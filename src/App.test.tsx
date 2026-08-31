import { createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router";
import { render as renderComponent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.tsx";

/**
 * The editor renders navigation links, so it needs a router the way it has one
 * in the real app. Rendering it bare only ever worked by accident.
 */
function render(ui: React.ReactElement) {
  const rootRoute = createRootRoute({ component: () => ui });
  const router = createRouter({ routeTree: rootRoute });
  return renderComponent(<RouterProvider router={router} />);
}

/** The router mounts asynchronously; most assertions need it settled first. */
async function renderApp(ui: React.ReactElement) {
  const result = render(ui);
  await screen.findByRole("textbox", { name: "HTML" });
  return result;
}

/**
 * A render response carrying a minimal but valid PDF body.
 *
 * The bytes are passed as a `Uint8Array` rather than wrapped in a `Blob`:
 * `Response` comes from undici and `Blob` from jsdom, and undici cannot read
 * jsdom's blob — `res.blob()` threw a TypeError, which the renderer reported
 * as an unreachable service, so every test here rendered an error instead of
 * a preview.
 */
function pdfResponse() {
  return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
    status: 200,
    headers: { "content-type": "application/pdf" },
  });
}

function errorResponse(status: number, body: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  localStorage.clear();
  // jsdom has no object URL support.
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => "blob:test"),
    revokeObjectURL: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("App", () => {
  it("names both editors so they can be told apart", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => pdfResponse()),
    );
    await renderApp(<App />);

    expect(screen.getByRole("textbox", { name: "HTML" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "CSS" })).toBeInTheDocument();
  });

  it("names each resize handle", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => pdfResponse()),
    );
    await renderApp(<App />);

    const separators = screen.getAllByRole("separator");
    for (const separator of separators) {
      expect(separator).toHaveAccessibleName();
    }
  });

  it("keeps a live region in the DOM before any error occurs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => pdfResponse()),
    );
    await renderApp(<App />);

    // Present but hidden — a region inserted with its first message is often
    // missed by screen readers. There are two: the preview's own errors and
    // the toast that reports a refused drop.
    const alerts = [...document.querySelectorAll('[role="alert"]')];
    expect(alerts).toHaveLength(2);
    for (const alert of alerts) expect(alert).not.toBeVisible();
  });

  it("shows the server's message when a render fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        errorResponse(429, { error: "Browser Run rate limit reached.", hint: "Wait." }),
      ),
    );
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Browser Run rate limit reached.",
    );
  });

  it("reports an unreachable service when the request never connects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    render(<App />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Unable to reach the render service.");
    expect(alert).toHaveTextContent("Check your connection");
  });

  it("lets the user dismiss an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(500, { error: "Render failed." })),
    );
    const user = userEvent.setup();
    render(<App />);

    const alert = await screen.findByRole("alert");
    expect(alert).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Dismiss error" }));
    await waitFor(() => expect(alert).not.toBeVisible());
  });

  it("does not call the render API when the CSS cannot be parsed", async () => {
    const fetchMock = vi.fn(async () => pdfResponse());
    vi.stubGlobal("fetch", fetchMock);
    localStorage.setItem(
      "htmlcsspdf.draft.v1",
      JSON.stringify({ html: "<p>hi</p>", css: "body { color:" }),
    );

    render(<App />);

    // `hidden` keeps the region out of the a11y tree until it has a message,
    // so wait on the error card's own text rather than the role. Matched
    // strictly: "CSS" alone also appears in the pane label and the format
    // toggle.
    expect(await screen.findByText(/^CSS:/)).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the download action unavailable until a PDF exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => errorResponse(500, { error: "nope" })),
    );
    await renderApp(<App />);

    expect(screen.getByRole("button", { name: "Download PDF" })).toBeDisabled();
  });

  it("offers to update the preview once the content moves on", async () => {
    const fetchMock = vi.fn(async () => pdfResponse());
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole("button", { name: /update preview/i }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("textbox", { name: "HTML" }));
    await user.keyboard("x");

    const update = await screen.findByRole("button", { name: /update preview/i });
    await user.click(update);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("does not re-render until asked", async () => {
    const fetchMock = vi.fn(async () => pdfResponse());
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("textbox", { name: "HTML" }));
    await user.keyboard("x");

    // Long enough that any debounce would have fired.
    await new Promise((resolve) => setTimeout(resolve, 1300));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-renders on a pause once auto preview is on", async () => {
    const fetchMock = vi.fn(async () => pdfResponse());
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    await renderApp(<App />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("checkbox", { name: "Auto preview" }));
    await user.click(screen.getByRole("textbox", { name: "HTML" }));
    await user.keyboard("x");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 3000 });
  });

  it("re-renders on the keyboard shortcut", async () => {
    const fetchMock = vi.fn(async () => pdfResponse());
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("textbox", { name: "HTML" }));
    await user.keyboard("x");
    await user.keyboard("{Meta>}{Enter}{/Meta}");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });
});

/**
 * Drop files onto the page, the way a real drag does.
 *
 * jsdom implements neither `DragEvent` nor `DataTransfer`, so the event
 * carries the shape react-dropzone reads: `types` is what marks a file drag,
 * and `items` is what it expands into files. Dispatched on a descendant so it
 * bubbles to the drop target the way a real drop does.
 */
