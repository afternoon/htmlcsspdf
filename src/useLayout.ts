import { useCallback, useEffect, useState } from "react";
import { clampFraction, type Layout, loadLayout, saveLayout } from "./storage.ts";

export interface LayoutState extends Layout {
  setEditors: (fraction: number) => void;
  setHtmlRows: (fraction: number) => void;
}

/** Pane split fractions, clamped and persisted across reloads. */
export function useLayout(): LayoutState {
  const [layout, setLayout] = useState<Layout>(loadLayout);

  useEffect(() => {
    saveLayout(layout);
  }, [layout]);

  const setEditors = useCallback((fraction: number) => {
    setLayout((prev) => ({ ...prev, editors: clampFraction(fraction) }));
  }, []);

  const setHtmlRows = useCallback((fraction: number) => {
    setLayout((prev) => ({ ...prev, htmlRows: clampFraction(fraction) }));
  }, []);

  return { ...layout, setEditors, setHtmlRows };
}
