import { useEffect, useRef, useState } from "react";
import { formatCss, formatHtml } from "./document.ts";

const FORMAT_DEBOUNCE_MS = 1200;

interface AutoFormat {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
  formatting: boolean;
}

/**
 * Reformats the editor content while the user pauses.
 *
 * Runs on a pause rather than on every keystroke, and only when the content
 * has actually settled — reformatting mid-word would fight the person typing.
 * Invalid input is left exactly as it is: Prettier cannot parse it, and
 * replacing someone's broken markup with nothing while they are repairing it
 * would be worse than leaving it alone.
 *
 * The caller owns the text, so this reports nothing about failures. A syntax
 * error already surfaces through validation on render; a failed format is
 * simply a no-op.
 */
export function useAutoFormat(
  html: string,
  css: string,
  onFormatted: (next: { html: string; css: string }) => void,
): AutoFormat {
  const [enabled, setEnabled] = useState(false);
  const [formatting, setFormatting] = useState(false);

  // The callback changes identity every render; keeping it in a ref means the
  // debounce restarts only when the content or the toggle changes.
  const onFormattedRef = useRef(onFormatted);
  onFormattedRef.current = onFormatted;

  // What we last produced, so formatting our own output does not re-trigger.
  const lastFormatted = useRef<{ html: string; css: string } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (lastFormatted.current?.html === html && lastFormatted.current?.css === css)
      return;

    const timer = setTimeout(async () => {
      setFormatting(true);
      try {
        const [formattedHtml, formattedCss] = await Promise.all([
          formatHtml(html),
          formatCss(css),
        ]);

        // `changed` is false when the text is already formatted, and both are
        // left untouched when parsing failed.
        if (!formattedHtml.changed && !formattedCss.changed) return;

        const next = {
          html: formattedHtml.changed ? formattedHtml.text : html,
          css: formattedCss.changed ? formattedCss.text : css,
        };
        lastFormatted.current = next;
        onFormattedRef.current(next);
      } finally {
        setFormatting(false);
      }
    }, FORMAT_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [html, css, enabled]);

  return { enabled, setEnabled, formatting };
}
