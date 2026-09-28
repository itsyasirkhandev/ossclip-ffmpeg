import React from "react";
import { ModalShell } from "./ModalShell";

/**
 * The keybinds reference (R16 §63) — a modal listing every shortcut the app
 * answers to, grouped the way the work is grouped. STATIC data, maintained
 * beside the handlers it documents: a list generated from the handlers would
 * be over-engineering, and a stale row here fails the e2e that greps for the
 * bindings it exercises.
 */
const SECTIONS: Array<{ title: string; rows: Array<[keys: string, action: string]> }> = [
  {
    title: "transport",
    rows: [
      ["space", "play / pause"],
      ["J / K / L", "reverse · pause · forward (tap again to speed up)"],
      ["← / →", "step one frame back / forward"],
      ["⌘/ctrl + ← / →", "jump to and select the previous / next scene"],
    ],
  },
  {
    title: "selection",
    rows: [
      ["click", "select scene or element"],
      ["⌥ + ← / →", "select previous / next scene"],
      ["esc", "clear selection · close dialogs"],
    ],
  },
  {
    title: "editing",
    rows: [
      ["⌘/ctrl + B", "split the scene at the playhead"],
      ["delete / backspace", "delete the selected scene — asks graphic or whole take (§139)"],
      ["enter (in that dialog)", "confirm the highlighted option"],
      ["⌘/ctrl + Z", "undo"],
      ["⌘/ctrl + ⇧ + Z", "redo (⌘Y works too)"],
      ["⌘/ctrl + S", "save"],
      ["double-click caption word", "retype it in place"],
      ["drag element / corner handles", "move · resize"],
      ["drag picture", "pan the video framing"],
      [
        "drag a scene block / edge on the timeline",
        "snaps to scene edges + the playhead (hold ⌥ while dragging to disable)",
      ],
      [
        "drag a box on the stage",
        "snaps to centre / safe-area guides (hold ⌥ mid-drag to disable)",
      ],
    ],
  },
  {
    title: "view",
    rows: [
      ["⌘/ctrl + scroll on preview", "zoom the view (never edits)"],
      ["⌥-drag / middle-drag", "pan the zoomed view"],
      ["⌘/ctrl + scroll on timeline", "zoom the timeline"],
      ["?", "this reference"],
    ],
  },
];

export const ShortcutsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <ModalShell
    onClose={onClose}
    title="keybinds"
    subtitle="available commands and configured shortcuts"
    testId="shortcuts-modal"
    close="chip"
    closeLabel="esc close"
    mono
    width={620}
    panelStyle={{ maxHeight: "82vh", padding: "20px 26px 26px" }}
  >
    {SECTIONS.map((s) => (
      <div key={s.title} style={{ marginTop: 18 }}>
        <div style={sectionTitle}>{s.title}</div>
        {s.rows.map(([keys, action]) => (
          <div key={keys} style={row}>
            <span style={keyText}>{keys}</span>
            <span style={actionText}>{action}</span>
          </div>
        ))}
      </div>
    ))}
  </ModalShell>
);

const sectionTitle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: "#8ab4f8",
  marginBottom: 6,
};

const row: React.CSSProperties = {
  display: "flex",
  gap: 16,
  padding: "3px 0",
};

const keyText: React.CSSProperties = {
  width: 290,
  flexShrink: 0,
  color: "#c5a3ff",
  fontWeight: 600,
  fontSize: 13,
};

const actionText: React.CSSProperties = {
  color: "#C9C9D4",
  fontSize: 13,
};
