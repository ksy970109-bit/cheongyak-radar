// 공공데이터포털(data.go.kr) — 국토교통부 아파트 매매 실거래가 + 행정안전부 법정동코드.
// One service key works for both once each API's 활용신청 is approved.
import fs from "fs";
import path from "path";
import { UA, sleep } from "./util.js";

const RTMS = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade";
const REGION = "https://apis.data.go.kr/1741000/StanReginCd/getStanReginCdList";

export class MolitError extends Error {
  constructor(code, msg) {
    super(msg);
    this.code = code;
  }
}

const KEY_ERRORS = {
  "30": "등록되지 않은 서비스키입니다. (활용신청 승인 후 1~2시간 걸릴 수 있어요)",
  "22": "일일 호출 한도를 초과했습니다.",
  "20": "이 API에 대한 활용신청이 승인되지 않았습니다.",
  "12": "해당 오픈API 서비스가 없거나 폐기되었습니다.",
  "31": "기한이 만료된 서비스키입니다.",
};

export function normKey(k = "") {
  k = String(k).trim();
  // data.go.kr shows an "Encoding" and a "Decoding" key — accept either.
  if (/%[0-9A-F]{2}/i.test(k)) {
    try {
      k = decodeURIComponent(k);
    } catch {}
  }
  return k;
}

const tag = (xml, name) => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? m[1].trim() : "";
};

function checkError(body, api) {
  if (/OpenAPI_ServiceResponse|returnReasonCode/.test(body)) {
    const code = (/returnReasonCode"?\s*[:>]\s*"?(\d+)/.exec(body) || [])[1];
    throw new MolitError("KEY", `${api}: ${KEY_ERRORS[code] || "서비스키 오류 (" + code + ")"}`);
  }
}

export class Molit {
  constructor(dir, getKey) {
    this.dir = path.join(dir, "molit");
    fs.mkdirSync(path.join(this.dir, "rtms"), { recursive: true });
    this.getKey = getKey;
    this.regionFile = path.join(this.dir, "regions.json");
    try {
      this.regions = JSON.parse(fs.readFileSync(this.regionFile, "utf8"));
    } catch {
      this.regions = {};
    }
    this.calls = 0;
  }

  hasKey() {
    return !!this.getKey();
  }

