// 청약홈 (한국부동산원) — APT 분양, APT 무순위/잔여세대, 오피스텔·도시형·(공공지원)민간임대.
// List pages are server-rendered tables (10 rows/page, newest notice first); the detail
// "popup" pages answer plain GETs with houseManageNo/pblancNo.
import { fetchText, rows, cells, attr, tables, text, dates, firstDate, normRegion, num, sleep, addDays, todayKST } from "../util.js";

const BASE = "https://www.applyhome.co.kr";

export const LISTS = {
  apt: {
    label: "APT 분양",
    path: "/ai/aia/selectAPTLttotPblancListView.do",
    detail: "/ai/aia/selectAPTLttotPblancDetail.do",
    cols: { region: 0, kind: 1, supplyType: 2, company: 4, tel: 5, noticeDate: 6, apply: 7, winner: 8 },
  },
  remndr: {
    label: "APT 무순위·잔여세대",
    path: "/ai/aia/selectAPTRemndrLttotPblancListView.do",
    detail: "/ai/aia/selectAPTRemndrLttotPblancDetailView.do",
    cols: { region: 0, kind: 1, company: 3, noticeDate: 4, apply: 5, winner: 6 },
  },
  other: {
    label: "오피스텔·도시형·민간임대",
    path: "/ai/aia/selectOtherLttotPblancListView.do",
    detail: "/ai/aia/selectPRMOLttotPblancDetailView.do",
    cols: { region: 0, kind: 1, company: 3, tel: 4, noticeDate: 5, apply: 6, winner: 7 },
  },
};

function detailUrl(list, n) {
  const q = new URLSearchParams({ houseManageNo: n.hmno, pblancNo: n.pbno });
  if (n.hsecd && list === "other") q.set("houseSecd", n.hsecd);
  return BASE + LISTS[list].detail + "?" + q;
}

function parseListPage(list, html) {
  const cfg = LISTS[list];
  const out = [];
  for (const r of rows(html)) {
    const pbno = attr(r.attrs, "data-pbno");
    if (!pbno) continue;
    const c = cells(r.html).map((x) => x.text);
    const col = (k) => (cfg.cols[k] != null ? c[cfg.cols[k]] || "" : "");
    const apply = dates(col("apply"));
    const n = {
      id: `applyhome:${list}:${pbno}`,
      source: "applyhome",
      list,
      pbno,
      hmno: attr(r.attrs, "data-hmno") || pbno,
      hsecd: attr(r.attrs, "data-hsecd") || null,
      title: (attr(r.attrs, "data-honm") || "").trim(),
      region: normRegion(col("region")),
      kind: col("kind"),
      supplyType: col("supplyType") || null,
      company: col("company") || null,
      tel: (col("tel") || "").replace(/^☎\s*/, "") || null,
      noticeDate: firstDate(col("noticeDate")),
      applyStart: apply[0] || null,
      applyEnd: apply[1] || apply[0] || null,
      winnerDate: firstDate(col("winner")),
    };
    n.url = detailUrl(list, n);
    out.push(n);
  }
  return out;
}

/** Walk list pages newest-first until notices are older than `sinceDays`. */
export async function collectList(list, { sinceDays = 75, maxPages = 25, delay = 350 } = {}) {
  const cutoff = addDays(todayKST(), -sinceDays);
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const html = await fetchText(`${BASE}${LISTS[list].path}?pageIndex=${page}`);
    const items = parseListPage(list, html);
    if (!items.length) break;
    all.push(...items);
    // Lists are ordered by notice date (desc); stop once a whole page is past the cutoff.
    if (items.every((n) => (n.noticeDate || "9999") < cutoff)) break;
    await sleep(delay);
  }
  // A notice can be listed twice (e.g. 정정공고); keep the first (newest).
  const seen = new Set();
  return all.filter((n) => (n.noticeDate || "9999") >= cutoff && !seen.has(n.id) && seen.add(n.id));
}

// ---------- detail ----------

/** Value cell following a label cell, e.g. <td>공급위치</td><td>…</td>. */
function labelValue(html, label) {
  const re = new RegExp(`<t[dh][^>]*>\\s*${label}\\s*</t[dh]>\\s*<td[^>]*>([\\s\\S]*?)</td>`, "i");
  const m = re.exec(html);
  return m ? m[1] : null;
}

// 주택형 "084.9409A", "024.5100", "59A", "20OA" — a bare integer is a count, not a type
const TYPE_RE = /^(\d{2,3}\.\d+[A-Za-z]*\d*|\d{2,3}[A-Za-z]+\d*)$/;

