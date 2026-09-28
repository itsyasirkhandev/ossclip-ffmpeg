import { basename, dirname, extname, join } from "node:path";

/** Containers where `-movflags +faststart` applies (matches separate.sh). */
const FASTSTART_EXTS = new Set([".mp4", ".m4v", ".mov"]);

/**
 * Pure: ffmpeg args for splitting a video into a silent video and an audio
 * file. Video is stream-copied (`-c:v copy -an`); audio is re-encoded to mp3
 * at 320k. `-avoid_negative_ts make_zero` and faststart mirror separate.sh —
 * the flags exist because a stream-copy without them produces a file some
 * players and the combine step handle poorly.
 */
export function separateArgs(
  video: string,
  silentOut: string,
  audioOut: string,
): { videoArgs: string[]; audioArgs: string[] } {
  const silentExt = extname(silentOut).toLowerCase();
  const faststart = FASTSTART_EXTS.has(silentExt);
  const videoArgs = [
    "-y",
    "-i", video,
    "-map", "0:v:0",
    "-c:v", "copy",
    "-an",
    "-avoid_negative_ts", "make_zero",
    ...(faststart ? ["-movflags", "+faststart"] : []),
    silentOut,
  ];
  const audioArgs = [
    "-y",
    "-i", video,
    "-vn",
    "-b:a", "320k",
    audioOut,
  ];
  return { videoArgs, audioArgs };
}

/** Default output paths for `ossclip separate <video>` (separate.sh naming). */
export function defaultSeparatePaths(video: string): { silent: string; audio: string } {
  const dir = dirname(video);
  const ext = extname(video);
  const base = basename(video, ext);
  return {
    silent: join(dir, `${base}_silent${ext}`),
    audio: join(dir, `${base}_audio.mp3`),
  };
}
