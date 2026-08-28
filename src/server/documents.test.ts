import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createDocument,
  deleteDocument,
  listDocuments,
  loadDocument,
  markThumbnail,
  renameDocument,
  updateDocument,
} from "./documents.ts";

/**
 * The ownership rule has a real security consequence, so it is tested against
 * a real SQLite database running the real migration — not a mock. If the
 * migration and these queries ever disagree, that shows up here.
 */

const ALICE = "user-alice";
const BOB = "user-bob";

/** Adapt node:sqlite to the small slice of the D1 API the queries use. */
function createTestDb(): { db: D1Database; raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  // Read from the project root: the real migration, so schema drift fails here.
  const migration = readFileSync(
    join(process.cwd(), "migrations/0001_initial.sql"),
    "utf8",
  );
  raw.exec(migration);

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

let db: D1Database;

beforeEach(() => {
  db = createTestDb().db;
});

const DOC = { name: "Invoice", html: "<h1>Hi</h1>", css: "h1 { color: red }" };

describe("ownership", () => {
  it("does not let one user load another's document", async () => {
    const { id } = await createDocument(db, ALICE, DOC);
    expect(await loadDocument(db, id, ALICE)).not.toBeNull();
    expect(await loadDocument(db, id, BOB)).toBeNull();
  });

  it("does not let one user update another's document", async () => {
    const { id } = await createDocument(db, ALICE, DOC);

    const updated = await updateDocument(db, id, BOB, { html: "<p>hacked</p>", css: "" });
    expect(updated).toBe(false);

    const doc = await loadDocument(db, id, ALICE);
    expect(doc?.html).toBe(DOC.html);
  });

  it("does not let one user rename another's document", async () => {
    const { id } = await createDocument(db, ALICE, DOC);

    expect(await renameDocument(db, id, BOB, "stolen")).toBe(false);
    expect((await loadDocument(db, id, ALICE))?.name).toBe("Invoice");
  });

  it("does not let one user delete another's document", async () => {
    const { id } = await createDocument(db, ALICE, DOC);

    expect(await deleteDocument(db, id, BOB)).toBe(false);
    expect(await loadDocument(db, id, ALICE)).not.toBeNull();
  });

  it("lists only the requesting user's documents", async () => {
    await createDocument(db, ALICE, { ...DOC, name: "Alice one" });
    await createDocument(db, ALICE, { ...DOC, name: "Alice two" });
    await createDocument(db, BOB, { ...DOC, name: "Bob one" });

    const forAlice = await listDocuments(db, ALICE);
    expect(forAlice.map((d) => d.name).sort()).toEqual(["Alice one", "Alice two"]);

    const forBob = await listDocuments(db, BOB);
    expect(forBob.map((d) => d.name)).toEqual(["Bob one"]);
  });

  it("does not let one user mark a thumbnail on another's document", async () => {
    const { id } = await createDocument(db, ALICE, DOC);

    expect(await markThumbnail(db, id, BOB)).toBe(false);
    expect((await loadDocument(db, id, ALICE))?.thumbnailUpdatedAt).toBeNull();
  });

  it("returns null for an unknown id rather than throwing", async () => {
    expect(await loadDocument(db, "does-not-exist", ALICE)).toBeNull();
  });
});

describe("createDocument", () => {
  it("returns an id and stores the content", async () => {
    const { id } = await createDocument(db, ALICE, DOC);
    expect(id).toBeTruthy();

    const doc = await loadDocument(db, id, ALICE);
    expect(doc).toMatchObject({
      name: "Invoice",
      html: DOC.html,
      css: DOC.css,
      userId: ALICE,
    });
  });

  it("gives each document a distinct id", async () => {
    const a = await createDocument(db, ALICE, DOC);
    const b = await createDocument(db, ALICE, DOC);
    expect(a.id).not.toBe(b.id);
  });

  it("sanitises HTML before storing it", async () => {
    // Storage is a boundary of its own: a document is rendered by a browser
    // and served back, so nothing executable may be persisted even if a
    // caller forgets to sanitise.
    const { id } = await createDocument(db, ALICE, {
      name: "Bad",
      html: "<p>ok</p><script>alert(1)</script>",
      css: "p { color: red }",
    });

    const doc = await loadDocument(db, id, ALICE);
    expect(doc?.html).not.toMatch(/<script/i);
    expect(doc?.html).toContain("ok");
  });

  it("starts with no thumbnail", async () => {
    const { id } = await createDocument(db, ALICE, DOC);
    expect((await loadDocument(db, id, ALICE))?.thumbnailUpdatedAt).toBeNull();
  });
});

describe("updateDocument", () => {
  it("replaces content and reports success", async () => {
    const { id } = await createDocument(db, ALICE, DOC);

    expect(await updateDocument(db, id, ALICE, { html: "<p>new</p>", css: "p{}" })).toBe(
      true,
    );

    const doc = await loadDocument(db, id, ALICE);
    expect(doc?.html).toBe("<p>new</p>");
    expect(doc?.css).toBe("p{}");
  });

  it("sanitises HTML on update too", async () => {
    const { id } = await createDocument(db, ALICE, DOC);
    await updateDocument(db, id, ALICE, { html: '<p onclick="x()">t</p>', css: "" });

    expect((await loadDocument(db, id, ALICE))?.html).not.toMatch(/onclick/i);
  });

  it("leaves the name alone", async () => {
    const { id } = await createDocument(db, ALICE, DOC);
    await updateDocument(db, id, ALICE, { html: "<p>x</p>", css: "" });

    expect((await loadDocument(db, id, ALICE))?.name).toBe("Invoice");
  });

  it("clears a stale thumbnail, since the content it showed is gone", async () => {
    const { id } = await createDocument(db, ALICE, DOC);
    await markThumbnail(db, id, ALICE);
    expect((await loadDocument(db, id, ALICE))?.thumbnailUpdatedAt).not.toBeNull();

    await updateDocument(db, id, ALICE, { html: "<p>different</p>", css: "" });
    expect((await loadDocument(db, id, ALICE))?.thumbnailUpdatedAt).toBeNull();
  });

  it("reports failure for an unknown document", async () => {
    expect(await updateDocument(db, "nope", ALICE, { html: "", css: "" })).toBe(false);
  });
});

describe("renameDocument", () => {
  it("changes the name without touching content", async () => {
    const { id } = await createDocument(db, ALICE, DOC);

    expect(await renameDocument(db, id, ALICE, "Quote")).toBe(true);

    const doc = await loadDocument(db, id, ALICE);
    expect(doc?.name).toBe("Quote");
    expect(doc?.html).toBe(DOC.html);
  });
});

describe("deleteDocument", () => {
  it("removes the document", async () => {
    const { id } = await createDocument(db, ALICE, DOC);

    expect(await deleteDocument(db, id, ALICE)).toBe(true);
    expect(await loadDocument(db, id, ALICE)).toBeNull();
  });

  it("reports failure when the document is already gone", async () => {
    const { id } = await createDocument(db, ALICE, DOC);
    await deleteDocument(db, id, ALICE);

    expect(await deleteDocument(db, id, ALICE)).toBe(false);
  });
});

describe("listDocuments", () => {
  it("returns most recently updated first", async () => {
    const first = await createDocument(db, ALICE, { ...DOC, name: "First" });
    const second = await createDocument(db, ALICE, { ...DOC, name: "Second" });

    // Touch the older one so it becomes the most recent.
    await updateDocument(db, first.id, ALICE, { html: "<p>touched</p>", css: "" });

    const names = (await listDocuments(db, ALICE)).map((d) => d.name);
    expect(names[0]).toBe("First");
    expect(names).toContain("Second");
    expect(second.id).toBeTruthy();
  });

  it("omits document content, which a list does not need", async () => {
    await createDocument(db, ALICE, DOC);

    const [summary] = await listDocuments(db, ALICE);
    expect(summary).not.toHaveProperty("html");
    expect(summary).not.toHaveProperty("css");
    expect(summary.name).toBe("Invoice");
  });

  it("returns an empty list for a user with no documents", async () => {
    expect(await listDocuments(db, BOB)).toEqual([]);
  });
});
