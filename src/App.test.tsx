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
 * Built from bytes rather than a `Blob`. `Response` here is Node's, from
 * undici, while `Blob` is jsdom's — and jsdom's has no `stream()`, which
 * undici calls when it takes a Blob body. Passing one threw
 * `TypeError: object.stream is not a function` *inside this helper*, so every
 * render in this file failed and the two tests that assert on the error
 * overlay were the only ones that noticed.
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
    // missed by screen readers.
    const alert = document.querySelector('[role="alert"]');
    expect(alert).toBeInTheDocument();
    expect(alert).not.toBeVisible();
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
