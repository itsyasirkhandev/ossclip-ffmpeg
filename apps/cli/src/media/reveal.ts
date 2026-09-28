import { spawn } from "node:child_process";

/** Reveal a file in Windows Explorer, macOS Finder, or Linux file manager. */
export function revealInFileManager(filePath: string): void {
  if (process.platform === "win32") {
    spawn("explorer.exe", [`/select,${filePath}`], { detached: true, stdio: "ignore" }).unref();
  } else if (process.platform === "darwin") {
    spawn("open", ["-R", filePath], { detached: true, stdio: "ignore" }).unref();
  }
}
