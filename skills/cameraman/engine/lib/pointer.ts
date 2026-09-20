/**
 * Moving the REAL operating-system cursor.
 *
 * Why this exists: Playwright dispatches input over CDP
 * `Input.dispatchMouseEvent`, which does not move the OS pointer. A
 * `page.click()` therefore leaves no trace in a screen recording, and a
 * reviewer sees things happen with nothing causing them. Playwright is used
 * only to LOCATE the element; the movement and the click are done by a system
 * utility.
 *
 * No new npm dependency (nut.js needs a native build). Whatever the system has:
 *   Linux  — xdotool      (`apt install xdotool`)
 *   macOS  — cliclick     (`brew install cliclick`)
 *   Windows — PowerShell  (SetCursorPos + mouse_event via Add-Type)
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export type Point = { x: number; y: number };

const PLATFORM = process.platform;

const WIN_HELPER = `
Add-Type -Name W -Namespace G -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
[DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,int e);
'@
`;

async function moveTo(point: Point): Promise<void> {
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  if (PLATFORM === "linux") {
    await run("xdotool", ["mousemove", String(x), String(y)]);
  } else if (PLATFORM === "darwin") {
    await run("cliclick", [`m:${x},${y}`]);
  } else {
    await run("powershell", [
      "-NoProfile",
      "-Command",
      `${WIN_HELPER}; [G.W]::SetCursorPos(${x}, ${y})`,
    ]);
  }
}

async function pressAndRelease(): Promise<void> {
  if (PLATFORM === "linux") {
    await run("xdotool", ["click", "1"]);
  } else if (PLATFORM === "darwin") {
    await run("cliclick", ["c:."]);
  } else {
    await run("powershell", [
      "-NoProfile",
      "-Command",
      `${WIN_HELPER}; [G.W]::mouse_event(0x02,0,0,0,0); Start-Sleep -Milliseconds 40; [G.W]::mouse_event(0x04,0,0,0,0)`,
    ]);
  }
}

/** Keyboard shortcut — used for Ctrl/Cmd+L, focusing the address bar. */
export async function hotkey(combo: "ctrl+l" | "ctrl+t" | "ctrl+w"): Promise<void> {
  if (PLATFORM === "linux") {
    await run("xdotool", ["key", "--clearmodifiers", combo]);
  } else if (PLATFORM === "darwin") {
    const key = combo.split("+")[1];
    await run("cliclick", [`kd:cmd`, `t:${key}`, `ku:cmd`]);
  } else {
    const key = combo.split("+")[1].toUpperCase();
    await run("powershell", [
      "-NoProfile",
      "-Command",
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^${key.toLowerCase()}')`,
    ]);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

let last: Point = { x: 0, y: 0 };

/**
 * Ease onto the target. A jump reads as a cut in the recording, so the motion
 * is interpolated with an accelerate/decelerate curve.
 */
export async function moveSmooth(target: Point, durationMs: number): Promise<void> {
  const steps = Math.max(8, Math.round(durationMs / 16));
  const from = last;
  for (let i = 1; i <= steps; i += 1) {
    const t = easeInOut(i / steps);
    await moveTo({
      x: from.x + (target.x - from.x) * t,
      y: from.y + (target.y - from.y) * t,
    });
    await sleep(durationMs / steps);
  }
  last = target;
}

/** Move to the target, pause briefly so the intent reads on camera, then click. */
export async function clickAt(target: Point, moveMs: number): Promise<void> {
  await moveSmooth(target, moveMs);
  await sleep(220);
  await pressAndRelease();
  await sleep(120);
}

/** Check the pointer utility up front, rather than failing mid-take. */
export async function assertPointerToolAvailable(): Promise<void> {
  try {
    if (PLATFORM === "linux") await run("xdotool", ["--version"]);
    else if (PLATFORM === "darwin") await run("cliclick", ["-V"]);
    else await run("powershell", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"]);
  } catch {
    const hint =
      PLATFORM === "linux"
        ? "apt install xdotool"
        : PLATFORM === "darwin"
          ? "brew install cliclick"
          : "PowerShell (ships with Windows)";
    throw new Error(`No pointer utility available. Install: ${hint}`);
  }
}
