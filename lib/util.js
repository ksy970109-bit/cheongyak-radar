// Shared helpers: HTTP, light HTML parsing, KST dates, region names.

// LH 청약플러스 rejects short/non-browser user agents, so send a full one everywhere.
export const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchText(url, { method = "GET", body, headers = {}, timeout = 25000, retries = 1 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method,
        body,
        headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9", ...headers },
        signal: AbortSignal.timeout(timeout),
        redirect: "follow",
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return text;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await sleep(1500);
    }
  }
  throw lastErr;
}

export async function fetchJson(url, opts) {
  const text = await fetchText(url, opts);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`JSON 아님: ${text.slice(0, 120).replace(/\s+/g, " ")}`);
  }
}

// ---------- HTML ----------
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·" };
export function decode(s = "") {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}

export function text(html = "") {
  return decode(
    html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** All <tr> blocks (opening-tag attributes + inner html). */
export function rows(html) {
  const out = [];
  const re = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = re.exec(html))) out.push({ attrs: m[1], html: m[2] });
  return out;
}

/** <td>/<th> cells of one row. */
export function cells(rowHtml) {
  const out = [];
  const re = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(rowHtml))) out.push({ tag: m[1].toLowerCase(), attrs: m[2], html: m[3], text: text(m[3]) });
  return out;
}

export function attr(attrs, name) {
  const m = new RegExp(`${name}\\s*=\\s*(["'])(.*?)\\1`, "i").exec(attrs || "");
  return m ? decode(m[2]) : null;
}

/** Inner html of every <table> (non-nested pages only). */
export function tables(html) {
  const out = [];
  const re = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

// ---------- dates (KST) ----------
export function todayKST() {
  return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
}
export function addDays(ymd, n) {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function daysBetween(a, b) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400e3);
}
/** All YYYY-MM-DD dates in a string (accepts 2026.11.12 / 2026-11-12 / 2026/11/12). */
export function dates(s = "") {
  const out = [];
  const re = /(20\d{2})[.\-/]\s?(\d{1,2})[.\-/]\s?(\d{1,2})/g;
  let m;
  while ((m = re.exec(s))) out.push(`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`);
  return out;
}
export const firstDate = (s) => dates(s)[0] || null;

// ---------- regions ----------
const REGIONS = [
  ["서울", /^서울/],
  ["경기", /^경기/],
  ["인천", /^인천/],
  ["부산", /^부산/],
  ["대구", /^대구/],
  ["광주", /^광주/],
  ["대전", /^대전/],
  ["울산", /^울산/],
  ["세종", /^세종/],
  ["강원", /^강원/],
  ["충북", /^(충북|충청북)/],
  ["충남", /^(충남|충청남)/],
  ["전북", /^(전북|전라북)/],
  ["전남", /^(전남|전라남)/],
  ["경북", /^(경북|경상북)/],
  ["경남", /^(경남|경상남)/],
  ["제주", /^제주/],
];
export const REGION_NAMES = REGIONS.map((r) => r[0]);
export function normRegion(s = "") {
  const t = s.trim();
  for (const [name, re] of REGIONS) if (re.test(t)) return name;
  if (/전국/.test(t)) return "전국";
  return t || "기타";
}

export const num = (s) => {
  const n = parseFloat(String(s ?? "").replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};

export const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
