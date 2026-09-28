import { existsSync } from "node:fs";
import { delimiter, extname, isAbsolute, join } from "node:path";

type Run = typeof import("../src/exec").run;

/**
 * Why this file exists (probed on Node v24.18.0, win32, 2026-09-27):
 * libuv cannot spawn the suite's extensionless script stubs on Windows.
 * A target with no extension is searched with PATHEXT suffixes only
 * (.COM/.EXE/…), so `spawn("<dir>/agy")` is ENOENT; handing it a `.cmd`
 * path is no better — CreateProcessW receives it as lpApplicationName,
 * which fails ERROR_BAD_EXE_FORMAT (193 → UV_EINVAL), because cmd.exe
 * scripts run only through the command line, never CreateProcess. So the
 * one escape hatch that works is invoking the stub through
 * `process.execPath` — which is exactly what this wrapper does, and only:
 *
 * - on win32 only (POSIX installs nothing — the shebang keeps spawning the
 *   stub directly, byte-identical to the bash stubs' mechanics before);
 * - only for extensionless targets (a real .exe must spawn natively;
 *   `.cmd` would fail EINVAL anyway — our stubs never carry an extension);
 * - only when the target resolves (a missing bin falls through to the real
 *   run(), preserving the `${bin} failed to start: … ENOENT` spawn-failure
 *   path that the missing-binary tests assert).
 *
 * Everything else — argv, stdin, stdout/stderr, cwd, onStdout, allowNonZero,
 * exit codes — passes through run() itself, so production behavior stays
 * what the tests exercise.
 */
export function adaptRun(actual: Run): Run {
  return (bin, args, opts) => {
    const target = nodeLaunchTarget(bin);
    if (target === undefined) return actual(bin, args, opts);
    return actual(process.execPath, [target, ...args], opts);
  };
}

/** Absolute/relative path → itself when present; bare name → exact-match PATH walk. */
function nodeLaunchTarget(bin: string): string | undefined {
  const pathish = isAbsolute(bin) || bin.includes("/") || bin.includes("\\");
  const target = pathish ? (existsSync(bin) ? bin : undefined) : findOnPath(bin);
  return target !== undefined && extname(target) === "" ? target : undefined;
}

function findOnPath(bin: string): string | undefined {
  for (const entry of (process.env.PATH ?? "").split(delimiter)) {
    const dir = entry.replace(/^"(.*)"$/, "$1");
    if (!dir) continue;
    const candidate = join(dir, bin);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}
