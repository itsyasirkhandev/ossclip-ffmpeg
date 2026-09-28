import React from "react";
import { AbsoluteFill, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type {
  ContentRectSegment,
  FaceCrop,
  FrameStyle,
  FramingSegment,
  SceneCue,
  Theme,
  ZoomSegment,
} from "@ossclip/core/browser";
import {
  frameBackgroundCss,
  frameBorderCss,
  frameGeometry,
  frameShadowCss,
  zoomScaleAt,
} from "@ossclip/core/browser";
import { activeCueAt, backdropOpacityAt, contentTransformFor, videoSlotAt } from "./stage";
import {
  activeCropBox,
  sourceFitBox,
  type ContentCropMode,
  type SourceFit,
  type SpanLike,
} from "./content-crop";
import { colorGradeFilterId, stageFilterFor, type ColorGradeProps } from "./color-grade";

/**
 * `background.file` -> a URL. The same rule EdlVideo applies to a cover file:
 * an absolute URL passes through untouched, anything else is a name in the
 * render's public dir, which is where produce stages it (see the staging block
 * there for why it never lands at the public root).
 */
const frameImage = (file: string): string => (/^https?:\/\//.test(file) ? file : staticFile(file));

/**
 * The stage (PHASE1 §1): a solid backdrop that fades in when a scene demotes
 * the speaker, and an animated video slot (rect, circular mask, blur, dim)
 * that the EDL video renders inside. The children — <EdlVideo> — stay mounted
 * at all times, so the BASE AUDIO TRACK IS CONTINUOUS regardless of layout.
 */
export const VideoStage: React.FC<{
  cues: SceneCue[];
  theme: Theme;
  /** Measured face box; null/undefined falls back to the assumed selfie framing. */
  face?: FaceCrop | null;
  /** Micro zoom punches (FINDINGS §15), precomputed from phrase boundaries. */
  zoomPlan?: ZoomSegment[];
  /**
   * Burned-in text in the source, in OUTPUT time. The crop window is nudged so
   * it never slices one of these bands in half (FINDINGS §36).
   */
  sourceTextRegions?: Array<{ y: number; h: number; startSec: number; endSec: number }>;
  /**
   * The source's framing over SOURCE time (PLAN Task C). Present only for a
   * source whose framing CHANGES mid-take — a uniformly letterboxed one is
   * cropped by ffmpeg into the mezzanine long before this runs, and passing a
   * timeline for it would crop the same bars twice.
   */
  contentTimeline?: ContentRectSegment[];
  /**
   * The render-time framing plan over SOURCE time — the props-based successor
   * to the destructive normalization bake (2026-08-16 incident). Preferred
   * over `contentTimeline` when present: the plan was computed FROM that
   * timeline and already accounts for the bars. Absent means no plan, so
   * every pre-existing render-props renders unchanged.
   */
  framingTimeline?: FramingSegment[];
  /** Kept spans, needed to read the timeline's SOURCE clock at an output time. */
  spans?: SpanLike[];
  /** The source's own pixel dimensions — the frame the timeline is measured in. */
  sourceSize?: { width: number; height: number };
  /**
   * How a letterboxed stretch renders: `cover` fills the slot from the strip
   * (face-biased crop), `fit` insets the strip whole — the fallback when the
   * strip is too small to cover without visible softening (option (b)).
   */
  contentCropMode?: ContentCropMode;
  /**
   * How the SOURCE meets the slot (`--source-fit`). `contain` shows the whole
   * frame inset against the backdrop instead of cover-cropping it — the
   * landscape escape hatch. Needs `sourceSize` to know the frame's shape;
   * without it there is nothing to fit and this falls back to cover.
   */
  sourceFit?: SourceFit;
  /**
   * The `--grade` SVG filter spec, already parsed by the composition
   * (`colorGradePropsFor` — parse, never coerce). Absent/null means no grade
   * and ZERO new DOM: no `<svg>`, no `url()` in the filter list, so a
   * grade-less render builds the exact tree it always did.
   */
  colorGrade?: ColorGradeProps | null;
  /**
   * The project-wide background + frame (PHASE1 frame styling). ABSENT MEANS
   * OFF, and the component then returns the exact tree it built before this
   * existed — one wrapper div added, not a conditional layer inside the stage,
   * so a project without the feature is byte-identical in the browser too.
   *
   * When present the stage is inset by `frameGeometry`'s padding inside a
   * chrome box that carries the radius, border and shadow. The chrome box's
   * own background is OPAQUE BLACK, matching the rasterizer: `pad` there fills
   * with black (alphamerge replaces alpha rather than combining it, so a
   * transparent pad would be overwritten anyway), which is why letterbox bars
   * inside the framed box read black on both surfaces.
   */
  frameStyle?: FrameStyle;
  children: React.ReactNode;
}> = ({
  cues,
  theme,
  face,
  zoomPlan,
  sourceTextRegions,
  contentTimeline,
  framingTimeline,
  spans,
  sourceSize,
  contentCropMode = "cover",
  sourceFit = "cover",
  colorGrade,
  frameStyle,
  children,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const t = frame / fps;
  // The composition already knows its own frame — hand it to the geometry so
  // a landscape export crops against 16:9 instead of the portrait assumption
  // baked in when 9:16 was the only output (R15).
  const outFrame = { width, height };
  // With frame styling on, the stage lives INSIDE the padded box, so every
  // slot number is measured against that box — the slot's percentages resolve
  // against the same div that provides these dimensions, and a slot spanning
  // the stage must not be sized by the full output. Off, this is `outFrame`
  // verbatim, which is why the absent path renders exactly as it always did.
  // …and the box is the PICTURE's, not the padded stage's: under `contain`
  // the picture is only fitted into that stage and never reaches its edges,
  // so the chrome has to shrink to it or the radius/border/shadow are drawn
  // out in the background, away from the video. The two surfaces agree
  // because both call the same `frameGeometry` with the same source.
  const chrome = frameStyle ? frameGeometry(frameStyle, outFrame, sourceSize) : undefined;
  const stageBox = chrome
    ? { width: chrome.content.width, height: chrome.content.height }
    : outFrame;
  const slot = videoSlotAt(cues, t, face ?? undefined, sourceTextRegions ?? [], stageBox);
  const backdrop = backdropOpacityAt(cues, t);

  const wPx = slot.rect.w * stageBox.width;
  const hPx = slot.rect.h * stageBox.height;
  const radiusPx = (slot.cornerRadius * Math.min(wPx, hPx)) / 2;

  // The user's per-scene crop correction (`overrides.json` -> cue.video).
  // Composed with the idle zoom rather than replacing it, so a scene that was
  // nudged still breathes; NOT lerped across the layout transition, because a
  // correction belongs to one scene and interpolating it into its neighbour
  // would drag the neighbour's crop with it.
  const activeCue = activeCueAt(cues, t);
  const userVideo = activeCue?.video;

  // §15: the idle zoom fades with the slot (graphic-only suppresses it) and
  // is damped on the bubble — a zooming bubble reads as a wobble. Both fall
  // out of the already-lerped slot state, so the damping stays continuous
  // through layout transitions. It composes with EdlVideo's cut-driven
  // punch-in multiplicatively (nested transforms). Per scene the AUTOMATIC
  // layer is switchable (`autoZoom: false` — PLAN 2026-07-30 Task A3):
  // "adjust the zoomed part" = switch it off and dial your own scale, or
  // leave it on and correct multiplicatively on top.
  const zoomRaw = zoomPlan && zoomPlan.length > 0 ? zoomScaleAt(zoomPlan, t) : 1;
  const zoomDamp = Math.max(0, slot.opacity * (1 - 0.6 * slot.cornerRadius));
  const autoZoom = userVideo?.autoZoom !== false;
  // `contain` promises the WHOLE frame; the idle push would immediately crop
  // it back — a 1.08 scale on an exactly-fitted picture trims 8% off every
  // edge. So the automatic layer is off in that mode by construction, not by
  // asking the user to remember to switch it off per scene. An explicit
  // `cue.video.scale` still applies: that one is a decision, not a default.
  const fitContain = sourceFit === "contain" && sourceSize !== undefined;
  const zoom = autoZoom && !fitContain ? 1 + (zoomRaw - 1) * zoomDamp : 1;
  const userScale = userVideo?.scale ?? 1;
  const userDx = userVideo?.dx ?? 0;
  const userDy = userVideo?.dy ?? 0;
  // Built OUTSIDE the crop on purpose: the transform wraps ContentCrop below,
  // so a user correction composes ON TOP of the framing plan instead of being
  // consumed by it (see contentTransformFor's contract).
  const contentTransform = contentTransformFor(zoom, userScale, userDx, userDy);

  // Value-derived id (see colorGradeFilterId): two stages in one document can
  // only collide when their grades are identical, which makes the collision
  // a no-op instead of one stage silently wearing the other's grade.
  const gradeId = colorGrade ? colorGradeFilterId(colorGrade) : null;

  // The stage, built once and rendered identically in both branches — the
  // absent path must produce the tree this always produced, and the frame path
  // must produce THAT tree plus chrome, not a re-ordering of it.
  const stage = (
    <>
      {colorGrade ? (
        // Zero-sized and absolute: the element exists only to define the
        // filter the slot's `filter: url(#…)` references; it must never take
        // layout space in the stage.
        <svg width={0} height={0} style={{ position: "absolute" }} aria-hidden>
          {/* colorInterpolationFilters="sRGB" is LOAD-BEARING: the SVG spec
              defaults filter math to linearRGB, but core sampled the transfer
              tables and built the matrix in sRGB (gamma) space — without the
              override the browser un-gammas the pixels first and the whole
              grade shifts brighter/washed. */}
          <filter id={gradeId!} colorInterpolationFilters="sRGB">
            <feComponentTransfer>
              <feFuncR type="table" tableValues={colorGrade.tableR.join(" ")} />
              <feFuncG type="table" tableValues={colorGrade.tableG.join(" ")} />
              <feFuncB type="table" tableValues={colorGrade.tableB.join(" ")} />
            </feComponentTransfer>
            <feColorMatrix type="matrix" values={colorGrade.colorMatrix.join(" ")} />
          </filter>
        </svg>
      ) : null}
      <AbsoluteFill style={{ background: theme.bg, opacity: backdrop }} />
      <div
        // Which scene's framing a grab on the picture edits (PLAN 2026-07-30
        // Task B). ATTRIBUTE ONLY — no cursor, no pointerEvents here: editor
        // affordances stay in the editor; the renderer just states whose
        // video this is right now.
        data-edit-video={activeCue?.id}
        style={{
          position: "absolute",
          left: `${slot.rect.x * 100}%`,
          top: `${slot.rect.y * 100}%`,
          width: wPx,
          height: hPx,
          borderRadius: radiusPx,
          overflow: "hidden",
          opacity: slot.opacity,
          // Under `contain` the picture no longer reaches the slot's edges. The
          // gap shows whatever is BEHIND the slot: the frame's own background
          // when one is configured (chrome), else the theme's colour — never
          // black, so a letterbox never reads as an unintentional bar.
          backgroundColor: fitContain && !chrome ? theme.bg : undefined,
          // Slightly lift the bubble off the backdrop like the reference.
          boxShadow: slot.cornerRadius > 0.5 ? "0 18px 60px rgba(0,0,0,0.55)" : undefined,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            // Grade before blur (stageFilterFor has the ordering argument);
            // without a grade this is the exact blur string it always was.
            filter: stageFilterFor(gradeId, slot.blurPx),
            transform: contentTransform,
            // Zoom toward the face, which the crop bias keeps in the upper part.
            transformOrigin: "50% 40%",
            // Crop bias consumed by EdlVideo's object-position (FINDINGS §11/§13):
            // derived from the measured face so the head lands in the band.
            ["--ossclip-obj-y" as string]: `${slot.objectPosY * 100}%`,
            // …and the horizontal one, which only leaves centre for a source
            // wider than the slot (a landscape take in a vertical frame).
            ["--ossclip-obj-x" as string]: `${slot.objectPosX * 100}%`,
          }}
        >
          {fitContain ? (
            // The whole frame, inset and centred. The box carries the SOURCE's
            // aspect, so EdlVideo's `object-fit: cover` has no overflow left to
            // crop and its object-position bias becomes a no-op — the same
            // property the mixed-framing fit path relies on. Takes precedence
            // over the content-rect path below: `contain` means "exactly as
            // recorded", bars in the source included.
            <FitBox source={sourceSize!} slot={{ width: wPx, height: hPx }}>
              {children}
            </FitBox>
          ) : (
            <ContentCrop
              timeline={contentTimeline}
              framing={framingTimeline}
              spans={spans}
              sourceSize={sourceSize}
              mode={contentCropMode}
              tSec={t}
              slot={{ width: wPx, height: hPx }}
              posX={slot.objectPosX}
              posY={slot.objectPosY}
            >
              {children}
            </ContentCrop>
          )}
        </div>
        <div style={{ position: "absolute", inset: 0, background: "black", opacity: slot.dim }} />
      </div>
    </>
  );

  if (!frameStyle || !chrome) return <AbsoluteFill>{stage}</AbsoluteFill>;

  const bw = frameStyle.borderWidth;
  return (
    <AbsoluteFill
      style={{
        background: frameBackgroundCss(frameStyle.background, frameImage) ?? theme.bg,
        // The rasterizer clips at the frame edge, so the preview must too —
        // at padding 0 the stroke's inset goes negative and would otherwise
        // paint outside the composition.
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: `${chrome.content.y}px ${chrome.content.x}px`,
          borderRadius: chrome.radius,
          overflow: "hidden",
          // Transparent, so the letterbox gaps the fitted picture leaves fall
          // through to the frame background painted on the outer AbsoluteFill —
          // one unbroken surface behind the picture rather than a black pad.
          boxShadow: frameShadowCss(frameStyle),
        }}
      >
        <AbsoluteFill>{stage}</AbsoluteFill>
      </div>
      {bw > 0 ? (
        // A sibling rather than a border on the box above: `overflow: hidden`
        // there would clip the outer half of the stroke, which the rasterizer
        // draws in full, and no CSS border can straddle a content edge — it
        // always sits wholly inside or wholly outside it.
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: `${chrome.content.y - bw / 2}px ${chrome.content.x - bw / 2}px`,
            boxSizing: "border-box",
            border: frameBorderCss(frameStyle),
            borderRadius: chrome.radius + bw / 2,
            // Outlined over the slot; without this the editor's
            // click-to-edit-video would stop reaching the picture.
            pointerEvents: "none",
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

/** Shows the whole source frame, centred inside the slot (`--source-fit contain`). */
const FitBox: React.FC<{
  source: { width: number; height: number };
  slot: { width: number; height: number };
  children: React.ReactNode;
}> = ({ source, slot, children }) => {
  const box = sourceFitBox(source, slot);
  return (
    <div
      style={{ position: "absolute", width: box.width, height: box.height, left: box.left, top: box.top }}
    >
      {children}
    </div>
  );
};

/**
 * Crops the video to the source's ACTIVE content rect (PLAN Task C).
 *
 * A no-op — literally the same `inset: 0` box as before — unless the source's
 * framing changes mid-take AND this moment is inside a letterboxed stretch.
 * Keeping the untouched path byte-identical is deliberate: the uniform case is
 * what every existing geometry test covers, and it must not drift because the
 * mixed case needed something.
 *
 * When it does apply, the FULL frame is sized and offset so the content rect
 * covers the slot. The resulting box carries the source's own aspect ratio, so
 * the video's `object-fit: cover` has no overflow left to crop and its
 * `object-position` becomes a no-op — the bias has already been spent here.
 *
 * A `framing` plan (2026-08-16) takes the same box-shaped path with its own
 * windows and bias; the which-crop-wins decision lives in `activeCropBox`, a
 * pure function, so this component stays a dumb box painter.
 */
const ContentCrop: React.FC<{
  timeline?: ContentRectSegment[];
  framing?: FramingSegment[];
  spans?: SpanLike[];
  sourceSize?: { width: number; height: number };
  mode: ContentCropMode;
  tSec: number;
  slot: { width: number; height: number };
  posX: number;
  posY: number;
  children: React.ReactNode;
}> = ({ timeline, framing, spans, sourceSize, mode, tSec, slot, posX, posY, children }) => {
  const box = activeCropBox(framing, timeline, spans ?? [], tSec, sourceSize, mode, slot, posX, posY);
  if (!box) return <div style={{ position: "absolute", inset: 0 }}>{children}</div>;
  return (
    <div
      style={{
        position: "absolute",
        width: box.width,
        height: box.height,
        left: box.left,
        top: box.top,
      }}
    >
      {children}
    </div>
  );
};