export function parseDetail(html) {
  const d = {};
  const loc = labelValue(html, "공급위치");
  if (loc) d.address = text(loc);
  const scale = labelValue(html, "공급규모");
  if (scale) d.households = num(text(scale));

  // Schedule rows: label in the first cell, dates in the rest.
  const sched = {};
  for (const t of tables(html)) {
    if (!/청약일정|청약접수|모집공고일/.test(t)) continue;
    for (const r of rows(t)) {
      const c = cells(r.html);
      if (!c.length) continue;
      // rows under the rowspan "청약접수" header start with the sub-label (특별공급/1순위/2순위)
      const label = c[0].text.replace(/\s+/g, "");
      const ds = dates(c.slice(1).map((x) => x.text).join(" "));
      if (/모집공고일/.test(label)) sched.notice = ds[0] || null;
      else if (/특별공급/.test(label)) sched.special = ds;
      else if (/^1순위/.test(label)) sched.rank1 = ds;
      else if (/^2순위/.test(label)) sched.rank2 = ds;
      else if (/당첨자/.test(label)) sched.winner = ds[0] || null;
      else if (/계약/.test(label)) sched.contract = ds;
      else if (/청약접수|접수/.test(label) && ds.length) sched.apply = ds;
      // homepage link inside the 당첨자 발표일 cell
      if (/당첨자/.test(label)) {
        const href = /href="(https?:\/\/[^"]+)"/i.exec(r.html);
        if (href && !/applyhome/.test(href[1])) d.homepage = href[1];
      }
    }
  }
  d.schedule = sched;

  const remark = /특이사항\s*:\s*([^<]+)/.exec(html);
  d.remarks = remark ? text(remark[1]) : "";

  const pdf = /href="([^"]*getAtchmnfl\.do[^"]*)"/i.exec(html);
  if (pdf) d.pdfUrl = pdf[1].replace(/&amp;/g, "&");

  // Units. Columns are located by header name, because layouts differ per list:
  //   APT 공급대상   주택구분 | 주택형 | 공급면적 | 일반 | 특별 | 계   (two-row header)
  //   APT 공급금액   주택형 | 공급금액(최고가 기준) | 2순위 청약금
  //   무순위        주택형 | 공급세대수 | 분양가   — or 주택형 | 공급세대수 | 비고 (no price)
  //   오피스텔      주택구분 | 군 | 타입 | 전용면적 | 공급세대수  /  군 | 타입 | 공급금액 | 청약신청금
  const units = new Map();
  for (const t of tables(html)) {
    const caption = text((/<caption[^>]*>([\s\S]*?)<\/caption>/i.exec(t) || [])[1] || "");
    if (/특별공급/.test(caption)) continue;
    const ths = [...t.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => text(m[1]).replace(/\s+/g, ""));
    const H = (re) => ths.findIndex((h) => re.test(h));
    const typeHdr = H(/^(주택형|타입)$/);
    if (typeHdr < 0) continue;
    const aptSupply = /공급대상/.test(caption) && ths.includes("일반") && ths.includes("특별");
    const col = { price: H(/^(공급금액|분양가)/), hh: H(/^공급세대수$/), excl: H(/^전용면적$/), supply: H(/공급면적/) };
    for (const r of rows(t)) {
      const c = cells(r.html).filter((x) => x.tag === "td").map((x) => x.text);
      const i = c.findIndex((x) => TYPE_RE.test(x));
      if (i < 0) continue;
      const at = (hdr) => (hdr >= 0 ? c[i + hdr - typeHdr] : undefined);
      const type = c[i];
      const u = units.get(type) || { type, area: num(type) };
      if (aptSupply) {
        // colspan header → positional: [공급면적, 일반, 특별, 계, 관리번호]
        const rest = c.slice(i + 1).map(num);
        if (rest[0] && rest[0] > 10) u.supplyArea = rest[0];
        const counts = rest.slice(1).filter((x) => x != null && x < 100000);
        if (counts.length >= 3) [u.general, u.special, u.total] = counts;
        else if (counts.length) u.total = counts[counts.length - 1];
      } else {
        const p = num(at(col.price));
        if (p && p >= 1000) u.price = p; // 만원 (최고가 기준); smaller numbers are counts/fees
        const hh = num(at(col.hh));
        if (hh != null && hh < 100000) u.total = hh;
        const ex = num(at(col.excl));
        if (ex) u.area = ex;
        const sa = num(at(col.supply));
        if (sa && sa > 10) u.supplyArea = sa;
      }
      units.set(type, u);
    }
  }
  d.units = [...units.values()].filter((u) => u.area);

  const mv = /입주예정월\s*:\s*(\d{4})[.\-](\d{1,2})/.exec(html);
  if (mv) d.moveIn = `${mv[1]}-${mv[2].padStart(2, "0")}`;

  // 기타사항: 시행사 / 시공사
  for (const t of tables(html)) {
    if (!/시공사/.test(t)) continue;
    const rs = rows(t).map((r) => cells(r.html).map((x) => x.text));
    const h = rs.find((r) => r.includes("시공사"));
    const v = rs[rs.indexOf(h) + 1];
    if (h && v) {
      d.builder = v[h.indexOf("시공사")] || null;
      d.developer = v[h.indexOf("시행사")] || null;
    }
  }
  return d;
}

export async function fetchDetail(n) {
  return parseDetail(await fetchText(n.url));
}
