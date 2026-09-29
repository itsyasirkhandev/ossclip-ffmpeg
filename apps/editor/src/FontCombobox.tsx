import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useCombobox } from "downshift";

/** One family the picker offers: the name the list shows, and the CSS stack
 *  the `fontDisplay` token stores when it is picked. */
export interface FontOption {
  name: string;
  stack: string;
}

/**
 * The curated families — deliberately NOT a system-font enumeration.
 *
 * `document.fonts`/canvas measurement would hand every OS a different menu,
 * so the same project would offer different fonts on the laptop and on the
 * render box. The token is not just preview style either: burned-in
 * subtitles hand its FIRST family to ffmpeg as a single font name
 * (`packages/renderer/src/ffmpeg-renderer.ts`), which fontconfig then has to
 * resolve on whatever machine renders. A fixed list keeps the menu, the
 * preview and the render saying the same thing — and every stack below leads
 * with its own family so that first-family lookup finds it.
 */
export const FONT_OPTIONS: readonly FontOption[] = [
  // Inter's stack IS the default token, so re-picking Inter restores
  // `defaultTheme.fontDisplay` byte-for-byte instead of a near-miss.
  { name: "Inter", stack: "'Inter', 'Helvetica Neue', 'Arial Black', Arial, sans-serif" },
  { name: "Arial", stack: "Arial, sans-serif" },
  { name: "Helvetica", stack: "Helvetica, Arial, sans-serif" },
  { name: "Helvetica Neue", stack: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  { name: "Segoe UI", stack: "'Segoe UI', system-ui, sans-serif" },
  { name: "Roboto", stack: "Roboto, Arial, sans-serif" },
  { name: "Verdana", stack: "Verdana, Geneva, sans-serif" },
  { name: "Tahoma", stack: "Tahoma, Geneva, sans-serif" },
  { name: "Trebuchet MS", stack: "'Trebuchet MS', Helvetica, sans-serif" },
  { name: "Calibri", stack: "Calibri, 'Segoe UI', sans-serif" },
  { name: "system-ui", stack: "system-ui, sans-serif" },
  { name: "Georgia", stack: "Georgia, 'Times New Roman', serif" },
  { name: "Times New Roman", stack: "'Times New Roman', Times, serif" },
  { name: "Palatino Linotype", stack: "'Palatino Linotype', Palatino, serif" },
  { name: "Garamond", stack: "Garamond, Georgia, serif" },
  { name: "Cambria", stack: "Cambria, Georgia, serif" },
  { name: "Book Antiqua", stack: "'Book Antiqua', Palatino, serif" },
  { name: "Courier New", stack: "'Courier New', Courier, monospace" },
  { name: "Consolas", stack: "Consolas, monospace" },
  { name: "Menlo", stack: "Menlo, Consolas, monospace" },
  { name: "Monaco", stack: "Monaco, monospace" },
  { name: "Cascadia Code", stack: "'Cascadia Code', 'Cascadia Mono', monospace" },
  { name: "ui-monospace", stack: "ui-monospace, monospace" },
  { name: "Arial Black", stack: "'Arial Black', sans-serif" },
  { name: "Impact", stack: "Impact, sans-serif" },
  { name: "Comic Sans MS", stack: "'Comic Sans MS', cursive" },
];

/** The stack's first family, unquoted — the name ffmpeg gets handed. */
const firstFamily = (stack: string): string =>
  stack.split(",")[0]?.trim().replace(/^['"]|['"]$/g, "") ?? "";

const optionFor = (stack: string): FontOption | undefined =>
  FONT_OPTIONS.find((o) => o.name.toLowerCase() === firstFamily(stack).toLowerCase());

/** What the field shows for a committed stack: the curated family name when
 *  the stack leads with one, the stack verbatim otherwise (a config-set
 *  font the list has never heard of stays visible, `soundOptions`' "not in
 *  the library any more" idiom). */
export const fontLabelFor = (stack: string): string => optionFor(stack)?.name ?? stack;

const field: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  position: "relative",
};
const fieldLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "#9A9AA3",
};
/** The popover anchors to the INPUT, not to the whole field, so flipping it
 *  upward flips it above the box rather than above the label. */
const inputWrap: React.CSSProperties = { position: "relative", display: "flex" };
/** Inspector's `textInput`, plus the right padding the caret sits in. That
 *  one is module-local there, and exporting it just for here would close an
 *  import cycle (Inspector renders this), so the shape is mirrored instead.
 *  The UA gives inputs border-box, so width:100% is the box's true width. */
const input: React.CSSProperties = {
  fontFamily: "var(--font-sans)",
  fontSize: 13,
  background: "var(--bg-input)",
  border: "1px solid var(--border-default)",
  borderRadius: 6,
  color: "#fff",
  padding: "6px 26px 6px 8px",
  width: "100%",
};
/** A select's caret, in the input's right padding. pointer-events: none
 *  makes a click on it a click on the input, which is what opens the menu. */
const caret: React.CSSProperties = {
  position: "absolute",
  right: 9,
  top: "50%",
  transform: "translateY(-50%)",
  fontSize: 10,
  color: "var(--text-faint)",
  pointerEvents: "none",
  userSelect: "none",
};
const popover: React.CSSProperties = {
  position: "absolute",
  left: 0,
  right: 0,
  zIndex: "var(--z-menu)",
  padding: 4,
  background: "var(--bg-elevated)",
  border: "1px solid var(--border-default)",
  borderRadius: 6,
  boxShadow: "var(--shadow-menu)",
};
const MENU_MAX_HEIGHT = 260;
const list: React.CSSProperties = {
  margin: 0,
  padding: 0,
  listStyle: "none",
  maxHeight: MENU_MAX_HEIGHT,
  overflowY: "auto",
};
/** Layout only — colour, hover and cursor come from `.ossclip-menu-item`,
 *  and an INLINE background here would outrank that class's :hover rule.
 *  That is why only the active row carries one: the pointer's hover and the
 *  keyboard's cursor paint the same colour, so both read as "the row a
 *  selection would land on". */
const itemRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};
const itemActive: React.CSSProperties = { background: "#22222c" };
const check: React.CSSProperties = {
  marginLeft: "auto",
  fontSize: 11,
  color: "var(--text-muted)",
  userSelect: "none",
};
const noMatch: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
  padding: "8px 10px",
};

