// 로또청약 판별: 분양가(최고가 기준) vs 같은 시군구 최근 12개월 실거래 중앙값.
import { median } from "./util.js";

const PYEONG = 3.305785;

export const GRADES = [
  { key: "lotto", label: "로또", test: (g, r) => g >= 30000 || (g >= 15000 && r >= 0.3) },
  { key: "good", label: "알짜", test: (g, r) => g >= 10000 || r >= 0.15 },
  { key: "fair", label: "시세 수준", test: (g, r) => r >= -0.05 },
  { key: "high", label: "고분양가", test: () => true },
];

/** Price per 평 (공급면적 기준, 만원) — shown even without a data.go.kr key. */
export function priceStats(units = []) {
  const priced = units.filter((u) => u.price >= 1000 && u.area);
  if (!priced.length) return null;
  const rep = pickRep(priced);
  const perPy = rep.supplyArea ? Math.round(rep.price / (rep.supplyArea / PYEONG)) : null;
  return {
    repType: rep.type,
    repArea: rep.area,
    repPrice: rep.price,
    perPyeong: perPy,
    min: Math.min(...priced.map((u) => u.price)),
    max: Math.max(...priced.map((u) => u.price)),
  };
}

/** 대표 주택형: 전용 84㎡에 가장 가까운 타입 (없으면 세대수가 가장 많은 타입). */
function pickRep(units) {
  const near = units.filter((u) => u.area >= 55 && u.area <= 135);
  if (near.length) return near.reduce((a, b) => (Math.abs(b.area - 84) < Math.abs(a.area - 84) ? b : a));
  return units.reduce((a, b) => ((b.total || 0) > (a.total || 0) ? b : a));
}

/**
 * For each priced unit, estimate market value from comparable trades:
 *   tier 1: 같은 법정동 · 준공 10년 이내 · 전용 ±12%   (≥3건)
 *   tier 2: 같은 시군구 · 준공 10년 이내 · 전용 ±12%   (≥3건)
 *   tier 3: 같은 시군구 · 준공 10년 이내 · ㎡당 중앙값 × 전용  (≥5건)
 *   tier 4: 같은 시군구 · 전체 연식 · ㎡당 중앙값 × 전용     (≥5건, 신뢰도 낮음)
 */
export function estimate(units, trades, { umd, year }) {
  const valid = trades.filter((t) => !t.cancelled);
  const newCut = year - 10;
  const isNew = (t) => t.build && t.build >= newCut;
  const out = [];
  for (const u of units.filter((x) => x.price >= 1000 && x.area)) {
    const near = (t) => Math.abs(t.area - u.area) <= u.area * 0.12;
    let est = null;
    let basis = null;
    let sample = 0;
    const tiers = [
      ["동·신축·동일면적", valid.filter((t) => umd && t.umd === umd && isNew(t) && near(t)), 5, false],
      ["구·신축·동일면적", valid.filter((t) => isNew(t) && near(t)), 3, false],
      ["구·신축·㎡당", valid.filter(isNew), 5, true],
      ["구·전체·㎡당", valid, 5, true],
    ];
    let tier = -1;
    for (const [idx, [label, arr, min, perM2]] of tiers.entries()) {
      if (arr.length < min) continue;
      est = perM2 ? median(arr.map((t) => t.price / t.area)) * u.area : median(arr.map((t) => t.price));
      basis = label;
      sample = arr.length;
      tier = idx;
      break;
    }
    if (est == null) continue;
    est = Math.round(est);
    const gain = est - u.price;
    const confidence = tier === 0 ? "높음" : tier === 1 ? "보통" : "낮음";
    out.push({ type: u.type, area: u.area, price: u.price, est, gain, rate: +(gain / u.price).toFixed(3), basis, sample, confidence });
  }
  if (!out.length) return null;
  const rep = pickRep(out);
  const grade = GRADES.find((g) => g.test(rep.gain, rep.rate));
  return { grade: grade.key, gradeLabel: grade.label, rep, units: out };
}

/** Notices whose 공급금액 is not comparable with resale prices. */
export function notComparable(n) {
  if (/토지임대부/.test(n.title)) return "토지임대부 주택은 토지 소유권이 없어(월 토지임대료 별도) 일반 아파트 시세와 비교하지 않아요.";
  if (/임대/.test(n.title)) return "임대주택(분양전환형)은 임대 조건이라 시세 비교에서 제외했어요.";
  return null;
}

export async function evaluate(n, molit) {
  const skip = notComparable(n);
  if (skip) return { error: skip, skipped: true };
  const units = n.detail?.units || [];
  if (!units.some((u) => u.price) || !n.detail?.address) return null;
  const loc = await molit.resolve(n.detail.address);
  if (!loc) return { error: "주소에서 시군구 코드를 찾지 못했습니다." };
  const trades = await molit.recentTrades(loc.sgg, 12);
  const year = new Date(Date.now() + 9 * 3600e3).getUTCFullYear();
  const r = estimate(units, trades, { umd: loc.umd, year });
  if (!r) return { error: "비교할 실거래가 부족합니다.", sgg: loc.sgg, trades: trades.length };
  return { ...r, sgg: loc.sgg, umd: loc.umd, region: loc.name, trades: trades.length, at: new Date().toISOString() };
}
