import { captionAnchorOf, type CaptionWord, type OverrideDoc } from "@ossclip/core/browser";

/**
 * The two things "delete these words" can mean — the same duality as
 * `deleteScene.ts`'s `DeleteTarget`, on the transcript axis (§59b revisited
 * 2026-08-18):
 *
 * - `caption` → `hideCaptionWords`: the words leave the rendered captions
 *   NOW (the hide layer previews instantly) but stay in the transcript and
 *   the audio. Restorable from the transcript itself.
 * - `caption-video` → `cutWords`: the hides above PLUS `doc.cuts` entries
 *   removing the words' time ranges from the output on the next
 *   produce/Render — the live preview deliberately never applies `doc.cuts`
 *   (App.tsx's `live` memo has the why), so the modal copy must say "next
 *   Render".
 */
export type DeleteWordsTarget = "caption" | "caption-video";

/** One deletable run of words, plus the OUTPUT end of the flat word
 * immediately BEFORE it (null when the run starts the transcript). A plain
 * selection is one run; Delete all is one run per occurrence. */
export interface DeleteWordsRun {
  words: ReadonlyArray<{ word: CaptionWord; live: string; synthetic: boolean }>;
  prevEnd: number | null;
}

export interface DeleteWordsPlan {
  /** One window per deleted run, selection first then each occurrence in
   * sweep order — the order `findOccurrences` reports. The windows' OUTPUT
   * seconds belong to WHATEVER CLOCK the panel's lines were on — the last
   * render's frame, or the live one when App fed the panel a rebuilt track
   * (cut-review rework phase 2). The two differ by the revived/cut seconds
   * before a window, so App resolves each window's `src` on the same signal
   * that chose the streams; nothing here can tell them apart, which is why it
   * is stated. */
  windows: Array<{ startSec: number; endSec: number }>;
  /** The anchorable words across every run, LIVE (post-retype) text as
   * `was` — the same contract `hideCaptionWords` documents. */
  words: Array<{ srcStart: number; was: string }>;
  /** Offered in this order; `[0]` is the modal's fallback default. `caption`
   * leads wherever it is offered because it is the recoverable one — the
   * same rationale as `deletePlanFor`'s graphic-first default. */
  targets: DeleteWordsTarget[];
  /** The radio the modal opens on when the GESTURE named one (the flyout's
   * "Delete + video…") — without it the modal would re-default to the
   * recoverable arm the user just declined, which is the field bug this
   * field exists to prevent. Only ever set to an offered target; absent on
   * the keyboard path, whose safe default stays `targets[0]`. */
  defaultTarget?: DeleteWordsTarget;
}

/**
 * The run's cut window, or null when the stamps invert it. Raw ASR word
 * starts can be smeared FAR early by whisper's stamp-stretch
 * (transcribe.ts:150-155 bleeds each end into the next start — the §18 field
 * case put a word on screen 21 seconds early), so the word's display-clamped
 * `start` (MAX_CAPTION_WORD_LEAD_SEC in captions.ts) is the SAFE cut edge;
 * ends are the trustworthy stamps (MAX_CAPTION_WORD_LEAD_SEC's own doc).
 * Clamping to the PREVIOUS word's end on top of that guarantees the cut never
 * eats a kept word, whatever the stamps say. A zero/negative result is not a
 * decision anyone made.
 */
function windowOf(run: DeleteWordsRun): { startSec: number; endSec: number } | null {
  const first = run.words[0]?.word;
  const last = run.words[run.words.length - 1]?.word;
  if (first === undefined || last === undefined) return null;
  const startSec = Math.max(first.start, run.prevEnd ?? 0);
  const endSec = last.end;
  if (endSec <= startSec) return null;
  return { startSec, endSec };
}

/** The plan assembly both gestures share — one run (the selection) or
 * selection + occurrences (Delete all). Returns null when NOTHING is
 * deletable, which is the signal not to open the modal at all
 * (`deletePlanFor`'s rule: a confirm dialog with nothing to offer is worse
 * than the gesture doing nothing). */
