import { type FormEvent, useEffect, useRef, useState } from "react";
import { DocumentNameSchema } from "./documentsApi.ts";

interface NameDialogProps {
  open: boolean;
  /** Pre-filled when renaming an existing document. */
  initialName?: string;
  title: string;
  submitLabel: string;
  saving?: boolean;
  onSubmit: (name: string) => void;
  onClose: () => void;
}

/**
 * Asks for a document name.
 *
 * Hand-rolled against the shared schema rather than a form library: one field
 * with one rule does not need a state engine, and the schema is the same one
 * the server validates with, so the two cannot disagree.
 */
export function NameDialog({
  open,
  initialName = "",
  title,
  submitLabel,
  saving = false,
  onSubmit,
  onClose,
}: NameDialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  // A name the user has not finished typing is not yet wrong.
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      setName(initialName);
      setError(null);
      setTouched(false);
      element.showModal();
    }
    if (!open && element.open) element.close();
  }, [open, initialName]);

  function validate(value: string): boolean {
    const result = DocumentNameSchema.safeParse(value);
    setError(
      result.success ? null : (result.error.issues[0]?.message ?? "Invalid name."),
    );
    return result.success;
  }

  function handleChange(value: string) {
    setName(value);
    // Only revalidates a field already blurred, so a name being typed for the
    // first time stays quiet until the user leaves it.
    if (touched) validate(value);
  }

  function handleBlur() {
    setTouched(true);
    validate(name);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!validate(name)) return;
    onSubmit(name.trim());
  }

  const showError = touched && error !== null;

  return (
    <dialog
      ref={dialog}
      className="dialog"
      onClose={onClose}
      aria-labelledby="name-title"
    >
      <form className="dialog-body" onSubmit={handleSubmit}>
        <h2 id="name-title">{title}</h2>

        <label className="field">
          <span>Document name</span>
          <input
            name="name"
            value={name}
            onChange={(e) => handleChange(e.target.value)}
            onBlur={handleBlur}
            // The dialog exists only to collect this one value, so focusing it
            // saves a keystroke rather than stealing focus from anything.
            autoFocus
            required
            aria-invalid={showError}
            aria-describedby={showError ? "name-error" : undefined}
            placeholder="Invoice, letter, report…"
          />
        </label>

        {/* Always in the DOM so the message is announced when it appears. */}
        <p className="field-error" id="name-error" role="alert" hidden={!showError}>
          {showError ? error : ""}
        </p>

        <div className="dialog-actions">
          <button type="button" data-variant="ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={saving}>
            {saving ? "Saving…" : submitLabel}
          </button>
        </div>
      </form>
    </dialog>
  );
}
