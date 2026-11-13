// Runs every source, merges with the previous snapshot, enriches 청약홈 notices with
// detail pages (schedule, units, prices) and — when a data.go.kr key is set — 로또 판별.
import fs from "fs";
import path from "path";
import { collectList } from "./sources/applyhome.js";
import { fetchDetail } from "./sources/applyhome.js";
import { collectLH } from "./sources/lh.js";
import { collectSH } from "./sources/sh.js";
import { collectYouth } from "./sources/youth.js";
import { classify } from "./classify.js";
import { evaluate, priceStats } from "./lotto.js";
import { todayKST, addDays, sleep } from "./util.js";

export const SOURCES = {
  "applyhome-apt": { label: "청약홈 APT 분양", host: "applyhome", run: () => collectList("apt") },
  "applyhome-remndr": { label: "청약홈 무순위·잔여세대", host: "applyhome", run: () => collectList("remndr") },
  "applyhome-other": { label: "청약홈 오피스텔·민간임대", host: "applyhome", run: () => collectList("other") },
  "lh-rent": { label: "LH 임대주택", host: "lh", run: () => collectLH("rent") },
  "lh-sale": { label: "LH 분양주택", host: "lh", run: () => collectLH("sale") },
  sh: { label: "SH 서울주택도시공사", host: "sh", run: () => collectSH() },
  youth: { label: "서울 청년안심주택", host: "youth", run: () => collectYouth() },
};

const sourceKey = (n) => (n.source === "applyhome" ? `applyhome-${n.list}` : n.source === "lh" ? `lh-${n.list}` : n.source);
const RETAIN_DAYS = 150;

export class Collector {
  constructor(dataDir, molit, log = console.log) {
    this.dir = dataDir;
    this.file = path.join(dataDir, "notices.json");
    this.detailDir = path.join(dataDir, "details");
    fs.mkdirSync(this.detailDir, { recursive: true });
    this.molit = molit;
    this.log = log;
    this.running = null;
    this.state = this.load();
  }

  load() {
    try {
      return JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      return { updatedAt: null, sources: {}, notices: [] };
    }
  }

  save() {
    fs.writeFileSync(this.file + ".tmp", JSON.stringify(this.state));
    fs.renameSync(this.file + ".tmp", this.file);
  }

  run(opts) {
    if (!this.running) this.running = this._run(opts).finally(() => (this.running = null));
    return this.running;
  }

  async _run({ lottoOnly = false } = {}) {
    const t0 = Date.now();
    const today = todayKST();
    const prev = new Map(this.state.notices.map((n) => [n.id, n]));
    const sources = { ...this.state.sources };
    let fresh = [];

    if (!lottoOnly) {
      // Sources on the same host run one after another; different hosts in parallel.
      const byHost = {};
      for (const [key, s] of Object.entries(SOURCES)) (byHost[s.host] ||= []).push(key);
      await Promise.all(
        Object.values(byHost).map(async (keys) => {
          for (const key of keys) {
            try {
              const items = await SOURCES[key].run();
              fresh.push(...items);
              sources[key] = { label: SOURCES[key].label, ok: true, count: items.length, at: new Date().toISOString() };
            } catch (e) {
              sources[key] = { ...sources[key], label: SOURCES[key].label, ok: false, error: String(e.message || e), at: new Date().toISOString() };
              this.log(`[collect] ${key} 실패: ${e.message}`);
            }
          }
        })
      );
    }

    // Merge: fresh items win; earlier items stay until they age out (lists only show recent windows).
    const merged = new Map();
    for (const n of prev.values()) merged.set(n.id, n);
    for (const n of fresh) {
      const old = prev.get(n.id);
      merged.set(n.id, { ...old, ...n, firstSeen: old?.firstSeen || new Date().toISOString(), detail: old?.detail, lotto: old?.lotto });
    }
    const cutoff = addDays(today, -RETAIN_DAYS);
    let notices = [...merged.values()].filter((n) => (n.applyEnd || n.noticeDate || today) >= cutoff);

    // 청약홈 details (cached on disk; active notices re-checked daily for 정정공고).
    if (!lottoOnly) {
      let fetched = 0;
      const lastDay = (n) => n.applyEnd || n.noticeDate || "";
      // newest first, so active notices are covered before the per-run cap
      const queue = notices.filter((n) => n.source === "applyhome").sort((a, b) => lastDay(b).localeCompare(lastDay(a)));
      for (const n of queue) {
        const active = lastDay(n) >= addDays(today, -3);
        const cacheFile = path.join(this.detailDir, n.id.replace(/[^\w-]/g, "_") + ".json");
        let cached = null;
        try {
          cached = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
        } catch {}
        const stale = !cached || (active && Date.now() - cached.at > 20 * 3600e3);
        if (cached) n.detail = cached.detail;
        if (!stale) continue;
        // network budget: cap per run, and skip long-closed notices we never fetched
        if (fetched >= 200 || (!cached && lastDay(n) < addDays(today, -45))) continue;
        try {
          n.detail = await fetchDetail(n);
          fs.writeFileSync(cacheFile, JSON.stringify({ at: Date.now(), detail: n.detail }));
          fetched++;
          await sleep(300);
        } catch (e) {
          if (cached) n.detail = cached.detail;
          this.log(`[detail] ${n.title}: ${e.message}`);
        }
      }
      this.log(`[collect] 청약홈 상세 ${fetched}건 갱신`);
    }

    for (const n of notices) {
      const c = classify(n);
      n.cats = c.cats;
      n.tags = c.tags;
      n.hidden = !!c.hidden;
      if (n.detail?.units) n.priceStats = priceStats(n.detail.units);
    }

    // 로또 판별 (needs data.go.kr key) for active APT 분양·무순위 with prices.
    if (this.molit.hasKey()) {
      let done = 0;
      let keyErr = null;
      for (const n of notices) {
        if (n.source !== "applyhome" || !["apt", "remndr"].includes(n.list)) continue;
        if ((n.applyEnd || n.noticeDate || "") < addDays(today, -21)) continue;
        if (!n.priceStats) continue;
        try {
          n.lotto = await evaluate(n, this.molit);
          done++;
        } catch (e) {
          n.lotto = { error: e.message };
          if (e.code === "KEY" || e.code === "NOKEY") {
            this.log(`[lotto] 키 오류로 중단: ${e.message}`);
            keyErr = e.message;
            break;
          }
        }
      }
      sources.lotto = keyErr
        ? { label: "로또 판별(실거래가)", ok: false, error: keyErr, at: new Date().toISOString() }
        : { label: "로또 판별(실거래가)", ok: true, count: done, at: new Date().toISOString() };
    } else {
      delete sources.lotto;
    }

    this.state = { updatedAt: new Date().toISOString(), sources, notices };
    this.save();
    this.log(`[collect] ${notices.length}건 (${((Date.now() - t0) / 1000).toFixed(0)}s, 실거래 API ${this.molit.calls}회 누적)`);
    return this.state;
  }
}

export { sourceKey };
