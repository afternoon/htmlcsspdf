import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "./documentsApi.ts";
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
  // The naming dialog is gone: a resumed save now creates the document
  // directly, so what these guard is whether the resume is signalled at all.
  it("signals a resume once the user comes back signed in", async () => {
    markPendingSave();

    const { result } = renderHook(() => useDocumentSave(null));

    await waitFor(() => expect(result.current.resumePending).toBe(true));
  });

  it("waits for the session before deciding", async () => {
    // Acting while the session is still resolving would misread a signed-in
    // user as signed out, and consume the flag for nothing.
    markPendingSave();
    stillResolving();

    const { result, rerender } = renderHook(() => useDocumentSave(null));
    expect(result.current.resumePending).toBe(false);

    signedIn();
    rerender();

    await waitFor(() => expect(result.current.resumePending).toBe(true));
  });

  it("still resumes when the session reports signed-out before the user arrives", async () => {
    // better-auth commonly settles to "not pending, no user" before its
    // cookie-backed refetch lands. Consuming the one-shot flag on that
    // inconclusive read meant the dialog never opened after signing in.
    markPendingSave();
    stillResolving();

    const { result, rerender } = renderHook(() => useDocumentSave(null));

    session.current = { data: null, isPending: false };
    rerender();
    expect(result.current.resumePending).toBe(false);

    signedIn();
    rerender();

    await waitFor(() => expect(result.current.resumePending).toBe(true));
  });

  it("does not resume for a user who is still signed out", async () => {
    // Sign-in was abandoned or failed. Prompting for a name would lead
    // straight to a save that cannot succeed.
    markPendingSave();
    signedOut();

    const { result } = renderHook(() => useDocumentSave(null));

    expect(result.current.resumePending).toBe(false);
    // The flag survives rather than being burned on an inconclusive read; its
    // expiry retires it if the user never comes back.
    expect(takePendingSave()).toBe(true);
  });

  it("does not open the dialog over an already-named document", async () => {
    markPendingSave();

    const { result } = renderHook(() => useDocumentSave("existing-doc-id"));

    await waitFor(() => expect(takePendingSave()).toBe(false));
    expect(result.current.resumePending).toBe(false);
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
    expect(result.current.resumePending).toBe(false);
  });

  it("does not resume when no save was pending", async () => {
    const { result } = renderHook(() => useDocumentSave(null));

    await waitFor(() => expect(takePendingSave()).toBe(false));
    expect(result.current.resumePending).toBe(false);
  });
});

describe("what the Save button reports", () => {
  const DOC = { html: "<h1>Hi</h1>", css: "h1 { color: red }" };

  it("says saved only while the content still matches what was written", async () => {
    // The button previously latched on "Saved" forever, so a user could type a
    // hundred lines of new work and still be told it was saved.
    vi.spyOn(api, "saveDocument").mockResolvedValue(undefined);

    const { result } = renderHook(() => useDocumentSave("doc-1"));

    await act(async () => {
      result.current.requestSave(DOC);
    });
    await waitFor(() => expect(result.current.stateFor(DOC)).toBe("saved"));

    const edited = { ...DOC, html: "<h1>Changed</h1>" };
    expect(result.current.stateFor(edited)).toBe("idle");
  });

  it("says saved again if an edit is undone back to the saved text", async () => {
    vi.spyOn(api, "saveDocument").mockResolvedValue(undefined);

    const { result } = renderHook(() => useDocumentSave("doc-1"));

    await act(async () => {
      result.current.requestSave(DOC);
    });
    await waitFor(() => expect(result.current.stateFor(DOC)).toBe("saved"));

    expect(result.current.stateFor({ ...DOC, css: "changed" })).toBe("idle");
    expect(result.current.stateFor(DOC)).toBe("saved");
  });

  it("reports a failed save regardless of the content shown", async () => {
    vi.spyOn(api, "saveDocument").mockRejectedValue(new Error("network down"));

    const { result } = renderHook(() => useDocumentSave("doc-1"));

    await act(async () => {
      result.current.requestSave(DOC);
    });

    await waitFor(() => expect(result.current.stateFor(DOC)).toBe("error"));
    expect(result.current.error).toBe("network down");
  });
});
