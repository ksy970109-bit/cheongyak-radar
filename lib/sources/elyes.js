// 롯데건설 엘리스(Elyes) — 롯데캐슬 뉴스테이·어바니엘·청년안심주택 등 민간임대 단지의
// 재임대 / 공실세대 / 추가모집 공고. 본문은 대부분 이미지라 일정은 제목에서 읽는다:
//   "[어바니엘 한강] 공실세대 모집공고 (접수기간: 11/13~11/15)"
//   "[사송 롯데캐슬] 재임대 모집공고(접수기간: 26.11.11~26.11.15)"
//   "[독산역 롯데캐슬] 신혼부부특별공급세대 재임대 모집공고(접수: '26.11.13(금) 10~15시)"
//   "[남영역 롯데캐슬] 공실세대 모집공고 (공고일:'26.11.13)"
import { fetchJson, decode, koDates, normRegion, sleep } from "../util.js";

const HOST = "https://www.elyes.co.kr";
const FORM = { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" };

const squash = (s = "") => s.replace(/\(.*?\)/g, "").replace(/\s+/g, "");

/** Complex name → address, from Elyes' own complex catalog. */
async function complexes() {
  const out = [];
  for (const categoryDiv of ["0100", "0200", "0400"]) {
    try {
      const j = await fetchJson(`${HOST}/complex/data/list`, {
        method: "POST",
        headers: FORM,
        body: new URLSearchParams({ categoryDiv, i_iNowPageNo: "1", i_iPageSize: "100" }),
      });
      for (const c of j.stayList || []) out.push({ name: c.proj_name, key: squash(c.proj_name), address: c.location || "" });
    } catch {}
  }
  return out;
}

function findComplex(list, name) {
  const k = squash(name);
  return list.find((c) => c.key.includes(k) || k.includes(c.key)) || null;
}

/** Dates inside a title; "26.11.11" and "11/13" forms are normalized first. */
export function titleDates(title, postedYmd) {
  const year = +postedYmd.slice(0, 4);
  const t = title.replace(/(?<![\d'‘’.])(\d{2})\.(\d{1,2})\.(\d{1,2})/g, "'$1.$2.$3");
  let ds = koDates(t, year);
  if (!ds.length) {
    let y = year;
    let last = 0;
    ds = [...t.matchAll(/(?<!\d)(\d{1,2})\/(\d{1,2})(?!\d)/g)].map((m) => {
      const mo = +m[1];
      if (last && mo < last) y++;
      last = mo;
      return `${y}-${String(mo).padStart(2, "0")}-${String(+m[2]).padStart(2, "0")}`;
    });
  }
  return ds;
}

const KINDS = [
  [/신혼부부/, "신혼부부 재임대"],
  [/공실/, "공실세대"],
  [/재임대/, "재임대"],
  [/추가\s*모집/, "추가모집"],
  [/임대차계약|계약\s*신청/, "공실세대"],
];

export async function collectElyes({ pages = 2, pageSize = 40, delay = 400 } = {}) {
  const cx = await complexes();
  const out = [];
  for (let page = 1; page <= pages; page++) {
    const j = await fetchJson(`${HOST}/post/data/recruit/list`, {
      method: "POST",
      headers: FORM,
      body: new URLSearchParams({ i_iNowPageNo: String(page), i_iPageSize: String(pageSize) }),
    });
    const rows = j.recruitList || [];
    if (!rows.length) break;
    for (const r of rows) {
      const raw = decode(decode(String(r.nt_title || ""))).trim();
      // follow-up posts (접수 현황 / 결과) are not new recruitments
      if (/접수\s*현황|결과|당첨|발표|명단/.test(raw)) continue;
      const posted = String(r.row_input_date || "").replace(/\./g, "-");
      const closed = /마감\s*(되었|됨|완료)|접수\s*마감/.test(raw);
      const title = raw.replace(/[\s_\-–—→>,.]*(마감\s*되었습니다|마감되었습니다|마감)[.,]?\s*$/, "").replace(/-+>\s*$/, "").trim();
      const complexName = (/^\[([^\]]+)\]/.exec(title) || [])[1] || "";
      const complex = findComplex(cx, complexName);
      const ds = titleDates(title, posted);
      const isNoticeDate = /공고일/.test(title) && !/접수|모집기간/.test(title);
      out.push({
        id: `elyes:${r.nt_idx}`,
        source: "elyes",
        sourceName: "엘리스(롯데)",
        list: "rent",
        title,
        complexName,
        kind: (KINDS.find(([re]) => re.test(title)) || [null, "재임대"])[1],
        region: complex ? normRegion(complex.address) : "기타",
        regionRaw: complex?.address || "",
        company: "롯데건설 엘리스",
        noticeDate: isNoticeDate ? ds[0] || posted : posted,
        applyStart: isNoticeDate ? null : ds[0] || null,
        applyEnd: isNoticeDate ? null : ds[ds.length - 1] || null,
        closed,
        url: `${HOST}/post/recruit/detail?i_sNtCode=BHCT&nt_idx=${encodeURIComponent(r.nt_idx)}`,
      });
    }
    await sleep(delay);
  }
  return out;
}
