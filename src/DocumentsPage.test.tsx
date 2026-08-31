import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentsPage } from "./DocumentsPage.tsx";
import type { DocumentSummary } from "./documentsApi.ts";

/**
 * The page navigates to the editor after a drop, so the test router carries a
 * real `/d/$id` route rather than a stub — landing on it is the observable
 * half of "a document was created".
 */
async function renderPage(documents: DocumentSummary[] = []) {
  const rootRoute = createRootRoute();
  const listRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => <DocumentsPage documents={documents} />,
  });
  const editorRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/d/$id",
    component: () => <p>editing {editorRoute.useParams().id}</p>,
  });

  const router = createRouter({
    routeTree: rootRoute.addChildren([listRoute, editorRoute]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });

  const result = render(<RouterProvider router={router} />);
  // The router mounts asynchronously; a drop dispatched before it settles
  // lands on a page that is not there yet.
  await screen.findByText("documents");
  return result;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Answers document creation; anything else (auth, session) comes back empty. */
function stubApi(create: () => Response) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/documents") && init?.method === "POST") return create();
    return jsonResponse({});
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The body of the one create request that was made. */
function createdDocument(fetchMock: ReturnType<typeof stubApi>) {
  const call = fetchMock.mock.calls.find(([, init]) => init?.method === "POST");
  return JSON.parse(String(call?.[1]?.body));
}

function dropFiles(files: File[], types: string[] = ["Files"]) {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { types, files } });
  window.dispatchEvent(event);
}

const htmlFile = (name = "invoice.html", content = "<p>hi</p>") =>
  new File([content], name, { type: "text/html" });
const cssFile = (name = "theme.css", content = "p { color: red }") =>
  new File([content], name, { type: "text/css" });

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("dropping files onto the document list", () => {
  it("creates a document from one file and opens it", async () => {
    const fetchMock = stubApi(() => jsonResponse({ id: "abc" }));
    await renderPage();

    dropFiles([htmlFile()]);

    expect(await screen.findByText("editing abc")).toBeInTheDocument();
    expect(createdDocument(fetchMock)).toEqual({
      name: "invoice",
      html: "<p>hi</p>",
      css: "",
    });
  });

  it("fills both panes when an HTML and a CSS file are dropped together", async () => {
    const fetchMock = stubApi(() => jsonResponse({ id: "abc" }));
    await renderPage();

    dropFiles([htmlFile(), cssFile()]);

    await screen.findByText("editing abc");
    expect(createdDocument(fetchMock)).toEqual({
      name: "invoice",
      html: "<p>hi</p>",
      css: "p { color: red }",
    });
  });

  it("creates a document from a stylesheet alone", async () => {
    const fetchMock = stubApi(() => jsonResponse({ id: "abc" }));
    await renderPage();

    dropFiles([cssFile()]);

    await screen.findByText("editing abc");
    expect(createdDocument(fetchMock)).toEqual({
      name: "theme",
      html: "",
      css: "p { color: red }",
    });
  });

  it("refuses more than two files and creates nothing", async () => {
    const fetchMock = stubApi(() => jsonResponse({ id: "abc" }));
    await renderPage();

    dropFiles([htmlFile(), cssFile(), cssFile("other.css")]);

    const message = await screen.findByText(/at most 2 files/);
    expect(message.closest('[role="alert"]')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("refuses a file that is neither HTML nor CSS", async () => {
    const fetchMock = stubApi(() => jsonResponse({ id: "abc" }));
    await renderPage();

    dropFiles([new File(["%PDF"], "report.pdf", { type: "application/pdf" })]);

    expect(await screen.findByText(/report\.pdf/)).toBeVisible();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("reports the server's message when the document cannot be created", async () => {
    stubApi(() => jsonResponse({ error: "Sign in to save documents." }, 401));
    await renderPage();

    dropFiles([htmlFile()]);

    expect(await screen.findByText("Sign in to save documents.")).toBeVisible();
    expect(screen.queryByText("editing abc")).not.toBeInTheDocument();
  });

  it("ignores a drag that carries no files", async () => {
    const fetchMock = stubApi(() => jsonResponse({ id: "abc" }));
    await renderPage();

    dropFiles([htmlFile()], ["text/plain"]);

    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(
        false,
      ),
    );
  });
});
