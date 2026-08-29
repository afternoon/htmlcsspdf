import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EditableName } from "./EditableName.tsx";

function renderName(name = "Invoice 042") {
  const onRename = vi.fn();
  render(<EditableName name={name} onRename={onRename} />);
  return { onRename };
}

/** Open the field the way a user does. */
async function startEditing(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("button", { name: `Rename ${name}` }));
  return screen.getByRole("textbox", { name: "Document name" });
}

describe("EditableName", () => {
  it("shows the name as a control that can be edited", () => {
    renderName();
    expect(screen.getByRole("button", { name: "Rename Invoice 042" })).toHaveTextContent(
      "Invoice 042",
    );
  });

  it("opens an input with the current name selected", async () => {
    const user = userEvent.setup();
    renderName();

    const input = await startEditing(user, "Invoice 042");

    expect(input).toHaveValue("Invoice 042");
    expect(input).toHaveFocus();
    // Selected, so typing replaces rather than appends.
    await user.keyboard("New name");
    expect(input).toHaveValue("New name");
  });

  it("commits on Enter", async () => {
    const user = userEvent.setup();
    const { onRename } = renderName();

    const input = await startEditing(user, "Invoice 042");
    await user.clear(input);
    await user.type(input, "Quote 7{Enter}");

    expect(onRename).toHaveBeenCalledWith("Quote 7");
  });

  it("commits on blur", async () => {
    const user = userEvent.setup();
    const { onRename } = renderName();

    const input = await startEditing(user, "Invoice 042");
    await user.clear(input);
    await user.type(input, "Letter");
    await user.tab();

    expect(onRename).toHaveBeenCalledWith("Letter");
  });

  it("commits once when Enter is followed by the blur it causes", async () => {
    const user = userEvent.setup();
    const { onRename } = renderName();

    const input = await startEditing(user, "Invoice 042");
    await user.clear(input);
    await user.type(input, "Once{Enter}");

    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it("commits via the Save name button", async () => {
    const user = userEvent.setup();
    const { onRename } = renderName();

    const input = await startEditing(user, "Invoice 042");
    await user.clear(input);
    await user.type(input, "Report");
    await user.click(screen.getByRole("button", { name: "Save name" }));

    expect(onRename).toHaveBeenCalledWith("Report");
  });

  it("falls back to Untitled when the name is cleared", async () => {
    const user = userEvent.setup();
    const { onRename } = renderName();

    const input = await startEditing(user, "Invoice 042");
    await user.clear(input);
    await user.keyboard("{Enter}");

    expect(onRename).toHaveBeenCalledWith("Untitled");
  });

  it("abandons the edit on Escape", async () => {
    const user = userEvent.setup();
    const { onRename } = renderName();

    const input = await startEditing(user, "Invoice 042");
    await user.clear(input);
    await user.type(input, "Discarded{Escape}");

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Rename Invoice 042" })).toBeVisible();
  });

  it("does not report a rename when the name is unchanged", async () => {
    const user = userEvent.setup();
    const { onRename } = renderName();

    await startEditing(user, "Invoice 042");
    await user.keyboard("{Enter}");

    expect(onRename).not.toHaveBeenCalled();
  });

  it("normalises the committed name", async () => {
    const user = userEvent.setup();
    const { onRename } = renderName();

    const input = await startEditing(user, "Invoice 042");
    await user.clear(input);
    await user.type(input, "  spaced   out  {Enter}");

    expect(onRename).toHaveBeenCalledWith("spaced out");
  });

  it("closes the editor after committing", async () => {
    const user = userEvent.setup();
    renderName();

    const input = await startEditing(user, "Invoice 042");
    await user.clear(input);
    await user.type(input, "Done{Enter}");

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("reports progress and blocks further edits while saving", () => {
    render(<EditableName name="Invoice 042" onRename={vi.fn()} editing saving />);

    expect(screen.getByRole("textbox", { name: "Document name" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /saving/i })).toBeDisabled();
  });
});
