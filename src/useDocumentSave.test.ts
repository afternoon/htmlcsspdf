import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

const HTML = "<h1>Hi</h1>";
const CSS = "h1 { color: red }";

/**
 * The hook holds no content of its own: the editor passes what it has on every
 * render, so an edit in these tests is a rerender with different text.
 */
function renderSave(documentId: string | null = null, name: string | null = null) {
  return renderHook(
    ({ html, css }: { html: string; css: string }) =>
      useDocumentSave(html, css, documentId, name),
    { initialProps: { html: HTML, css: CSS } },
  );
}

/** Long enough for both debounces, so a test never encodes their exact length. */
const PAST_SAVE_PAUSE = 5_000;
const PAST_PREVIEW_PAUSE = 60_000;

/** Let `ms` of debounce elapse, with effects and promises settled. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  localStorage.clear();
  signedIn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("resuming a save interrupted by signing in", () => {
  // The naming dialog is gone: a resumed save now creates the document
  // directly, so what these guard is whether the resume is signalled at all.
  it("signals a resume once the user comes back signed in", async () => {
    markPendingSave();

    const { result } = renderSave();

    await waitFor(() => expect(result.current.resumePending).toBe(true));
  });

  it("waits for the session before deciding", async () => {
    // Acting while the session is still resolving would misread a signed-in
    // user as signed out, and consume the flag for nothing.
    markPendingSave();
    stillResolving();

    const { result, rerender } = renderSave();
    expect(result.current.resumePending).toBe(false);

    signedIn();
    rerender({ html: HTML, css: CSS });

    await waitFor(() => expect(result.current.resumePending).toBe(true));
  });

  it("still resumes when the session reports signed-out before the user arrives", async () => {
    // better-auth commonly settles to "not pending, no user" before its
    // cookie-backed refetch lands. Consuming the one-shot flag on that
    // inconclusive read meant the dialog never opened after signing in.
    markPendingSave();
    stillResolving();

    const { result, rerender } = renderSave();

    session.current = { data: null, isPending: false };
    rerender({ html: HTML, css: CSS });
    expect(result.current.resumePending).toBe(false);

    signedIn();
    rerender({ html: HTML, css: CSS });

    await waitFor(() => expect(result.current.resumePending).toBe(true));
  });

  it("does not resume for a user who is still signed out", async () => {
    // Sign-in was abandoned or failed. Prompting for a name would lead
    // straight to a save that cannot succeed.
    markPendingSave();
    signedOut();

    const { result } = renderSave();

    expect(result.current.resumePending).toBe(false);
    // The flag survives rather than being burned on an inconclusive read; its
    // expiry retires it if the user never comes back.
    expect(takePendingSave()).toBe(true);
  });

  it("does not open the dialog over an already-named document", async () => {
    markPendingSave();

    const { result } = renderSave("existing-doc-id");

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

    const { result } = renderSave();

    await waitFor(() => expect(takePendingSave()).toBe(false));
    expect(result.current.resumePending).toBe(false);
  });

  it("does not resume when no save was pending", async () => {
    const { result } = renderSave();

    await waitFor(() => expect(takePendingSave()).toBe(false));
    expect(result.current.resumePending).toBe(false);
  });
});

describe("what the Save button reports", () => {
  it("says saved only while the content still matches what was written", async () => {
    // The button previously latched on "Saved" forever, so a user could type a
    // hundred lines of new work and still be told it was saved.
    vi.spyOn(api, "saveDocument").mockResolvedValue(undefined);

    const { result, rerender } = renderSave("doc-1");

    await act(async () => {
      result.current.requestSave();
    });
    await waitFor(() => expect(result.current.state).toBe("saved"));

    rerender({ html: "<h1>Changed</h1>", css: CSS });
    expect(result.current.state).toBe("idle");
  });

  it("says saved again if an edit is undone back to the saved text", async () => {
    vi.spyOn(api, "saveDocument").mockResolvedValue(undefined);

    const { result, rerender } = renderSave("doc-1");

    await act(async () => {
      result.current.requestSave();
    });
    await waitFor(() => expect(result.current.state).toBe("saved"));

    rerender({ html: HTML, css: "changed" });
    expect(result.current.state).toBe("idle");

    rerender({ html: HTML, css: CSS });
    expect(result.current.state).toBe("saved");
  });

  it("reports a failed save regardless of the content shown", async () => {
    vi.spyOn(api, "saveDocument").mockRejectedValue(new Error("network down"));

    const { result } = renderSave("doc-1");

    await act(async () => {
      result.current.requestSave();
    });

    await waitFor(() => expect(result.current.state).toBe("error"));
    expect(result.current.error).toBe("network down");
  });
});

describe("auto-saving a document that already exists", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("writes the document once the typing pauses", async () => {
    const saveDocument = vi.spyOn(api, "saveDocument").mockResolvedValue(undefined);

    const { rerender } = renderSave("doc-1");
    rerender({ html: "<h1>Edited</h1>", css: CSS });

    await advance(PAST_SAVE_PAUSE);

    expect(saveDocument).toHaveBeenCalledWith("doc-1", "<h1>Edited</h1>", CSS, {
      // Quietly: a browser render per pause in typing would spend the quota
      // the PDF itself depends on.
      capturePreview: false,
    });
  });

  it("does not write while the user is still typing", async () => {
    const saveDocument = vi.spyOn(api, "saveDocument").mockResolvedValue(undefined);

    const { rerender } = renderSave("doc-1");
    rerender({ html: "<h1>E</h1>", css: CSS });
    await advance(400);
    rerender({ html: "<h1>Ed</h1>", css: CSS });
    await advance(400);

    expect(saveDocument).not.toHaveBeenCalled();
  });

  it("does not write back the document it just opened", async () => {
    // Every open would otherwise cost a write and clear the card's preview.
    const saveDocument = vi.spyOn(api, "saveDocument").mockResolvedValue(undefined);

    renderSave("doc-1");
    await advance(PAST_SAVE_PAUSE);

    expect(saveDocument).not.toHaveBeenCalled();
  });

  it("leaves an unsaved draft alone", async () => {
    // Nothing to write to: a draft has no id, and creating a document is the
    // user's decision to make.
    const saveDocument = vi.spyOn(api, "saveDocument").mockResolvedValue(undefined);
    const createDocument = vi.spyOn(api, "createDocument").mockResolvedValue("doc-1");

    const { rerender } = renderSave(null);
    rerender({ html: "<h1>Edited</h1>", css: CSS });
    await advance(PAST_SAVE_PAUSE);

    expect(saveDocument).not.toHaveBeenCalled();
    expect(createDocument).not.toHaveBeenCalled();
  });

  it("does not write for a signed-out user", async () => {
    // The request would only come back 401, and the editor would report an
    // error for something the user never asked for.
    signedOut();
    const saveDocument = vi.spyOn(api, "saveDocument").mockResolvedValue(undefined);

    const { rerender } = renderSave("doc-1");
    rerender({ html: "<h1>Edited</h1>", css: CSS });
    await advance(PAST_SAVE_PAUSE);

    expect(saveDocument).not.toHaveBeenCalled();
  });

  it("writes again for edits made while a write was in flight", async () => {
    // The second pass reads the content as it is when the first lands, so work
    // typed during the request is not left behind by a stale closure.
    let finishFirst: () => void = () => {};
    const saveDocument = vi
      .spyOn(api, "saveDocument")
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finishFirst = resolve;
          }),
      )
      .mockResolvedValue(undefined);

    const { rerender } = renderSave("doc-1");
    rerender({ html: "<h1>First</h1>", css: CSS });
    await advance(PAST_SAVE_PAUSE);
    expect(saveDocument).toHaveBeenCalledTimes(1);

    rerender({ html: "<h1>Second</h1>", css: CSS });
    await advance(PAST_SAVE_PAUSE);
    // Still in flight: nothing overlaps the request that is running.
    expect(saveDocument).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishFirst();
    });
    await advance(PAST_SAVE_PAUSE);

    expect(saveDocument).toHaveBeenCalledTimes(2);
    expect(saveDocument).toHaveBeenLastCalledWith("doc-1", "<h1>Second</h1>", CSS, {
      capturePreview: false,
    });
  });

  it("retries on the next edit after a failed write", async () => {
    const saveDocument = vi
      .spyOn(api, "saveDocument")
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue(undefined);

    const { result, rerender } = renderSave("doc-1");
    rerender({ html: "<h1>First</h1>", css: CSS });
    await advance(PAST_SAVE_PAUSE);
    expect(result.current.state).toBe("error");

    rerender({ html: "<h1>Second</h1>", css: CSS });
    await advance(PAST_SAVE_PAUSE);

    expect(saveDocument).toHaveBeenCalledTimes(2);
    expect(result.current.state).toBe("saved");
  });
});

describe("refreshing the preview image", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("asks for one once the editing has stopped", async () => {
    vi.spyOn(api, "saveDocument").mockResolvedValue(undefined);
    const capturePreview = vi.spyOn(api, "capturePreview").mockResolvedValue(undefined);

    const { rerender } = renderSave("doc-1");
    rerender({ html: "<h1>Edited</h1>", css: CSS });

    await advance(PAST_SAVE_PAUSE);
    expect(capturePreview).not.toHaveBeenCalled();

    await advance(PAST_PREVIEW_PAUSE);
    expect(capturePreview).toHaveBeenCalledWith("doc-1");
  });

  it("holds it back while the editor has moved on from what is stored", async () => {
    // A preview of content that is about to be overwritten spends a browser
    // session on an image that is already wrong. The second write here never
    // lands, so the document stays behind the editor for the whole test.
    vi.spyOn(api, "saveDocument")
      .mockResolvedValueOnce(undefined)
      .mockImplementation(() => new Promise<void>(() => {}));
    const capturePreview = vi.spyOn(api, "capturePreview").mockResolvedValue(undefined);

    const { rerender } = renderSave("doc-1");
    rerender({ html: "<h1>One</h1>", css: CSS });
    await advance(PAST_SAVE_PAUSE);

    // Typing resumes before the preview owed for "One" is due.
    rerender({ html: "<h1>Two</h1>", css: CSS });
    await advance(PAST_PREVIEW_PAUSE);

    expect(capturePreview).not.toHaveBeenCalled();
  });

  it("does not ask for one after an explicit save, which captures its own", async () => {
    const saveDocument = vi.spyOn(api, "saveDocument").mockResolvedValue(undefined);
    const capturePreview = vi.spyOn(api, "capturePreview").mockResolvedValue(undefined);

    const { result, rerender } = renderSave("doc-1");
    rerender({ html: "<h1>Edited</h1>", css: CSS });

    await act(async () => {
      result.current.requestSave();
    });
    await advance(PAST_PREVIEW_PAUSE);

    expect(saveDocument).toHaveBeenCalledWith("doc-1", "<h1>Edited</h1>", CSS, {
      capturePreview: true,
    });
    expect(capturePreview).not.toHaveBeenCalled();
  });

  it("survives a capture the server refuses", async () => {
    // Previews are best-effort: a card with no image is a normal state, and
    // never an error worth putting in front of someone who is editing.
    vi.spyOn(api, "saveDocument").mockResolvedValue(undefined);
    vi.spyOn(api, "capturePreview").mockRejectedValue(new Error("rate limited"));

    const { result, rerender } = renderSave("doc-1");
    rerender({ html: "<h1>Edited</h1>", css: CSS });
    await advance(PAST_SAVE_PAUSE);
    await advance(PAST_PREVIEW_PAUSE);

    expect(result.current.state).toBe("saved");
    expect(result.current.error).toBeNull();
  });
});
