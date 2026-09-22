import type { CaptionLine } from "@ossclip/core/browser";

/**
 * The transcript as plain text: one line per caption, words joined with a
 * space — the same join `srtFromCaptionLines` uses (core's
 * export-premiere-project.ts). Takes the panel's LIVE lines, so retype and
 * range edits are in the file: the user downloads what they are looking at,
 * not the pristine source. Empty-word lines (possible after deletes) are
 * skipped; a trailing newline keeps the file well-formed for `tail`/diff.
 */
export function transcriptText(lines: readonly CaptionLine[]): string {
  const out: string[] = [];
  for (const line of lines) {
    if (line.words.length === 0) continue;
    out.push(line.words.map((w) => w.text).join(" "));
  }
  return out.length === 0 ? "" : out.join("\n") + "\n";
}

/**
 * Save a string as a file in the browser. The I/O half of the feature,
 * split from `transcriptText` so the format stays testable without a DOM
 * click (the `openCommand`/`openInBrowser` split). charset=utf-8 in the
 * MIME, not a bare `text/plain`: Urdu transcripts are a first-class case
 * here and the bare type inherits the OS default encoding. The anchor is
 * attached for the click — Firefox ignores clicks on a detached <a> — then
 * removed; the URL is revoked once the click has fired.
 */
export function downloadTextFile(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
