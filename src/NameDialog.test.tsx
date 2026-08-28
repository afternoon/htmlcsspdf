import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { NameDialog } from "./NameDialog.tsx";

/**
 * jsdom does not implement <dialog>, so showModal/close are stubbed and the
 * element's contents are asserted directly. That keeps these tests about the
 * form's behaviour rather than the platform's dialog implementation.
 */
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

function renderDialog(props: Partial<Parameters<typeof NameDialog>[0]> = {}) {
  const onSubmit = vi.fn();
  const onClose = vi.fn();
  render(
    <NameDialog
      open
      title="Name your document"
      submitLabel="Save document"
      onSubmit={onSubmit}
      onClose={onClose}
      {...props}
    />,
  );
  return { onSubmit, onClose };
}

describe("NameDialog", () => {
  it("submits the name the user typed", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog();

    await user.type(screen.getByLabelText("Document name"), "Invoice 001");
    await user.click(screen.getByRole("button", { name: "Save document" }));

    expect(onSubmit).toHaveBeenCalledWith("Invoice 001");
  });

  it("trims surrounding whitespace from the name", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog();

    await user.type(screen.getByLabelText("Document name"), "  Padded  ");
    await user.click(screen.getByRole("button", { name: "Save document" }));

    expect(onSubmit).toHaveBeenCalledWith("Padded");
  });

  it("stays quiet while a name is being typed for the first time", async () => {
    const user = userEvent.setup();
    renderDialog();

    // Typing then clearing leaves it empty and invalid, but the field has not
    // been left yet — so no error should be shown.
    await user.type(screen.getByLabelText("Document name"), "a");
    await user.clear(screen.getByLabelText("Document name"));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports an empty name once the field has been left", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog();

    await user.click(screen.getByLabelText("Document name"));
    await user.tab();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /give the document a name/i,
    );
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("reveals the error on submit even if the field was never visited", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Save document" }));

    expect(await screen.findByRole("alert")).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("marks the field invalid for assistive technology", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Save document" }));

    const input = screen.getByLabelText("Document name");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription(/give the document a name/i);
  });

  it("clears the error once the name becomes valid", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Save document" }));
    expect(await screen.findByRole("alert")).toBeVisible();

    await user.type(screen.getByLabelText("Document name"), "Now valid");

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("pre-fills the current name when renaming", () => {
    renderDialog({ initialName: "Existing name", title: "Rename document" });

    expect(screen.getByLabelText("Document name")).toHaveValue("Existing name");
  });

  it("reports saving progress and prevents a double submit", () => {
    renderDialog({ saving: true });

    const submit = screen.getByRole("button", { name: /saving/i });
    expect(submit).toBeDisabled();
  });

  it("closes without submitting when cancelled", async () => {
    const user = userEvent.setup();
    const { onSubmit, onClose } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalled();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
