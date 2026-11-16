// 청약레이더 front-end — one fetch of /api/notices, everything else client-side.
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const store = {
  get(k, d) {
    try {
      const v = localStorage.getItem("cr:" + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem("cr:" + k, JSON.stringify(v));
    } catch {}
  },
};

let DATA = null;
const F = Object.assign(
  { cat: "all", status: "active", region: "", kind: "", sort: "deadline", q: "", view: "list", month: null },
  store.get("filters", {})
);
F.q = "";

const SRC = { applyhome: "청약홈", lh: "LH", sh: "SH", youth: "청년안심주택", elyes: "엘리스(롯데)", myhome: "마이홈" };
const srcName = (n) => n.sourceName || SRC[n.source] || n.source;
const CAT_LABEL = {};
const DOW = ["일", "월", "화", "수", "목", "금", "토"];

// ---------- formatting ----------
function won(man) {
  if (man == null) return "-";
  const a = Math.abs(man);
  const sign = man < 0 ? "−" : "";
  if (a >= 10000) {
    const eok = a / 10000;
    return sign + (eok >= 10 ? eok.toFixed(1) : eok.toFixed(2)).replace(/\.?0+$/, "") + "억";
  }
  return sign + Math.round(a).toLocaleString() + "만";
}
const signed = (man) => (man > 0 ? "+" : "") + won(man);
function md(d, withDow = true) {
  if (!d) return "";
  const [y, m, dd] = d.split("-").map(Number);
  const dow = DOW[new Date(Date.UTC(y, m - 1, dd)).getUTCDay()];
  const yy = DATA && String(y) !== DATA.today.slice(0, 4) ? `${String(y).slice(2)}.` : "";
  return `${yy}${m}.${dd}${withDow ? `(${dow})` : ""}`;
}
const range = (a, b) => (a && b && a !== b ? `${md(a)}~${md(b, false)}` : md(a || b));

function ddayBadge(n) {
  if (n.status === "closed") return `<span class="dday">마감</span>`;
  if (n.status === "notice") return `<span class="dday">공고</span>`;
  if (n.status === "open") {
    const urgent = n.dday != null && n.dday <= 1;
    const t = n.dday == null ? "접수중" : n.dday === 0 ? "오늘 마감" : `마감 D-${n.dday}`;
    return `<span class="dday ${urgent ? "urgent" : "open"}">${t}</span>`;
  }
  if (n.ddayKind === "end") return `<span class="dday upcoming">공고중 · 마감 D-${n.dday}</span>`;
  return `<span class="dday upcoming">${n.dday === 0 ? "오늘 접수" : `접수 D-${n.dday}`}</span>`;
}

const mainCat = (n) => n.cats.find((c) => c !== "lotto" && c !== "youth") || n.cats[0];

function schedLine(n) {
  const s = [];
  if (n.source === "lh") {
    s.push(`게시<b>${md(n.noticeDate)}</b>`);
    if (n.applyEnd) s.push(`마감<b>${md(n.applyEnd)}</b>`);
  } else if (n.source === "youth") {
    if (n.applyStart) s.push(`청약신청<b>${range(n.applyStart, n.applyEnd)}</b>`);
    else s.push(`공고<b>${md(n.noticeDate)}</b>`);
    if (n.winnerDate) s.push(`발표<b>${md(n.winnerDate)}</b>`);
  } else if (n.source === "sh") {
    s.push(`공고<b>${md(n.noticeDate)}</b>`);
  } else {
    if (n.applyStart) s.push(`접수<b>${range(n.applyStart, n.applyEnd)}</b>`);
    if (n.winnerDate) s.push(`발표<b>${md(n.winnerDate)}</b>`);
    if (!n.applyStart) s.push(`공고<b>${md(n.noticeDate)}</b>`);
  }
  return s.map((x) => `<span>${x}</span>`).join("");
}

function gainHtml(n) {
  const l = n.lotto;
  if (!l || l.error || !l.rep) return "";
  return `<span class="gain ${l.grade}">${l.gradeLabel} ${signed(l.rep.gain)}</span>`;
}

function priceLine(n) {
  const p = n.priceStats;
  if (!p) return "";
  const per = p.perPyeong ? `<span>평당 ${p.perPyeong.toLocaleString()}만</span>` : "";
  return `<div class="price-line"><span>${Math.floor(p.repArea)}㎡</span><strong>${won(p.repPrice)}</strong>${per}${gainHtml(n)}</div>`;
}

const WARN_TAGS = new Set(["분양가상한제"]);
function tagsHtml(n) {
  const kindTag = n.kind ? n.kind : null;
  const tags = (n.tags || []).filter((t) => t !== kindTag).slice(0, 5);
  return tags.map((t) => `<span class="tag ${WARN_TAGS.has(t) ? "warn" : ""}">${esc(t)}</span>`).join("");
}

function card(n) {
  const cat = mainCat(n);
  const lottoPill =
    n.lotto?.grade === "lotto" ? `<span class="pill lotto">로또</span>` : n.lotto?.grade === "good" ? `<span class="pill good">알짜</span>` : "";
  const where = n.detail?.address || (n.regionRaw && n.regionRaw !== "전국" ? n.regionRaw : n.region);
  const sub = [where, n.company].filter(Boolean);
  return `<article class="card ${n.status === "closed" ? "closed" : ""}" data-id="${esc(n.id)}" tabindex="0">
    <div class="card-top">
      <span class="pill ${cat}">${esc(CAT_LABEL[cat] || cat)}</span>
      ${n.kind ? `<span class="src">${esc(n.kind)}</span>` : ""}
      ${lottoPill}${n.isNew ? `<span class="pill new">NEW</span>` : ""}
      ${ddayBadge(n)}
    </div>
    <h3>${esc(n.title)}</h3>
    <div class="sub">${esc(sub.join(" · "))}</div>
    <div class="sched">${schedLine(n)}</div>
    ${priceLine(n)}
    <div class="tags"><span class="tag">${srcName(n)}</span>${tagsHtml(n)}</div>
  </article>`;
}

// ---------- filtering ----------
const ACTIVE = new Set(["open", "upcoming"]);
function isActive(n) {
  if (ACTIVE.has(n.status)) return true;
  if (n.status === "notice") return n.noticeDate >= addDays(DATA.today, -30);
  return false;
}
function addDays(ymd, k) {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + k);
  return d.toISOString().slice(0, 10);
}

