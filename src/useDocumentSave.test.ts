import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { markPendingSave, takePendingSave } from "./draft.ts";
import { useDocumentSave } from "./useDocumentSave.ts";

/**
 * The router and session are stubbed: what matters here is the decision about
 * whether the naming dialog should open, not how navigation happens.
 */
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("./authClient.ts", () => ({
  useSession: () => ({ data: { user: { id: "u1" } }, isPending: false }),
}));

beforeEach(() => {
  localStorage.clear();
});

describe("a save interrupted by signing in", () => {
  it("reopens the naming dialog for a document that was never saved", () => {
    markPendingSave();

    const { result } = renderHook(() => useDocumentSave(null));

    expect(result.current.nameOpen).toBe(true);
  });

  it("does not open the naming dialog over an already-named document", () => {
    // A stale flag — from a sign-in the user abandoned earlier — must not pop
    // a naming dialog over a stored document that already has a name.
    markPendingSave();

    const { result } = renderHook(() => useDocumentSave("existing-doc-id"));

    expect(result.current.nameOpen).toBe(false);
  });

  it("clears a stale flag even when it does not act on it", () => {
    // Otherwise the flag survives to fire against some later, unrelated page.
    markPendingSave();

    renderHook(() => useDocumentSave("existing-doc-id"));

    expect(takePendingSave()).toBe(false);
  });

  it("leaves the dialog closed when no save was pending", () => {
    const { result } = renderHook(() => useDocumentSave(null));

    expect(result.current.nameOpen).toBe(false);
  });
});
