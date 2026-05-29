// Cloudflare D1 adapter — for Workers / edge runtime.
// Uses the D1 client from @cloudflare/workers-types.
// In Workers runtime, D1 is bound via env.DB (or custom binding name).
import { PRAGMA_SQL } from "../schema.js";

// D1 has async API only — we must not export getAdapterSync.
// driver.js will throw if getAdapterSync is called.
export async function createD1Adapter(bindingName = "DB") {
  // In Workers runtime, binding is injected via globalThis.env
  let db;
  if (typeof globalThis !== "undefined" && globalThis.env && globalThis.env[bindingName]) {
    db = globalThis.env[bindingName];
  } else if (process.env.D1_DATABASE) {
    // Fallback: allow override via env var (useful for local testing via wrangler dev)
    const { D1Database } = await import("@cloudflare/workers-types");
    db = new D1Database(process.env.D1_DATABASE);
  } else {
    throw new Error(`[D1] Binding '${bindingName}' not found in env and D1_DATABASE env not set`);
  }

  // D1: no pragma needed (already applied when DB was created via wrangler)
  // Some pragmas may not work on D1 — wrap in try/catch
  try { await db.exec(PRAGMA_SQL); } catch { /* D1 ignores most pragmas */ }

  // D1 returns D1Result<T> with { results: T[], success: boolean, meta: object }
  function d1ToRows(result) {
    return result.results ?? [];
  }

  return {
    driver: "d1",
    // run: executes and returns changes/lastInsertRowid
    // D1 doesn't expose lastInsertRowid — return 0
    async run(sql, params = []) {
      const r = await db.prepare(sql).bind(...params).run();
      return { changes: r.meta?.changes ?? 0, lastInsertRowid: 0 };
    },
    // get: returns first row or undefined
    async get(sql, params = []) {
      const r = await db.prepare(sql).bind(...params).first();
      return r ?? undefined;
    },
    // all: returns all rows
    async all(sql, params = []) {
      const r = await db.prepare(sql).bind(...params).all();
      return d1ToRows(r);
    },
    // exec: raw execute (DDL)
    async exec(sql) {
      const lines = sql.split(";").filter((l) => l.trim());
      for (const line of lines) {
        await db.prepare(line.trim()).run();
      }
    },
    // transaction: D1 supports Bun-style transactions via batch
    // Wrap in try/catch — D1 transactions may not be available on all plans
    transaction(fn) {
      // D1 transactions are NOT natively supported in the standard D1 client API.
      // For multi-statement atomicity, D1 uses the HTTP API with
      // X-Lines: transaction header, but the standard client doesn't expose it.
      // Fallback: run without transaction (less safe for importDb).
      // Repos that use transaction() for importDb will need to handle D1 specially.
      try {
        // Some D1 clients expose .batch() — try it
        if (typeof db.batch === "function") {
          return db.batch(fn); // fn should return array of prepared statements
        }
      } catch {}
      // No transaction support — execute directly
      fn();
    },
    // checkpoint: N/A for D1 (managed by Cloudflare)
    checkpoint() {},
    // close: N/A for D1
    close() {},
  };
}
