import { describe, expect, it } from "vitest";
import { OverrideDocSchema, type CaptionWord } from "@ossclip/core/browser";
import { deleteWordsAllPlanFor, deleteWordsPlanFor } from "../src/deleteWords";

/** An anchored caption word — display-clamped output start/end plus the
 * §137 source anchor, the shape TranscriptPanel's flat list carries.
 * `synthetic` marks a word a range rewrite minted (interpolated stamps). */
const w = (text: string, start: number, end: number, srcStart: number, synthetic = false) => ({
  word: { text, start, end, srcStart } satisfies CaptionWord,
  live: text,
  synthetic,
});

/** A pre-§137 word: no `srcStart` at all (the render-props boundary is an
 * unvalidated cast, so this typechecks as a CaptionWord and must). */
const anchorless = (text: string, start: number, end: number) => ({
  word: { text, start, end } as CaptionWord,
  live: text,
  synthetic: false,
});

const doc = (raw: Record<string, unknown> = {}) => OverrideDocSchema.parse(raw);

describe("deleteWordsPlanFor — targets (§59b revisited, the deletePlanFor duality)", () => {
  const sel = [w("a", 1.0, 1.3, 10), w("b", 1.3, 1.6, 11)];

  it("offers BOTH for a visible selection, caption first (the recoverable one)", () => {
    const plan = deleteWordsPlanFor(sel, 0.9, doc());
    expect(plan?.targets).toEqual(["caption", "caption-video"]);
    // `was` is the LIVE text, keyed by srcStart — the hideCaptionWords contract.
    expect(plan?.words).toEqual([
      { srcStart: 10, was: "a" },
      { srcStart: 11, was: "b" },
    ]);
  });

  it("withholds the caption target when EVERY selected word is already hidden", () => {
    const plan = deleteWordsPlanFor(
      sel,
      0.9,
      doc({ captionWordsHidden: { w10000: { was: "a" }, w11000: { was: "b" } } }),
    );
    expect(plan?.targets).toEqual(["caption-video"]);
  });

  it("a PARTLY hidden selection still offers the caption target", () => {
    const plan = deleteWordsPlanFor(
      sel,
      0.9,
      doc({ captionWordsHidden: { w10000: { was: "a" } } }),
    );
    expect(plan?.targets).toEqual(["caption", "caption-video"]);
  });

  it("withholds the video target when an identical SRC-LESS cut already exists", () => {
    const plan = deleteWordsPlanFor(sel, 0.9, doc({ cuts: [{ startSec: 1.0, endSec: 1.6 }] }));
    expect(plan?.targets).toEqual(["caption"]);
  });

  it("a SRC-ANCHORED cut at the same window does not suppress the video offer", () => {
    // The deletePlanFor:55-58 predicate: a src-anchored entry is produce's
    // resolved anchor for a DIFFERENT decision that shares these numbers.
    const plan = deleteWordsPlanFor(
      sel,
      0.9,
      doc({ cuts: [{ startSec: 1.0, endSec: 1.6, src: { startSec: 4, endSec: 4.6 } }] }),
    );
    expect(plan?.targets).toEqual(["caption", "caption-video"]);
  });

  it("withholds the video target when ANY selected word is SYNTHETIC — minted stamps are interpolations", () => {
    // A count-changed rewrite mints words whose stamps retimeCaptionTokens
    // interpolated across the run's window — not measured ASR boundaries, so
    // the "ends are trustworthy" premise behind the cut window doesn't hold
    // and a captions+video cut would remove an arbitrary slice of real
    // audio. The caption-only hide never touches time and stays offered.
    const plan = deleteWordsPlanFor(
      [w("a", 1.0, 1.3, 10), w("minted", 1.3, 1.6, 11, true)],
      0.9,
      doc(),
    );
    expect(plan?.targets).toEqual(["caption"]);
  });

  it("returns null when BOTH targets are gone — no empty dialog", () => {
    const plan = deleteWordsPlanFor(
      sel,
      0.9,
      doc({
        captionWordsHidden: { w10000: { was: "a" }, w11000: { was: "b" } },
        cuts: [{ startSec: 1.0, endSec: 1.6 }],
      }),
    );
    expect(plan).toBeNull();
  });
});

describe("deleteWordsPlanFor — anchors (§137)", () => {
  it("carries only ANCHORABLE words — an anchorless one cannot hold a hide key", () => {
    const plan = deleteWordsPlanFor([w("a", 1.0, 1.3, 10), anchorless("b", 1.3, 1.6)], 0.9, doc());
    expect(plan?.words).toEqual([{ srcStart: 10, was: "a" }]);
    // The RANGE still spans the whole selection: the anchorless word's time
    // is deletable from the video even though its caption carries no key.
    expect(plan?.windows[0]?.endSec).toBe(1.6);
  });

  it("returns null when NO selected word is anchorable, and on an empty selection", () => {
    expect(deleteWordsPlanFor([anchorless("a", 1.0, 1.3)], 0.9, doc())).toBeNull();
    expect(deleteWordsPlanFor([], null, doc())).toBeNull();
  });
});

