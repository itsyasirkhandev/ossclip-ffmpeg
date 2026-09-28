import { createServer } from "node:http";

/**
 * Ports undici/browsers refuse on http:// URLs ("bad port", WHATWG fetch
 * spec). Derived empirically 2026-09-27: fetching every port 1–65535
 * against node 24.18.0 — 82 hits, all ≤ 10080, none above.
 *
 * This matters here because the machine's TCP dynamic range starts at 1024
 * (`netsh int ipv4 show dynamicport tcp`: start 1024, count 13977), not
 * Windows' default 49152, so `listen(0)` CAN hand out one of these: the
 * server binds fine, every fetch to its URL throws "bad port", and a browser
 * would refuse to open it too. Tests use `port: 0` as "any free port", so
 * they must notice and take a different one.
 *
 * On a default-range machine (Windows 49152+, Linux 32768+) none of these
 * can ever come out of `listen(0)` — the set is kept complete so the helper
 * stays honest on any host.
 */
const WHATWG_BAD_PORTS = new Set<number>([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79,
  87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137,
  139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515, 526, 530, 531, 532,
  540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995, 1719, 1720,
  1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667,
  6668, 6669, 6679, 6697, 10080,
]);

export function isFetchHostilePort(port: number): boolean {
  return WHATWG_BAD_PORTS.has(port);
}

/**
 * Are all ports in [from, from + span) bindable right now? Windows'
 * excluded port ranges (Hyper-V/WinNAT style) come and go between runs —
 * a probe of the dynamic range on 2026-09-27 found 1024, 1029, 4983, 5040
 * refusing with EACCES, and an earlier failing run of this suite hit 3266
 * instead. A test that starts on an ephemeral port and lets
 * `openEditServer` bump upward (edit-port.ts, PORT_BUMP_ATTEMPTS steps)
 * dies on the EACCES that `tryStart` deliberately rethrows, so callers
 * pick a fresh ephemeral port when the bump window is poisoned.
 *
 * EADDRINUSE on a probe is not immediately fatal: `EditServer.close()`
 * takes no callback, so a server the caller just discarded may not have
 * released its port yet, and parallel test files hold servers of their
 * own. Busy ports get a short grace period; only EACCES (an excluded
 * range — persistent on the scale of one test run) or a port still busy
 * after the grace period fails the window.
 *
 * Probe-bind is TOCTOU, but the window between probe and the real bind is
 * milliseconds inside one test file — good enough for a suite, not something
 * production should ever do.
 */
export async function bindableBlock(from: number, span: number): Promise<boolean> {
  for (let port = from; port < from + span; port++) {
    if (!(await waitOutBusyPort(port))) return false;
  }
  return true;
}

async function waitOutBusyPort(port: number): Promise<boolean> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const verdict = await new Promise<"ok" | "busy" | "denied">((resolve) => {
      const probe = createServer();
      probe.once("error", (err) => {
        resolve((err as { code?: string }).code === "EADDRINUSE" ? "busy" : "denied");
      });
      probe.listen(port, "127.0.0.1", () => probe.close(() => resolve("ok")));
    });
    if (verdict === "ok") return true;
    if (verdict === "denied") return false;
    await new Promise((r) => setTimeout(r, 10));
  }
  return false;
}
