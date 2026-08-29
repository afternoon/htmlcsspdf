import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { DEFAULT_DOCUMENT_NAME, normalizeName } from "./documentName.ts";

interface EditableNameProps {
  name: string;
  onRename: (name: string) => void;
  /** Opens straight into editing — used by the card's Rename action. */
  editing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  saving?: boolean;
  className?: string;
}

/**
 * A document name that becomes an input when clicked.
 *
 * The button and the input are deliberately styled alike, so flipping between
 * them does not move anything around it — see `.name-field` in styles.css,
 * where both share the same font, padding and border box.
 */
export function EditableName({
  name,
  onRename,
  editing: controlledEditing,
  onEditingChange,
  saving = false,
  className,
}: EditableNameProps) {
  const [uncontrolledEditing, setUncontrolledEditing] = useState(false);
  const editing = controlledEditing ?? uncontrolledEditing;
  const [draft, setDraft] = useState(name);
  const input = useRef<HTMLInputElement>(null);
  // Commit runs from both Enter and blur, and Enter blurs the field — without
  // this the same edit would be submitted twice.
  const committed = useRef(false);

  function setEditing(next: boolean) {
    setUncontrolledEditing(next);
    onEditingChange?.(next);
  }

  useEffect(() => {
    if (!editing) return;
    committed.current = false;
    setDraft(name);
    // Focus and select on open, so typing replaces the old name. autoFocus
    // would only fire on mount, and this component stays mounted.
    input.current?.focus();
    input.current?.select();
  }, [editing, name]);

  function commit() {
    if (committed.current) return;
    committed.current = true;

    // Empty commits to the default rather than erroring: it is what the server
    // does with a blank name, so there is no state the user can get stuck in.
    const next = normalizeName(draft);
    setEditing(false);
    if (next !== name) onRename(next);
  }

  function cancel() {
    committed.current = true;
    setDraft(name);
    setEditing(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        className={`name-field ${className ?? ""}`}
        onClick={() => setEditing(true)}
        // The name alone reads as a label rather than an action.
        aria-label={`Rename ${name}`}
      >
        {name}
      </button>
    );
  }

  return (
    <span className="name-edit">
      <input
        ref={input}
        className={`name-field ${className ?? ""}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        // Blur covers clicking away and tabbing out. The Save name button is
        // reached by that same blur, so it commits without needing its own
        // handler to race this one.
        onBlur={commit}
        aria-label="Document name"
        placeholder={DEFAULT_DOCUMENT_NAME}
        disabled={saving}
      />
      <button type="button" className="name-save" onMouseDown={commit} disabled={saving}>
        {saving ? "Saving…" : "Save name"}
      </button>
    </span>
  );
}
