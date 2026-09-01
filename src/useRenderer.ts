import { useCallback, useEffect, useRef, useState } from "react";
import { describeIssue, validate } from "./document.ts";

export interface RenderError {
  message: string;
  hint?: string;
}

export interface Renderer {
  pdfUrl: string | null;
  error: RenderError | null;
  rendering: boolean;
  render: (html: string, css: string, documentId?: string | null) => Promise<void>;
  clearError: () => void;
  setError: (error: RenderError) => void;
  /** True when the editor has moved on from what the preview shows. */
  isStale: (html: string, css: string) => boolean;
}

/**
 * Owns the render lifecycle: validation, the fetch, and the blob URL the
 * preview iframe points at.
 *
 * Two races to keep in mind — a slow earlier response must not overwrite a
 * newer one, and the previous blob URL must not be revoked until the new one
 * is live in the iframe.
 */
export function useRenderer(): Renderer {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<RenderError | null>(null);
  const [rendering, setRendering] = useState(false);

  const seqRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const pdfUrlRef = useRef<string | null>(null);
  // What the visible PDF was rendered from. Compared by content rather than
  // tracked with a dirty flag, so undoing back to the rendered text clears the
  // stale state by itself.
  const [renderedFrom, setRenderedFrom] = useState<{ html: string; css: string } | null>(
    null,
  );

  const render = useCallback(
    async (html: string, css: string, documentId?: string | null) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const seq = ++seqRef.current;

      // The attempt gives up early in several places — a superseded render, a
      // syntax error, a rejected response. Running it as a nested function keeps
      // those returns local, so the pending flag is cleared on every path below
      // without a `finally`, which the React Compiler cannot compile.
      const attempt = async () => {
        try {
          // Catch syntax errors locally rather than spending a browser session on
          // input that cannot parse.
          const check = await validate(html, css);
          if (seq !== seqRef.current) return;
          if (!check.ok) {
            const extra = check.issues.length - 1;
            setError({
              message: describeIssue(check.issues[0]),
              hint:
                extra > 0
                  ? `${extra} more issue${extra > 1 ? "s" : ""} to fix.`
                  : "Fix the syntax error to render.",
            });
            return;
          }

          const res = await fetch("/api/render", {
            method: "POST",
            headers: { "content-type": "application/json" },
            // The document this content belongs to, when it has one. The
            // server refreshes its card preview on the same browser session
            // as the PDF, after the PDF has been sent — so the picture costs
            // a second render rather than a second session. Ignored unless
            // the document is the signed-in caller's and is owed one.
            body: JSON.stringify({ html, css, documentId: documentId ?? undefined }),
            signal: controller.signal,
          });
          if (seq !== seqRef.current) return;

          if (!res.ok) {
            let message = `Render failed (${res.status})`;
            let hint: string | undefined;
            try {
              const body = (await res.json()) as { error?: string; hint?: string };
              if (body.error) message = body.error;
              hint = body.hint;
            } catch {
              // Non-JSON error body; keep the status-based message.
            }
            // Keep the previous PDF visible underneath the overlay.
            setError({ message, hint });
            return;
          }

          const blob = await res.blob();
          if (seq !== seqRef.current) return;

          const url = URL.createObjectURL(blob);
          const previous = pdfUrlRef.current;
          pdfUrlRef.current = url;
          setPdfUrl(url);
          setRenderedFrom({ html, css });
          setError(null);
          if (previous) URL.revokeObjectURL(previous);
        } catch (e) {
          if (controller.signal.aborted) return;
          if (seq !== seqRef.current) return;
          // fetch() rejects with TypeError when the request never reached a
          // server — offline, DNS failure, connection refused.
          const unreachable = e instanceof TypeError;
          setError({
            message: unreachable
              ? "Unable to reach the render service."
              : e instanceof Error
                ? e.message
                : "Render failed.",
            hint: unreachable ? "Check your connection and try again." : undefined,
          });
        }
      };

      setRendering(true);
      // `attempt` handles its own failures, so this never rejects.
      await attempt();
      if (seq === seqRef.current) setRendering(false);
    },
    [],
  );

  // Release the final blob URL on unmount.
  useEffect(() => {
    return () => {
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    };
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const isStale = useCallback(
    (html: string, css: string) => {
      // Nothing rendered yet is not stale; the preview says so itself.
      if (!renderedFrom) return false;
      return renderedFrom.html !== html || renderedFrom.css !== css;
    },
    [renderedFrom],
  );

  return { pdfUrl, error, rendering, render, clearError, setError, isStale };
}
