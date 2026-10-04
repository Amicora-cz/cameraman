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

/**
 * Plain `SetForegroundWindow` from an unrelated background process almost
 * always fails silently on Windows — it is deliberately restricted since
 * Windows 2000 to stop apps popping themselves to the front uninvited. The
 * standard workaround is `AttachThreadInput`: borrow the current foreground
 * thread's input state for the duration of the call, which grants the
 * permission that a plain call is refused. Found the hard way — the plain
 * call returned no error and did nothing, an unrelated fullscreen app stayed
 * in front, and the click landed on it instead of the recording target.
 */
const WIN_FOCUS_HELPER = `
Add-Type -Name F -Namespace G -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
[DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
[DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
[DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
'@
function Set-RealForeground([IntPtr]$target) {
  $dummy = [uint32]0
  $fg = [G.F]::GetForegroundWindow()
  $fgThread = [G.F]::GetWindowThreadProcessId($fg, [ref]$dummy)
  $targetThread = [G.F]::GetWindowThreadProcessId($target, [ref]$dummy)
  $curThread = [G.F]::GetCurrentThreadId()
  [G.F]::AttachThreadInput($curThread, $fgThread, $true) | Out-Null
  [G.F]::AttachThreadInput($targetThread, $fgThread, $true) | Out-Null
  [G.F]::ShowWindow($target, 9) | Out-Null
  [G.F]::BringWindowToTop($target) | Out-Null
  [G.F]::SetForegroundWindow($target) | Out-Null
  [G.F]::AttachThreadInput($curThread, $fgThread, $false) | Out-Null
  [G.F]::AttachThreadInput($targetThread, $fgThread, $false) | Out-Null
}
`;

/**
 * Raise the OS window whose title contains `titleIncludes` — best-effort,
 * never throws.
 *
 * Why this exists: a page-level `bringToFront()` (CDP `Page.bringToFront`)
 * only asks Chromium to activate its own tab/window; it does not fight
 * Windows' focus-stealing prevention, and it does nothing at all for an
 * unrelated app that happens to be foreground (a fullscreen game, an
 * overlay, whatever the operator alt-tabbed to). The real OS cursor clicks
 * whatever is actually on top at that screen position regardless — silently:
 * the move and the click both "succeed", they just land on the wrong window.
 * Passed via env var, not string-interpolated into the command, so a title
 * containing quotes cannot break out of the PowerShell one-liner.
 */
export async function focusWindow(titleIncludes: string): Promise<void> {
  if (!titleIncludes) return;
  const env = { ...process.env, CAMERAMAN_FOCUS_TITLE: titleIncludes };
  try {
    if (PLATFORM === "linux") {
      await run("xdotool", ["search", "--name", titleIncludes, "windowactivate", "--sync"]);
    } else if (PLATFORM === "darwin") {
      await run(
        "osascript",
        [
          "-e",
          'tell application "System Events" to tell (first process whose name contains ' +
            '(system attribute "CAMERAMAN_FOCUS_TITLE")) to set frontmost to true',
        ],
        { env },
      );
    } else {
      await run(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `${WIN_FOCUS_HELPER}; $t = $env:CAMERAMAN_FOCUS_TITLE; ` +
            `$p = Get-Process | Where-Object { $_.MainWindowTitle -like "*$t*" } | Select-Object -First 1; ` +
            `if ($p) { Set-RealForeground($p.MainWindowHandle) }`,
        ],
        { env },
      );
    }
  } catch {
    // Best-effort: no window-focus tool, or no window matched yet (still
    // loading). Not fatal — the click below still has a chance if the
    // window happened to already be frontmost.
  }
}

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
