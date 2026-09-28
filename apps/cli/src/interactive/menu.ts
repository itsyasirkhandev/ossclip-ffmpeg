import { assertInteractive, intro, select, unwrap } from "./prompts";

export type MenuChoice = "produce" | "combine" | "edit" | "setup" | "doctor";

/**
 * What each menu entry runs. Produce and combine are exceptions — they need
 * answers before they have an argv, so they return null and the caller hands off
 * to their respective wizards.
 */
export function menuArgv(choice: MenuChoice): string[] | null {
  if (choice === "produce" || choice === "combine") return null;
  // Edit with NO argument is deliberate: that is the project picker over
  // recent runs (R17 §83), which is exactly what somebody who reached a menu
  // instead of typing a command needs.
  return [choice];
}

export async function chooseFromMenu(): Promise<MenuChoice> {
  assertInteractive("main menu");
  intro("ossclip");
  return unwrap(
    await select({
      message: "What do you want to do?",
      options: [
        { value: "produce", label: "Produce a video", hint: "cut, caption, frame, render" },
        { value: "combine", label: "Combine & Produce", hint: "silent video + enhanced audio -> produce" },
        { value: "edit", label: "Edit a produced project", hint: "pick from recent runs" },
        { value: "setup", label: "Set up my install", hint: "ffmpeg, whisper, the model" },
        { value: "doctor", label: "Check what's missing" },
      ],
    }),
  ) as MenuChoice;
}
