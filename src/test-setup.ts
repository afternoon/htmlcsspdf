import "@testing-library/jest-dom/vitest";

// Server tests opt into the node environment with a `@vitest-environment`
// pragma, and this file still runs for them. Everything below stubs the DOM,
// so it is skipped where there is no DOM to stub rather than throwing on
// `Range` before a single test has run.
const hasDom = typeof globalThis.document !== "undefined";

// CodeMirror measures text with Range.getClientRects, which jsdom does not
// implement. Stub the geometry APIs it needs so the view can lay out.
const zeroRect = () => ({
  top: 0,
  left: 0,
  bottom: 0,
  right: 0,
  width: 0,
  height: 0,
  x: 0,
  y: 0,
  toJSON: () => ({}),
});

if (hasDom && !Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () =>
    Object.assign([], { item: () => null }) as unknown as DOMRectList;
}
if (hasDom && !Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = zeroRect as never;
}

// This jsdom build ships only a partial localStorage. Provide a real one so
// storage behaviour can be tested rather than mocked away.
class MemoryStorage implements Storage {
  #data = new Map<string, string>();

  get length() {
    return this.#data.size;
  }

  clear() {
    this.#data.clear();
  }

  getItem(key: string) {
    return this.#data.get(key) ?? null;
  }

  key(index: number) {
    return [...this.#data.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.#data.delete(key);
  }

  setItem(key: string, value: string) {
    this.#data.set(key, String(value));
  }
}

Object.defineProperty(globalThis, "localStorage", {
  value: new MemoryStorage(),
  writable: true,
  configurable: true,
});
