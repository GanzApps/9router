#!/usr/bin/env node
// Patch @opennextjs/cloudflare's bundle-server.js to externalize native-only modules
// Run AFTER npm install, BEFORE npx opennextjs-cloudflare build
import fs from "node:fs";
import path from "node:path";

const bundleServerPath = path.join(
  process.cwd(),
  "node_modules",
  "@opennextjs",
  "cloudflare",
  "dist",
  "cli",
  "build",
  "bundle-server.js"
);
const shimsSrcDir = path.join(
  process.cwd(),
  "node_modules",
  "@opennextjs",
  "cloudflare",
  "dist",
  "cli",
  "templates",
  "shims"
);
const shimsOutDir = path.join(
  process.cwd(),
  ".open-next",
  "cloudflare-templates",
  "shims"
);

let code = fs.readFileSync(bundleServerPath, "utf8");
let modified = false;

// ── 1. Add native-only modules to esbuild external list ──────────────────────
if (!code.includes('"bun:sqlite"')) {
  code = code.replace(
    'external: ["./middleware/handler.mjs"]',
    'external: ["./middleware/handler.mjs", "bun:sqlite", "bun:sqlite/vec", "better-sqlite3"]'
  );
  modified = true;
}

// ── 2. Create better-sqlite3 stub shim ──────────────────────────────────────
// Copy to node_modules shims dir so OpenNext's copy step picks it up
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
  console.log(`[patch] Created better-sqlite3 stub: ${betterShimPath}`);
}

// Also write to output dir (in case .open-next already exists)
fs.mkdirSync(shimsOutDir, { recursive: true });
fs.writeFileSync(path.join(shimsOutDir, "better-sqlite3.js"), stubContent);

// ── 3. Add alias for native modules → throw/empty shims ──────────────────────
if (!code.includes('"better-sqlite3"')) {
  code = code.replace(
    '"@next/env": path.join(buildOpts.outputDir, "cloudflare-templates/shims/env.js"),',
    `"@next/env": path.join(buildOpts.outputDir, "cloudflare-templates/shims/env.js"),
            // bun:sqlite — Bun-only native module, not available in Workers
            "bun:sqlite": path.join(buildOpts.outputDir, "cloudflare-templates/shims/throw.js"),
            // better-sqlite3 — Node-only native addon, not available in Workers
            "better-sqlite3": path.join(buildOpts.outputDir, "cloudflare-templates/shims/better-sqlite3.js"),
            // node:sqlite — uses Node native addon features not in Workers
            "node:sqlite": path.join(buildOpts.outputDir, "cloudflare-templates/shims/throw.js"),`
  );
  modified = true;
}

if (modified) {
  fs.writeFileSync(bundleServerPath, code);
  console.log("[patch] bundle-server.js patched: native modules externalized and aliased");
} else {
  console.log("[patch] bundle-server.js already patched, skipping");
}