/**
 * `fontDisplay` as a searchable combobox, replacing the free-text field that
 * used to sit in the Theme section.
 *
 * The rules the whole control hangs from:
 *  1. The COMMITTED font (the family name for a curated stack, the raw stack
 *     for anything else) is what the box shows while nothing is being
 *     searched. It never survives into an open menu: a click or an arrow key
 *     empties the box so typing is a search rather than an edit of a CSS
 *     stack, and a keystroke that opens the menu replaces it with its own
 *     text. Which makes selection the only commit — a query the user backed
 *     out of never reaches the token.
 *  2. The handlers composed onto the input run BEFORE downshift's own, so
 *     every close path (Escape, Enter, a second click, blur) restores the
 *     label in the same batched render that closes the menu — no frame
 *     where the field shows a half-typed query.
 *  3. `items` filters on `query`, not on the text in the box: downshift
 *     computes the opening highlight against the `items` prop it captured
 *     at dispatch time, so a list derived from the not-yet-cleared text
 *     would open pointing at a row from the wrong list.
 *
 * It stays a real `<input>` on purpose: Overlay's `isTypingContext` and the
 * e2e guard in `interactions.spec.ts` both read INPUT as text entry, which
 * is what keeps SPACE typing a space instead of toggling playback.
 */
export const FontCombobox: React.FC<{
  /** The field's visible label — the token's name, like every Theme field. */
  label: string;
  /** The committed `fontDisplay` stack. */
  value: string;
  /** Writes the stack (through `patchTheme`). Only a pick ever calls it. */
  onCommit: (stack: string) => void;
  testId: string;
}> = ({ label, value, onCommit, testId }) => {
  const display = fontLabelFor(value);
  /** The entry the committed value maps to. A stack outside the curated
   *  list becomes an option of its own so it can still show as current. */
  const current = useMemo<FontOption>(
    () => optionFor(value) ?? { name: value, stack: value },
    [value],
  );
  const [query, setQuery] = useState("");

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [flip, setFlip] = useState(false);

  const items = useMemo<FontOption[]>(() => {
    const all: FontOption[] = optionFor(value) ? [...FONT_OPTIONS] : [current, ...FONT_OPTIONS];
    const q = query.trim().toLowerCase();
    return q === "" ? all : all.filter((o) => o.name.toLowerCase().includes(q));
  }, [current, query, value]);

  const {
    isOpen,
    highlightedIndex,
    inputValue,
    getInputProps,
    getMenuProps,
    getItemProps,
    setInputValue,
  } = useCombobox<FontOption>({
    items,
    selectedItem: current,
    itemToString: (item) => (item ? item.name : ""),
    defaultInputValue: display,
    stateReducer: (state, { type, changes }) => {
      // downshift's Escape on a CLOSED menu clears the text and the
      // selection; here Escape on a closed field does nothing at all
      // (Overlay blurs it for the shortcut, which is the same gesture the
      // other inspector fields make).
      if (type === useCombobox.stateChangeTypes.InputKeyDownEscape && !state.isOpen) return state;
      return { ...state, ...changes };
    },
    onSelectedItemChange: ({ selectedItem }) => {
      if (selectedItem) onCommit(selectedItem.stack);
    },
    onStateChange: (changes) => {
      // Close is the only moment `query` has to be dropped, and every close
      // path batches one of the handlers below into the same render as this
      // callback — so reset here and rule 3's invariant holds in one place:
      // a closed menu carries no query, hence no stale filter for the next
      // open. (Resetting on OPEN instead would wipe the very query the
      // keystroke that opened the menu just typed.)
      if (changes.isOpen === false) setQuery("");
    },
  });

  /** Measured at open, not per render: which side of the input has room for
   *  the menu. jsdom reports an all-zero rect, so tests always see the
   *  downward menu — the branch is layout, not behavior. */
  useLayoutEffect(() => {
    if (!isOpen) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom;
    setFlip(below < MENU_MAX_HEIGHT + 8 && rect.top > below);
  }, [isOpen]);

  return (
    <div style={field}>
      <span style={fieldLabel}>{label}</span>
      <div ref={wrapRef} style={inputWrap}>
        <input
          {...getInputProps({
            style: input,
            placeholder: "Search fonts…",
            // User handlers run BEFORE downshift's own, and React batches
            // both updates into one render — so `query` and downshift's
            // inputValue are never a frame out of step. It filters
            // UNCONDITIONALLY because downshift OPENS the menu on every
            // keystroke (InputChange sets isOpen), including the first one
            // typed after a Tab-focus: skipping that case would show the
            // box's own text beside an unfiltered list (rule 3).
            onChange: (e) => {
              // Narrowed, not cast: downshift's option type gives `target`
              // as a plain EventTarget, and this is an input by construction.
              if (e.target instanceof HTMLInputElement) setQuery(e.target.value);
            },
            onClick: () => setInputValue(isOpen ? display : ""),
            onKeyDown: (e) => {
              if (!isOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                setInputValue(""); // the keyboard's open, same as a click's
              }
              if (
                e.key === "Escape" ||
                (e.key === "Enter" && isOpen && highlightedIndex < 0)
              ) {
                // Menu open with nothing to pick: downshift just closes it,
                // so the search text has to come back to rule 1 here.
                setInputValue(display);
              }
            },
            onBlur: () => setInputValue(display),
          })}
          data-testid={testId}
        />
        <span style={caret} aria-hidden="true">
          ▾
        </span>
        {/* The sidebar is a scroll container (App's `sidebar`), so a menu
            that would hang past its bottom edge flips upward instead: the
            alternative is a dropdown reachable only by scrolling the panel
            while it is open. */}
        <div
          style={{
            ...popover,
            ...(flip ? { bottom: "calc(100% + 4px)" } : { top: "calc(100% + 4px)" }),
            display: isOpen ? "block" : "none",
          }}
        >
          <ul {...getMenuProps()} className="ossclip-scroll-list" style={list}>
            {isOpen
              ? items.map((item, index) => (
                  <li
                    key={item.name}
                    {...getItemProps({ item, index })}
                    className="ossclip-menu-item"
                    style={{
                      ...itemRow,
                      ...(highlightedIndex === index ? itemActive : null),
                    }}
                  >
                    {/* The row renders in its own face: a font picker that
                        cannot show the font is a list of names. */}
                    <span style={{ fontFamily: item.stack }}>{item.name}</span>
                    {item === current ? (
                      <span style={check} aria-hidden="true">
                        ✓
                      </span>
                    ) : null}
                  </li>
                ))
              : null}
          </ul>
          {isOpen && items.length === 0 ? (
            <div style={noMatch}>No match for "{inputValue}". Try fewer letters.</div>
          ) : null}
        </div>
      </div>
    </div>
  );
};
