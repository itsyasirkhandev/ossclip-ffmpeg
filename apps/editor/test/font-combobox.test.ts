// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FONT_OPTIONS, FontCombobox, fontLabelFor } from "../src/FontCombobox";

// Same one-time act() opt-in as Inspector.test.ts — this file mounts a
// component rather than calling renderToStaticMarkup.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DEFAULT_STACK = "'Inter', 'Helvetica Neue', 'Arial Black', Arial, sans-serif";

/**
 * The controlled shape Inspector gives it: `value` is the theme token and
 * `onCommit` writes it back, so a pick is observable BOTH as the callback
 * and as the field re-rendering with the new family — the second half is the
 * path an undo/redo or a doc load takes, where nothing local changed.
 */
function Harness({
  initial = DEFAULT_STACK,
  onCommit = () => {},
}: {
  initial?: string;
  onCommit?: (stack: string) => void;
}) {
  const [value, setValue] = React.useState(initial);
  return React.createElement(FontCombobox, {
    label: "fontDisplay",
    testId: "theme-fontDisplay",
    value,
    onCommit: (stack: string) => {
      onCommit(stack);
      setValue(stack);
    },
  });
}

/** React's own value tracker ignores a direct `el.value = ...`; the native
 *  setter bypasses it, which is what makes the dispatched `input` event a
 *  real change (same idiom as Inspector.test.ts's textarea write). */
