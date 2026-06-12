// Copies screenshot assets from the design handoff folder into Docusaurus static/
// so docs can reference them via /img/screenshots/<name>.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const src = resolve(repoRoot, "design_handoff_verspaetungsbegleiter", "screenshots");
const dst = resolve(here, "..", "static", "img", "screenshots");

if (!existsSync(src)) {
  console.warn(`[copy-assets] source not found: ${src} — skipping`);
  process.exit(0);
}

mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log(`[copy-assets] copied screenshots → ${dst}`);
