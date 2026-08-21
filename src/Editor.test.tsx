import { html as htmlLang } from "@codemirror/lang-html";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Editor } from "./Editor.tsx";

/**
 * Mirrors how App uses Editor: controlled `value`, and a `language` extension
 * built inline so a fresh object identity arrives on every parent render.
 */
function Harness({ initial = "<p>hi</p>" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <Editor value={value} language={htmlLang()} onChange={setValue} label="HTML" />;
}

/**
 * CodeMirror's contenteditable carries the accessible name, so query it by
 * role and name rather than by class.
 */
function contentEl() {
  return screen.getByRole("textbox", { name: "HTML" });
}

describe("Editor", () => {
  it("keeps DOM focus in the editor after typing a character", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const content = contentEl();
    await user.click(content);
    expect(content).toHaveFocus();

    await user.keyboard("x");

    // The bug: the view is torn down and rebuilt on each keystroke, so the
    // element that had focus is detached and focus falls back to <body>.
    expect(document.activeElement).not.toBe(document.body);
    expect(contentEl()).toHaveFocus();
  });

  it("does not recreate the editor DOM when typing", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const before = contentEl();
    await user.click(before);
    await user.keyboard("x");

    // Same live DOM node — a rebuilt EditorView would swap this out.
    expect(contentEl()).toBe(before);
  });

  it("preserves the cursor position after typing", async () => {
    const user = userEvent.setup();
    render(<Harness initial="abc" />);

    const content = contentEl();
    await user.click(content);
    await user.keyboard("{End}");
    await user.keyboard("Z");

    const sel = window.getSelection();
    if (!sel) throw new Error("expected a selection inside the editor");
    // A destroyed view leaves no selection inside the editor at all.
    expect(sel.rangeCount).toBeGreaterThan(0);
    expect(contentEl().contains(sel.anchorNode)).toBe(true);
    expect(content.textContent).toContain("abcZ");
  });

  it("still applies external value changes (e.g. Reset)", async () => {
    function External() {
      const [value, setValue] = useState("<p>one</p>");
      return (
        <>
          <button type="button" onClick={() => setValue("<p>two</p>")}>
            swap
          </button>
          <Editor value={value} language={htmlLang()} onChange={setValue} label="HTML" />
        </>
      );
    }
    const user = userEvent.setup();
    render(<External />);

    expect(contentEl().textContent).toContain("one");
    await user.click(screen.getByRole("button", { name: "swap" }));
    expect(contentEl().textContent).toContain("two");
  });
});
