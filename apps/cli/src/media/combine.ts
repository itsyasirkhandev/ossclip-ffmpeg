import { basename, dirname, extname, join } from "node:path";

/** Containers where `-movflags +faststart` applies (matches combine.sh). */
const FASTSTART_EXTS = new Set([".mp4", ".m4v", ".mov"]);

/**
 * Pure: ffmpeg args for muxing a video with an external (typically enhanced)
 * audio track. Video is stream-copied; audio becomes AAC 320k. `-shortest`
 * and `-avoid_negative_ts make_zero` mirror combine.sh.
 */
export function combineArgs(video: string, audio: string, out: string): string[] {
  const outExt = extname(out).toLowerCase();
  const faststart = FASTSTART_EXTS.has(outExt);
  return [
    "-y",
    "-i", video,
    "-i", audio,
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "320k",
    "-avoid_negative_ts", "make_zero",
    ...(faststart ? ["-movflags", "+faststart"] : []),
    "-shortest",
    out,
  ];
}

/**
 * Default output for combining: strips a trailing `_silent`/`_combined` so
 * `raw_silent.mp4` + enhanced audio becomes `raw_combined.mp4`, not
 * `raw_silent_combined.mp4` (combine-wizard's baseName rule).
 */
export function defaultCombinePath(video: string): string {
  const dir = dirname(video);
  const ext = extname(video);
  const base = basename(video, ext).replace(/(_silent|_combined)$/i, "");
  return join(dir, `${base}_combined${ext}`);
}
