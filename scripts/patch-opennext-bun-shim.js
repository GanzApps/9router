#!/usr/bin/env node
// Patch @opennextjs/cloudflare's esbuild calls to externalize native-only modules
// Run AFTER npm install, BEFORE npx opennextjs-cloudflare build
import fs from "node:fs";
import path from "node:path";

const distDir = path.join(process.cwd(), "node_modules", "@opennextjs", "cloudflare", "dist", "cli", "build");

// ── Files to patch ─────────────────────────────────────────────────────────────
const filesToPatch = [
  path.join(distDir, "bundle-server.js"),         // main handler bundle
  path.join(distDir, "open-next", "createServerBundle.js"),  // per-function bundles
];

// ── Modules to externalize ─────────────────────────────────────────────────────
const nativeModules = [
  "bun:sqlite",
  "bun:sqlite/vec",
  "better-sqlite3",
];

// ── Create better-sqlite3 stub ─────────────────────────────────────────────────
const shimsSrcDir = path.join(process.cwd(), "node_modules", "@opennextjs", "cloudflare", "dist", "cli", "templates", "shims");
const stubContent = `// better-sqlite3 shim for CF Workers — no filesystem access anyway
class StubDatabase {
  constructor() {}
  prepare() { return { all: () => [], get: () => undefined, run: () => ({ changes: 0, lastInsertRowid: 0 }) }; }
  close() {}
}
module.exports = { Database: StubDatabase };
export default StubDatabase;
`;
const betterShimPath = path.join(shimsSrcDir, "better-sqlite3.js");
if (!fs.existsSync(betterShimPath)) {
  fs.writeFileSync(betterShimPath, stubContent);
  console.log(`[patch] Created better-sqlite3 stub`);
}

let totalModified = 0;

for (const file of filesToPatch) {
  if (!fs.existsSync(file)) {
    console.log(`[patch] File not found, skipping: ${file}`);
    continue;
  }

  let code = fs.readFileSync(file, "utf8");
  let modified = false;

  // ── 1. Patch external arrays ────────────────────────────────────────────────
  for (const mod of nativeModules) {
    const escaped = mod.replace(":", "\\:");
    const pattern = new RegExp(`external: \\["([^"]*middleware[^"]*)"\\]`, "g");
    code = code.replace(pattern, (match, inner) => {
      if (inner.includes(mod)) return match;  // already added
      modified = true;
      return `external: [${JSON.stringify(inner.replace(/,\\s*/, ", ").replace(/"\s*\]/, `", "${mod}"]`))}]`;
    });
  }

  // More specific pattern for the exact string
  code = code.replace(
    /external: \["\.\/middleware\.mjs"\]/g,
    (match) => {
      if (match.includes("bun:sqlite")) return match;
      modified = true;
      return `external: ["./middleware.mjs", "bun:sqlite", "bun:sqlite/vec", "better-sqlite3"]`;
    }
  );

  // ── 2. Patch alias blocks (only in bundle-server.js) ────────────────────────
  if (file.endsWith("bundle-server.js")) {
    if (!code.includes('"better-sqlite3"')) {
      code = code.replace(
        /"@next\/env": path\.join\(buildOpts\.outputDir, "cloudflare-templates\/shims\/env\.js"\),/,
        (m) => `${m}
            "bun:sqlite": path.join(buildOpts.outputDir, "cloudflare-templates/shims/throw.js"),
            "better-sqlite3": path.join(buildOpts.outputDir, "cloudflare-templates/shims/better-sqlite3.js"),
            "node:sqlite": path.join(buildOpts.outputDir, "cloudflare-templates/shims/throw.js"),`
      );
      modified = true;
    }
  }

  // ── 3. Patch createServerBundle.js alias (has different structure) ───────────
  if (file.includes("createServerBundle")) {
    // This file uses buildHelper.esbuildAsync with inline alias objects
    if (!code.includes('"better-sqlite3"') && code.includes("alias: {")) {
      // Find the alias block and add our entries
      code = code.replace(
        /(alias: \{[\s\S]*?)(\})/,
        (m, block, close) => {
          modified = true;
          return `${block}
            "bun:sqlite": path.join(options.outputDir, "cloudflare-templates/shims/throw.js"),
            "better-sqlite3": path.join(options.outputDir, "cloudflare-templates/shims/better-sqlite3.js"),
            "node:sqlite": path.join(options.outputDir, "cloudflare-templates/shims/throw.js"),${close}`;
        }
      );
    }
  }

  if (modified) {
    fs.writeFileSync(file, code);
    console.log(`[patch] Patched: ${path.basename(file)}`);
    totalModified++;
  } else {
    console.log(`[patch] No changes needed: ${path.basename(file)}`);
  }
}

if (totalModified > 0) {
  console.log(`[patch] Done — ${totalModified} file(s) patched`);
} else {
  console.log("[patch] All files already patched, skipping");
}
