import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The editor seeds its name, id and content through `useState` initialisers,
 * which run only on mount. A client-side navigation between two documents
 * reuses the same component instance, so without a `key` the header kept the
 * previous document's name and the navigation panel highlighted the previous
 * entry.
 *
 * Asserted against the source rather than by rendering: the defect is the
 * absence of one prop at one call site, and a render-level test passes whether
 * or not the route supplies it — the test would have to pass its own key,
 * which is precisely the thing under test.
 */
describe("the document route", () => {
  const source = readFileSync(join(process.cwd(), "src/routes/d.$id.tsx"), "utf8");

  it("keys the editor on the document id", () => {
    const start = source.indexOf("<App");
    const editorElement = source.slice(start, source.indexOf("/>", start));

    expect(start).toBeGreaterThan(-1);
    expect(editorElement).toContain("key={document.id}");
  });
});
