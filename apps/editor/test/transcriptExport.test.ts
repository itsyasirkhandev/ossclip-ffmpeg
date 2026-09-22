// @vitest-environment jsdom
import React, { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { PlayerRef } from "@remotion/player";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptionLine } from "@ossclip/core/browser";
import { downloadTextFile, transcriptText } from "../src/transcriptExport";
import { TranscriptPanel } from "../src/TranscriptPanel";
import { useEdits } from "../src/useEdits";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const line = (...texts: string[]): CaptionLine => ({
  words: texts.map((text, i) => ({
    text,
    start: i * 0.3,
    end: i * 0.3 + 0.3,
    srcStart: i * 0.3,
  })),
  start: 0,
  end: texts.length * 0.3,
});

/** jsdom's Blob has no `.text()`; FileReader is what it does implement. */
const readBlob = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });

describe("transcriptText", () => {
  it("joins words within a line and lines with newlines", () => {
    expect(transcriptText([line("Hello", "world"), line("Second", "line")])).toBe(
      "Hello world\nSecond line\n",
    );
  });

  it("skips lines with no words", () => {
    expect(transcriptText([line("Kept"), { words: [], start: 0, end: 0 }, line("Too")])).toBe(
      "Kept\nToo\n",
    );
  });

  it("returns an empty string for no lines", () => {
    expect(transcriptText([])).toBe("");
  });

  it("preserves edited text as-is", () => {
    expect(transcriptText([line("ری‌است", "ہے")])).toBe("ری‌است ہے\n");
  });
});

describe("downloadTextFile", () => {
  let created: Blob[];
  let anchorClick: ReturnType<typeof vi.spyOn>;
  // jsdom implements neither URL.createObjectURL nor revokeObjectURL, so
  // there is nothing to spy on — install stand-ins and take them away again.
  const urlAny = URL as unknown as Record<string, unknown>;
  const hadCreate = "createObjectURL" in URL;
  const hadRevoke = "revokeObjectURL" in URL;
  const origCreate = urlAny.createObjectURL;
  const origRevoke = urlAny.revokeObjectURL;
  let createMock: ReturnType<typeof vi.fn>;
  let revokeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    created = [];
    createMock = vi.fn((blob: Blob) => {
      created.push(blob);
      return "blob:transcript-export";
    });
    revokeMock = vi.fn();
    urlAny.createObjectURL = createMock;
    urlAny.revokeObjectURL = revokeMock;
    anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  afterEach(() => {
    if (hadCreate) urlAny.createObjectURL = origCreate;
    else delete urlAny.createObjectURL;
    if (hadRevoke) urlAny.revokeObjectURL = origRevoke;
    else delete urlAny.revokeObjectURL;
    anchorClick.mockRestore();
  });

  it("saves the text as a .txt blob via a clicked anchor", async () => {
    downloadTextFile("transcript.txt", "one\ntwo\n");

    expect(created).toHaveLength(1);
    expect(created[0]!.type).toBe("text/plain;charset=utf-8");
    expect(await readBlob(created[0]!)).toBe("one\ntwo\n");
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(revokeMock).toHaveBeenCalledWith("blob:transcript-export");
    // The temporary anchor must not linger in the document.
    expect(document.querySelector('a[download="transcript.txt"]')).toBeNull();
  });
});

describe("TranscriptPanel download button", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  let created: Blob[];
  let anchorClick: ReturnType<typeof vi.spyOn>;
  const urlAny = URL as unknown as Record<string, unknown>;
  const hadCreate = "createObjectURL" in URL;
  const hadRevoke = "revokeObjectURL" in URL;
  const origCreate = urlAny.createObjectURL;
  const origRevoke = urlAny.revokeObjectURL;

  function Harness({ lines }: { lines: CaptionLine[] }) {
    const edits = useEdits();
    const playerRef = useRef<PlayerRef>(null);
    return React.createElement(TranscriptPanel, {
      baseLines: lines,
      liveLines: lines,
      timingLines: lines,
      workdir: null,
      fps: 30,
      playerRef,
      edits,
      onDeleteWords: () => {},
      width: 300,
    });
  }

  beforeEach(() => {
    created = [];
    urlAny.createObjectURL = vi.fn((blob: Blob) => {
      created.push(blob);
      return "blob:panel-export";
    });
    urlAny.revokeObjectURL = vi.fn();
    anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    if (hadCreate) urlAny.createObjectURL = origCreate;
    else delete urlAny.createObjectURL;
    if (hadRevoke) urlAny.revokeObjectURL = origRevoke;
    else delete urlAny.revokeObjectURL;
    anchorClick.mockRestore();
  });

  it("downloads the live lines as plain text", async () => {
    const lines = [line("Edited", "words", "here"), line("Second", "row")];
    await act(async () => {
      root.render(React.createElement(Harness, { lines }));
    });
    await act(async () => {
      container
        .querySelector<HTMLElement>('[data-testid="transcript-download"]')!
        .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });

    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
    expect(await readBlob(created[0]!)).toBe("Edited words here\nSecond row\n");
  });
});