const type = (el: HTMLInputElement, text: string): void => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(el, text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

const key = (el: HTMLElement, k: string): void => {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
};

/** React 18 maps onBlur onto the bubbling focusout, not the focus loss. */
const blur = (el: HTMLInputElement): void => {
  el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
};

const options = (container: HTMLElement): HTMLElement[] =>
  Array.from(container.querySelectorAll<HTMLElement>('[role="option"]'));

/** Row = [name span][current-mark span], so the name is the FIRST span. */
const nameOf = (row: HTMLElement): string | null | undefined =>
  row.querySelector("span")?.textContent;

describe("FontCombobox — the Theme section's font picker", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("names a curated stack by family, and keeps an unknown stack verbatim", () => {
    expect(fontLabelFor(DEFAULT_STACK)).toBe("Inter");
    expect(fontLabelFor("Georgia, serif")).toBe("Georgia");
    expect(fontLabelFor("'Brand Font', cursive")).toBe("'Brand Font', cursive");
  });

  it("mounts closed on the committed family, with no options in the DOM", async () => {
    await act(async () => {
      root.render(React.createElement(Harness, {}));
    });
    const field = container.querySelector<HTMLInputElement>('[data-testid="theme-fontDisplay"]')!;
    expect(field.value).toBe("Inter");
    expect(options(container)).toHaveLength(0);
  });

  it("opens to an empty search box listing every family, then picks by search", async () => {
    const commits: string[] = [];
    await act(async () => {
      root.render(React.createElement(Harness, { onCommit: (s) => commits.push(s) }));
    });
    const field = container.querySelector<HTMLInputElement>('[data-testid="theme-fontDisplay"]')!;

    await act(async () => {
      field.click();
    });
    expect(field.value).toBe("");
    expect(options(container)).toHaveLength(FONT_OPTIONS.length);

    await act(async () => {
      type(field, "geo");
    });
    const rows = options(container);
    expect(rows).toHaveLength(1);
    expect(nameOf(rows[0])).toBe("Georgia");

    await act(async () => {
      rows[0]!.click();
    });
    expect(commits).toEqual(["Georgia, 'Times New Roman', serif"]);
    // The field re-reads the committed value, it does not keep the query.
    expect(field.value).toBe("Georgia");
    expect(options(container)).toHaveLength(0);
  });

  it("keeps the list in step when typing is what OPENS the menu (Tab, no click)", async () => {
    // The keystroke's `onChange` sets the query AND downshift's InputChange
    // opens the menu in the same batch; a reset keyed on isOpen becoming
    // true would wipe that query and leave the box's text beside an
    // unfiltered list.
    await act(async () => {
      root.render(React.createElement(Harness, {}));
    });
    const field = container.querySelector<HTMLInputElement>('[data-testid="theme-fontDisplay"]')!;
    await act(async () => {
      field.focus();
    });
    expect(options(container)).toHaveLength(0);

    await act(async () => {
      type(field, "ge");
    });
    expect(field.value).toBe("ge");
    const rows = options(container);
    expect(rows).toHaveLength(1);
    expect(nameOf(rows[0])).toBe("Georgia");
  });

  it("commits nothing for a query with no match, and blur puts the label back", async () => {
    const commits: string[] = [];
    await act(async () => {
      root.render(React.createElement(Harness, { onCommit: (s) => commits.push(s) }));
    });
    const field = container.querySelector<HTMLInputElement>('[data-testid="theme-fontDisplay"]')!;

    await act(async () => {
      field.click();
    });
    await act(async () => {
      type(field, "zzzz");
    });
    expect(options(container)).toHaveLength(0);
    expect(container.textContent).toContain("No match for");

    await act(async () => {
      blur(field);
    });
    expect(field.value).toBe("Inter");
    expect(options(container)).toHaveLength(0);
    expect(commits).toEqual([]);
  });

  it("yields SPACE to typing while open (the premise of the e2e guard)", async () => {
    await act(async () => {
      root.render(React.createElement(Harness, {}));
    });
    const field = container.querySelector<HTMLInputElement>('[data-testid="theme-fontDisplay"]')!;
    await act(async () => {
      field.click();
    });

    // No handler on this field claims Space: the menu stays up and the text
    // survives the keydown, which is the whole premise of the e2e guard
    // (nothing in the app is about to reinterpret it as a transport key).
    await act(async () => {
      key(field, " ");
    });
    expect(field.value).toBe("");
    expect(options(container)).toHaveLength(FONT_OPTIONS.length);

    // The browser's own insertion, the second half of a real Space keypress.
    // The space is a query that trims to nothing, so the menu stays OPEN and
    // stays full — a stray space never blanks the list under a live search.
    await act(async () => {
      type(field, " ");
    });
    expect(field.value).toBe(" ");
    expect(options(container)).toHaveLength(FONT_OPTIONS.length);
  });

  it("Escape closes an open menu and restores the label, but never empties a closed field", async () => {
    await act(async () => {
      root.render(React.createElement(Harness, {}));
    });
    const field = container.querySelector<HTMLInputElement>('[data-testid="theme-fontDisplay"]')!;

    // Closed: downshift's own Escape would clear the text and the selection.
    await act(async () => {
      key(field, "Escape");
    });
    expect(field.value).toBe("Inter");

    await act(async () => {
      field.click();
    });
    await act(async () => {
      type(field, "geo");
    });
    await act(async () => {
      key(field, "Escape");
    });
    expect(field.value).toBe("Inter");
    expect(options(container)).toHaveLength(0);
  });

  it("offers a stack outside the curated list as its own row, marked current", async () => {
    await act(async () => {
      root.render(React.createElement(Harness, { initial: "'Brand Font', cursive" }));
    });
    const field = container.querySelector<HTMLInputElement>('[data-testid="theme-fontDisplay"]')!;
    expect(field.value).toBe("'Brand Font', cursive");

    await act(async () => {
      field.click();
    });
    const rows = options(container);
    expect(rows).toHaveLength(FONT_OPTIONS.length + 1);
    expect(nameOf(rows[0])).toBe("'Brand Font', cursive");
    // Marked current only when it IS current: the mark is the sighted
    // shortcut, the field's own value stays the accessible truth.
    expect(rows[0]!.textContent).toContain("✓");
    expect(rows[1]!.textContent).not.toContain("✓");
  });

  it("re-reads an EXTERNAL value change (the undo path), not just its own picks", async () => {
    const view = (value: string) =>
      React.createElement(FontCombobox, {
        label: "fontDisplay",
        testId: "theme-fontDisplay",
        value,
        onCommit: () => {},
      });
    await act(async () => {
      root.render(view("Impact, sans-serif"));
    });
    const field = container.querySelector<HTMLInputElement>('[data-testid="theme-fontDisplay"]')!;
    expect(field.value).toBe("Impact");

    await act(async () => {
      root.render(view("Georgia, serif"));
    });
    expect(field.value).toBe("Georgia");
  });
});
