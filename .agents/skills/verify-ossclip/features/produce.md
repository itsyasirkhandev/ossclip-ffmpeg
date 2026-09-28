# Render a finished video

`ossclip produce` is `transcribe` plus a render: burned-in captions, graphics, framing, watermark, and optionally
an LLM-planned graphics pass — plus a cover image, but only when `--cover <path>` asks for one.

## Sub-features

- Full ffmpeg render to an output mp4 (`-o`)
- `--no-render` stops after `production.json` / `render-props.json` (this is what `transcribe` wraps)
- `--produce` runs the LLM producer brain for title cards and graphics; `--scenes` supplies them by hand instead
- Cover image beside the video — opt-in: `--cover <path>` writes one; without it no image is written at all
  (`--no-cover` still parses, as a no-op kept for old recorded replays)
- Watermark from config, `--no-watermark` overrides
- Color grade: `--color-grade <preset|file.cube>` / `--no-color-grade`; presets ride render props
  (SVG filter in the composition), a `.cube` from `~/.ossclip/luts` bakes into a hash-suffixed mezzanine
- YouTube pack (`--no-youtube` opts out)
- Portrait / long-form windowing, zoom and punch planning

## How to get to it (user POV)

```sh
ossclip produce input.mp4 -o out.mp4              # cut + captions, no LLM, no network
ossclip produce input.mp4 --produce -o out.mp4    # + LLM-planned graphics
```

## Driving it with the CLI

```sh
WD=$(mktemp -d)
pnpm ossclip produce fixtures/fixture.mp4 \
  --transcript fixtures/fixture.transcript.json \
  --workdir "$WD" -o "$WD/out.mp4" \
  --no-cover --no-youtube
```

**Proves it works:** `out.mp4` exists, the frame dimensions are 1080x1920, and `ffprobe` reports a
container duration within 0.3s of `outputDurationSec` in `render-props.json`. The fixture baseline is
plan 11.579s rendering to 11.800s.

## Gotchas

- The fixture's 0.22s gap between plan and render is known and accounted for, not a failure (§157):
  +0.091s from `atrim` sample rounding and AAC priming, +0.130s from loudnorm's re-encode, and video
  at 351 frames against 347.4 planned because the concat outpoint cuts on DTS and lets ~2 B-frames
  past each of the three boundaries. The budget for anything beyond that is 0.3s.
- Proven 2026-08-30 for the offline path incl. `--color-grade` (both lanes):
  evidence in `docs/verification/2026-08-30-color-grade/`. The `--produce` LLM pass is still unproven.
- Real rendering is slow and CPU-heavy. Do not put it in a tight loop.
- Skip `--produce` unless the change is about the LLM planner: it needs a provider and costs money. `--scenes` is
  the deterministic substitute.
- `--no-render` makes this command equivalent to `transcribe`; if that is all you need, drive `transcribe`.
