import { useCallback, useRef, useState } from "react";

/** A message currently being shown, identified so a repeat still counts. */
export interface ToastMessage {
  id: number;
  text: string;
}

interface UseToast {
  toast: ToastMessage | null;
  show: (text: string) => void;
  dismiss: () => void;
}

/**
 * The one transient message a page shows at a time.
 *
 * Identified rather than stored as a bare string: dropping the same bad file
 * twice produces the same text, and without an id the second attempt changes
 * no state — the toast would sit there mid-fade, or not reappear at all.
 */
export function useToast(): UseToast {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const nextId = useRef(0);

  const show = useCallback((text: string) => {
    nextId.current += 1;
    setToast({ id: nextId.current, text });
  }, []);

  const dismiss = useCallback(() => setToast(null), []);

  return { toast, show, dismiss };
}
