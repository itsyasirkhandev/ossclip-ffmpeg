import { basename, dirname, extname, join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { run } from "@ossclip/core";
import {
  combineArgs,
  defaultCombinePath,
  defaultSeparatePaths,
  revealInFileManager,
  scanAudios,
  separateArgs,
} from "../media";
import { livePickerDeps, pickPath, pickerAvailable, type PickerDeps } from "./picker";
import { log, select, text, unwrap } from "./prompts";
import { isInteractive } from "./tty";
import { StageAnimator } from "../ui/animation";

const BROWSE_FILE = "__browse_file__";
const TYPE_PATH = "__type_path__";
const REFRESH_AUDIO = "__refresh_audio__";

export type AudioWorkflowChoice = "extract" | "already";

export interface AudioWorkflowDeps {
  ffmpeg: string;
  canBrowse: boolean;
  pickerDeps: PickerDeps;
}

/**
 * The extract / already-ready select shared by the produce wizard's gated
 * audio-workflow step and the combine wizard. Pure prompt — no I/O — so the
 * choice matrix stays testable without a TTY.
 *
 * `firstExtract` flips the extract label when `_audio` already exists on
 * disk (re-extract vs first extract).
 */
export function audioWorkflowOptions(firstExtract: boolean): Array<{
  value: AudioWorkflowChoice;
  label: string;
  hint?: string;
}> {
  return [
    {
      value: "extract",
      label: firstExtract
        ? "Extract audio for enhancement (creates _silent.mp4 and _audio.mp3)"
        : "Re-extract audio for enhancement",
      hint: "recommended",
    },
    {
      value: "already",
      label: "Audio is already extracted / I have the enhanced audio ready",
    },
  ];
}

/** Default derived paths for a source video (silent / audio / combined). */
export function audioWorkflowPaths(videoPath: string): {
  baseName: string;
  silent: string;
  audio: string;
  combined: string;
} {
  const dir = dirname(videoPath);
  const ext = extname(videoPath);
  const rawBase = basename(videoPath, ext);
  const baseName = rawBase.replace(/(_silent|_combined)$/i, "");
  const sep = defaultSeparatePaths(videoPath);
  return {
    baseName,
    silent: join(dir, `${baseName}_silent${ext}`),
    audio: sep.audio,
    combined: defaultCombinePath(videoPath),
  };
}

/**
 * Run the separate → (user enhances externally) → pick enhanced → combine
 * sub-flow. Returns the path the rest of the wizard should use as input.
 *
 * `mode: "extract"` runs the ffmpeg split and reveals the audio file so the
 * user can drag it into their enhancer; `mode: "already"` skips the split and
 * goes straight to picking the enhanced track (combine falls back to the
 * original video when no `_silent` exists, muxing the new audio over it).
 */
export async function runAudioWorkflow(opts: {
  videoPath: string;
  mode: AudioWorkflowChoice;
  deps: AudioWorkflowDeps;
  /** Pre-supplied audio path (combine wizard's --audio / opts.audio). */
  audio?: string;
}): Promise<string> {
  const { videoPath, mode, deps } = opts;
  const { silent, audio: extractedAudio, combined } = audioWorkflowPaths(videoPath);
  const baseName = audioWorkflowPaths(videoPath).baseName;

  if (mode === "extract") {
    log.info("Extracting silent video and audio with FFmpeg…");
    try {
      const { videoArgs, audioArgs } = separateArgs(videoPath, silent, extractedAudio);
      await run(deps.ffmpeg, videoArgs);
      await run(deps.ffmpeg, audioArgs);
      log.success(`Audio extracted: ${extractedAudio}`);
      log.step("Opening file location so you can drag the audio into your enhancer…");
      revealInFileManager(extractedAudio);
    } catch (err: unknown) {
      log.error(`FFmpeg extraction failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  // Select enhanced audio (refresh / browse / type until a real file is picked).
  let audioPath = opts.audio ? resolve(opts.audio) : undefined;
  while (!audioPath || !existsSync(audioPath)) {
    const foundAudios = scanAudios(dirname(videoPath), baseName);
    const audioChoices: Array<{ value: string; label: string; hint?: string }> = foundAudios.map(
      (a) => ({ value: a.path, label: a.label, hint: a.hint }),
    );

    if (deps.canBrowse) {
      audioChoices.push({ value: BROWSE_FILE, label: "Browse for audio file…" });
    }
    audioChoices.push({ value: REFRESH_AUDIO, label: "Refresh audio list (waiting for export/save…)" });
    audioChoices.push({ value: TYPE_PATH, label: "Type audio path…" });

    const chosenAudio = unwrap(
      await select({
        message: "Select enhanced audio file",
        options: audioChoices,
      }),
    ) as string;

    if (chosenAudio === REFRESH_AUDIO) {
      continue;
    } else if (chosenAudio === BROWSE_FILE) {
      const picked = await pickPath("file", deps.pickerDeps);
      if (picked && existsSync(picked)) {
        audioPath = resolve(picked);
      }
    } else if (chosenAudio === TYPE_PATH) {
      const typed = unwrap(
        await text({
          message: "Path to enhanced audio file",
          placeholder: `${baseName}_enhanced.wav`,
          validate: (v) => (!v || !existsSync(v) ? "File does not exist" : undefined),
        }),
      ) as string;
      if (typed) audioPath = resolve(typed);
    } else {
      audioPath = resolve(chosenAudio);
    }
  }

  // Combine silent video (or original) with the enhanced audio.
  const sourceVideoToCombine = existsSync(silent) ? silent : videoPath;
  log.info(
    `Combining video and audio…\n  Video: ${sourceVideoToCombine}\n  Audio: ${audioPath}`,
  );
  // The mux of a long source (+faststart rewrites the whole file) leaves
  // seconds of dead air that reads as a hung CLI (2026-09-28 report), so an
  // elapsed-time spinner runs for the duration. StageAnimator no-ops on
  // non-TTY; the log.info above is the feedback there.
  const combining = isInteractive()
    ? new StageAnimator(
        "COMBINE",
        `Muxing ${basename(sourceVideoToCombine)} + ${basename(audioPath)}`,
      ).start()
    : null;
  try {
    await run(deps.ffmpeg, combineArgs(sourceVideoToCombine, audioPath, combined));
    combining?.stop();
    log.success(`Combined video created: ${combined}`);
  } catch (err: unknown) {
    combining?.stop();
    log.error(`FFmpeg combine failed: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }

  return combined;
}

/** Live picker deps + browse availability, for callers that need both. */
export function audioWorkflowLiveDeps(ffmpeg: string): AudioWorkflowDeps {
  const pickerDeps = livePickerDeps();
  return {
    ffmpeg,
    canBrowse: pickerAvailable(pickerDeps),
    pickerDeps,
  };
}
