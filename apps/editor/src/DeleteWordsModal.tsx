import React, { useEffect, useRef, useState } from "react";
import { ModalShell } from "./ModalShell";
import type { DeleteWordsPlan, DeleteWordsTarget } from "./deleteWords";

/**
 * The transcript's Delete confirmation (§59b revisited 2026-08-18) — the
 * word-range sibling of `DeleteSceneModal`, and deliberately its twin in
 * every mechanism: form-submit Enter, capture-phase Escape (ModalShell),
 * focus trap, and a preselected initial radio. The preselection is the one
 * place it differs: the flyout's "Delete + video…" names the destructive arm,
 * so `defaultTarget` pins it and only the keyboard path falls back to the
 * recoverable `targets[0]` (2026-09-26).
 *
 * The video option's copy must say "next Render" — the live preview
 * deliberately never applies `doc.cuts` (App.tsx's `live` memo).
 */
const COPY: Record<DeleteWordsTarget, { label: string; detail: (plan: DeleteWordsPlan) => string }> =
  {
    caption: {
      label: "Remove from captions only",
      // Names what survives, not the mechanism — the DeleteSceneModal rule.
      detail: () => "restorable — the words stay in the transcript and the audio",
    },
    "caption-video": {
      label: "Remove captions + video",
      detail: (plan) => {
        // Delete all cuts one window per occurrence; the copy has to own the
        // sum, not the first window's duration.
        const total = plan.windows.reduce((s, w) => s + (w.endSec - w.startSec), 0);
        const places = plan.windows.length > 1 ? ` in ${plan.windows.length} places` : "";
        return (
          `cuts ${total.toFixed(1)}s out of the video${places} on the next Render; ` +
          "captions disappear now"
        );
      },
    },
  };

export const DeleteWordsModal: React.FC<{
  plan: DeleteWordsPlan;
  onConfirm: (target: DeleteWordsTarget) => void;
  onCancel: () => void;
}> = ({ plan, onConfirm, onCancel }) => {
  // The gesture's own target wins: "Delete + video…" must not reopen on the
  // recoverable radio the user just declined (the field bug behind
  // `DeleteWordsPlan.defaultTarget`). The keyboard path sets none and keeps
  // the safe `targets[0]` default.
  const [target, setTarget] = useState<DeleteWordsTarget>(plan.defaultTarget ?? plan.targets[0]!);
  const panelRef = useRef<HTMLFormElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Focus trap + focus default action / restore on close — same contract as
  // DeleteSceneModal (its comments carry the why).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = panel.querySelectorAll<HTMLElement>(
        'input:not([disabled]), button:not([disabled]):not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    return () => returnTo?.focus?.();
  }, []);

  const n = plan.words.length;
  const places = plan.windows.length > 1 ? ` in ${plan.windows.length} places` : "";
  const words = `word${n === 1 ? "" : "s"}`;
  return (
    <ModalShell
      onClose={onCancel}
      asForm
      onSubmit={(e) => {
        e.preventDefault();
        onConfirm(target);
      }}
      title={`delete ${n} ${words}${places}?`}
      ariaLabel={`Delete ${n} ${words}${places}`}
      subtitle="undoable with ⌘Z, like every other edit"
      testId="delete-words-modal"
      close="chip"
      closeLabel="esc cancel"
      mono
      width={420}
      panelRef={panelRef}
      panelStyle={{ padding: "18px 22px 20px", maxHeight: "none" }}
      footer={
        <>
          <button
            type="button"
            data-testid="delete-words-cancel"
            className="ossclip-btn ossclip-btn-ghost"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="submit"
            data-testid="delete-words-confirm"
            className="ossclip-btn ossclip-btn-danger"
          >
            Delete
          </button>
        </>
      }
    >
      <div style={{ marginTop: 16 }}>
        {plan.targets.map((t) => (
          <label key={t} style={row} data-testid={`delete-words-option-${t}`}>
            <input
              type="radio"
              name="delete-words-target"
              value={t}
              checked={target === t}
              onChange={() => setTarget(t)}
              style={radio}
            />
            <span>
              <span style={optionLabel}>{COPY[t].label}</span>
              <span style={optionDetail}>{COPY[t].detail(plan)}</span>
            </span>
          </label>
        ))}
      </div>
    </ModalShell>
  );
};

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  padding: "8px 0",
  cursor: "pointer",
};

const radio: React.CSSProperties = {
  accentColor: "#8ab4f8",
  marginTop: 2,
  cursor: "pointer",
};

const optionLabel: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: "#EDEDF2",
};

const optionDetail: React.CSSProperties = {
  display: "block",
  fontSize: 12,
  color: "#9A9AA3",
  marginTop: 2,
};
