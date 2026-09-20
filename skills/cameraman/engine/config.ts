/**
 * Configuration for the recording engine.
 *
 * Read from `.env.cameraman` in the working directory (gitignored; template in
 * `.env.cameraman.example`). It deliberately does NOT read `.env` or
 * `.env.local`: recording a screencast has no business holding a project's
 * service-role key or payment credentials, and the way to guarantee that is to
 * never load the file they live in.
 *
 * The file is parsed here rather than with `dotenv`, so that an install which
 * never ran `npm install` — a `~/.claude/skills/` copy, a bare clone — can
 * still run `list`, `voice` and `assemble`. (`/plugin install` does run it.)
 */
import path from "node:path";
import fs from "node:fs";

const ROOT = path.resolve(__dirname, "..");
const ENV_FILE = path.join(process.cwd(), ".env.cameraman");

/** KEY=VALUE per line. `#` comments, optional `export`, optional quotes. */
function loadEnvFile(file: string): void {
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).replace(/^export\s+/, "").trim();
    if (!key) continue;
    let value = line.slice(eq + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote) && value.length > 1) {
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, "\n");
    } else {
      // An unquoted value ends at the first ` #`.
      const hash = value.indexOf(" #");
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    // `override: true` — the file is the authority over an inherited env.
    process.env[key] = value;
  }
}

if (fs.existsSync(ENV_FILE)) {
  loadEnvFile(ENV_FILE);
}

function req(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is missing. Copy .env.cameraman.example to .env.cameraman and fill it in.`,
    );
  }
  return value;
}

function opt(name: string, fallback: string): string {
  return process.env[name] || fallback;
}

export const config = {
  root: ROOT,
  outDir: path.join(process.cwd(), "cameraman-output"),

  /** The app being filmed. Scenarios refuse localhost for review videos. */
  baseUrl: opt("RECORD_BASE_URL", "https://nalekci.cz"),

  /** CDP endpoint of the Chrome a human started (see the skill, Step 0). */
  cdpUrl: opt("RECORD_CDP_URL", "http://127.0.0.1:9222"),

  obs: {
    url: opt("OBS_WS_URL", "ws://127.0.0.1:4455"),
    password: process.env.OBS_WS_PASSWORD || "",
  },

  elevenLabs: {
    apiKey: process.env.ELEVENLABS_API_KEY || "",
    voiceId: opt("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM"),
    /**
     * `eleven_v3` is the default, for the inline tags (`[breathes]`, …) and the
     * phrasing — without them the voice does not breathe and the read comes out
     * flat. The older `eleven_multilingual_v2` is faster and cheaper; switch via
     * ELEVENLABS_MODEL_ID.
     */
    modelId: opt("ELEVENLABS_MODEL_ID", "eleven_v3"),
  },

  /**
   * Multiplier from CSS pixels to screen pixels. Empty = take
   * `devicePixelRatio` from the browser. Override by hand on HiDPI displays
   * where clicks land off target.
   */
  pointerScale: process.env.RECORD_POINTER_SCALE
    ? Number(process.env.RECORD_POINTER_SCALE)
    : null,

  /** Cursor travel time between two points (ms). Slower reads better on camera. */
  pointerMoveMs: Number(opt("RECORD_POINTER_MOVE_MS", "700")),

  requireProductionUrl: opt("RECORD_ALLOW_LOCALHOST", "0") !== "1",
} as const;

export function assertProductionTarget(): void {
  if (!config.requireProductionUrl) return;
  if (/localhost|127\.0\.0\.1|\.vercel\.app|ngrok|trycloudflare/i.test(config.baseUrl)) {
    throw new Error(
      `RECORD_BASE_URL='${config.baseUrl}' — reviewers reject videos recorded on ` +
        "localhost, preview and tunnel domains. Film production on a verified " +
        "domain. If you are only smoke-testing, set RECORD_ALLOW_LOCALHOST=1.",
    );
  }
}

export function takeDir(stamp: string): string {
  return path.join(config.outDir, `take-${stamp}`);
}

export function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}
