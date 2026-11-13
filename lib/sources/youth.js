// 서울시 청년안심주택 (구 역세권 청년주택) — 모집공고 게시판 JSON.
import { fetchJson, dates, firstDate, sleep } from "../util.js";

const HOST = "https://soco.seoul.go.kr";
const BBS = "BMSR00015";

export async function collectYouth({ pages = 3, delay = 400 } = {}) {
  const out = [];
  for (let page = 1; page <= pages; page++) {
    const body = new URLSearchParams({
      bbsId: BBS, pageIndex: String(page), searchAdresGu: "", searchCondition: "", searchKeyword: "", optn2: "", optn5: "",
    });
    const d = await fetchJson(`${HOST}/youth/pgm/home/yohome/bbsListJson.json`, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", "X-Requested-With": "XMLHttpRequest" },
    });
    const list = d.resultList || [];
    if (!list.length) break;
    for (const r of list) {
      const applyDates = dates(r.optn4 || "");
      out.push({
        id: `youth:${r.boardId}`,
        source: "youth",
        list: "youth",
        title: String(r.nttSj || "").trim(),
        kind: r.optn2 === "1" ? "공공임대" : r.optn2 === "2" ? "민간임대" : "",
        round: r.optn5 === "1" ? "최초" : r.optn5 === "2" ? "추가" : "",
        region: "서울",
        company: r.optn3 || null,
        noticeDate: firstDate(r.optn1 || "") || null,
        applyStart: applyDates[0] || null,
        applyEnd: applyDates[1] || null,
        url: `${HOST}/youth/bbs/${BBS}/view.do?boardId=${r.boardId}&menuNo=400008`,
      });
    }
    await sleep(delay);
  }
  return out;
}
