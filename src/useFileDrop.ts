import { useDropzone } from "react-dropzone";

/**
 * The page-wide file drop target, and the file picker that reaches the same
 * thing from the keyboard.
 *
 * react-dropzone owns the drag plumbing — the enter/leave counting that a
 * naive boolean gets wrong, directory expansion, and the document-level guard
 * that stops the browser navigating to a dropped file. What a drop *means* is
 * still decided by `dropFiles.ts`, so both pages answer identically and the
 * messages stay ours rather than becoming generic rejection codes.
 */

/** Offered in the file picker; the drop rules still decide what is accepted. */
const PICKER_TYPES = {
  "text/html": [".html", ".htm", ".xhtml"],
  "text/css": [".css"],
};

export interface FileDrop {
  /** Spread onto the element that should act as the drop target. */
  rootProps: ReturnType<ReturnType<typeof useDropzone>["getRootProps"]>;
  /** Spread onto the hidden input that backs the file picker. */
  inputProps: ReturnType<ReturnType<typeof useDropzone>["getInputProps"]>;
  dragging: boolean;
  /** Open the system file picker — the keyboard path to the same result. */
  open: () => void;
}

export function useFileDrop(onFiles: (files: File[]) => void): FileDrop {
  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    // Rejections are forwarded too: `accept` is here to filter the picker's
    // dialog, not to decide the outcome. Dropping a PDF should say so by name,
    // which is `dropFiles.ts`'s job, not arrive as a silent non-event.
    onDrop: (accepted, rejected) =>
      onFiles([...accepted, ...rejected.map((r) => r.file)]),
    accept: PICKER_TYPES,
    multiple: true,
    // The target is the whole page, so a click or Enter anywhere would
    // otherwise open a file dialog. The picker has its own button instead.
    noClick: true,
    noKeyboard: true,
  });

  return {
    rootProps: getRootProps(),
    inputProps: getInputProps(),
    dragging: isDragActive,
    open,
  };
}