function matches(n, { ignoreCat = false, ignoreStatus = false, ignoreKind = false } = {}) {
  if (!ignoreCat && F.cat !== "all" && !n.cats.includes(F.cat)) return false;
  if (!ignoreStatus) {
    if (F.status === "active" && !isActive(n)) return false;
    if (F.status === "open" && n.status !== "open") return false;
  }
  if (F.region && n.region !== F.region) return false;
  if (!ignoreKind && F.kind && n.kind !== F.kind) return false;
  if (F.q) {
    const hay = `${n.title} ${n.company || ""} ${n.detail?.address || ""} ${n.region} ${n.kind || ""} ${(n.tags || []).join(" ")}`.toLowerCase();
    if (!F.q.toLowerCase().split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

const STATUS_ORDER = { open: 0, upcoming: 1, notice: 2, closed: 3 };
function sortList(arr) {
  const byDeadline = (a, b) => {
    const s = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (s) return s;
    if (a.status === "open") return (a.applyEnd || "9").localeCompare(b.applyEnd || "9");
    if (a.status === "upcoming") return (a.applyStart || a.applyEnd || "9").localeCompare(b.applyStart || b.applyEnd || "9");
    return (b.applyEnd || b.noticeDate || "").localeCompare(a.applyEnd || a.noticeDate || "");
  };
  if (F.sort === "recent") return arr.sort((a, b) => (b.noticeDate || "").localeCompare(a.noticeDate || "") || byDeadline(a, b));
  if (F.sort === "gain")
    return arr.sort((a, b) => (b.lotto?.rep?.gain ?? -1e12) - (a.lotto?.rep?.gain ?? -1e12) || byDeadline(a, b));
  return arr.sort(byDeadline);
}

// ---------- render ----------
function renderStats() {
  const ns = DATA.notices;
  const open = ns.filter((n) => n.status === "open").length;
  const soon = ns.filter((n) => n.status === "upcoming" && n.ddayKind === "start" && n.dday <= 7).length;
  const lotto = ns.filter((n) => n.cats.includes("lotto") && isActive(n)).length;
  const fresh = ns.filter((n) => n.isNew).length;
  $("#stats").innerHTML = `
    <button class="stat" data-go="open"><b>${open}</b><span>지금 접수중</span></button>
    <button class="stat" data-go="soon"><b>${soon}</b><span>7일 내 접수 시작</span></button>
    <button class="stat hot" data-go="lotto"><b>${lotto}</b><span>${DATA.hasKey ? "로또·알짜 후보" : "분양가상한제 단지"}</span></button>
    <button class="stat" data-go="new"><b>${fresh}</b><span>최근 2일 신규</span></button>`;
}

function renderTabs() {
  const counts = { all: 0 };
  for (const n of DATA.notices) {
    if (!matches(n, { ignoreCat: true, ignoreKind: true })) continue;
    counts.all++;
    for (const c of n.cats) counts[c] = (counts[c] || 0) + 1;
  }
  const tabs = [{ key: "all", label: "전체" }, ...DATA.categories];
  $("#tabs").innerHTML = tabs
    .map(
      (t) =>
        `<button class="tab ${t.key === "lotto" ? "lotto" : ""} ${F.cat === t.key ? "on" : ""}" data-cat="${t.key}" role="tab">${esc(
          t.key === "lotto" && !DATA.hasKey ? "로또 후보" : t.label
        )}<small>${counts[t.key] || 0}</small></button>`
    )
    .join("");
}

function renderSelects() {
  $("#regionSel").innerHTML =
    `<option value="">전국</option>` + DATA.regions.map((r) => `<option ${F.region === r ? "selected" : ""}>${r}</option>`).join("");
  const kinds = {};
  for (const n of DATA.notices) if (n.kind && matches(n, { ignoreKind: true })) kinds[n.kind] = (kinds[n.kind] || 0) + 1;
  if (F.kind && !kinds[F.kind]) F.kind = "";
  $("#kindSel").innerHTML =
    `<option value="">유형 전체</option>` +
    Object.entries(kinds)
      .sort((a, b) => b[1] - a[1])
      .map(([k, c]) => `<option value="${esc(k)}" ${F.kind === k ? "selected" : ""}>${esc(k)} (${c})</option>`)
      .join("");
  $("#sortSel").value = F.sort;
  $("#sortSel").querySelector('[value="gain"]').disabled = !DATA.hasKey;
  $$("#statusSeg button").forEach((b) => b.classList.toggle("on", b.dataset.v === F.status));
  $$("#viewSeg button").forEach((b) => b.classList.toggle("on", b.dataset.v === F.view));
}

function renderList() {
  const items = sortList(DATA.notices.filter((n) => matches(n)));
  $("#resultInfo").textContent = `${items.length}건`;
  $("#list").innerHTML = items.length
    ? items.map(card).join("")
    : `<div class="empty">조건에 맞는 공고가 없어요.<br>상태를 ‘전체’로 바꾸거나 필터를 줄여 보세요.</div>`;
}

function renderCal() {
  const month = F.month || DATA.today.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const start = addDays(month + "-01", -first.getUTCDay());
  const byDay = {};
  let count = 0;
  for (const n of DATA.notices) {
    if (!matches(n, { ignoreStatus: true })) continue;
    for (const ev of n.events || []) {
      let d = ev.date;
      const end = ev.end && ev.kind === "apply" ? ev.end : ev.date;
      for (let i = 0; d <= end && i < 7; i++, d = addDays(d, 1)) {
        (byDay[d] ||= []).push({ n, ev });
        if (i === 0 && d.startsWith(month)) count++;
      }
    }
  }
  const order = { apply: 0, winner: 1, contract: 2 };
  let cells = DOW.map((d) => `<div class="cal-dow">${d}</div>`).join("");
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    if (i >= 35 && !d.startsWith(month)) break;
    const evs = (byDay[d] || []).sort((a, b) => order[a.ev.kind] - order[b.ev.kind] || b.n.cats.includes("lotto") - a.n.cats.includes("lotto"));
    const shown = evs.slice(0, 4);
    cells += `<div class="cal-day ${d.startsWith(month) ? "" : "other"} ${d === DATA.today ? "today" : ""}" data-day="${d}">
      <span class="cal-n">${+d.slice(8)}</span>
      ${shown.map(({ n, ev }) => calEv(n, ev)).join("")}
      ${evs.length > 4 ? `<span class="cal-more" data-more="${d}">+${evs.length - 4}<span class="more-txt">건 더보기</span></span>` : ""}
    </div>`;
  }
  const agenda = Object.keys(byDay)
    .filter((d) => d.startsWith(month))
    .sort()
    .map(
      (d) => `<div class="agenda-day" id="ag-${d}"><h4>${md(d)}</h4>${byDay[d]
        .map(
          ({ n, ev }) =>
            `<div class="agenda-ev" data-id="${esc(n.id)}"><span class="k ${ev.kind}">${esc(ev.label)}</span><span>${esc(n.title)}</span></div>`
        )
        .join("")}</div>`
    )
    .join("");
  $("#cal").innerHTML = `
    <div class="cal-head">
      <button class="icon-btn" data-mon="-1" aria-label="이전 달">‹</button>
      <h2>${y}년 ${m}월</h2>
      <button class="icon-btn" data-mon="1" aria-label="다음 달">›</button>
      <button class="btn" data-mon="0" style="height:32px">오늘</button>
      <div class="cal-legend"><span><i style="background:var(--accent)"></i>청약접수</span><span><i style="background:var(--purple)"></i>당첨발표</span><span><i style="background:var(--green)"></i>계약</span></div>
    </div>
    <div class="cal-grid">${cells}</div>
    <div class="cal-agenda">${agenda || '<p class="muted">이 달에는 일정이 없어요.</p>'}</div>`;
  $("#resultInfo").textContent = `${y}년 ${m}월 일정 ${count}건`;
}

function calEv(n, ev) {
  const lotto = n.cats.includes("lotto") ? "lotto" : "";
  return `<div class="cal-ev ${ev.kind} ${lotto}" data-id="${esc(n.id)}" title="${esc(ev.label + " · " + n.title)}">${esc(ev.label)} ${esc(n.title)}</div>`;
}

function render() {
  store.set("filters", { ...F, q: "" });
  renderTabs();
  renderSelects();
  $("#list").hidden = F.view !== "list";
  $("#cal").hidden = F.view !== "cal";
  if (F.view === "list") renderList();
  else renderCal();
}

// ---------- drawer ----------
// 마이홈 금액은 원 단위 → 사이트 다른 곳처럼 만원으로
const manwon = (v) => (v == null ? "-" : v >= 10000 ? `${(v / 10000).toLocaleString(undefined, { maximumFractionDigits: 1 })}만` : v.toLocaleString());
function complexTable(n) {
  const cs = n.detail?.complexes || [];
  if (n.source !== "myhome" || !cs.length) return "";
  const total = n.detail.complexCount || cs.length;
  const money = cs.some((c) => c.deposit != null || c.rent != null);
  const price = cs.some((c) => c.price != null);
  const rows = cs
    .map(
      (c) =>
        `<tr><td>${esc(c.name || "-")}</td><td>${esc(c.address || "-")}</td><td>${c.supply ?? "-"}</td>${
          money ? `<td>${manwon(c.deposit)}</td><td>${manwon(c.rent)}</td>` : ""
        }${price ? `<td>${c.price ? won(Math.round(c.price / 10000)) : "-"}</td>` : ""}</tr>`
    )
    .join("");
  return `<div class="d-sec"><h3>단지 ${total.toLocaleString()}곳</h3><div class="tbl-wrap"><table class="t"><thead><tr><th>단지</th><th>주소</th><th>공급</th>${
    money ? "<th>최소 보증금</th><th>최소 월임대료</th>" : ""
  }${price ? "<th>최소 분양가</th>" : ""}</tr></thead><tbody>${rows}</tbody></table></div>${
    total > cs.length ? `<p class="note">외 ${total - cs.length}곳은 원문 공고에서 확인하세요.</p>` : ""
  }<p class="note">마이홈포털(국토교통부) 제공 정보예요. 금액은 단지별 최소 조건이라 주택형마다 달라요.</p></div>`;
}
function openDrawer(id, push = true) {
  const n = DATA.notices.find((x) => x.id === id);
  if (!n) return;
  const d = n.detail || {};
  const s = d.schedule || {};
  const cat = mainCat(n);
  const rows = [];
  const kv = (k, v) => v && rows.push(`<dt>${k}</dt><dd>${v}</dd>`);
  kv("지역", esc(d.address || n.regionRaw || n.region));
  kv("유형", esc([CAT_LABEL[cat], n.kind, n.supplyType].filter(Boolean).join(" · ")));
  kv("공급규모", d.households ? `${d.households.toLocaleString()}세대` : "");
  kv("시행", esc(d.developer || n.company));
  kv("시공", esc(d.builder));
  kv("문의", n.tel ? `<a href="tel:${esc(n.tel)}">${esc(n.tel)}</a>` : "");
  kv("입주예정", d.moveIn ? esc(d.moveIn.replace("-", "년 ") + "월") : "");
  kv("특이사항", esc(d.remarks));
  kv("출처", `${srcName(n)}${n.statusText ? " · " + esc(n.statusText) : ""}`);

  const sched = [];
  const sr = (k, v) => v && sched.push(`<dt>${k}</dt><dd>${v}</dd>`);
  sr("모집공고", md(s.notice || n.noticeDate));
  if (s.special?.length) sr("특별공급", range(s.special[0], s.special.at(-1)));
  if (s.rank1?.length) sr("1순위", s.rank1.length > 1 && s.rank1[0] !== s.rank1[1] ? `${md(s.rank1[0])} 해당 · ${md(s.rank1[1])} 기타` : md(s.rank1[0]));
  if (s.rank2?.length) sr("2순위", s.rank2.length > 1 && s.rank2[0] !== s.rank2[1] ? `${md(s.rank2[0])} 해당 · ${md(s.rank2[1])} 기타` : md(s.rank2[0]));
  if (!s.special && !s.rank1) {
    if (n.source === "lh") sr("접수마감", md(n.applyEnd));
    else if (n.source === "youth") sr("청약신청", range(n.applyStart, n.applyEnd));
    else sr("청약접수", range(n.applyStart, n.applyEnd));
  }
  sr("당첨발표", md(s.winner || n.winnerDate));
  if (s.contract?.length) sr("계약", range(s.contract[0], s.contract.at(-1)));

  const l = n.lotto && !n.lotto.error ? n.lotto : null;
  const est = new Map((l?.units || []).map((u) => [u.type, u]));
  const units = (d.units || []).filter((u) => u.price || u.total);
  const unitTable = units.length
    ? `<div class="tbl-wrap"><table class="t"><thead><tr><th>주택형</th><th>공급면적</th><th>세대</th><th>분양가</th><th>평당</th>${
        l ? "<th>예상시세</th><th>차익</th>" : ""
      }</tr></thead><tbody>${units
        .map((u) => {
          const e = est.get(u.type);
          const py = u.supplyArea && u.price ? Math.round(u.price / (u.supplyArea / 3.305785)).toLocaleString() + "만" : "-";
          const hh = u.general != null ? `${u.total}<span class="muted"> (일반 ${u.general})</span>` : u.total ?? "-";
          return `<tr class="${l?.rep?.type === u.type ? "rep" : ""}"><td>${esc(u.type)}</td><td>${u.supplyArea ? u.supplyArea.toFixed(1) + "㎡" : "-"}</td><td>${hh}</td><td>${won(
            u.price
          )}</td><td>${py}</td>${
            l ? `<td>${e ? won(e.est) : "-"}</td><td class="${e ? (e.gain >= 0 ? "pos" : "neg") : ""}">${e ? signed(e.gain) : "-"}</td>` : ""
          }</tr>`;
        })
        .join("")}</tbody></table></div><p class="note">분양가는 청약홈 공시 최고가 기준(만원 단위 환산). 층·호별 금액은 모집공고문을 확인하세요.</p>`
    : "";

  let lottoSec = "";
  if (l?.rep) {
    lottoSec = `<div class="d-sec"><h3>로또 판별</h3>
      <div class="lotto-box ${l.grade}"><div><div class="muted" style="font-size:13px">${esc(l.rep.type)} 기준 예상 차익</div><div class="big">${signed(l.rep.gain)}</div></div>
      <div style="font-size:13px">등급 <b>${esc(l.gradeLabel)}</b><br>차익률 ${(l.rep.rate * 100).toFixed(0)}%<br>예상시세 ${won(l.rep.est)}</div></div>
      <p class="note">신뢰도 <b>${esc(l.rep.confidence || "-")}</b> · 비교 기준: ${esc(l.region || "")} ${esc(l.rep.basis)} 실거래 ${l.rep.sample}건 중앙값 (최근 12개월, 해제거래 제외). 단지 규모·브랜드·층·향·입주시점은 반영되지 않은 참고치예요. 신도시·택지지구는 주변에 비교할 신축이 적어 오차가 커요.</p></div>`;
  } else if (n.lotto?.error) {
    lottoSec = `<div class="d-sec"><h3>로또 판별</h3><p class="note">${esc(n.lotto.error)}</p></div>`;
  } else if (n.priceStats && ["apt", "remndr"].includes(n.list) && !DATA.hasKey) {
    lottoSec = `<div class="d-sec"><h3>로또 판별</h3><p class="note">주변 실거래가 대비 예상 차익은 공공데이터포털 인증키를 설정하면 계산돼요. (오른쪽 위 ⚙)</p></div>`;
  }

  const links = [`<a class="btn primary" href="${esc(n.url)}" target="_blank" rel="noopener">원문 공고 보기 ↗</a>`];
  if (d.pdfUrl) links.push(`<a class="btn" href="${esc(d.pdfUrl)}" target="_blank" rel="noopener">모집공고문 PDF</a>`);
  if (d.homepage) links.push(`<a class="btn" href="${esc(d.homepage)}" target="_blank" rel="noopener">분양 홈페이지</a>`);
  if (d.myhomeUrl && d.myhomeUrl !== n.url) links.push(`<a class="btn" href="${esc(d.myhomeUrl)}" target="_blank" rel="noopener">마이홈포털에서 보기</a>`);

  $("#drawerBody").innerHTML = `
    <div class="card-top"><span class="pill ${cat}">${esc(CAT_LABEL[cat] || cat)}</span>${
    n.lotto?.grade === "lotto" ? '<span class="pill lotto">로또</span>' : n.lotto?.grade === "good" ? '<span class="pill good">알짜</span>' : ""
  }${ddayBadge(n)}</div>
    <h2 class="d-title">${esc(n.title)}</h2>
    <div class="tags">${tagsHtml(n)}</div>
    <div class="links">${links.join("")}</div>
    ${lottoSec}
    <div class="d-sec"><h3>일정</h3><dl class="kv">${sched.join("")}</dl>${
    n.source === "lh" ? '<p class="note">LH는 상세 일정이 공고문에 있어요. 원문 링크는 LH 청약플러스 공고 목록(공고명 검색)으로 연결됩니다.</p>' : ""
  }</div>
    ${unitTable ? `<div class="d-sec"><h3>주택형·분양가</h3>${unitTable}</div>` : ""}
    ${complexTable(n)}
    <div class="d-sec"><h3>기본 정보</h3><dl class="kv">${rows.join("")}</dl></div>`;
  $("#drawer").hidden = false;
  document.body.style.overflow = "hidden";
  if (push) history.replaceState(null, "", "#n=" + encodeURIComponent(id));
}
function closeDrawer() {
  $("#drawer").hidden = true;
  document.body.style.overflow = "";
  history.replaceState(null, "", location.pathname + location.search);
}

// ---------- settings ----------
function renderKeyState() {
  const lotto = DATA.sources?.lotto;
  $("#keyState").innerHTML = DATA.hasKey
    ? `✅ 인증키 설정됨 — ${lotto ? (lotto.ok ? `로또 판별 ${lotto.count}건 계산` : `오류: ${esc(lotto.error)}`) : "다음 수집 때 계산합니다"}`
    : "인증키 없음 — 분양가·평당가까지만 표시 중";
  const mh = DATA.sources?.myhome;
  if (DATA.hasKey) {
    $("#keyState").innerHTML += !mh
      ? "<br>마이홈 모집공고 API — 다음 수집 때 확인합니다"
      : mh.ok
      ? `<br>✅ 마이홈 공공주택 공고 ${mh.count}건 수집`
      : mh.pending
      ? "<br>⏳ 마이홈 모집공고 API 승인 대기 — 활용신청 후 1~2시간 뒤, 다음 수집 때 자동 반영돼요"
      : `<br>⚠️ 마이홈 API 오류: ${esc(mh.error)}`;
  }
  const can = DATA.canEditKey;
  $("#keyInput").disabled = !can;
  $("#keySave").disabled = !can;
  if (!can) $("#keyMsg").textContent = "키 설정은 서버를 실행 중인 PC(localhost)에서만 할 수 있어요.";
}

async function saveKey() {
  const key = $("#keyInput").value.trim();
  const msg = $("#keyMsg");
  if (!key) return;
  msg.className = "key-msg";
  msg.textContent = "확인 중…";
  $("#keySave").disabled = true;
  try {
    const r = await fetch("/api/key", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.status);
    msg.className = "key-msg ok";
    msg.textContent = `연결 성공 (영등포구 ${j.test.ym.slice(0, 4)}.${j.test.ym.slice(4)} 거래 ${j.test.total}건 확인). 로또 판별을 계산하는 중이에요…`;
    $("#keyInput").value = "";
    watchRun();
  } catch (e) {
    msg.className = "key-msg err";
    msg.textContent = e.message;
  } finally {
    $("#keySave").disabled = false;
  }
}

// ---------- data ----------
async function load() {
  const r = await fetch("/api/notices");
  DATA = await r.json();
  for (const c of DATA.categories) CAT_LABEL[c.key] = c.label;
  const t = DATA.updatedAt ? new Date(DATA.updatedAt) : null;
  $("#updated").textContent = DATA.running ? "수집 중…" : t ? `${t.getMonth() + 1}/${t.getDate()} ${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")} 업데이트` : "";
  $("#refreshBtn").classList.toggle("spin", DATA.running);
  const bad = Object.values(DATA.sources || {}).filter((s) => !s.ok && !s.pending); // pending = API 승인 대기
  $("#sourceStatus").textContent = bad.length ? `수집 오류: ${bad.map((s) => s.label).join(", ")} (이전 데이터 유지)` : "";
  renderStats();
  render();
  renderKeyState();
  if (!DATA.notices.length && DATA.running) $("#list").innerHTML = Array(4).fill('<div class="skeleton"></div>').join("");
  return DATA;
}

let watching = false;
async function watchRun() {
  if (watching) return;
  watching = true;
  $("#refreshBtn").classList.add("spin");
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    const d = await load().catch(() => null);
    if (d && !d.running) break;
  }
  watching = false;
  toast("최신 공고로 업데이트했어요");
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 2600);
}

