import { tmpdir } from "node:os";
import { join } from "node:path";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The editor's Playwright smoke test (apps/editor/e2e/edit.spec.ts) uses
    // its own runner (`playwright test`, see apps/editor/playwright.config.ts)
    // and imports `@playwright/test`, not vitest — left in vitest's default
    // include glob (`**/*.spec.ts`), it would be picked up here too and fail
    // outright since `test`/`expect` come from a different framework.
    // docs/local/** is gitignored scratch — the Remotion project that renders
    // the blog art lives there, is not a workspace package, and tests its frame
    // math with node's built-in runner (`node --test`, no vitest dependency).
    // Same problem as the e2e specs above: vitest collects the file and fails
    // with "No test suite found" because the registrations are node:test's.
    exclude: [
      ...configDefaults.exclude,
      "apps/editor/e2e/**",
      "docs/local/**",
    ],
    // Two invariants, one env block. The telemetry key is baked into the build
    // (telemetry.ts §134), so OSSCLIP_TELEMETRY=0 forces it off. And EVERY
    // server that opens a workdir records it as a recent project (edit.ts's
    // `recordRecentProject`) — including the ones reached through offerEditor,
    // which cannot be handed a `recentDir` — so the recents dir is pinned to a
    // tmp path here, before any test file runs. Without it those writers land
    // in the developer's real ~/.ossclip/recent-projects.json and, at the
    // 12-entry cap, evict their actual projects from the picker (2026-09-29).
    // The hermetic-suite tests in apps/cli/test/telemetry.test.ts pin this
    // posture.
    env: {
      OSSCLIP_TELEMETRY: "0",
      OSSCLIP_RECENTS_DIR: join(tmpdir(), "ossclip-test-recents-env"),
    },
    // 15s, not vitest's 5s default. The apps/cli suites that build a real
    // `buildProgram()` (bare-path, replay-argv, llm-help,
    // produce-argv-roundtrip, telemetry) take 2–4.3s EACH when the machine is
    // idle — comfortably under 5s alone, and over it whenever the box is
    // loaded. That produced intermittent "Test timed out in 5000ms" failures
    // in a rotating set of files, reproducible on a clean tree, which cost
    // two false investigations in one session (2026-08-12) before anyone
    // recognised the shape. The cost of a generous ceiling is a slow test
    // hanging longer before it fails; the cost of a tight one is a green
    // suite that lies at random.
    testTimeout: 15_000,
  },
});
