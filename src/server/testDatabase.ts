import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * A real SQLite database running the real migrations, wearing a D1 face.
 *
 * Shared by every server test that touches storage, so they all run against
 * the same schema production has and schema drift fails here rather than in a
 * deploy. Not a mock: the ownership rules under test are the `where` clauses,
 * and a mock that answers them is a mock that cannot fail.
 *
 * Test-only, but not a `.test.ts` file — vitest would try to run it as a suite.
 */

export const ALICE = "user-alice";
export const BOB = "user-bob";

export function createTestDb(): { db: D1Database; raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  // Every migration, in order, from the project root.
  const dir = join(process.cwd(), "migrations");
  for (const file of readdirSync(dir).sort()) {
    if (file.endsWith(".sql")) raw.exec(readFileSync(join(dir, file), "utf8"));
  }

  for (const id of [ALICE, BOB]) {
    raw
      .prepare(
        `insert into "user" ("id","name","email","emailVerified","createdAt","updatedAt")
         values (?, ?, ?, 1, date('now'), date('now'))`,
      )
      .run(id, id, `${id}@test.local`);
  }

  const statement = (sql: string, params: unknown[] = []): D1PreparedStatement =>
    ({
      bind: (...next: unknown[]) => statement(sql, next),
      first: async <T>() =>
        (raw.prepare(sql).get(...(params as never[])) ?? null) as T | null,
      all: async <T>() => ({
        results: raw.prepare(sql).all(...(params as never[])) as T[],
      }),
      run: async () => {
        const info = raw.prepare(sql).run(...(params as never[]));
        return { meta: { changes: Number(info.changes) } };
      },
    }) as unknown as D1PreparedStatement;

  return {
    db: { prepare: (sql: string) => statement(sql) } as unknown as D1Database,
    raw,
  };
}
