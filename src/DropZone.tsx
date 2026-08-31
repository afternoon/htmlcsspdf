import { Upload } from "lucide-react";
import type { ReactNode } from "react";
import type { FileDrop } from "./useFileDrop.ts";

interface DropZoneProps {
  /** From `useFileDrop`, held by the page so its picker button can reach it. */
  drop: FileDrop;
  /** Shown on the overlay while files are dragged over the page. */
  hint: string;
  children: ReactNode;
}

/**
 * Wraps the page in a file drop target and shows what a drop would do.
 *
 * Wrapping rather than listening on `window`: react-dropzone delivers through
 * the element its root props are on, and a full-height wrapper covers the
 * header, the gap between panes and the preview alike.
 */
export function DropZone({ drop, hint, children }: DropZoneProps) {
  return (
    <div {...drop.rootProps} className="drop-root">
      {/* Backs the picker button; react-dropzone keeps it out of the tab order
          and labelled, so it is never a stray control of its own. */}
      <input {...drop.inputProps} />

      {children}

      {drop.dragging ? (
        // Purely a visual affordance for a pointer drag, and no one who cannot
        // drag can reach it, so it is hidden from assistive technology. What
        // the drop *does* is announced through the toast region instead.
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-overlay-card">
            <Upload size={20} aria-hidden="true" />
            <p className="drop-overlay-text">{hint}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
