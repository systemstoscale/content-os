import type { Env } from "../env";

// Runtime D1 schema bootstrap for Deploy-button installs.
//
// WHY THIS EXISTS: the Cloudflare Deploy button auto-provisions the D1 database,
// but the build command's `wrangler d1 migrations apply` cannot resolve it — the
// build runs BEFORE provisioning writes the database_id back into the config, and
// D1 subcommands don't support auto-provisioned bindings anyway (workers-sdk
// #13632). So instead of applying migrations in the build, we apply them at
// RUNTIME against the `env.DB` binding (always connected once deployed), once per
// isolate.
//
// SAFE TO RE-RUN: every statement across migrations/ is `CREATE ... IF NOT
// EXISTS`, so applying the full set is idempotent — existing objects are skipped.
// The .sql files are imported as text (see ../sql-shim.d.ts + the Text rule in
// wrangler config) so they remain the single source of truth, shared with the
// operator `wrangler d1 migrations apply` path (install.sh).

import m0001 from "../../migrations/0001_init.sql";
import m0002 from "../../migrations/0002_telegram.sql";
import m0003 from "../../migrations/0003_tg_dedupe.sql";
import m0005 from "../../migrations/0005_auth.sql";
import m0007 from "../../migrations/0007_cost_tracking.sql";
import m0019 from "../../migrations/0019_content_ideas.sql";
import m0020 from "../../migrations/0020_reel_projects.sql";
import m0021 from "../../migrations/0021_assets.sql";

// Order matters only for readability — every statement is IF NOT EXISTS.
const MIGRATIONS = [m0001, m0002, m0003, m0005, m0007, m0019, m0020, m0021];

/** Split a .sql file into individual executable statements: strip comments,
 *  then split on ";". Safe for these migrations (DDL only, no ";" inside
 *  string literals). */
function statements(sql: string): string[] {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "") // block comments
    .replace(/--[^\n]*/g, "") // line + inline comments
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

let schemaPromise: Promise<void> | null = null;

/** Ensure every table + index exists. Runs the full migration set once per
 *  isolate; subsequent calls await the cached result (no DB round-trips). Safe
 *  to call before any DB-dependent request. */
export function ensureSchema(env: Env): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = apply(env).catch((e) => {
      // Don't cache a failure — let the next request retry the bootstrap.
      schemaPromise = null;
      throw e;
    });
  }
  return schemaPromise;
}

async function apply(env: Env): Promise<void> {
  const stmts = MIGRATIONS.flatMap(statements);
  // Sequential single-statement execution — the most broadly-compatible way to
  // run DDL on D1 (no transaction/DDL-in-batch edge cases). One-time cost per
  // isolate; every statement is IF NOT EXISTS so order/repeats are harmless.
  for (const sql of stmts) {
    await env.DB.prepare(sql).run();
  }
}
