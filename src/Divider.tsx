import { useCallback, useEffect, useRef } from "react";
import { MAX_FRACTION, MIN_FRACTION } from "./storage.ts";

interface DividerProps {
  orientation: "vertical" | "horizontal";
  /** Accessible name — a separator with no name is unusable by keyboard. */
  label: string;
  /** Current split as a fraction of the container taken by the first pane. */
  fraction: number;
  onChange: (fraction: number) => void;
  /** Clamp so neither pane can be dragged shut. */
  min?: number;
  max?: number;
}

/**
 * A draggable split handle. Measures its parent on each drag so the fraction
 * stays correct when the window is resized between drags.
 */
export function Divider({
  orientation,
  label,
  fraction,
  onChange,
  min = MIN_FRACTION,
  max = MAX_FRACTION,
}: DividerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  // Latest callback, so the window listeners don't need re-binding per render.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const vertical = orientation === "vertical";

  const apply = useCallback(
    (clientX: number, clientY: number) => {
      const parent = ref.current?.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const raw = vertical
        ? (clientX - rect.left) / rect.width
        : (clientY - rect.top) / rect.height;
      if (!Number.isFinite(raw)) return;
      onChangeRef.current(Math.min(max, Math.max(min, raw)));
    },
    [vertical, min, max],
  );

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!dragging.current) return;
      e.preventDefault();
      apply(e.clientX, e.clientY);
    };
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      delete document.body.dataset.dragging;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [apply]);

  const start = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = true;
      // Suppress text/iframe selection and keep the cursor consistent while
      // the pointer travels outside the handle.
      document.body.dataset.dragging = vertical ? "col" : "row";
    },
    [vertical],
  );

  // Keyboard nudging keeps the split reachable without a pointer.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const dec = vertical ? "ArrowLeft" : "ArrowUp";
      const inc = vertical ? "ArrowRight" : "ArrowDown";
      if (e.key !== dec && e.key !== inc) return;
      e.preventDefault();
      const step = e.shiftKey ? 0.1 : 0.02;
      const next = fraction + (e.key === inc ? step : -step);
      onChangeRef.current(Math.min(max, Math.max(min, next)));
    },
    [vertical, fraction, min, max],
  );

  return (
    // No native element implements a resizable split handle; role="separator"
    // with a tabindex is the ARIA window-splitter pattern.
    // biome-ignore lint/a11y/useSemanticElements: no native equivalent exists
    <div
      ref={ref}
      className={`divider ${vertical ? "divider-v" : "divider-h"}`}
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-valuenow={Math.round(fraction * 100)}
      aria-valuemin={Math.round(min * 100)}
      aria-valuemax={Math.round(max * 100)}
      onPointerDown={start}
      onKeyDown={onKeyDown}
    />
  );
}
