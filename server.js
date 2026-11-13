import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Collector } from "./lib/collector.js";
import { Molit, MolitError, normKey } from "./lib/molit.js";
import { CATEGORIES, statusOf, eventsOf } from "./lib/classify.js";
import { notComparable } from "./lib/lotto.js";
import { REGION_NAMES, todayKST, daysBetween } from "./lib/util.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.DATA_DIR || path.join(__dirname, "data");
const PORT = Number(process.env.PORT || 4320);
const REFRESH_HOURS = Number(process.env.REFRESH_HOURS || 3);
fs.mkdirSync(DATA, { recursive: true });

// ---- config (data.go.kr key) ----
const CONFIG = path.join(DATA, "config.json");
const readConfig = () => {
  try {
    return JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  } catch {
    return {};
  }
};
const saveConfig = (patch) => fs.writeFileSync(CONFIG, JSON.stringify({ ...readConfig(), ...patch }, null, 2));
const getKey = () => process.env.DATA_GO_KR_KEY || readConfig().dataGoKrKey || null;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const molit = new Molit(DATA, getKey);
const collector = new Collector(DATA, molit, log);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

const isLocal = (req) => ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress);

app.get("/healthz", (req, res) => res.json({ ok: true }));

app.get("/api/notices", (req, res) => {
  const today = todayKST();
  const s = collector.state;
  const notices = s.notices
    .filter((n) => !n.hidden && n.cats?.length)
    .map((n) => {
      const st = statusOf(n, today);
      // with a key: graded by 실거래 비교; without: 분양가상한제 단지 as a rough proxy
      const lottoCand = molit.hasKey()
        ? n.lotto?.grade === "lotto" || n.lotto?.grade === "good"
        : n.tags?.includes("분양가상한제") && !notComparable(n);
      return {
        ...n,
        ...st,
        cats: lottoCand ? [...n.cats, "lotto"] : n.cats,
        isNew: !!n.noticeDate && daysBetween(n.noticeDate, today) <= 2,
        events: eventsOf(n),
      };
    });
  res.json({
    today,
    updatedAt: s.updatedAt,
    running: !!collector.running,
    hasKey: molit.hasKey(),
    canEditKey: isLocal(req),
    categories: CATEGORIES,
    regions: REGION_NAMES,
    sources: s.sources,
    notices,
  });
});

let lastManual = 0;
app.post("/api/refresh", (req, res) => {
  if (collector.running) return res.json({ started: false, running: true });
  if (!isLocal(req) && Date.now() - lastManual < 15 * 60e3) {
    return res.status(429).json({ error: "새로고침은 15분에 한 번만 가능합니다." });
  }
  lastManual = Date.now();
  collector.run().catch((e) => log("[refresh]", e));
  res.json({ started: true });
});

// The key never leaves the server; only the local machine may change it.
app.post("/api/key", async (req, res) => {
  if (!isLocal(req)) return res.status(403).json({ error: "키 설정은 서버 PC(localhost)에서만 가능합니다." });
  const key = normKey(req.body?.key || "");
  if (key.length < 20) return res.status(400).json({ error: "공공데이터포털 일반 인증키(Decoding)를 붙여넣어 주세요." });
  try {
    const r = await molit.testKey(key);
    saveConfig({ dataGoKrKey: key });
    collector.run({ lottoOnly: !collector.running }).catch((e) => log("[lotto]", e));
    res.json({ ok: true, test: r });
  } catch (e) {
    res.status(e instanceof MolitError ? 400 : 502).json({ error: e.message });
  }
});

app.delete("/api/key", (req, res) => {
  if (!isLocal(req)) return res.status(403).json({ error: "forbidden" });
  saveConfig({ dataGoKrKey: null });
  res.json({ ok: true });
});

app.listen(PORT, () => {
  log(`청약 레이더: http://localhost:${PORT}`);
  const age = collector.state.updatedAt ? Date.now() - Date.parse(collector.state.updatedAt) : Infinity;
  if (age > 60 * 60e3) setTimeout(() => collector.run().catch((e) => log("[boot]", e)), 1500);
  setInterval(() => collector.run().catch((e) => log("[cron]", e)), REFRESH_HOURS * 3600e3);
});
