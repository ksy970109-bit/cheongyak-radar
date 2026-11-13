// LH 청약플러스 — 임대주택(mi=1026) / 분양주택(mi=1027) 공고문 목록.
// Server-rendered list (default window = last 2 months, 50 rows/page). Detail pages
// need a POSTed session form, so links point at the list filtered by 공고명.
import { fetchText, rows, cells, attr, text, firstDate, normRegion, REGION_NAMES, sleep } from "../util.js";

const LIST = "https://apply.lh.or.kr/lhapply/apply/wt/wrtanc/selectWrtancList.do";
export const LH_LISTS = { rent: { mi: "1026", label: "LH 임대" }, sale: { mi: "1027", label: "LH 분양" } };

const STATUS = { 접수중: "open", 공고중: "upcoming", 정정공고중: "upcoming", 접수마감: "closed", 마감: "closed" };

function parse(list, html) {
  const out = [];
  for (const r of rows(html)) {
    if (!/class="wrtancInfoBtn"/.test(r.html)) continue;
    const c = cells(r.html);
    const a = /<a[^>]*class="wrtancInfoBtn"[^>]*>/.exec(r.html)[0];
    const panId = attr(a, "data-id1");
    const span = /<span>([\s\S]*?)<\/span>/.exec(c[2]?.html || "");
    const title = text((span ? span[1] : c[2]?.html || "").replace(/<em[\s\S]*?<\/em>/gi, ""));
    const statusText = c[7]?.text || "";
    let region = normRegion(c[3]?.text || "");
    // 매입임대 등은 지역이 '전국'으로 표기되지만 공고명이 "경남 거창군 …"처럼 시작하는 경우가 많음
    if (region === "전국" || region === "기타") {
      const fromTitle = normRegion(title.split(/\s+/)[0]);
      if (REGION_NAMES.includes(fromTitle)) region = fromTitle;
    }
    out.push({
      id: `lh:${panId}`,
      source: "lh",
      list,
      panId,
      title,
      kind: c[1]?.text || "",
      region,
      regionRaw: c[3]?.text || "",
      noticeDate: firstDate(c[5]?.text),
      applyStart: null,
      applyEnd: firstDate(c[6]?.text),
      statusText,
      lhStatus: STATUS[statusText.replace(/\s/g, "")] || null,
      url: `${LIST}?${new URLSearchParams({ mi: LH_LISTS[list].mi, srchY: "Y", panNm: title.slice(0, 30) })}`,
    });
  }
  return out;
}

export async function collectLH(list, { maxPages = 6, delay = 500 } = {}) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const html = await fetchText(`${LIST}?mi=${LH_LISTS[list].mi}&currPage=${page}`);
    if (/오류알림/.test(html) && !/wrtancInfoBtn/.test(html)) throw new Error("LH 오류 페이지(차단 또는 점검)");
    const items = parse(list, html);
    if (!items.length) break;
    all.push(...items);
    await sleep(delay);
  }
  const seen = new Set();
  return all.filter((n) => !seen.has(n.id) && seen.add(n.id));
}
