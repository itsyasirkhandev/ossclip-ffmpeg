// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { OverrideDocSchema, type CaptionWord } from "@ossclip/core/browser";
import { DeleteWordsModal } from "../src/DeleteWordsModal";
import {
  deleteWordsAllPlanFor,
  deleteWordsPlanFor,
  type DeleteWordsPlan,
  type DeleteWordsTarget,
} from "../src/deleteWords";

// Same one-time act() opt-in as TranscriptPanel.test.ts.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The Delete modal's preselection contract (2026-09-26). The field bug: the
 * flyout's "Delete + video…" reopened the confirm on the recoverable
 * caption-only radio, one Enter away from hiding instead of cutting — the
 * gesture's own target is carried on `DeleteWordsPlan.defaultTarget` and only
 * the keyboard path keeps the safe `targets[0]` fallback.
 */

const w = (text: string, start: number, end: number, srcStart: number, synthetic = false) => ({
  word: { text, start, end, srcStart } satisfies CaptionWord,
  live: text,
  synthetic,
});

const doc = (raw: Record<string, unknown> = {}) => OverrideDocSchema.parse(raw);

describe("DeleteWordsModal — defaultTarget preselects the gesture's arm", () => {
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

  const mount = async (
    plan: DeleteWordsPlan,
    onConfirm: (target: DeleteWordsTarget) => void = () => {},
    onCancel: () => void = () => {},
  ) => {
    await act(async () => {
      root.render(React.createElement(DeleteWordsModal, { plan, onConfirm, onCancel }));
    });
  };

  const radio = (target: DeleteWordsTarget) =>
    container.querySelector<HTMLInputElement>(`[data-testid="delete-words-option-${target}"] input`)!;

  it("opens on captions + video when the flyout named that arm", async () => {
    const plan = deleteWordsPlanFor([w("a", 1.0, 1.3, 10)], 0.9, doc(), "caption-video")!;
    await mount(plan, () => {});
    expect(radio("caption-video").checked).toBe(true);
    expect(radio("caption").checked).toBe(false);
  });

  it("falls back to the recoverable arm when no gesture named one — the keyboard path", async () => {
    const plan = deleteWordsPlanFor([w("a", 1.0, 1.3, 10)], 0.9, doc())!;
    await mount(plan, () => {});
    expect(radio("caption").checked).toBe(true);
    expect(radio("caption-video").checked).toBe(false);
  });

  it("still lets the user switch, and confirms what is checked", async () => {
    let confirmed: DeleteWordsTarget | null = null;
    const plan = deleteWordsPlanFor([w("a", 1.0, 1.3, 10)], 0.9, doc(), "caption-video")!;
    await mount(plan, (t) => {
      confirmed = t;
    });
    await act(async () => {
      radio("caption").click();
    });
    expect(radio("caption").checked).toBe(true);
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('[data-testid="delete-words-confirm"]')!
        .click();
    });
    expect(confirmed).toBe("caption");
  });

  it("owns the multi-window sum and place count in the video copy — Delete all", async () => {
    const plan = deleteWordsAllPlanFor(
      [w("helllo", 1.0, 1.3, 10)],
      0.9,
      [
        { words: [w("hello", 5.0, 5.3, 50)], prevEnd: 4.3 },
        { words: [w("hello", 9.0, 9.3, 90)], prevEnd: 8.3 },
      ],
      doc(),
      "caption-video",
    )!;
    await mount(plan, () => {});
    expect(container.querySelector(".ossclip-modal-title")!.textContent).toBe(
      "delete 3 words in 3 places?",
    );
    const detail = container
      .querySelector('[data-testid="delete-words-option-caption-video"]')!.textContent!;
    expect(detail).toContain("0.9s");
    expect(detail).toContain("in 3 places");
  });

  it("keeps the single-window copy unchanged — no places suffix", async () => {
    const plan = deleteWordsPlanFor([w("a", 1.0, 1.3, 10)], 0.9, doc())!;
    await mount(plan, () => {});
    expect(container.querySelector(".ossclip-modal-title")!.textContent).toBe("delete 1 word?");
    const detail = container
      .querySelector('[data-testid="delete-words-option-caption-video"]')!.textContent!;
    expect(detail).toContain("0.3s");
    expect(detail).not.toContain("places");
  });
});
