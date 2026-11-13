// SH 서울주택도시개발공사 — 공고 및 공지 게시판. The board mixes 보상·공사·채용 notices
// and its category filter is applied client-side, so we read recent pages and keep
// housing recruitment notices by title.
import { fetchText, rows, cells, text, firstDate, sleep } from "../util.js";

const BOARD = "https://www.i-sh.co.kr/main/lay2/program/S1T294C297/www/brd/m_247";

const INCLUDE = /(모집|공급|청약|입주자)/;
const HOUSING = /(분양|임대|전세|행복|안심|주택|하우징|든든)/;
const EXCLUDE =
  /(당첨자|계약대상|발표|결과|서류|안내문|휴무|보상|공사|용역|감정평가|채용|입찰|설명회|선정|명단|추첨|점검|사업시행자|협상|매입\s*공고|매도|공모|위탁|운영자|상가|토지|점포|주차|돌보미|센터|사무지원|재계약|기간제|인턴)/;

function parse(html) {
  const out = [];
  for (const r of rows(html)) {
    const m = /getDetailView\('(\d+)'\)/.exec(r.html);
    if (!m) continue;
    const c = cells(r.html);
    const title = text(
      (/<a[^>]*getDetailView[^>]*>([\s\S]*?)<\/a>/.exec(r.html) || [])[1]?.replace(/<span class="icoNew">[\s\S]*?<\/span>/, "") || ""
    );
    const date = c.map((x) => firstDate(x.text)).find(Boolean) || null;
    out.push({ seq: m[1], title, dept: c[2]?.text || "", noticeDate: date });
  }
  return out;
}

export async function collectSH({ maxPages = 12, delay = 400 } = {}) {
  const out = [];
  const seen = new Set();
  for (let page = 1; page <= maxPages; page++) {
    const html = await fetchText(`${BOARD}/list.do?page=${page}`);
    const items = parse(html);
    if (!items.length) break;
    for (const it of items) {
      if (seen.has(it.seq)) continue;
      seen.add(it.seq);
      if (!INCLUDE.test(it.title) || !HOUSING.test(it.title) || EXCLUDE.test(it.title)) continue;
      out.push({
        id: `sh:${it.seq}`,
        source: "sh",
        list: "board",
        title: it.title,
        kind: "",
        region: "서울",
        company: "SH공사",
        noticeDate: it.noticeDate,
        applyStart: null,
        applyEnd: null,
        url: `${BOARD}/view.do?seq=${it.seq}`,
      });
    }
    await sleep(delay);
  }
  return out;
}
