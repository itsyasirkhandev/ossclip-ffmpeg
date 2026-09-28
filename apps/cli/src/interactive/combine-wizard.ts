import { basename, extname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig } from "@ossclip/core";
import { scanVideos } from "../media";
import {
  audioWorkflowLiveDeps,
  audioWorkflowOptions,
  audioWorkflowPaths,
  runAudioWorkflow,
} from "./audio-workflow";
import { livePickerDeps, pickPath, pickerAvailable } from "./picker";
import { assertInteractive, intro, log, select, text, unwrap } from "./prompts";
import { produceWizard } from "./produce-wizard";

const BROWSE_FILE = "__browse_file__";
const TYPE_PATH = "__type_path__";

export async function combineWizard(
  opts: { video?: string; audio?: string } = {},
): Promise<string[]> {
  assertInteractive("combine wizard");
  intro("ossclip combine & produce");

  const cfg = loadConfig();
  const ffmpeg = cfg.ffmpegPath || "ffmpeg";
  const pickerDeps = livePickerDeps();
  const canBrowse = pickerAvailable(pickerDeps);

  // 1. Resolve video file
  let videoPath = opts.video ? resolve(opts.video) : undefined;
  if (!videoPath || !existsSync(videoPath)) {
    const candidateDirs = [process.cwd(), "E:\\Youtube", resolve(process.cwd(), "..")];
    const videos = scanVideos(candidateDirs);

    const options = videos.slice(0, 15).map((v) => ({
      value: v.path,
      label: v.label,
    }));

    if (canBrowse) {
      options.push({ value: BROWSE_FILE, label: "Browse with file dialog…" });
    }
    options.push({ value: TYPE_PATH, label: "Type a path…" });

    while (!videoPath) {
      const chosen = unwrap(
        await select({
          message: "Select video file (ScreenArc export or raw video)",
          options,
        }),
      ) as string;

      if (chosen === BROWSE_FILE) {
        const picked = await pickPath("file", pickerDeps);
        if (picked && existsSync(picked)) {
          videoPath = resolve(picked);
        }
      } else if (chosen === TYPE_PATH) {
        const typed = unwrap(
          await text({
            message: "Path to video file",
            placeholder: "E:\\Youtube\\recording.mp4",
            validate: (v) => (!v || !existsSync(v) ? "File does not exist" : undefined),
          }),
        ) as string;
        if (typed) videoPath = resolve(typed);
      } else {
        videoPath = resolve(chosen);
      }
    }
  }

  const videoExt = extname(videoPath);
  const rawBaseName = basename(videoPath, videoExt);
  const isSilentAlready = rawBaseName.toLowerCase().endsWith("_silent");

  // 2. Audio extraction prompt (skip when already a _silent file)
  let finalInput = videoPath;
  if (!isSilentAlready) {
    const { audio: extractedAudio } = audioWorkflowPaths(videoPath);
    const firstExtract = !existsSync(extractedAudio);
    const audioAction = unwrap(
      await select({
        message: "Audio separation",
        options: [
          ...audioWorkflowOptions(firstExtract),
          {
            value: "skip" as const,
            label: "Keep this video as-is (no external audio enhancement)",
            hint: "proceed directly to produce wizard",
          },
        ],
      }),
    ) as "extract" | "already" | "skip";

    if (audioAction === "skip") {
      return await produceWizard({
        speaker: cfg.speaker,
        modelDir: cfg.modelDir,
        input: videoPath,
        watermark: cfg.watermark,
        audience: cfg.audience,
        portrait: cfg.portrait,
        thumbnailBrief: cfg.thumbnailBrief,
        resolution: cfg.resolution,
      });
    }

    const deps = audioWorkflowLiveDeps(ffmpeg);
    finalInput = await runAudioWorkflow({
      videoPath,
      mode: audioAction,
      deps,
      audio: opts.audio,
    });
  } else if (opts.audio) {
    // Silent source with a pre-supplied audio path: still combine.
    const deps = audioWorkflowLiveDeps(ffmpeg);
    finalInput = await runAudioWorkflow({
      videoPath,
      mode: "already",
      deps,
      audio: opts.audio,
    });
  }

  // 3. Hand off to the produce wizard.
  log.step("Proceeding to produce wizard for final cuts, captions, and graphics…");
  return await produceWizard({
    speaker: cfg.speaker,
    modelDir: cfg.modelDir,
    input: finalInput,
    watermark: cfg.watermark,
    audience: cfg.audience,
    portrait: cfg.portrait,
    thumbnailBrief: cfg.thumbnailBrief,
    resolution: cfg.resolution,
  });
}
