import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { loadConfig, parseFfmpegProgress } from "@ossclip/core";
import { frameGeometry, type CaptionLine, type Theme } from "@ossclip/core/browser";
import type { ProductionCompProps } from "./ProductionComposition";
import { ensureFrameAssets } from "./frame-assets";
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

/**
 * Generates an ffconcat demuxer script for fast sequential cuts.
 *
 * Branching hundreds of `trim` filters from a single input stream forces FFmpeg
 * to maintain hundreds of active queues in RAM and duplicate decoded frames to all
 * branches, dropping performance to ~6 fps on dual-core CPUs.
 * The concat demuxer cuts sequentially at the demuxer level, running 30x–40x faster (~200+ fps).
 */
export function generateFfconcatScript(
  videoPath: string,
  spans: ReadonlyArray<{ srcIn: number; srcOut: number }>,
) {
  const escaped = resolve(videoPath).replace(/\\/g, "/").replace(/'/g, "\\'");
  const lines = ["ffconcat version 1.0"];
  for (const s of spans) {
    lines.push(`file '${escaped}'`);
    lines.push(`inpoint ${s.srcIn.toFixed(4)}`);
    lines.push(`outpoint ${s.srcOut.toFixed(4)}`);
  }
  return lines.join("\n") + "\n";
}

/**
 * Pure filtergraph assembly for ffmpeg rendering.
 *
 * When `useConcatDemuxer` is enabled, cutting was already handled by the concat
 * demuxer before the filter stage. The filtergraph only scales, adds subtitles,
 * and resamples audio with `aresample=async=1` to guarantee smooth audio timestamps.
 *
 * With `frame` set, the picture is scaled to the PADDED content box instead of
 * the whole output and then composited over a background with its corners
 * clipped, shadow and border — see `frame-assets.ts` for how those layers are
 * generated and why none of them is looped. Absent `frame` produces exactly
 * the graph it always did, which is what keeps a run that never enabled
 * frame styling byte-identical.
 *
 * LETTERBOX (2026-09-27): the `scale:decrease` that meets an aspect mismatch
 * used to hand off to `pad`, which fills with opaque black — so a 1.25:1 source
 * in a 1.78:1 frame rendered as a picture on two black bars. Without frame
 * styling there is no background to show, so `pad` stays and those bars are
 * still black: absent `frame` is byte-identical to what it always was. With
 * `frame`, the fit is `decrease` into the content box and the gaps the picture
 * leaves are NOT padded — they fall through to a crop of the frame's own
 * background, so the wallpaper/image/gradient/colour runs unbroken behind the
 * picture instead of stopping at a black bar. Where the aspect matches the
 * picture reaches every edge and no gap exists at all.
 *
 * The returned `frameInputs` are the extra files to pass as `-i` AFTER input 0,
 * in this exact order — the graph above refers to them by position.
 */
export function buildFfmpegFilterGraph(params: {
  spans?: ReadonlyArray<{ srcIn: number; srcOut: number }>;
  cropVf?: string;
  width: number;
  height: number;
  assPath?: string | null;
  useConcatDemuxer?: boolean;
  frame?: FrameGraphSpec;
}) {
  const spans = params.spans && params.spans.length > 0 ? params.spans : [];
  const filterParts: string[] = [];
  let videoOutLabel = "[0:v]";
  let audioOutLabel = "[0:a]";

  if (!params.useConcatDemuxer && spans.length > 0) {
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
  } else if (params.useConcatDemuxer) {
    filterParts.push(`[0:a]aresample=async=1[aout]`);
    audioOutLabel = "[aout]";
  }

  if (params.frame) {
    const graph = buildFrameGraph({
      frame: params.frame,
      cropVf: params.cropVf,
      assPath: params.assPath ?? null,
      videoOutLabel,
      filterParts,
    });
    return {
      filterComplex: filterParts.join(";"),
      videoOutLabel: graph.videoOutLabel,
      audioOutLabel,
      frameInputs: graph.frameInputs,
    };
  }

  // Next: video styling, scaling and subtitles
  // The picture is fitted (contain) into the output and the remainder padded
  // opaque black — with no `frame` there is no configured background to show
  // there instead, and keeping this exact chain is what makes a run that never
  // enabled frame styling byte-identical to its own history.
  const prep = params.cropVf ? `${params.cropVf},` : "";
  const fittedLabel = params.assPath ? "[vfitout]" : "[vout]";
  filterParts.push(
    `${videoOutLabel}${prep}scale=${params.width}:${params.height}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${params.width}:${params.height}:(ow-iw)/2:(oh-ih)/2,setsar=1${fittedLabel}`,
  );

  if (params.assPath) {
    filterParts.push(`[vfitout]ass='${escapeFilterPath(params.assPath)}'[vout]`);
  }

  return {
    filterComplex: filterParts.join(";"),
    videoOutLabel: "[vout]",
    audioOutLabel,
    frameInputs: [] as string[],
  };
}

/** What `frame-assets.ts` built, resolved to the paths ffmpeg will read. */
export interface FrameGraphSpec {
  /** Content box + radius, from the one shared `frameGeometry`. */
  geometry: {
    content: { x: number; y: number; width: number; height: number };
    radius: number;
  };
  /** Absolute paths, in the order `frameInputs` must carry them. */
  background: string;
  mask?: string;
  shadow?: string;
  border?: string;
}

function buildFrameGraph(spec: {
  frame: FrameGraphSpec;
  cropVf?: string;
  assPath: string | null;
  videoOutLabel: string;
  filterParts: string[];
}): { videoOutLabel: string; frameInputs: string[] } {
  const { frame } = spec;
  const g = frame.geometry;
  const box = `${g.content.width}:${g.content.height}`;
  const parts = spec.filterParts;
  const frameInputs = [frame.background];
  let next = 1;
  const idxBackground = next++;
  const idxMask = frame.mask ? next++ : undefined;
  const idxShadow = frame.shadow ? next++ : undefined;
  const idxBorder = frame.border ? next++ : undefined;
  if (frame.mask) frameInputs.push(frame.mask);
  if (frame.shadow) frameInputs.push(frame.shadow);
  if (frame.border) frameInputs.push(frame.border);

  const videoFilters: string[] = [];
  if (spec.cropVf) videoFilters.push(spec.cropVf);
  const prep = videoFilters.length > 0 ? `${videoFilters.join(",")}` : "";
  const fitted = `${box}:force_original_aspect_ratio=decrease:flags=lanczos`;

  // The background canvas, with the shadow already on it, split in two: one
  // branch is what the box gets composited onto, the other supplies the box's
  // own floor. A CROP of that floor at the box's offset is used rather than a
  // second copy, so the letterbox gaps the fitted picture leaves read as the
  // wallpaper/gradient/image continuing out past the picture and around it —
  // one unbroken surface, not a picture sitting on a black pad inside a
  // framed box.
  parts.push(`[${idxBackground}:v]format=rgba[bgbase]`);
  let bgFull = "[bgbase]";
  if (idxShadow !== undefined) {
    parts.push(`[bgbase][${idxShadow}:v]overlay=0:0[bged]`);
    bgFull = "[bged]";
  }
  parts.push(`${bgFull}split=2[bgbox][bgunder]`);
  // `format=rgba` BEFORE the crop, not before the split's consumer: the
  // shadow overlay downconverts to yuva420p, and crop then rounds an ODD box
  // width down to the chroma boundary (1215 -> 1214) — one pixel short of the
  // mask it is about to be clipped by, which `alphamerge` rejects outright.
  // rgba has no chroma subsampling, so the box survives whole.
  parts.push(`[bgbox]format=rgba,crop=${box}:${g.content.x}:${g.content.y}[bginner]`);

  // The picture, FITTED (contain) — a 1280x1024 source shows whole, centred,
  // with no `pad` and no cropping. It is never cover-scaled here: `cover` is
  // the caller's choice, not this layer's.
  parts.push(`${spec.videoOutLabel}${prep}${prep ? "," : ""}scale=${fitted},setsar=1,format=rgba[vpic]`);
  parts.push(`[bginner][vpic]overlay=(W-w)/2:(H-h)/2[vbox]`);

  // alphamerge needs an alpha channel on its FIRST input, and the mask is
  // what supplies it — so the clip to the rounded corners happens here, at
  // content-box size, so the corners fall through to the same background the
  // ring already shows.
  let boxed = "[vbox]";
  if (idxMask !== undefined) {
    parts.push(`[vbox][${idxMask}:v]alphamerge[boxed]`);
    boxed = "[boxed]";
  }
  parts.push(`[bgunder]${boxed}overlay=${g.content.x}:${g.content.y}[comp]`);

  let composed = "[comp]";
  if (idxBorder !== undefined) {
    parts.push(`[comp][${idxBorder}:v]overlay=0:0[bordered]`);
    composed = "[bordered]";
  }
  // Captions keep their FULL-frame coordinates: `generateAssSubtitles` sizes
  // them against the output, and shifting them into the padded box would move
  // every existing caption the moment padding is enabled.
  if (spec.assPath) {
    parts.push(`${composed}format=yuv420p,setsar=1[vpre]`);
    parts.push(`[vpre]ass='${escapeFilterPath(spec.assPath)}'[vout]`);
  } else {
    parts.push(`${composed}format=yuv420p,setsar=1[vout]`);
  }

  return { videoOutLabel: "[vout]", frameInputs };
}

/**
 * Pure argv construction for ffmpeg rendering. Uses `-filter_complex_script`
 * to avoid Windows 32KB command line limits (spawn ENAMETOOLONG) and optional
 * concat demuxer for high performance cutting.
 */
export function buildFfmpegRenderArgs(params: {
  inputVideo: string;
  concatScriptPath?: string;
  filterScriptPath: string;
  audioOutLabel: string;
  outPath: string;
  preset?: string;
  crf?: number | string;
  /**
   * Extra single-frame PNGs, in the order `buildFfmpegFilterGraph` returned
   * them. Each is declared `-framerate <fps>` because a static image input
   * defaults to 25fps and the overlay that takes it as its MAIN input adopts
   * that rate — silently re-timing the whole output.
   */
  frameInputs?: string[];
  fps?: number;
}) {
  const preset = params.preset ?? process.env.OSSCLIP_FFMPEG_PRESET ?? "medium";
  const crf = params.crf !== undefined ? String(params.crf) : (process.env.OSSCLIP_FFMPEG_CRF ?? "18");
  const inputArgs = params.concatScriptPath
    ? ["-f", "concat", "-safe", "0", "-i", resolve(params.concatScriptPath)]
    : ["-i", resolve(params.inputVideo)];
  const frameArgs = (params.frameInputs ?? []).flatMap((file) => [
    "-framerate", String(params.fps ?? 30), "-i", resolve(file),
  ]);

  return [
    "-v", "error",
    "-y",
    ...inputArgs,
    ...frameArgs,
    "-filter_complex_script", resolve(params.filterScriptPath),
    "-map", "[vout]",
    "-map", params.audioOutLabel,
    "-c:v", "libx264",
    "-preset", preset,
    "-crf", crf,
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-progress", "pipe:1",
    resolve(params.outPath),
  ];
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

  const baseWidth = props.settings?.width || 1920;
  const baseHeight = props.settings?.height || 1080;
  const scale = opts.scale ?? 1;
  const width = Math.max(2, 2 * Math.round((baseWidth * scale) / 2));
  const height = Math.max(2, 2 * Math.round((baseHeight * scale) / 2));
  const totalDuration = props.outputDurationSec || 1;

  // Build ASS subtitles if captions are enabled
  let assPath: string | null = null;
  if (!props.captionsHidden && props.captionLines && props.captionLines.length > 0) {
    assPath = join(opts.publicDir, "subtitles.ass");
    const assContent = generateAssSubtitles(props.captionLines, width, height, props.theme);
    await writeFile(assPath, assContent, "utf8");
  }

  const spans = props.spans && props.spans.length > 0 ? props.spans : [];
  let ffmpegBin = opts.ffmpegPath ?? process.env.OSSCLIP_FFMPEG;
  if (!ffmpegBin) {
    try {
      ffmpegBin = loadConfig().ffmpegPath;
    } catch {
      ffmpegBin = "ffmpeg";
    }
  }

  let concatScriptPath: string | undefined;
  if (spans.length > 0) {
    concatScriptPath = join(opts.publicDir, "concat_list.txt");
    const concatScript = generateFfconcatScript(inputVideo, spans);
    await writeFile(concatScriptPath, concatScript, "utf8");
  }

  // Frame styling (background + padding/radius/shadow/border). Absent means
  // off: no assets are built and the graph below is the one this always
  // produced, so a run that never enabled it is unchanged to the byte.
  let frame: FrameGraphSpec | undefined;
  if (props.frameStyle) {
    const geometry = frameGeometry(
      props.frameStyle,
      { width, height },
      // The picture is fitted (contain) into the padded box, so on an aspect
      // mismatch it stops short of that box's edges — hand the source size
      // over and the mask/border/shadow hug the VIDEO instead of ringing the
      // empty stage around it.
      props.sourceSize,
    );
    const assets = await ensureFrameAssets(
      { style: props.frameStyle, geometry, themeBg: props.theme?.bg ?? "#0B0B0E" },
      opts.publicDir,
      ffmpegBin,
    );
    frame = {
      geometry,
      background: join(opts.publicDir, assets.background),
      mask: assets.mask ? join(opts.publicDir, assets.mask) : undefined,
      shadow: assets.shadow ? join(opts.publicDir, assets.shadow) : undefined,
      border: assets.border ? join(opts.publicDir, assets.border) : undefined,
    };
  }

  const graph = buildFfmpegFilterGraph({
    spans,
    cropVf: props.cropVf,
    width,
    height,
    assPath,
    useConcatDemuxer: spans.length > 0,
    frame,
  });

  // Windows CreateProcess has an lpCommandLine limit of 32,767 characters.
  // Writing the filtergraph to a file and passing `-filter_complex_script` avoids this.
  const filterScriptPath = join(opts.publicDir, "filter_complex.txt");
  await writeFile(filterScriptPath, graph.filterComplex, "utf8");

  const ffmpegArgs = buildFfmpegRenderArgs({
    inputVideo,
    concatScriptPath,
    filterScriptPath,
    audioOutLabel: graph.audioOutLabel,
    outPath: opts.outPath,
    preset: opts.preset,
    crf: opts.crf,
    frameInputs: graph.frameInputs,
    fps: props.settings?.fps,
  });

  return new Promise<void>((resolvePromise, rejectPromise) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(ffmpegBin, ffmpegArgs, {
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      rejectPromise(new Error(`ffmpeg spawn failed: ${(err as Error).message}`));
      return;
    }

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
