// 마이홈포털 공공주택 모집공고 (data.go.kr 15108420, 국토교통부) — LH·SH·GH·iH·지방공사의
// 공공임대(국민·영구·행복·통합·매입·전세임대 …)와 공공분양 공고를 한 곳에서.
// Same data.go.kr key as 실거래가; needs its own 활용신청. Rows are per 주택(단지), so one
// 공고 can come back as many rows — they are grouped by pblancId here.
import { decode, normRegion, todayKST, addDays, sleep } from "../util.js";

const BASE = "https://apis.data.go.kr/1613000/HWSPR02";
const OPS = [
  ["rsdtRcritNtcList", "rent"], // 공공임대주택 모집공고
  ["ltRsdtRcritNtcList", "sale"], // 공공분양주택 모집공고
];

export const ymd = (s) => {
  const d = String(s ?? "").replace(/\D/g, "");
  return d.length >= 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : null;
};
// the API sends 0 for "not applicable" (전세임대 보증금, 매입임대 지역 행 …)
const pos = (v) => {
  const n = Number(String(v ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** JSON or XML body → { items, total }. Throws on a non-OK resultCode. */
export function parseBody(body) {
  const t = String(body || "").trim();
  let items, total, code, msg;
  if (t.startsWith("{")) {
    const j = JSON.parse(t);
    const r = j.response || j;
    code = r.header?.resultCode;
    msg = r.header?.resultMsg;
    const b = r.body || {};
    let it = b.items?.item ?? b.item ?? b.items ?? [];
    if (!Array.isArray(it)) it = it && typeof it === "object" ? [it] : [];
    items = it;
    total = Number(b.totalCount || 0);
  } else {
    code = (/<resultCode>\s*(\w+)\s*</.exec(t) || [])[1];
    msg = (/<resultMsg>([\s\S]*?)</.exec(t) || [])[1];
    items = [...t.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) =>
      Object.fromEntries([...m[1].matchAll(/<(\w+)>([\s\S]*?)<\/\1>/g)].map((x) => [x[1], decode(x[2].trim())]))
    );
    total = Number((/<totalCount>\s*(\d+)/.exec(t) || [])[1] || 0);
  }
  // "00" = OK, "03" = NODATA
  if (code && !/^0+$/.test(code) && code !== "03") {
    const e = new Error(`마이홈 모집공고 API: ${msg || "오류"} (${code})`);
    e.code = "API";
    throw e;
  }
  return { items: items.filter(Boolean), total };
}

const INST = [
  [/LH|토지주택/, "LH"],
  [/^SH|서울주택|서울특별시\s*SH/, "SH"],
  [/GH|경기주택/, "GH"],
  [/iH|인천도시/, "iH"],
];
export const instKey = (s = "") => (INST.find(([re]) => re.test(s)) || [null, s.trim()])[1];

/** Rows → one notice per 공고 (pblancId). */
export function toNotices(rows, list) {
  const groups = new Map();
  for (const it of rows) {
    const id = String(it.pblancId || "").trim();
    if (!id) continue;
    (groups.get(id) || groups.set(id, []).get(id)).push(it);
  }
  // a 정정공고 points at the 공고 it replaces — keep only the latest
  const replaced = new Set(rows.map((x) => String(x.beforePblancId || "").trim()).filter(Boolean));
  const out = [];
  for (const [id, all] of groups) {
    if (replaced.has(id)) continue;
    // houseSn 0 = 공고 단위 요약 행; it repeats the 단지 행 when those exist
    const items = all.some((x) => +x.houseSn > 0) ? all.filter((x) => +x.houseSn > 0) : all;
    const f = items[0];
    const pick = (k) => items.map((x) => x[k]).find((v) => v != null && String(v).trim() !== "");
    const regions = [...new Set(items.map((x) => normRegion(String(x.brtcNm || ""))).filter((r) => r && r !== "기타"))];
    const places = [...new Set(items.map((x) => [x.brtcNm, x.signguNm].filter(Boolean).join(" ")).filter(Boolean))];
    const complexes = items.map((x) => ({
      name: String(x.hsmpNm || "").trim(),
      address: String(x.fullAdres || "").trim(),
      supply: pos(x.sumSuplyCo) ?? pos(x.suplyHoCo),
      households: pos(x.totHshldCo),
      deposit: pos(x.rentGtn),
      rent: pos(x.mtRntchrg),
      // 분양: 계약금 + 중도금 + 잔금 = 최소 분양가 (원)
      price: list === "sale" ? pos((pos(x.enty) || 0) + (pos(x.prtpay) || 0) + (pos(x.surlus) || 0)) : null,
      heating: String(x.heatMthdNm || "").trim() || undefined,
    }));
    const supply = complexes.reduce((s, c) => s + (c.supply || 0), 0);
    const kind = list === "sale" ? "공공분양" : String(pick("suplyTyNm") || pick("houseTyNm") || "공공임대").trim();
    const tel = String(pick("refrnc") || "").trim();
    out.push({
      id: `myhome:${id}`,
      source: "myhome",
      sourceName: "마이홈",
      list,
      pblancId: id,
      beforePblancId: pick("beforePblancId") || undefined,
      title: decode(String(f.pblancNm || "").trim()),
      kind,
      supplyType: String(pick("houseTyNm") || "").trim() || undefined,
      inst: instKey(String(pick("suplyInsttNm") || "")),
      company: String(pick("suplyInsttNm") || "").trim() || null,
      region: regions.length === 1 ? regions[0] : regions.length ? "전국" : "기타",
      regionRaw: places.length === 1 ? places[0] : places.length ? `${places.slice(0, 3).join(", ")}${places.length > 3 ? ` 외 ${places.length - 3}곳` : ""}` : "",
      noticeDate: ymd(pick("rcritPblancDe")),
      applyStart: ymd(pick("beginDe")),
      applyEnd: ymd(pick("endDe")),
      winnerDate: ymd(pick("przwnerPresnatnDe")),
      statusText: String(pick("sttusNm") || "").trim() || undefined,
      closed: /마감|종료|완료/.test(String(pick("sttusNm") || "")) || undefined,
      tel: (tel.match(/\d{2,4}-\d{3,4}-\d{4}|1\d{3}-\d{4}/) || [])[0],
      // LH 상세 링크(selectWrtancInfo.do)는 세션 없이 열면 오류 페이지라 마이홈 상세를 우선
      url: (instKey(String(pick("suplyInsttNm") || "")) === "LH" ? pick("pcUrl") || pick("url") : pick("url") || pick("pcUrl")) || "https://www.myhome.go.kr/",
      detail: {
        address: complexes.length === 1 && complexes[0].address ? complexes[0].address : undefined,
        households: supply || undefined,
        complexes: complexes.filter((c) => c.name || c.address).slice(0, 60),
        complexCount: complexes.length,
        myhomeUrl: pick("pcUrl") || undefined,
      },
    });
  }
  return out;
}

/** molit = the data.go.kr client (handles the key, retries, and key errors without echoing the URL). */
export async function collectMyhome(molit, { months = 3, rows = 300, maxPages = 8, delay = 300 } = {}) {
  const today = todayKST();
  const ym = (d) => d.slice(0, 7).replace("-", "");
  const range = { yearMtBegin: ym(addDays(today, -months * 31)), yearMtEnd: ym(today) };
  const out = [];
  for (const [op, list] of OPS) {
    const rowsAll = [];
    for (let page = 1; page <= maxPages; page++) {
      const body = await molit.get(`${BASE}/${op}`, { ...range, pageNo: String(page), numOfRows: String(rows) });
      const { items, total } = parseBody(body);
      rowsAll.push(...items);
      if (!items.length || page * rows >= total) break;
      await sleep(delay);
    }
    out.push(...toNotices(rowsAll, list));
  }
  return out;
}

// ---------- overlap with the direct sources ----------
// 마이홈 repeats LH·SH (and 청약홈 for 분양). Keep the direct source's copy — it has
// richer detail — and drop the 마이홈 one when the same 공고 is already there.
const STOP = /(\[[^\]]*정정[^\]]*\]|\([^)]*정정[^)]*\)|모집\s*공고|입주자|공고문?|모집|정정|재공고|안내|및|의|\s|[^\p{L}\p{N}])/gu;
const normTitle = (s = "") => s.replace(STOP, "").toLowerCase();
const bigrams = (s) => {
  const b = new Map();
  for (let i = 0; i < s.length - 1; i++) b.set(s.slice(i, i + 2), (b.get(s.slice(i, i + 2)) || 0) + 1);
  return b;
};
export function similar(a, b) {
  const x = normTitle(a);
  const y = normTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (Math.min(x.length, y.length) >= 6 && (x.includes(y) || y.includes(x))) return 0.95;
  const A = bigrams(x);
  const B = bigrams(y);
  let hit = 0;
  for (const [g, c] of A) hit += Math.min(c, B.get(g) || 0);
  return (2 * hit) / (x.length - 1 + y.length - 1 || 1);
}

const PEERS = { LH: ["lh", "applyhome"], SH: ["sh", "youth", "applyhome"] };

/** Returns the notices with 마이홈 duplicates of LH/SH/청약홈/청년안심 notices removed. */
export function dropMyhomeDupes(notices, threshold = 0.72) {
  const others = notices.filter((n) => n.source !== "myhome");
  const near = (a, b) => !a || !b || Math.abs((Date.parse(a) - Date.parse(b)) / 864e5) <= 10;
  // 정정공고 from a later run replaces the copy kept from an earlier run
  const replaced = new Set(notices.filter((n) => n.source === "myhome" && n.beforePblancId).map((n) => `myhome:${n.beforePblancId}`));
  return notices.filter((n) => {
    if (n.source !== "myhome") return true;
    if (replaced.has(n.id)) return false;
    const peers = PEERS[n.inst] || ["applyhome", ...(/청년안심/.test(n.title) ? ["youth"] : [])];
    return !others.some((o) => {
      if (!peers.includes(o.source)) return false;
      const s = similar(o.title, n.title);
      // same title re-posted later (상시 모집 재게시) is still the same 공고
      return s === 1 || (s >= threshold && near(o.noticeDate, n.noticeDate));
    });
  });
}
