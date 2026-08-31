// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { getSchema } from "better-auth/db";
import { describe, expect, it } from "vitest";
import { authPlugins } from "./authPlugins.ts";

/**
 * The migrations must still describe the tables Better Auth expects.
 *
 * `@better-auth/cli generate` cannot check this for us — its latest release is
 * 1.4.x and predates the OAuth provider plugin — so the schema the plugins
 * declare at runtime is compared against the SQL directly. An upgrade that
 * adds a column now fails here, loudly, instead of surfacing as a
 * "no such column" the first time somebody tries to authorize an agent.
 *
 * `authPlugins` is imported rather than reconstructed: a test-local copy of
 * the plugin configuration would be the very thing that drifts.
 */

/** Build the schema every migration in `migrations/` produces, in order. */
function migratedDatabase(): DatabaseSync {
  const raw = new DatabaseSync(":memory:");
  const dir = join(process.cwd(), "migrations");
  for (const file of readdirSync(dir).sort()) {
    if (file.endsWith(".sql")) raw.exec(readFileSync(join(dir, file), "utf8"));
  }
  return raw;
}

interface ColumnInfo {
  name: string;
  notnull: number;
}

function columns(raw: DatabaseSync, table: string): Map<string, ColumnInfo> {
  const rows = raw
    .prepare(`pragma table_info("${table}")`)
    .all() as unknown as ColumnInfo[];
  return new Map(rows.map((row) => [row.name, row]));
}

const schema = getSchema({
  // Any syntactically valid resource will do: the identifier is validated on
  // construction but does not affect which tables exist.
  plugins: authPlugins("https://example.test/api/mcp"),
});

describe("auth schema", () => {
  const raw = migratedDatabase();

  it("declares tables to check, so an empty schema cannot pass silently", () => {
    expect(Object.keys(schema).length).toBeGreaterThan(4);
  });

  for (const [model, definition] of Object.entries(schema)) {
    describe(model, () => {
      const found = columns(raw, model);

      it("exists", () => {
        expect(found.size).toBeGreaterThan(0);
      });

      it("has an id primary key", () => {
        expect(found.has("id")).toBe(true);
      });

      for (const [field, attribute] of Object.entries(definition.fields)) {
        const name = attribute.fieldName ?? field;

        it(`has ${name}`, () => {
          expect(found.get(name)).toBeDefined();
        });

        // A column the library requires but the table lets be null is the
        // failure that would otherwise only show up as a write that succeeds
        // and a read that cannot make sense of the row.
        if (attribute.required) {
          it(`requires ${name}`, () => {
            expect(found.get(name)?.notnull).toBe(1);
          });
        }
      }
    });
  }
});
