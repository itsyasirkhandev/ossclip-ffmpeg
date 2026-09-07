import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { parseFfmpegProgress } from "@ossclip/core";
import type { CaptionLine, Theme } from "@ossclip/core/browser";
import type { ProductionCompProps } from "./ProductionComposition";
import type { RenderJobOptions } from "./render-options";

function formatAssTime(sec: number): string {
  const clamped = Math.max(0, sec);
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = Math.floor(clamped % 60);
  const cs = Math.floor((clamped % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function escapeAssText(text: string): string {
  return text.replace(/\r?\n/g, "\\N").replace(/[{}]/g, "");
}

function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, "/").replace(/'/g, "'\\''").replace(/:/g, "\\:");
}

function hexToAssColor(hex?: string, defaultAss = "&H004DE1FF&"): string {
  if (!hex) return defaultAss;
  const clean = hex.replace(/^#/, "").trim();
  if (clean.length === 6) {
    const r = clean.slice(0, 2);
    const g = clean.slice(2, 4);
    const b = clean.slice(4, 6);
    return `&H00${b}${g}${r}&`;
  }
  return defaultAss;
}

export function generateAssSubtitles(
  lines: CaptionLine[],
  width: number,
  height: number,
  theme?: Theme,
): string {
  const fontSize = Math.max(24, Math.round(height * 0.048));
  const marginV = Math.max(24, Math.round(height * 0.075));
  const accentAss = hexToAssColor(theme?.accent, "&H004DE1FF&");
  const fgAss = hexToAssColor(theme?.fg, "&H00FFFFFF&");
  const fontName = theme?.fontDisplay?.split(",")[0]?.trim().replace(/['"]/g, "") || "Arial";

  let ass = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
ScaledBorderAndShadow: yes
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${fontSize},${fgAss},&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3.5,1.5,2,30,30,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  for (const line of lines) {
    if (!line.words || line.words.length === 0) continue;
    const words = line.words
      .filter((w) => w.text && w.text.trim().length > 0)
      .sort((a, b) => a.start - b.start);
    if (words.length === 0) continue;

    if (words.length === 1) {
      const w = words[0]!;
      const start = formatAssTime(Math.min(line.start, w.start));
      const end = formatAssTime(Math.max(line.end, w.end));
      const text = `{\\c${accentAss}\\fscx110\\fscy110\\b1}${escapeAssText(w.text)}{\\r}`;
      ass += `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}\n`;
      continue;
    }

    // Lead-in before first word
    if (words[0]!.start > line.start + 0.08) {
      const start = formatAssTime(line.start);
      const end = formatAssTime(words[0]!.start);
      const text = words.map((w) => escapeAssText(w.text)).join(" ");
      ass += `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}\n`;
    }

    for (let i = 0; i < words.length; i++) {
      const currentWord = words[i]!;
      const startSec = currentWord.start;
      let endSec = i < words.length - 1 ? words[i + 1]!.start : Math.max(currentWord.end, line.end);
      if (endSec <= startSec) endSec = startSec + 0.12;

      const textParts = words.map((w, j) => {
        const escaped = escapeAssText(w.text);
        if (j === i) {
          // Word-by-word active animation: accent color + pop scale + bold
          return `{\\c${accentAss}\\fscx112\\fscy112\\b1}${escaped}{\\r}`;
        }
        return escaped;
      });

      const start = formatAssTime(startSec);
      const end = formatAssTime(endSec);
      ass += `Dialogue: 0,${start},${end},Default,,0,0,0,,${textParts.join(" ")}\n`;
    }
  }

  return ass;
}

/**
 * Update render progress from an incoming chunk of ffmpeg's `-progress` stream.
 *
 * ffmpeg emits `out_time_us`, `out_time_ms`, and `out_time` roughly twice a
 * second. NB: `out_time_ms` is ALSO in microseconds despite the name
 * (long-standing ffmpeg quirk — trusting the name causes a 1000x overshoot,
 * which made progress jump to 99% immediately).
 *
 * Pure function separated from I/O so chunk boundary handling and progress
 * math are testable without spawning ffmpeg (house style).
 */
export function parseFfmpegRenderProgress(
  carry: string,
  chunk: string,
  totalDurationSec: number,
): { carry: string; progress?: number } {
  const text = carry + chunk;
  const lastNewline = text.lastIndexOf("\n");
  if (lastNewline < 0) {
    return { carry: text };
  }
  const nextCarry = text.slice(lastNewline + 1);
  const parsed = parseFfmpegProgress(text.slice(0, lastNewline + 1));
  if (parsed.outTimeSec === undefined || !Number.isFinite(parsed.outTimeSec)) {
    return { carry: nextCarry };
  }
  const duration = Math.max(0.1, totalDurationSec);
  const pct = Math.min(0.99, Math.max(0, parsed.outTimeSec / duration));
  return { carry: nextCarry, progress: pct };
}

export async function renderProductionFfmpeg(
  props: ProductionCompProps,
  opts: RenderJobOptions,
): Promise<void> {
  opts.onPhase?.("rendering");

  let inputVideo = isAbsolute(props.videoFileName)
    ? props.videoFileName
    : join(opts.publicDir, props.videoFileName);

  if (!existsSync(inputVideo)) {
    const mezz = join(opts.publicDir, "mezzanine.mp4");
    if (existsSync(mezz)) {
      inputVideo = mezz;
    } else {
      const fallback = join(opts.publicDir, "video.mp4");
      if (existsSync(fallback)) inputVideo = fallback;
    }
  }

  const width = props.settings?.width || 1920;
  const height = props.settings?.height || 1080;
  const totalDuration = props.outputDurationSec || 1;

  // Build ASS subtitles if captions are enabled
  let assPath: string | null = null;
  if (!props.captionsHidden && props.captionLines && props.captionLines.length > 0) {
    assPath = join(opts.publicDir, "subtitles.ass");
    const assContent = generateAssSubtitles(props.captionLines, width, height, props.theme);
    await writeFile(assPath, assContent, "utf8");
  }

  const spans = props.spans && props.spans.length > 0 ? props.spans : [];
  const ffmpegBin = process.env.OSSCLIP_FFMPEG ?? "ffmpeg";

  const filterParts: string[] = [];
  let videoOutLabel = "[0:v]";
  let audioOutLabel = "[0:a]";

  if (spans.length > 0) {
    const vLabels: string[] = [];
    const aLabels: string[] = [];
    for (let i = 0; i < spans.length; i++) {
      const s = spans[i]!;
      const vLabel = `[v${i}]`;
      const aLabel = `[a${i}]`;
      filterParts.push(
        `[0:v]trim=start=${s.srcIn.toFixed(4)}:end=${s.srcOut.toFixed(4)},setpts=PTS-STARTPTS${vLabel}`,
      );
      filterParts.push(
        `[0:a]atrim=start=${s.srcIn.toFixed(4)}:end=${s.srcOut.toFixed(4)},asetpts=PTS-STARTPTS${aLabel}`,
      );
      vLabels.push(vLabel);
      aLabels.push(aLabel);
    }
    const concatIn = vLabels.map((v, i) => `${v}${aLabels[i]}`).join("");
    filterParts.push(`${concatIn}concat=n=${spans.length}:v=1:a=1[vcat][acat]`);
    videoOutLabel = "[vcat]";
    audioOutLabel = "[acat]";
  }

  // Next: video styling, scaling and subtitles
  const vPostFilters: string[] = [];
  // Ensure correct pixel dimensions
  vPostFilters.push(
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
  );

  if (assPath) {
    vPostFilters.push(`ass='${escapeFilterPath(assPath)}'`);
  }

  filterParts.push(`${videoOutLabel}${vPostFilters.join(",")}[vout]`);

  const filterComplex = filterParts.join(";");

  const ffmpegArgs = [
    "-v", "error",
    "-y",
    "-i", resolve(inputVideo),
    "-filter_complex", filterComplex,
    "-map", "[vout]",
    "-map", audioOutLabel,
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "20",
    "-c:a", "aac",
    "-b:a", "192k",
    "-progress", "pipe:1",
    resolve(opts.outPath),
  ];

  return new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(ffmpegBin, ffmpegArgs, {
      stdio: ["ignore", "pipe", "pipe"],
    });

    if (opts.cancelSignal) {
      opts.cancelSignal(() => {
        child.kill("SIGKILL");
        rejectPromise(new Error("render cancelled"));
      });
    }

    let stderrOutput = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrOutput += chunk.toString();
    });

    let carry = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      const res = parseFfmpegRenderProgress(
        carry,
        chunk.toString(),
        totalDuration,
      );
      carry = res.carry;
      if (res.progress !== undefined) {
        opts.onProgress?.(res.progress);
      }
    });

    child.on("error", (err) => {
      rejectPromise(new Error(`ffmpeg spawn failed: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code === 0) {
        opts.onProgress?.(1.0);
        resolvePromise();
      } else {
        rejectPromise(new Error(`ffmpeg render failed (exit code ${code}): ${stderrOutput}`));
      }
    });
  });
}
