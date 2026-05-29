#!/usr/bin/env node
// Patch @opennextjs/cloudflare's bundle-server.js to externalize bun:sqlite
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

let code = fs.readFileSync(bundleServerPath, "utf8");

// 1. Add bun:sqlite to the external array
if (!code.includes('"bun:sqlite"')) {
  code = code.replace(
    'external: ["./middleware/handler.mjs"]',
    'external: ["./middleware/handler.mjs", "bun:sqlite", "bun:sqlite/vec", "better-sqlite3"]'
  );
}

// 2. Add alias for bun:sqlite → throw shim
// Find the alias block and add bun:sqlite → throw.js
if (!code.includes('"bun:sqlite"')) {
  // Find the last alias entry and add after it
  const throwShim = path.join(
    "path.join(buildOpts.outputDir, \"cloudflare-templates/shims/throw.js\")"
  );
  code = code.replace(
    '"@next/env": path.join(buildOpts.outputDir, "cloudflare-templates/shims/env.js"),',
    `"@next/env": path.join(buildOpts.outputDir, "cloudflare-templates/shims/env.js"),
            // bun:sqlite is Bun-only, not available in Workers — throw
            "bun:sqlite": path.join(buildOpts.outputDir, "cloudflare-templates/shims/throw.js"),
            // better-sqlite3 is Node-only (native addon), not available in Workers — throw
            "better-sqlite3": path.join(buildOpts.outputDir, "cloudflare-templates/shims/throw.js"),
            // node:sqlite uses native addon features not available in Workers — throw
            "node:sqlite": path.join(buildOpts.outputDir, "cloudflare-templates/shims/throw.js"),`
  );
}

fs.writeFileSync(bundleServerPath, code);
console.log("[patch] bundle-server.js patched: bun:sqlite externalized and aliased to throw shim");
