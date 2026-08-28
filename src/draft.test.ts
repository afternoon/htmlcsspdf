import { beforeEach, describe, expect, it } from "vitest";
import {
  clearDraft,
  loadDraft,
  markPendingSave,
  saveDraft,
  takePendingSave,
} from "./draft.ts";

/**
 * The draft survives two things: a page refresh, and the Google OAuth round
 * trip — which unloads the page entirely, so React state is gone by the time
 * the user comes back.
 */

beforeEach(() => {
  localStorage.clear();
});

const DOC = { html: "<h1>Draft</h1>", css: "h1 { color: red }" };

describe("saveDraft and loadDraft", () => {
  it("returns null when nothing has been saved", () => {
    expect(loadDraft()).toBeNull();
  });

  it("round-trips a draft", () => {
    saveDraft(DOC);
    expect(loadDraft()).toEqual(DOC);
  });

  it("overwrites the previous draft", () => {
    saveDraft(DOC);
    saveDraft({ html: "<p>newer</p>", css: "p{}" });
    expect(loadDraft()?.html).toBe("<p>newer</p>");
  });

  it("returns null rather than throwing on corrupt storage", () => {
    localStorage.setItem("htmlcsspdf.draft.v1", "{not json");
    expect(loadDraft()).toBeNull();
  });

  it("returns null when the stored shape is wrong", () => {
    // A schema change or a hand-edited value must not crash the editor.
    localStorage.setItem("htmlcsspdf.draft.v1", JSON.stringify({ html: 42 }));
    expect(loadDraft()).toBeNull();
  });

  it("clears the draft", () => {
    saveDraft(DOC);
    clearDraft();
    expect(loadDraft()).toBeNull();
  });
});

describe("pending save across the sign-in redirect", () => {
  it("reports no pending save by default", () => {
    expect(takePendingSave()).toBe(false);
  });

  it("reports a pending save once marked", () => {
    markPendingSave();
    expect(takePendingSave()).toBe(true);
  });

  it("only reports once, so a later reload does not reopen the dialog", () => {
    markPendingSave();
    expect(takePendingSave()).toBe(true);
    expect(takePendingSave()).toBe(false);
  });
});
