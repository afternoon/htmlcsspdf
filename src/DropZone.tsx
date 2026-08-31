import { Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface DropZoneProps {
  /** Files from a drop anywhere on the page. */
  onDrop: (files: File[]) => void;
  /** Shown on the overlay while files are dragged over the page. */
  hint: string;
}

/** Whether a drag carries files, rather than text moved within the page. */
function carriesFiles(transfer: DataTransfer | null): boolean {
  return transfer?.types.includes("Files") ?? false;
}

/**
 * The whole window as a drop target for files.
 *
 * Listens on `window` rather than wrapping the page in a div: a drop should
 * work over the header, the gap between panes, and the preview alike, and a
 * wrapper would still miss anything positioned outside it.
 *
 * Only drags carrying files are claimed. CodeMirror moves selected text by
 * drag, and intercepting that would break editing in the name of a feature
 * about files.
 *
 * File drags are taken in the capture phase and stopped there. CodeMirror has
 * a file drop handler of its own that reads the file and inserts its text at
 * the cursor; left to run, a dropped stylesheet would both replace the CSS
 * pane and be pasted into whichever pane it landed on — and because its read
 * is asynchronous, the paste would land last and win.
 */
export function DropZone({ onDrop, hint }: DropZoneProps) {
  const [dragging, setDragging] = useState(false);
  // Reachable from listeners that are attached once, so a re-render cannot
  // leave a drop calling a stale handler.
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;

  // Attached once for the life of the page; nothing here depends on props.
  useEffect(() => {
    // Dragging over a child fires `dragleave` on the parent before `dragenter`
    // on the child, so a plain boolean flickers the overlay off and on across
    // every element boundary. Counting the enters and leaves survives that.
    let depth = 0;

    const onDragEnter = (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer)) return;
      depth += 1;
      setDragging(true);
    };

    const onDragOver = (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer)) return;
      // Without this the browser refuses the drop and then navigates to the
      // file, replacing the editor with the user's own HTML rendered raw.
      e.preventDefault();
      // Keeps the editors from showing a text drop cursor for a drag that is
      // never going to be inserted as text.
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };

    const onDragLeave = (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };

    const reset = () => {
      depth = 0;
      setDragging(false);
    };

    const onDropEvent = (e: DragEvent) => {
      if (!carriesFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      reset();
      onDropRef.current([...(e.dataTransfer?.files ?? [])]);
    };

    // Capture, so a file drop is claimed before it reaches the element it
    // landed on.
    window.addEventListener("dragenter", onDragEnter, true);
    window.addEventListener("dragover", onDragOver, true);
    window.addEventListener("dragleave", onDragLeave, true);
    window.addEventListener("drop", onDropEvent, true);
    // A drag abandoned outside the window never reports a matching leave.
    window.addEventListener("dragend", reset, true);

    return () => {
      window.removeEventListener("dragenter", onDragEnter, true);
      window.removeEventListener("dragover", onDragOver, true);
      window.removeEventListener("dragleave", onDragLeave, true);
      window.removeEventListener("drop", onDropEvent, true);
      window.removeEventListener("dragend", reset, true);
    };
  }, []);

  if (!dragging) return null;

  return (
    // Purely a visual affordance for a pointer drag, and no one who cannot
    // drag can reach it, so it is hidden from assistive technology. What the
    // drop *does* is announced through the toast region instead.
    <div className="drop-overlay" aria-hidden="true">
      <div className="drop-overlay-card">
        <Upload size={20} aria-hidden="true" />
        <p className="drop-overlay-text">{hint}</p>
      </div>
    </div>
  );
}
