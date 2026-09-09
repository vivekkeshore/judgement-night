/* Fetch supabase-js as a single self-contained ES module and vendor it into
   app/vendor/, so the game has no runtime dependency on a third-party CDN.
   Run: npm run vendor
   The result is committed to the repo — that is the point of vendoring. */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = process.argv[2] || "2";
const URL_ = `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@${VERSION}/+esm`;
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "app", "vendor", "supabase-js.js");

console.log(`fetching ${URL_}`);
const res = await fetch(URL_);
if (!res.ok) {
  console.error(`failed: HTTP ${res.status} ${res.statusText}`);
  process.exit(1);
}
const src = await res.text();

/* A bundle that still reaches out to the network would defeat the exercise, so
   refuse anything containing remote imports rather than vendoring it quietly. */
const remote = [...src.matchAll(/\bfrom\s*["'](https?:\/\/[^"']+)["']/g)].map(m => m[1]);
if (remote.length) {
  console.error("refusing to vendor: the bundle still imports from the network:");
  for (const r of new Set(remote)) console.error("   " + r);
  console.error("try a different bundler URL, e.g. https://esm.sh/@supabase/supabase-js@2?bundle");
  process.exit(1);
}
if (!/createClient/.test(src)) {
  console.error("refusing to vendor: no createClient export found — wrong URL?");
  process.exit(1);
}

await mkdir(dirname(OUT), { recursive: true });
const header = `/* Vendored from ${URL_} on ${new Date().toISOString().slice(0, 10)}.\n`
             + `   Do not edit. Refresh with: npm run vendor */\n`;
await writeFile(OUT, header + src, "utf8");
console.log(`wrote app/vendor/supabase-js.js  (${(src.length / 1024).toFixed(0)} KB, no remote imports)`);