describe("deleteWordsPlanFor — range math (the smeared-start clamp)", () => {
  it("clamps startSec to the PREVIOUS word's end so the cut never eats a kept word", () => {
    // A whisper stamp-stretch start smeared earlier than the previous word's
    // end (transcribe.ts:150-155): the previous word's end wins.
    const plan = deleteWordsPlanFor([w("a", 5.0, 6.0, 10)], 5.4, doc());
    expect(plan?.windows).toEqual([{ startSec: 5.4, endSec: 6.0 }]);
  });

  it("uses the word's own (display-clamped) start when the previous word ends earlier", () => {
    const plan = deleteWordsPlanFor([w("a", 5.0, 6.0, 10)], 4.2, doc());
    expect(plan?.windows[0]?.startSec).toBe(5.0);
  });

  it("the first word of the transcript clamps against 0, not against nothing", () => {
    const plan = deleteWordsPlanFor([w("a", 0.4, 0.9, 10)], null, doc());
    expect(plan?.windows).toEqual([{ startSec: 0.4, endSec: 0.9 }]);
  });

  it("returns null when the clamped window collapses (endSec <= startSec)", () => {
    // Overlapping stamps can put the previous word's end AT or PAST the
    // selection's last end — a zero/negative cut is not a decision.
    expect(deleteWordsPlanFor([w("a", 5.0, 5.5, 10)], 5.5, doc())).toBeNull();
    expect(deleteWordsPlanFor([w("a", 5.0, 5.5, 10)], 5.8, doc())).toBeNull();
  });
});

describe("deleteWordsPlanFor — defaultTarget (the flyout's named arm)", () => {
  it("records the gesture's target when it is offered — the modal's preselection", () => {
    const plan = deleteWordsPlanFor([w("a", 1.0, 1.3, 10)], 0.9, doc(), "caption-video");
    expect(plan?.defaultTarget).toBe("caption-video");
  });

  it("omits it when the gesture's target is NOT offered — the modal falls back to targets[0]", () => {
    // A synthetic word withholds the video arm; a "Delete + video…" click
    // must not pin an unoffered radio.
    const plan = deleteWordsPlanFor([w("minted", 1.0, 1.3, 10, true)], 0.9, doc(), "caption-video");
    expect(plan?.defaultTarget).toBeUndefined();
    expect(plan?.targets).toEqual(["caption"]);
  });

  it("stays absent on the keyboard path — the safe targets[0] default", () => {
    expect(deleteWordsPlanFor([w("a", 1.0, 1.3, 10)], 0.9, doc())?.defaultTarget).toBeUndefined();
  });
});

describe("deleteWordsAllPlanFor — selection + occurrences", () => {
  /** A word at srcStart `s` in output seconds `t`..`t+0.3`, one word per
   * second so each occurrence gets a visibly distinct window. */
  const at = (text: string, sec: number, src: number) => w(text, sec, sec + 0.3, src);

  const selection = [at("helllo", 1.0, 10)];
  const occurrence = (sec: number, src: number) => ({
    words: [at("hello", sec, src)],
    prevEnd: sec - 0.7,
  });

  it("builds one window per run, selection first, with a per-run prev-end clamp", () => {
    const plan = deleteWordsAllPlanFor(selection, 0.9, [occurrence(5.0, 50), occurrence(9.0, 90)], doc());
    expect(plan?.windows).toEqual([
      { startSec: 1.0, endSec: 1.3 },
      { startSec: 5.0, endSec: 5.3 },
      { startSec: 9.0, endSec: 9.3 },
    ]);
    // Every run's words ride along for the hide layer — LIVE text as `was`.
    expect(plan?.words).toEqual([
      { srcStart: 10, was: "helllo" },
      { srcStart: 50, was: "hello" },
      { srcStart: 90, was: "hello" },
    ]);
    expect(plan?.targets).toEqual(["caption", "caption-video"]);
  });

  it("withholds the video arm when ANY occurrence has a collapsed window — the caption arm survives", () => {
    // endSec <= startSec on the second run: cutting it is not a decision, and
    // "captions + video" must not silently cut only the healthy runs.
    const broken = { words: [at("hello", 5.5, 50)], prevEnd: 6.0 };
    const plan = deleteWordsAllPlanFor(selection, 0.9, [broken], doc());
    expect(plan?.targets).toEqual(["caption"]);
  });

  it("withholds the video arm when the SELECTION is synthetic, even though occurrences are clean", () => {
    const plan = deleteWordsAllPlanFor(
      [w("minted", 1.0, 1.3, 10, true)],
      0.9,
      [occurrence(5.0, 50)],
      doc(),
    );
    expect(plan?.targets).toEqual(["caption"]);
  });

  it("offers the video arm while at least one window is not already cut", () => {
    const plan = deleteWordsAllPlanFor(
      selection,
      0.9,
      [occurrence(5.0, 50)],
      doc({ cuts: [{ startSec: 1.0, endSec: 1.3 }] }),
    );
    expect(plan?.targets).toEqual(["caption", "caption-video"]);
  });

  it("withholds it when EVERY window is already cut (src-less, exact)", () => {
    const plan = deleteWordsAllPlanFor(
      selection,
      0.9,
      [occurrence(5.0, 50)],
      doc({
        cuts: [
          { startSec: 1.0, endSec: 1.3 },
          { startSec: 5.0, endSec: 5.3 },
        ],
      }),
    );
    expect(plan?.targets).toEqual(["caption"]);
  });

  it("offers only the video arm when every occurrence is already hidden", () => {
    const plan = deleteWordsAllPlanFor(
      selection,
      0.9,
      [occurrence(5.0, 50)],
      doc({
        captionWordsHidden: { w10000: { was: "helllo" }, w50000: { was: "hello" } },
      }),
    );
    expect(plan?.targets).toEqual(["caption-video"]);
  });

  it("returns null when nothing is deletable — the no-empty-dialog rule", () => {
    // The only run's words are already hidden AND its window already cut:
    // both targets are gone, so there is no modal to open.
    const plan = deleteWordsAllPlanFor(
      [],
      null,
      [occurrence(5.0, 50)],
      doc({
        captionWordsHidden: { w50000: { was: "hello" } },
        cuts: [{ startSec: 5.0, endSec: 5.3 }],
      }),
    );
    expect(plan).toBeNull();
  });
});
