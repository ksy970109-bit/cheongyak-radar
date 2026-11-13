// One-off collection: `npm run collect`
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { Collector } from "../lib/collector.js";
import { Molit } from "../lib/molit.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = process.env.DATA_DIR || path.join(root, "data");
fs.mkdirSync(DATA, { recursive: true });
const cfg = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, "config.json"), "utf8"));
  } catch {
    return {};
  }
})();
const molit = new Molit(DATA, () => process.env.DATA_GO_KR_KEY || cfg.dataGoKrKey);
const state = await new Collector(DATA, molit).run();
for (const [k, s] of Object.entries(state.sources)) console.log(`${s.ok ? "✓" : "✗"} ${s.label}: ${s.ok ? s.count + "건" : s.error}`);
