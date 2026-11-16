// Categories (tabs) + tags for a normalized notice, and date-dependent status.
import { addDays, daysBetween } from "./util.js";

export const CATEGORIES = [
  { key: "lotto", label: "로또·알짜" },
  { key: "sale", label: "아파트 분양" },
  { key: "remndr", label: "무순위·줍줍" },
  { key: "youth", label: "청년주택" },
  { key: "public-rent", label: "공공·장기임대" },
  { key: "private-rent", label: "민간임대" },
  { key: "officetel", label: "오피스텔·도시형" },
];

const LONG_RENT = /(영구임대|국민임대|50년|통합공공임대|장기전세|장기안심|공공임대)/;
const NON_HOUSING = /(어린이집|상가|토지|점포|주차장|창업|공장)/;

export function classify(n) {
  const cats = new Set();
  const tags = new Set();
  const t = `${n.title} ${n.kind || ""}`;

  if (n.source === "applyhome") {
    if (n.list === "apt") {
      cats.add("sale");
      if (n.kind) tags.add(n.kind === "국민" ? "공공분양" : n.kind === "민영" ? "민간분양" : n.kind);
    } else if (n.list === "remndr") {
      cats.add("remndr");
      if (n.kind) tags.add(n.kind);
    } else if (n.list === "other") {
      if (/민간임대/.test(n.kind)) cats.add("private-rent");
      else cats.add("officetel");
      if (n.kind) tags.add(n.kind);
    }
  } else if (n.source === "lh") {
    if (NON_HOUSING.test(n.kind)) return { cats: [], tags: [], hidden: true };
    if (n.list === "sale") {
      cats.add(/잔여|무순위|선착순|일반매각/.test(n.title) ? "remndr" : "sale");
      tags.add(n.kind.includes("신혼") ? "신혼희망타운" : "공공분양");
    } else {
      cats.add("public-rent");
      if (n.kind) tags.add(n.kind);
    }
  } else if (n.source === "sh") {
    if (/분양/.test(n.title) && !/임대/.test(n.title)) cats.add("sale");
    else cats.add("public-rent");
  } else if (n.source === "elyes" || n.sourceType === "operator") {
    // 기업형 민간임대 운영사 (뉴스테이·공공지원민간임대) 재임대·공실·추가모집
    cats.add("private-rent");
    tags.add("기업형 민간임대");
    if (n.kind) tags.add(n.kind);
    if (/청년안심|청년주택/.test(`${n.title} ${n.complexName || ""} ${n.regionRaw || ""}`)) cats.add("youth");
  } else if (n.source === "myhome") {
    // 마이홈포털 (LH·SH 외 GH·iH·지방공사 공공주택)
    if (n.list === "sale") {
      cats.add(/잔여|무순위|선착순|추가\s*모집/.test(n.title) ? "remndr" : "sale");
      tags.add(/신혼희망/.test(t) ? "신혼희망타운" : "공공분양");
    } else {
      cats.add(/민간임대/.test(t) ? "private-rent" : "public-rent");
      if (n.kind) tags.add(n.kind);
    }
    if (n.inst && n.inst.length <= 4) tags.add(n.inst);
  } else if (n.source === "youth") {
    cats.add("youth");
    cats.add(n.kind === "민간임대" ? "private-rent" : "public-rent");
    tags.add("청년안심주택");
    if (n.kind) tags.add(n.kind);
    if (n.round) tags.add(`${n.round}모집`);
  }

  if (/청년|대학생|사회초년|행복주택/.test(t)) cats.add("youth");
  if (/청년/.test(t)) tags.add("청년");
  if (/신혼|신생아/.test(t)) tags.add("신혼·신생아");
  if (LONG_RENT.test(t) && !cats.has("sale")) tags.add("장기임대");
  if (/매입임대/.test(t)) tags.add("매입임대");
  if (/전세임대/.test(t)) tags.add("전세임대");
  if (/예비입주자/.test(t)) tags.add("예비입주자");

  const remarks = n.detail?.remarks || "";
  if (/투기과열/.test(remarks)) tags.add("투기과열지구");
  if (/청약과열|조정대상/.test(remarks)) tags.add("청약과열지역");
  if (/분양가상한제|상한제/.test(remarks)) tags.add("분양가상한제");
  if (/정비사업/.test(remarks)) tags.add("정비사업");

  return { cats: [...cats], tags: [...tags] };
}

/**
 * Status relative to `today`:
 *  upcoming(접수예정) · open(접수중) · closed(마감) · notice(일정 원문 확인)
 */
export function statusOf(n, today) {
  let start = n.applyStart;
  let end = n.applyEnd;
  if (n.closed) return { status: "closed", dday: null }; // source says 마감
  if (n.source === "youth" && start && !end) end = addDays(start, 2); // 보통 2~3일 접수
  if (n.source === "lh") {
    if (end && end < today) return { status: "closed", dday: null };
    if (n.lhStatus === "open") return { status: "open", dday: end ? daysBetween(today, end) : null };
    if (n.lhStatus === "closed") return { status: "closed", dday: null };
    return { status: "upcoming", dday: end ? daysBetween(today, end) : null, ddayKind: "end" };
  }
  if (!start && !end) return { status: "notice", dday: null };
  if (end && end < today) return { status: "closed", dday: null };
  if (start && start > today) return { status: "upcoming", dday: daysBetween(today, start), ddayKind: "start" };
  return { status: "open", dday: end ? daysBetween(today, end) : null, ddayKind: "end" };
}

/** Calendar events: [{date, end?, kind, label}] */
export function eventsOf(n) {
  const ev = [];
  const s = n.detail?.schedule || {};
  const add = (date, kind, label, end) => date && ev.push(end && end !== date ? { date, end, kind, label } : { date, kind, label });
  // 청약홈 columns are [해당지역, 기타지역] — separate days, not a range
  const perArea = (ds, label) => {
    const uniq = [...new Set(ds || [])];
    uniq.forEach((d, i) => add(d, "apply", uniq.length > 1 ? `${label} ${i === 0 ? "해당" : "기타"}` : label));
  };
  perArea(s.special, "특별공급");
  perArea(s.rank1, "1순위");
  perArea(s.rank2, "2순위");
  if (!s.special && !s.rank1 && (n.applyStart || n.applyEnd)) {
    if (n.source === "lh") add(n.applyEnd, "apply", "접수마감");
    else add(n.applyStart || n.applyEnd, "apply", "청약접수", n.applyEnd);
  }
  add(s.winner || n.winnerDate, "winner", "당첨발표");
  if (s.contract?.length) add(s.contract[0], "contract", "계약", s.contract[s.contract.length - 1]);
  return ev;
}
