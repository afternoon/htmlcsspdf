import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { markPendingSave, takePendingSave } from "./draft.ts";
import { useDocumentSave } from "./useDocumentSave.ts";

/**
 * The router is stubbed, and the session is controlled per test: what matters
 * here is whether the naming dialog reopens, which depends entirely on what
 * the session turns out to be.
 */
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

const session = vi.hoisted(() => ({
  current: { data: null as unknown, isPending: false },
}));
vi.mock("./authClient.ts", () => ({ useSession: () => session.current }));

function signedIn() {
  session.current = { data: { user: { id: "u1" } }, isPending: false };
}
function signedOut() {
  session.current = { data: null, isPending: false };
}
function stillResolving() {
  session.current = { data: null, isPending: true };
}

beforeEach(() => {
  localStorage.clear();
  signedIn();
});

describe("resuming a save interrupted by signing in", () => {
  it("reopens the naming dialog once the user comes back signed in", async () => {
    markPendingSave();

    const { result } = renderHook(() => useDocumentSave(null));

    await waitFor(() => expect(result.current.nameOpen).toBe(true));
  });

  it("waits for the session before deciding", async () => {
    // Acting while the session is still resolving would misread a signed-in
    // user as signed out, and consume the flag for nothing.
    markPendingSave();
    stillResolving();

    const { result, rerender } = renderHook(() => useDocumentSave(null));
    expect(result.current.nameOpen).toBe(false);

    signedIn();
    rerender();

    await waitFor(() => expect(result.current.nameOpen).toBe(true));
  });

  it("does not open the dialog for a user who is still signed out", async () => {
    // Sign-in was abandoned or failed. Prompting for a name would lead
    // straight to a save that cannot succeed.
    markPendingSave();
    signedOut();

    const { result } = renderHook(() => useDocumentSave(null));

    await waitFor(() => expect(takePendingSave()).toBe(false));
    expect(result.current.nameOpen).toBe(false);
  });

  it("does not open the dialog over an already-named document", async () => {
    markPendingSave();

    const { result } = renderHook(() => useDocumentSave("existing-doc-id"));

    await waitFor(() => expect(takePendingSave()).toBe(false));
    expect(result.current.nameOpen).toBe(false);
  });

  it("ignores a pending save left over from long ago", async () => {
    // An abandoned sign-in must not open a naming dialog on some unrelated
    // visit days later.
    localStorage.setItem(
      "htmlcsspdf.pendingSave.v1",
      String(Date.now() - 60 * 60 * 1000),
    );

    const { result } = renderHook(() => useDocumentSave(null));

    await waitFor(() => expect(takePendingSave()).toBe(false));
    expect(result.current.nameOpen).toBe(false);
  });

  it("leaves the dialog closed when no save was pending", async () => {
    const { result } = renderHook(() => useDocumentSave(null));

    await waitFor(() => expect(takePendingSave()).toBe(false));
    expect(result.current.nameOpen).toBe(false);
  });
});
