// Shim for better-sqlite3 — not available in CF Workers.
// Cursor OAuth auto-import uses this to read local SQLite token DBs.
// In Workers there is no filesystem, so this feature is unavailable.
// Returns stub Database class that returns empty results.
class StubDatabase {
  constructor() {}
  prepare() { return new StubStatement(); }
  close() {}
}
class StubStatement {
  all() { return []; }
  get() { return undefined; }
  run() { return { changes: 0, lastInsertRowid: 0 }; }
}
module.exports = { Database: StubDatabase };
export default StubDatabase;
