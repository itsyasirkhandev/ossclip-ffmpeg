import { describe, expect, it } from "vitest";
import { planRenderPublicDir, planRenderSourceName } from "../src/produce";

/**
 * Final-review fix wave, Finding 3: the accepted-side-image check used to
 * accept an image from a directory that ISN'T the render's `publicDir`, so
 * the image passed the check and then 404'd inside the render. The two have
 * shared ONE decision — `planRenderPublicDir` — ever since, so they can
 * never disagree.
 *
 * 2026-09-28: that answer became UNCONDITIONALLY the workdir, for every
 * shape of run. It used to be `dirname(input)` on a `--no-mezzanine` file
 * run, which put `subtitles.ass`, `concat_list.txt`, `filter_complex.txt`,
 * `frame/`, `wallpapers/` and `side-images/` beside the user's video instead
 * of in the hidden `.ossclip` workdir. The source video now gets LINKED into
 * the workdir (`linkRenderSource`) so the render can still find it there.
 * These four cases are the pin: a reintroduced `dirname(input)` branch fails
 * all of them.
 */
describe("planRenderPublicDir", () => {
  const input = "/Users/x/Downloads/take.mov";
  const work = "/Users/x/Downloads/.ossclip/take-abc12345";

  it("is `work` when the framing bake ran (analysisInput !== input), even with no mezzanine build", () => {
    expect(
      planRenderPublicDir({
        input,
        inputIsAnalysisInput: false,
        mezzanineWillBuild: false,
        work,
      }),
    ).toBe(work);
  });

  it("is `work` when a mezzanine will build and analysisInput === input", () => {
    expect(
      planRenderPublicDir({
        input,
        inputIsAnalysisInput: true,
        mezzanineWillBuild: true,
        work,
      }),
    ).toBe(work);
  });

  it("is `work` — never dirname(input) — on a plain --no-mezzanine file run", () => {
    expect(
      planRenderPublicDir({
        input,
        inputIsAnalysisInput: true,
        mezzanineWillBuild: false,
        work,
      }),
    ).toBe(work);
    expect(planRenderPublicDir({ input, inputIsAnalysisInput: true, mezzanineWillBuild: false, work })).not.toBe(
      "/Users/x/Downloads",
    );
  });

  it("for a folder run, `input` is already inside `work` (source-concat.mp4), so the result is `work` either way", () => {
    const folderInput = `${work}/source-concat.mp4`;
    expect(
      planRenderPublicDir({
        input: folderInput,
        inputIsAnalysisInput: true,
        mezzanineWillBuild: false,
        work,
      }),
    ).toBe(work);
  });
});

/**
 * The name the source video takes inside that workdir. Two rules to pin:
 * the source's own basename WINS whenever it can (so `videoFileName`, the
 * editor's `/media/<name>` fetch and `staticFile()` stay byte-identical to
 * an older run), and a name that would be written over later is refused —
 * the link is a hard link, so `render-raw.mp4` landing on top of it would
 * write straight through into the user's original video.
 */
describe("planRenderSourceName", () => {
  const pipeline = new Set(["render-raw.mp4", "render-norm.mp4"]);

  it("keeps the source's own basename when nothing holds it", () => {
    expect(planRenderSourceName("take.mp4", new Set(pipeline))).toBe("take.mp4");
  });

  it("keeps the basename when the workdir's other entries are unrelated", () => {
    expect(planRenderSourceName("take.mp4", new Set([...pipeline, "audio.wav", "transcript.json"]))).toBe(
      "take.mp4",
    );
  });

  it("refuses a name produce will write into later, even though it is free on disk now", () => {
    expect(planRenderSourceName("render-raw.mp4", pipeline)).toBe("render-raw.source.mp4");
    expect(planRenderSourceName("render-norm.mp4", pipeline)).toBe("render-norm.source.mp4");
  });

  it("reserves the exact file, not the stem — `render-raw.mov` is not what rawPath writes", () => {
    expect(planRenderSourceName("render-raw.mov", pipeline)).toBe("render-raw.mov");
  });

  it("refuses a basename another file already holds (a leftover mezzanine, last run's link)", () => {
    expect(planRenderSourceName("take.mp4", new Set([...pipeline, "take.mp4"]))).toBe("take.source.mp4");
  });

  it("numbers further collisions rather than looping or reusing a taken name", () => {
    expect(planRenderSourceName("take.mp4", new Set([...pipeline, "take.mp4", "take.source.mp4"]))).toBe(
      "take.source2.mp4",
    );
    expect(
      planRenderSourceName("take.mp4", new Set([...pipeline, "take.mp4", "take.source.mp4", "take.source2.mp4"])),
    ).toBe("take.source3.mp4");
  });

  it("handles a source with no extension without producing a stray dot", () => {
    expect(planRenderSourceName("take", pipeline)).toBe("take");
    expect(planRenderSourceName("take", new Set(["take"]))).toBe("take.source");
  });
});
