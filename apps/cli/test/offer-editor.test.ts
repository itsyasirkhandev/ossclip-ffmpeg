import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
// `vi.mock` is hoisted above these, so both see the mocked module.
import { startEditServer, type EditServer } from "../src/edit";
import { offerEditor } from "../src/interactive/offer-editor";
import { PORT_BUMP_ATTEMPTS } from "../src/edit-port";
import { bindableBlock } from "./port-safety";
import type { ProduceResult } from "../src/produce";

/**
 * The end-of-run editor offer runs the SAME busy-port ladder `ossclip edit`
 * does. It shipped without it: a produce finishing into an editor already open
 * on that project died on EADDRINUSE, throwing away the run summary behind a
 * Node stack.
 */

// Hoisted, because vi.mock's factory is lifted above these declarations.
const opened = vi.hoisted(() => [] as string[]);
const started = vi.hoisted(() => [] as Array<{ close: () => void }>);

vi.mock("../src/open", () => ({
  // The offer opens a browser unconditionally; a test suite that pops a real
  // window on the runner is not a test suite.
  openInBrowser: (url: string) => opened.push(url),
}));

vi.mock("../src/edit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/edit")>();
  const { isFetchHostilePort } = await import("./port-safety");
  return {
    ...actual,
    // Whether apps/editor happens to be BUILT on this runner must not decide
    // whether this test runs (offerEditor bails early with a "run pnpm build"
    // line when the page dir is missing). The path only feeds static file
    // serving, which nothing here requests.
    resolveEditorPageDir: () => tmpdir(),
    // Real servers on real ports — but tracked, because offerEditor keeps the
    // one it starts and a leaked listener would hold the worker open.
    // Ephemeral picks that land on a WHATWG blacklisted port (port-safety.ts)
    // break the attach test: the health probe reads null and the flow bumps
    // instead. Explicit ports — the bump ladder itself — pass through untouched.
    startEditServer: async (...args: Parameters<typeof actual.startEditServer>) => {
      const opts = args[1] as { port?: number } | undefined;
      if (opts?.port !== 0) {
        const server = await actual.startEditServer(...args);
        started.push(server);
        return server;
      }
      let lastErr: unknown;
      for (let attempt = 0; attempt < 8; attempt++) {
        try {
          const server = await actual.startEditServer(...args);
          if (!isFetchHostilePort(Number(new URL(server.url).port))) {
            started.push(server);
            return server;
          }
          server.close();
        } catch (e) {
          if ((e as { code?: string }).code !== "EACCES") throw e;
          lastErr = e;
        }
      }
      throw lastErr ?? new Error("offer-editor test: no usable ephemeral port after 8 attempts");
    },
  };
});

const SHARED_RECENTS = join(tmpdir(), "ossclip-test-recents");
let strangers: Server[] = [];
afterEach(() => {
  for (const s of started) s.close();
  started.length = 0;
  opened.length = 0;
  for (const s of strangers) s.close();
  strangers = [];
});

async function fixtureWorkdir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "ossclip-offer-"));
  await writeFile(
    join(dir, "render-props.json"),
    JSON.stringify({ videoFileName: "clip.mp4", sceneCues: [], captionLines: [], spans: [] }),
  );
  return dir;
}

/** Only the two fields the offer reads — an explicit `flag: true` short-circuits
 * decideOpenEditor before `rendered` is consulted, but it is spelled anyway so
 * the fixture matches a real finished run. */
const runResult = (workdir: string): ProduceResult =>
  ({ workdir, rendered: true }) as unknown as ProduceResult;

const portOf = (url: string): number => Number(new URL(url).port);

/** A listener that is NOT ossclip: no /api/health, so the flow may step around
 * it but must never kill it. */
async function stranger(): Promise<number> {
  let lastOutcome = "no attempt succeeded";
  for (let attempt = 0; attempt < 8; attempt++) {
    const server = createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    strangers.push(server);
    try {
      await new Promise<void>((res, rej) => {
        // An 'error' with no listener (transient EACCES: Windows excluded
        // port ranges move around between runs) would take the whole file
        // down, so the promise rejects and the loop takes another port.
        server.once("error", rej);
        server.listen(0, "127.0.0.1", () => {
          server.off("error", rej);
          res();
        });
      });
    } catch (e) {
      lastOutcome = `listen failed: ${(e as Error).message}`;
      if ((e as { code?: string }).code !== "EACCES") throw e;
      continue;
    }
    const addr = server.address();
    const port = typeof addr === "object" && addr !== null ? addr.port : 0;
    // The unpinned flow bumps up to PORT_BUMP_ATTEMPTS ports from here and
    // rethrows EACCES by design (edit-port.ts tryStart) — if an excluded
    // range sits in that window, pick a stranger elsewhere.
    if (await bindableBlock(port + 1, PORT_BUMP_ATTEMPTS)) return port;
    lastOutcome = `port ${port} had no clear bump window`;
    server.close();
  }
  throw new Error(`offer-editor test: no stranger port after 8 attempts (${lastOutcome})`);
}

describe("offerEditor port conflicts", () => {
  it("attaches to the editor already open on this project", async () => {
    const dir = await fixtureWorkdir();
    const first = await startEditServer(dir, { port: 0, recentDir: SHARED_RECENTS });
    const port = portOf(first.url);

    await offerEditor(runResult(dir), { flag: true, port, portPinned: false });

    // One server, not two: the browser was pointed at the running one.
    expect(started).toHaveLength(1);
    expect(opened).toEqual([`http://127.0.0.1:${port}`]);
  });

  it("steps around a stranger on the DEFAULT port instead of refusing", async () => {
    // `--editor-port` untyped means commander's 5174, which is nobody's
    // choice: an unpinned port must bump so the run still ends in an editor.
    const dir = await fixtureWorkdir();
    const port = await stranger();

    await offerEditor(runResult(dir), { flag: true, port, portPinned: false });

    expect(opened).toHaveLength(1);
    expect(portOf(opened[0]!)).not.toBe(port);
    expect((started[0] as EditServer | undefined)?.url).toBe(opened[0]);
  });

  it("refuses rather than moving when the user typed --editor-port", async () => {
    const dir = await fixtureWorkdir();
    const port = await stranger();

    await expect(
      offerEditor(runResult(dir), { flag: true, port, portPinned: true }),
    ).rejects.toThrow(`port ${port} is taken by something that isn't ossclip`);
    expect(opened).toEqual([]);
  });
});
