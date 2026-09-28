import React, { useEffect, useState } from "react";
import { ModalShell } from "./ModalShell";

export interface RenderModalProps {
  defaultOutPath?: string;
  onCancel: () => void;
  onConfirm: (outPath?: string, replan?: boolean) => void;
  onOutPathChange?: (outPath: string) => void;
}

export const RenderModal: React.FC<RenderModalProps> = ({
  defaultOutPath,
  onCancel,
  onConfirm,
  onOutPathChange,
}) => {
  const [outPath, setOutPath] = useState(defaultOutPath ?? "");
  // Default OFF: a render from the editor reproduces the plan on screen.
  // Ticking this asks the LLM for a fresh one, which renumbers scenes and
  // can orphan edits anchored to the old numbering (renderReplayArgs).
  const [replan, setReplan] = React.useState(false);
  const [isPicking, setIsPicking] = useState(false);

  const handlePathChange = (val: string) => {
    setOutPath(val);
    onOutPathChange?.(val);
  };

  // Enter confirms, but only while focus is inside this dialog's own
  // fields — a capture-phase Enter that fired from the page behind would
  // start a render the user did not ask for. Escape is ModalShell's.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !isPicking) {
        const t = e.target as HTMLElement | null;
        const inDialog = t?.closest?.('[data-testid="render-modal"]') != null;
        if (!inDialog) return;
        e.preventDefault();
        onConfirm(outPath.trim() ? outPath.trim() : undefined, replan);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onConfirm, outPath, isPicking, replan]);

  const handleBrowse = async () => {
    setIsPicking(true);
    try {
      const res = await fetch("/api/pick-save-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultPath: outPath || defaultOutPath }),
      });
      if (res.ok) {
        const data = (await res.json()) as { path: string | null };
        if (data.path) {
          handlePathChange(data.path);
        }
      }
    } catch {
      // ignore
    } finally {
      setIsPicking(false);
    }
  };

  return (
    <ModalShell
      onClose={onCancel}
      title="Render master video"
      subtitle="Choose where to export your rendered master cut, or keep the default location."
      testId="render-modal"
      footer={
        <>
          <button type="button" className="ossclip-btn ossclip-btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 13,
              color: "var(--text-secondary)",
            }}
          >
            <input
              type="checkbox"
              data-testid="render-replan"
              checked={replan}
              onChange={(e) => setReplan(e.target.checked)}
            />
            Re-plan graphics with the LLM (discards the reviewed plan)
          </label>
          <button
            type="button"
            data-testid="render-confirm-btn"
            className="ossclip-btn ossclip-btn-success"
            style={{ padding: "9px 20px", fontSize: 13, fontWeight: 700 }}
            onClick={() => onConfirm(outPath.trim() ? outPath.trim() : undefined, replan)}
          >
            Render now
          </button>
        </>
      }
    >
      <div style={{ marginTop: 20 }}>
        <label className="ossclip-modal-label" htmlFor="render-outpath">
          Export file destination
        </label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            id="render-outpath"
            data-testid="render-outpath-input"
            type="text"
            value={outPath}
            onChange={(e) => handlePathChange(e.target.value)}
            placeholder="e.g. /Users/name/Movies/final-cut.mp4"
            className="ossclip-input"
            style={{
              flex: 1,
              padding: "10px 14px",
              fontSize: 13,
              fontFamily: "var(--font-mono)",
            }}
            autoFocus
          />
          <button
            type="button"
            data-testid="render-browse-btn"
            className="ossclip-btn"
            style={{ padding: "0 16px", fontSize: 13, whiteSpace: "nowrap" }}
            onClick={handleBrowse}
            disabled={isPicking}
            title="Open native file picker to choose destination"
          >
            {isPicking ? "Browsing…" : "Browse…"}
          </button>
        </div>
      </div>
    </ModalShell>
  );
};