// ---------- events ----------
document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-cat],[data-id],[data-close],[data-mon],[data-more],[data-go],[data-day],#statusSeg button,#viewSeg button");
  if (!el) return;
  if (el.dataset.close != null) return closeDrawer();
  const phone = matchMedia("(max-width: 640px)").matches;
  if (el.dataset.day || (phone && el.dataset.more)) {
    // phones: the grid only shows dots, so jump to that day in the agenda below
    if (phone) document.getElementById("ag-" + (el.dataset.day || el.dataset.more))?.scrollIntoView({ block: "start" });
    return;
  }
  if (el.dataset.more) {
    const cell = el.closest(".cal-day");
    const d = el.dataset.more;
    const evs = [];
    for (const n of DATA.notices) if (matches(n, { ignoreStatus: true })) for (const ev of n.events || []) if (ev.date <= d && (ev.kind === "apply" ? ev.end || ev.date : ev.date) >= d) evs.push(calEv(n, ev));
    cell.innerHTML = `<span class="cal-n">${+d.slice(8)}</span>${evs.join("")}`;
    return;
  }
  if (el.dataset.id) return openDrawer(el.dataset.id);
  if (el.dataset.cat) {
    F.cat = el.dataset.cat;
    F.kind = "";
  } else if (el.dataset.mon != null) {
    const k = +el.dataset.mon;
    if (!k) F.month = null;
    else {
      const [y, m] = (F.month || DATA.today.slice(0, 7)).split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1 + k, 1));
      F.month = dt.toISOString().slice(0, 7);
    }
  } else if (el.dataset.go) {
    const g = el.dataset.go;
    Object.assign(F, { cat: "all", kind: "", region: F.region, view: "list" });
    if (g === "open") F.status = "open";
    if (g === "soon") Object.assign(F, { status: "active", sort: "deadline" });
    if (g === "lotto") Object.assign(F, { cat: "lotto", status: "active" });
    if (g === "new") Object.assign(F, { status: "all", sort: "recent" });
    $("#tabs").scrollIntoView({ behavior: "smooth", block: "start" });
  } else if (el.closest("#statusSeg")) F.status = el.dataset.v;
  else if (el.closest("#viewSeg")) F.view = el.dataset.v;
  render();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("#drawer").hidden) closeDrawer();
  if (e.key === "Enter" && e.target.classList?.contains("card")) openDrawer(e.target.dataset.id);
});
$("#regionSel").addEventListener("change", (e) => ((F.region = e.target.value), render()));
$("#kindSel").addEventListener("change", (e) => ((F.kind = e.target.value), render()));
$("#sortSel").addEventListener("change", (e) => ((F.sort = e.target.value), render()));
let qt;
$("#q").addEventListener("input", (e) => {
  clearTimeout(qt);
  qt = setTimeout(() => ((F.q = e.target.value.trim()), render()), 150);
});
$("#refreshBtn").addEventListener("click", async () => {
  const r = await fetch("/api/refresh", { method: "POST" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return toast(j.error || "새로고침 실패");
  toast("공고를 새로 모으는 중이에요 (약 1분)");
  watchRun();
});
$("#settingsBtn").addEventListener("click", () => {
  renderKeyState();
  $("#settings").showModal();
});
$("#keySave").addEventListener("click", saveKey);

load().then((d) => {
  const m = /#n=([^&]+)/.exec(location.hash);
  if (m) openDrawer(decodeURIComponent(m[1]), false);
  if (d.running) watchRun();
});
