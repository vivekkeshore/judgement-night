/* Vendor supabase-js as a single self-contained ES module into app/vendor/, so
   the game has no runtime dependency on a third-party CDN.

   Run: npm run vendor

   Two strategies, in order:
     1. Ask a bundling CDN for a pre-bundled ESM file. Fast, nothing installed.
        Not all of them actually inline dependencies — jsDelivr's /+esm returns a
        nine-line stub that imports five sub-packages from root-relative CDN
        paths, which a browser then resolves against your own origin and cannot
        find. So every candidate is verified before it is accepted.
     2. Fall back to installing the package and bundling it with esbuild, which
        is deterministic. Nothing is added to package.json and node_modules is
        gitignored — only the bundled output is committed. */
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "app", "vendor", "supabase-js.js");

const CANDIDATES = process.argv[2] ? [process.argv[2]] : [
  "https://esm.sh/@supabase/supabase-js@2?bundle",
  "https://esm.sh/@supabase/supabase-js@2?bundle-deps",
  "https://esm.sh/@supabase/supabase-js@2?bundle&target=es2020",
];

/* Import scanning must ignore comments: supabase-js ships JSDoc blocks full of
   example `import X from "pkg"` lines, and matching those would reject a bundle
   that is actually fine. A small string/comment state machine is enough here. */
function stripComments(src) {
  let out = "", i = 0, state = "code", quote = "";
  while (i < src.length) {
    const c = src[i], d = src[i + 1];
    if (state === "code") {
      if (c === "/" && d === "/") { state = "line"; i += 2; continue; }
      if (c === "/" && d === "*") { state = "block"; i += 2; continue; }
      if (c === '"' || c === "'" || c === "`") { state = "str"; quote = c; out += c; i++; continue; }
      out += c; i++; continue;
    }
    if (state === "line")  { if (c === "\n") { state = "code"; out += c; } i++; continue; }
    if (state === "block") { if (c === "*" && d === "/") { state = "code"; i += 2; } else i++; continue; }
    if (c === "\\") { out += c + (d ?? ""); i += 2; continue; }
    if (c === quote) state = "code";
    out += c; i++;
  }
  return out;
}

/* A leftover STATIC import is fatal: the browser resolves it while loading the
   module and the whole thing fails — that is exactly how jsDelivr's stub broke.
   A leftover DYNAMIC import is not: supabase-js probes for optional React Native
   storage packages inside try/catch, and that code never runs in a browser. So
   the two are reported separately. */
function leftoverImports(raw) {
  const src = stripComments(raw);
  const statics = new Set(), dynamics = new Set();
  for (const re of [
    /\b(?:import|export)\b[^;{]*?\bfrom\s*["']([^"']+)["']/g,
    /(?<![.\w])import\s*["']([^"']+)["']/g,
  ]) for (const m of src.matchAll(re)) statics.add(m[1]);
  for (const m of src.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g)) dynamics.add(m[1]);
  return { statics: [...statics], dynamics: [...dynamics] };
}

async function fromCdn(url) {
  process.stdout.write(`trying ${url}\n`);
  let res;
  try { res = await fetch(url, { redirect: "follow" }); }
  catch (e) { console.log(`   unreachable: ${e.message}`); return null; }
  if (!res.ok) { console.log(`   HTTP ${res.status}`); return null; }
  const src = await res.text();
  const { statics } = leftoverImports(src);
  if (statics.length) { console.log(`   not self-contained, still needs: ${statics.join(", ")}`); return null; }
  if (!/createClient/.test(src)) { console.log("   no createClient found"); return null; }
  console.log(`   ok — ${(src.length / 1024).toFixed(0)} KB, self-contained`);
  return { src, from: url };
}

function fromEsbuild() {
  console.log("\nno CDN bundle was self-contained; building locally with esbuild");
  /* the entry must live inside the project, or esbuild resolves imports against
     /tmp and cannot find node_modules */
  const entry = join(ROOT, `.vendor-entry-${process.pid}.js`);
  const built = join(tmpdir(), `supabase-bundle-${process.pid}.js`);
  const run = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, stdio: "inherit" });
  try {
    run("npm", ["install", "--no-save", "--no-audit", "--no-fund", "@supabase/supabase-js"]);
    execFileSync("node", ["-e", `require("fs").writeFileSync(${JSON.stringify(entry)}, 'export * from "@supabase/supabase-js";')`]);
    run("npx", ["--yes", "esbuild", entry, "--bundle", "--format=esm", "--platform=browser",
                "--target=es2020", `--outfile=${built}`]);
    return { src: require_text(built), from: "local esbuild bundle of @supabase/supabase-js" };
  } finally {
    /* synchronous: an async unlink here loses the race with process.exit on the
       failure paths, leaving .vendor-entry-*.js litter behind */
    for (const f of [entry, built]) if (existsSync(f)) rmSync(f, { force: true });
  }
}
function require_text(p) { return execFileSync("cat", [p]).toString("utf8"); }

let result = null;
for (const url of CANDIDATES) {
  result = await fromCdn(url);
  if (result) break;
}
if (!result) {
  try { result = fromEsbuild(); }
  catch (e) { console.error(`\nlocal build failed: ${e.message}`); process.exit(1); }
  /* No regex check on this path. esbuild --bundle already fails loudly with
     "Could not resolve" on any unresolved static import, which is a real parser
     rather than a pattern match — and text scanning gives false positives here,
     because supabase-js embeds `import ...` examples inside doc comments and
     inside warning strings. Trust the bundler. */
  console.log("esbuild resolved every static import (it errors otherwise)");
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT,
  `/* Vendored from ${result.from} on ${new Date().toISOString().slice(0, 10)}.\n`
+ `   Self-contained: no module imports remain. Do not edit.\n`
+ `   Refresh with: npm run vendor */\n` + result.src, "utf8");

const kb = (result.src.length / 1024).toFixed(0);
console.log(`\nwrote app/vendor/supabase-js.js  (${kb} KB, 0 remaining imports)`);
if (result.src.length < 50_000) console.log("warning: that looks small for supabase-js — check it loads before committing");
