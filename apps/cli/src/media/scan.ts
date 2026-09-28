import { extname, resolve } from "node:path";
import { existsSync, readdirSync, statSync } from "node:fs";

const VIDEO_EXTS = new Set([".mp4", ".mov", ".mkv", ".webm", ".avi", ".flv"]);
const AUDIO_EXTS = new Set([".wav", ".mp3", ".m4a", ".flac", ".aac", ".ogg"]);

/** Find video files in candidate directories, newest first. */
export function scanVideos(dirs: string[]): Array<{ path: string; label: string; mtime: number }> {
  const seen = new Set<string>();
  const results: Array<{ path: string; label: string; mtime: number }> = [];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isFile()) continue;
        const ext = extname(e.name).toLowerCase();
        if (VIDEO_EXTS.has(ext)) {
          const full = resolve(dir, e.name);
          if (seen.has(full)) continue;
          seen.add(full);
          const st = statSync(full);
          const dateStr = st.mtime.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });
          results.push({
            path: full,
            label: `${e.name} (${dateStr})`,
            mtime: st.mtimeMs,
          });
        }
      }
    } catch {
      // Ignore unreadable dirs
    }
  }

  return results.sort((a, b) => b.mtime - a.mtime);
}

/** Find audio files in a folder, prioritizing _enhanced files. */
export function scanAudios(
  dir: string,
  baseName: string,
): Array<{ path: string; label: string; hint?: string }> {
  if (!existsSync(dir)) return [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    const audios: Array<{ path: string; label: string; hint?: string; score: number }> = [];

    for (const e of entries) {
      if (!e.isFile()) continue;
      const ext = extname(e.name).toLowerCase();
      if (AUDIO_EXTS.has(ext)) {
        const full = resolve(dir, e.name);
        const lower = e.name.toLowerCase();
        let score = 0;
        let hint: string | undefined;

        if (lower.includes(`${baseName.toLowerCase()}_enhanced`)) {
          score = 100;
          hint = "enhanced audio (recommended)";
        } else if (lower.includes("enhanced")) {
          score = 50;
          hint = "enhanced audio";
        } else if (lower.includes(`${baseName.toLowerCase()}_audio`)) {
          score = 10;
          hint = "original extracted audio";
        }

        audios.push({ path: full, label: e.name, hint, score });
      }
    }

    return audios.sort((a, b) => b.score - a.score);
  } catch {
    return [];
  }
}
