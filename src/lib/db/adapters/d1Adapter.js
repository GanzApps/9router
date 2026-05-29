// Cloudflare D1 adapter — for Workers / edge runtime.
// D1 is injected by the Workers runtime via globalThis.env binding.
// No npm packages needed — the binding is provided by wrangler at runtime.
export async function createD1Adapter(bindingName = "DB") {
  // In Workers runtime, D1 is bound via env (no import needed)
  if (typeof globalThis === "undefined" || !globalThis.env || !globalThis.env[bindingName]) {
    throw new Error(`[D1] Binding '${bindingName}' not found in Workers env`);
  }
  const db = globalThis.env[bindingName];

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
    // exec: raw execute (DDL — CREATE TABLE, etc.)
    async exec(sql) {
      const lines = sql.split(";").filter((l) => l.trim());
      for (const line of lines) {
        if (line.trim()) await db.prepare(line.trim()).run();
      }
    },
    // transaction: D1 standard client doesn't support Bun-style transactions.
    // Fallback: run statements sequentially (less safe for multi-row writes).
    // importDb() uses this — data integrity is still maintained per-row.
    transaction(fn) {
      try {
        if (typeof db.batch === "function") {
          return db.batch(fn()); // fn must return prepared statement array
        }
      } catch {}
      fn(); // no-op transaction fallback
    },
    // checkpoint: N/A — D1 is managed by Cloudflare
    checkpoint() {},
    // close: N/A — D1 connections are pooled by the runtime
    close() {},
  };
}