function planFromRuns(
  runs: ReadonlyArray<DeleteWordsRun>,
  doc: OverrideDoc,
  preferred?: DeleteWordsTarget,
): DeleteWordsPlan | null {
  // Only anchorable words can carry a hide key (§137) — the same
  // `captionAnchorOf` verdict every other caption surface keys on.
  const entries = runs.flatMap((r) => r.words);
  const anchorable = entries.filter((s) => captionAnchorOf(s.word) !== null);
  if (anchorable.length === 0) return null;

  const windows: Array<{ startSec: number; endSec: number }> = [];
  let anyWindowCollapsed = false;
  for (const run of runs) {
    const win = windowOf(run);
    if (win === null) anyWindowCollapsed = true;
    else windows.push(win);
  }

  const targets: DeleteWordsTarget[] = [];
  // A selection that is ALREADY entirely hidden has no caption left to
  // remove — offering it would be a confirm dialog for a no-op (the
  // `deletePlanFor` already-a-ghost rule).
  const allHidden = entries.every((s) => {
    const anchor = captionAnchorOf(s.word);
    return anchor !== null && anchor in doc.captionWordsHidden;
  });
  if (!allHidden) targets.push("caption");
  // Mirrors `cutChunk`'s own predicate in useEdits.ts (via `deletePlanFor`):
  // only a SRC-LESS entry at this exact window means "the user already cut
  // this" — a src-anchored entry sharing the window is a resolved anchor for
  // a DIFFERENT decision and must not suppress the offer. Unchanged by the
  // cut-review rework for `deletePlanFor`'s reason: a src-carrying cut is
  // live-applied, so its words are gone from the live caption stream this
  // selection is drawn on, leaving this check to serve legacy entries.
  //
  // Delete all withholds the offer only when EVERY window is already cut —
  // one stale window must not suppress cutting the others.
  const allAlreadyCut =
    windows.length > 0 &&
    windows.every((w) =>
      doc.cuts.some((c) => c.src === undefined && c.startSec === w.startSec && c.endSec === w.endSec),
    );
  // NEVER cut video through a MINTED word: its stamps are interpolations
  // (`retimeCaptionTokens` spreads them across the rewritten run's window),
  // not measured ASR boundaries — so the "ends are the trustworthy stamps"
  // premise the window derivation above rests on does not hold, and the cut
  // would remove an arbitrary slice of real audio nobody decided to lose.
  // The caption-only hide stays on the table: it never touches time.
  //
  // Delete all withholds the whole video arm on ANY minted word or collapsed
  // window: offering it would silently cut only the runs that happen to be
  // healthy while the modal promises "captions + video".
  const anySynthetic = entries.some((s) => s.synthetic);
  if (!anyWindowCollapsed && windows.length > 0 && !anySynthetic && !allAlreadyCut) {
    targets.push("caption-video");
  }
  if (targets.length === 0) return null;

  return {
    windows,
    words: anchorable.map((s) => ({ srcStart: s.word.srcStart, was: s.live })),
    targets,
    ...(preferred !== undefined && targets.includes(preferred) ? { defaultTarget: preferred } : {}),
  };
}

/**
 * Which deletes are on the table for the current transcript selection — pure,
 * so the modal's contents are testable without a DOM (the `deletePlanFor`
 * precedent).
 *
 * `selection` is the selected words in spoken order (TranscriptPanel's flat
 * range); `prevEnd` is the OUTPUT end of the flat word immediately BEFORE the
 * selection, or null when the selection starts the transcript. `synthetic`
 * marks a word MINTED by a count-changed range rewrite (the panel already
 * derives it for styling: no base word carries the anchor).
 *
 * A collapsed selection window refuses the WHOLE plan, caption arm included —
 * the original rule: a window nobody can honestly cut (or even measure) is
 * not a decision to put in front of the user.
 */
export function deleteWordsPlanFor(
  selection: DeleteWordsRun["words"],
  prevEnd: number | null,
  doc: OverrideDoc,
  preferred?: DeleteWordsTarget,
): DeleteWordsPlan | null {
  const run: DeleteWordsRun = { words: selection, prevEnd };
  if (windowOf(run) === null) return null;
  return planFromRuns([run], doc, preferred);
}

/**
 * "Delete all" — the selection plus every OTHER place its live text occurs
 * (`findOccurrences`' runs, selection first). Same targets, same guards; the
 * only differences from `deleteWordsPlanFor` are the extra runs and that a
 * single collapsed/minted run withholds the video arm instead of refusing the
 * whole plan (the caption arm still removes those words). Null when nothing
 * is deletable, the same no-empty-dialog rule.
 */
export function deleteWordsAllPlanFor(
  selection: DeleteWordsRun["words"],
  prevEnd: number | null,
  occurrences: ReadonlyArray<DeleteWordsRun>,
  doc: OverrideDoc,
  preferred?: DeleteWordsTarget,
): DeleteWordsPlan | null {
  return planFromRuns([{ words: selection, prevEnd }, ...occurrences], doc, preferred);
}
