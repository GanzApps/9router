// Cloudflare D1 adapter — for Workers / edge runtime.
// D1 is injected by the Workers runtime via globalThis.env binding.
// No npm packages needed — the binding is provided by wrangler at runtime.
//
// All methods are ASYNC (D1 is async-only). This is fine because:
// - driver.js's getAdapter() returns the fully-initialized adapter (async)
// - All repo code calls await db.all/run/get(...) after getAdapter()
// - migrate.js calls async adapter methods with await
// - getAdapterSync() is NOT called by any repo code (only internal use)
import { PRAGMA_SQL } from "../schema.js";
import { TABLES, buildCreateTableSql } from "../schema.js";

export async function createD1Adapter(bindingName = "DB") {
  if (typeof globalThis === "undefined" || !globalThis.env || !globalThis.env[bindingName]) {
    throw new Error(`[D1] Binding '${bindingName}' not found in Workers env`);
  }
  const db = globalThis.env[bindingName];

  // ── Bootstrap: create all tables if they don't exist ───────────────────────
  // D1 executes server-side. Fire all DDL in parallel, await together.
  // If tables already exist, CREATE TABLE IF NOT EXISTS is a no-op.
  await Promise.all([
    ...PRAGMA_SQL.split(";").map(l => l.trim()).filter(Boolean).map(l =>
      db.prepare(l).run().catch(() => {})  // pragma errors are non-fatal
    ),
    ...Object.entries(TABLES).flatMap(([name, def]) => [
      db.prepare(buildCreateTableSql(name, def)).run().catch(() => {}),
      ...(def.indexes || []).map(idx =>
        db.prepare(idx).run().catch(() => {})
      ),
    ]),
  ]);

  return {
    driver: "d1",

    async run(sql, params = []) {
      const r = await db.prepare(sql).bind(...params).run();
      return { changes: r.meta?.changes ?? 0, lastInsertRowid: 0 };
    },

    async get(sql, params = []) {
      const r = await db.prepare(sql).bind(...params).first();
      return r ?? undefined;
    },

    async all(sql, params = []) {
      const r = await db.prepare(sql).bind(...params).all();
      return r.results ?? [];
    },

    async exec(sql) {
      // D1 may not support all SQLite pragmas — skip them silently
      const lines = sql.split(";").filter(l => {
        const t = l.trim().toUpperCase();
        return t && !t.startsWith("PRAGMA");
      });
      await Promise.all(lines.map(l => l.trim()).filter(Boolean).map(
        l => db.prepare(l).run().catch(() => {})
      ));
    },

    transaction(fn) {
      // D1 has no synchronous transaction API.
      // Run fn() — each db.run() auto-commits. Less safe than Bun transactions
      // but importDb() handles this gracefully (per-row inserts, no multi-row rollback).
      fn();
    },

    checkpoint() {},  // N/A — D1 managed by Cloudflare
    close() {},       // N/A — D1 connections pooled by runtime
  };
}
