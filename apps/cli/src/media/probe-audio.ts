import { run } from "@ossclip/core";

/**
 * Whether the file has at least one audio stream. Cheap ffprobe (select only
 * audio streams) — used to gate the produce wizard's audio-workflow step so a
 * silent source never sees a menu where every option is a no-op.
 *
 * A probe failure returns false: if ffprobe cannot read the file, produce
 * will fail later with a clearer error, and hiding the step avoids a
 * pointless prompt in the meantime.
 */
export async function hasAudioStream(ffprobePath: string, path: string): Promise<boolean> {
  try {
    const { stdout } = await run(ffprobePath, [
      "-v", "error",
      "-select_streams", "a",
      "-show_entries", "stream=codec_type",
      "-of", "csv=p=0",
      path,
    ]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}