function dropFiles(
  files: File[],
  { types = ["Files"], target }: { types?: string[]; target?: Element } = {},
) {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  // A real text drag carries string items, not file ones, and react-dropzone
  // reads either — so the items have to follow `types`, or the fixture would
  // describe a file drag whatever it claims to be.
  const fileDrag = types.includes("Files");
  Object.defineProperty(event, "dataTransfer", {
    value: {
      types,
      files: fileDrag ? files : [],
      getData: () => "",
      items: files.map((file) => ({
        kind: fileDrag ? "file" : "string",
        type: file.type,
        getAsFile: () => file,
      })),
    },
  });
  (target ?? screen.getByRole("textbox", { name: "HTML" })).dispatchEvent(event);
  return event;
}

function htmlFile(name = "page.html", content = "<p>dropped</p>") {
  return new File([content], name, { type: "text/html" });
}

function cssFile(name = "theme.css", content = "p { color: red }") {
  return new File([content], name, { type: "text/css" });
}

describe("dropping files onto the editor", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => pdfResponse()),
    );
  });

  it("replaces the HTML pane with a dropped HTML file", async () => {
    await renderApp(<App />);

    dropFiles([htmlFile()]);

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "HTML" })).toHaveTextContent(
        "<p>dropped</p>",
      ),
    );
  });

  it("leaves the other pane alone when only one file is dropped", async () => {
    await renderApp(<App />);
    const css = screen.getByRole("textbox", { name: "CSS" });
    const before = css.textContent;

    dropFiles([htmlFile()]);

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "HTML" })).toHaveTextContent("dropped"),
    );
    expect(css.textContent).toBe(before);
  });

  it("fills both panes when an HTML and a CSS file are dropped together", async () => {
    await renderApp(<App />);

    dropFiles([htmlFile(), cssFile()]);

    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "HTML" })).toHaveTextContent("dropped"),
    );
    expect(screen.getByRole("textbox", { name: "CSS" })).toHaveTextContent(
      "p { color: red }",
    );
  });

  it("refuses a third file and says so", async () => {
    await renderApp(<App />);

    dropFiles([htmlFile(), cssFile(), cssFile("other.css")]);

    const message = await screen.findByText(/at most 2 files/);
    // The preview keeps its own alert region, so the message is found by what
    // it says; that it lands in a live region at all is the part worth
    // asserting about the markup.
    expect(message.closest('[role="alert"]')).toBeInTheDocument();
  });

  it("refuses a file that is neither HTML nor CSS", async () => {
    await renderApp(<App />);

    dropFiles([new File(["%PDF"], "report.pdf", { type: "application/pdf" })]);

    expect(await screen.findByText(/report\.pdf/)).toBeVisible();
  });

  it("leaves the editors untouched when the drop is refused", async () => {
    await renderApp(<App />);
    const html = screen.getByRole("textbox", { name: "HTML" });
    const before = html.textContent;

    dropFiles([new File(["%PDF"], "report.pdf", { type: "application/pdf" })]);

    await screen.findByText(/report\.pdf/);
    expect(html.textContent).toBe(before);
  });

  it("lets the user dismiss the message", async () => {
    const user = userEvent.setup();
    await renderApp(<App />);

    dropFiles([new File(["x"], "notes.txt", { type: "text/plain" })]);
    const message = await screen.findByText(/notes\.txt/);

    await user.click(screen.getByRole("button", { name: "Dismiss message" }));
    await waitFor(() => expect(message).not.toBeInTheDocument());
  });

  it("replaces the whole pane when the file lands on an editor", async () => {
    await renderApp(<App />);
    const html = screen.getByRole("textbox", { name: "HTML" });

    dropFiles([htmlFile()], { target: html });

    await waitFor(() => expect(html).toHaveTextContent("<p>dropped</p>"));
    // Exactly the file, not the file appended to what was there. CodeMirror
    // has a file drop handler of its own that pastes at the cursor, which the
    // drop zone suppresses; jsdom cannot place a drop for it to paste at, so
    // this pins the outcome rather than proving the suppression.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(html.textContent).toBe("<p>dropped</p>");
  });

  // CodeMirror moves selected text by drag; claiming that drop would break
  // editing in the name of a feature about files.
  it("ignores a drag that carries no files", async () => {
    await renderApp(<App />);
    const html = screen.getByRole("textbox", { name: "HTML" });
    const css = screen.getByRole("textbox", { name: "CSS" });
    const before = { html: html.textContent, css: css.textContent };

    dropFiles([htmlFile()], { types: ["text/plain"] });

    // Long enough for the drop rules to have run and reported, had they.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(html.textContent).toBe(before.html);
    expect(css.textContent).toBe(before.css);
    expect(
      screen.queryByRole("button", { name: "Dismiss message" }),
    ).not.toBeInTheDocument();
  });

  it("offers a keyboard path to the same thing", async () => {
    const user = userEvent.setup();
    await renderApp(<App />);
    // react-dropzone opens the picker by clicking its hidden input; the dialog
    // itself is the browser's, so this is as far as a test can follow.
    const openPicker = vi.spyOn(HTMLInputElement.prototype, "click");

    screen.getByRole("button", { name: /open files/i }).focus();
    await user.keyboard("{Enter}");

    expect(openPicker).toHaveBeenCalled();
  });
});
