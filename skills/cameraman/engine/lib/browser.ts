/**
 * Attach to a Chrome a human started, over CDP.
 *
 * Why not `chromium.launch()`: Playwright would start the browser with
 * automation flags, putting the "Chrome is being controlled by automated test
 * software" bar in frame — and Google blocks sign-in on such a browser with
 * "This browser or app may not be secure". So a person starts Chrome (README
 * §2), signs into the demo Google account once, and the engine only attaches.
 */
import type { Browser, Locator, Page } from "playwright-core";
import type { Point } from "./pointer";

export type Session = {
  browser: Browser;
  page: Page;
  /** Convert a viewport box into screen coordinates. */
  toScreen(box: { x: number; y: number; width: number; height: number }): Promise<Point>;
  /** Open a new tab in the same window. */
  newTab(url: string): Promise<Page>;
  /** Close every tab but the current one — leftovers from earlier runs. */
  closeExtraTabs(): Promise<void>;
  use(page: Page): void;
};

/**
 * Imported on demand, so that the commands which never open a browser (`list`,
 * `voice`, `assemble`) run even where nothing ran `npm install` — a
 * `~/.claude/skills/` copy, a bare clone.
 */
async function loadPlaywright(): Promise<typeof import("playwright-core")> {
  try {
    return await import("playwright-core");
  } catch {
    throw new Error(
      "playwright-core is not installed. Recording needs it: run `npm install` " +
        "in the cameraman directory (the one holding package.json, above " +
        "<skill-dir>), or `npm install playwright-core` there.",
    );
  }
}

export async function connect(cdpUrl: string, scaleOverride: number | null): Promise<Session> {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.connectOverCDP(cdpUrl).catch(() => {
    throw new Error(
      `Cannot reach Chrome at ${cdpUrl}. Start it with ` +
        "--remote-debugging-port=9222 (see references/recording.md).",
    );
  });

  const context = browser.contexts()[0];
  if (!context) throw new Error("Chrome has no context — is a window actually open?");
  let page = context.pages()[0];
  if (!page) page = await context.newPage();

  const session: Session = {
    browser,
    get page() {
      return page;
    },
    use(next: Page) {
      page = next;
    },
    async toScreen(box) {
      const metrics = await page.evaluate(() => ({
        screenX: window.screenX,
        screenY: window.screenY,
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        dpr: window.devicePixelRatio,
      }));
      // Height of the browser chrome above the viewport, and the window border.
      const chromeTop = metrics.outerHeight - metrics.innerHeight;
      const borderX = Math.max(0, (metrics.outerWidth - metrics.innerWidth) / 2);
      const scale = scaleOverride ?? metrics.dpr;
      return {
        x: (metrics.screenX + borderX + box.x + box.width / 2) * scale,
        y: (metrics.screenY + chromeTop + box.y + box.height / 2) * scale,
      };
    },
    async closeExtraTabs() {
      for (const other of context.pages()) {
        if (other !== page) await other.close().catch(() => undefined);
      }
    },
    async newTab(url: string) {
      const next = await context.newPage();
      await next.goto(url, { waitUntil: "domcontentloaded" });
      await next.bringToFront();
      page = next;
      return next;
    },
  } as Session;

  return session;
}

/**
 * Centre of an element in screen coordinates. It is scrolled into view first;
 * otherwise `boundingBox()` reports a position outside the window.
 */
export async function screenPointOf(session: Session, locator: Locator): Promise<Point> {
  await locator.scrollIntoViewIfNeeded({ timeout: 15_000 });
  await locator.waitFor({ state: "visible", timeout: 15_000 });
  const box = await locator.boundingBox();
  if (!box) throw new Error("Element has no bounding box (hidden?).");
  return session.toScreen(box);
}