  // data.go.kr answers key problems with HTTP 403 + an error body, so read the body
  // regardless of status. Errors never echo the URL — it carries the service key.
  async get(base, params, key = this.getKey()) {
    if (!key) throw new MolitError("NOKEY", "공공데이터포털 서비스키가 없습니다.");
    const api = base.includes("StanReginCd") ? "법정동코드 API" : "아파트 실거래가 API";
    const url = `${base}?${new URLSearchParams({ serviceKey: normKey(key), ...params })}`;
    for (let attempt = 0; ; attempt++) {
      this.calls++;
      try {
        const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(25000) });
        const body = await res.text();
        if (!res.ok) {
          checkError(body, api);
          throw new MolitError("API", `${api}: HTTP ${res.status}`);
        }
        return body;
      } catch (e) {
        if (e instanceof MolitError || attempt >= 1) throw e instanceof MolitError ? e : new MolitError("NET", `${api} 연결 실패`);
        await sleep(1500);
      }
    }
  }

  // ---------- 법정동코드 → 시군구(LAWD_CD 5자리) ----------
  async lookupRegion(name, key) {
    const body = await this.get(REGION, { type: "json", pageNo: "1", numOfRows: "100", flag: "Y", locatadd_nm: name }, key);
    checkError(body, "법정동코드 API");
    let rowsArr = [];
    try {
      const j = JSON.parse(body);
      for (const part of j.StanReginCd || []) if (part.row) rowsArr = part.row;
    } catch {
      throw new MolitError("API", "법정동코드 API 응답을 읽지 못했습니다: " + body.slice(0, 120));
    }
    const exact = rowsArr.find((r) => r.locatadd_nm?.trim() === name && r.sgg_cd !== "000");
    const any = exact || rowsArr.find((r) => r.sgg_cd && r.sgg_cd !== "000");
    return any ? String(any.region_cd).slice(0, 5) : null;
  }

  /** "서울특별시 영등포구 문래동3가 27-1" → { sgg: "11560", umd: "문래동3가" } */
  async resolve(address) {
    address = String(address || "");
    // "파주메디컬클러스터 도시개발구역 A2BL (경기도 파주시 서패동 …)" → start at the 시도 name
    const sido = /(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|충북|충남|전라|전북|전남|경상|경북|경남|제주)[가-힣]*\s/.exec(address);
    if (sido && sido.index > 0) address = address.slice(sido.index);
    const tokens = address.replace(/[()]/g, " ").replace(/\s+/g, " ").trim().split(" ");
    if (tokens.length < 2) return null;
    if (/^세종/.test(tokens[0])) return { sgg: "36110", umd: tokens.find((t) => /(동|읍|면|가)$/.test(t)) || null, name: "세종특별자치시" };
    const cands = [];
    if (/구$/.test(tokens[2] || "") && /시$/.test(tokens[1])) cands.push(tokens.slice(0, 3).join(" "));
    cands.push(tokens.slice(0, 2).join(" "));
    // 신설 특례시·행정구 명칭이 법정동코드와 다를 수 있어 '시'로 대체한 이름도 시도
    for (const c of [...cands]) if (/특례시/.test(c)) cands.push(c.replace("특례시", "시"));
    // "인천광역시 검단지구 …" 처럼 택지지구명으로 시작하면 같은 이름의 구(검단구)를 시도
    const stem = tokens[1].replace(/(지구|신도시|택지개발지구|공공주택지구)$/, "");
    if (stem !== tokens[1] && stem.length >= 2) cands.push(`${tokens[0]} ${stem}구`, `${tokens[0]} ${stem}시`, `${tokens[0]} ${stem}군`);
    const umd = legalDong(address, tokens);
    for (const name of cands) {
      if (!(name in this.regions)) {
        this.regions[name] = await this.lookupRegion(name);
        fs.writeFileSync(this.regionFile, JSON.stringify(this.regions, null, 1));
      }
      if (this.regions[name]) return { sgg: this.regions[name], umd, name };
    }
    return null;
  }

  // ---------- 실거래가 ----------
  /** Trades for one 시군구 / month, cached on disk (recent months refresh daily). */
  async trades(sgg, ym) {
    const file = path.join(this.dir, "rtms", `${sgg}_${ym}.json`);
    const now = new Date(Date.now() + 9 * 3600e3);
    const curYm = now.toISOString().slice(0, 7).replace("-", "");
    const ageLimit = ym >= prevYm(curYm, 2) ? 24 * 3600e3 : 30 * 24 * 3600e3;
    try {
      const c = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Date.now() - c.at < ageLimit) return c.items;
    } catch {}
    const items = [];
    for (let page = 1; page <= 10; page++) {
      const body = await this.get(RTMS, { LAWD_CD: sgg, DEAL_YMD: ym, pageNo: String(page), numOfRows: "1000" });
      checkError(body, "아파트 실거래가 API");
      const code = tag(body, "resultCode");
      if (code && !/^0+$/.test(code)) throw new MolitError("API", `실거래가 API 오류: ${tag(body, "resultMsg") || code}`);
      const chunk = [...body.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => parseTrade(m[1]));
      items.push(...chunk.filter(Boolean));
      const total = Number(tag(body, "totalCount") || 0);
      if (items.length >= total || chunk.length < 1000) break;
      await sleep(150);
    }
    fs.writeFileSync(file, JSON.stringify({ at: Date.now(), items }));
    return items;
  }

  async recentTrades(sgg, months = 12) {
    const now = new Date(Date.now() + 9 * 3600e3);
    let ym = now.toISOString().slice(0, 7).replace("-", "");
    const out = [];
    for (let i = 0; i < months; i++) {
      out.push(...(await this.trades(sgg, ym)));
      ym = prevYm(ym, 1);
    }
    return out;
  }

  /** Validate a key against both APIs. Returns a short report. */
  async testKey(key) {
    const sgg = await this.lookupRegion("서울특별시 영등포구", key);
    if (!sgg) throw new MolitError("API", "법정동코드 API 응답에 영등포구가 없습니다.");
    const ym = prevYm(new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7).replace("-", ""), 1);
    const body = await this.get(RTMS, { LAWD_CD: sgg, DEAL_YMD: ym, pageNo: "1", numOfRows: "10" }, key);
    checkError(body, "아파트 실거래가 API");
    const code = tag(body, "resultCode");
    if (code && !/^0+$/.test(code)) throw new MolitError("API", `실거래가 API 오류: ${tag(body, "resultMsg") || code}`);
    return { sgg, ym, total: Number(tag(body, "totalCount") || 0) };
  }
}

/**
 * 법정동 name as the 실거래가 API reports it (umdNm):
 *  "문래동3가" stays, "초량3동"(행정동) → "초량동", "고덕국제8로 10(고덕동 2705-1)" → "고덕동".
 */
export function legalDong(address, tokens) {
  const DONG = /^[가-힣]+[0-9]*(동[0-9]*가|동|가|읍|면)$/;
  let found = null;
  for (const raw of tokens.slice(2)) {
    const t = raw.replace(/^[^가-힣]+/, "").replace(/[^가-힣0-9]+$/, "");
    if (DONG.test(t) && !/(구|시|군)$/.test(t)) {
      found = t;
      break;
    }
  }
  if (!found) {
    const m = /\(([가-힣]+[0-9]*(?:동[0-9]*가|동|가|읍|면))[\s,)]/.exec(address);
    if (m) found = m[1];
  }
  if (!found) return null;
  // 행정동(숫자+동) → 법정동; 숫자+가 형태(문래동3가)는 그대로
  const admin = /^([가-힣]+?)[0-9]+동$/.exec(found);
  return admin ? admin[1] + "동" : found;
}

function prevYm(ym, n) {
  let y = +ym.slice(0, 4);
  let m = +ym.slice(4) - n;
  while (m < 1) {
    m += 12;
    y--;
  }
  return `${y}${String(m).padStart(2, "0")}`;
}

function parseTrade(x) {
  // new (camelCase) field names, with the legacy Korean tags as fallback
  const g = (a, b) => tag(x, a) || (b ? tag(x, b) : "");
  const price = Number(g("dealAmount", "거래금액").replace(/[^\d]/g, ""));
  const area = Number(g("excluUseAr", "전용면적"));
  if (!price || !area) return null;
  return {
    name: g("aptNm", "아파트"),
    umd: g("umdNm", "법정동").trim(),
    build: Number(g("buildYear", "건축년도")) || null,
    price, // 만원
    area,
    floor: Number(g("floor", "층")) || null,
    ymd: `${g("dealYear", "년")}-${g("dealMonth", "월").padStart(2, "0")}-${g("dealDay", "일").padStart(2, "0")}`,
    cancelled: /O/.test(g("cdealType", "해제여부")),
  };
}
