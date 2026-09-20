import fs from "node:fs";
import path from "node:path";
import type { Scenario } from "./types";
import { demoScenario } from "./demo";

/**
 * Scenarios belonging to the project being filmed.
 *
 * They live in that project, not in the plugin: they describe one app's
 * selectors, language and flows, and should be reviewed in its pull requests.
 * The plugin ships only the demo used to verify the chain end to end.
 */
const PROJECT_SCENARIO_DIR = process.env.CAMERAMAN_SCENARIOS
  ? path.resolve(process.env.CAMERAMAN_SCENARIOS)
  : path.join(process.cwd(), "cameraman-scenarios");

function loadProjectScenarios(): Scenario[] {
  if (!fs.existsSync(PROJECT_SCENARIO_DIR)) return [];
  const found: Scenario[] = [];
  for (const entry of fs.readdirSync(PROJECT_SCENARIO_DIR)) {
    if (!/\.(ts|mts|js|mjs)$/.test(entry) || entry.startsWith(".")) continue;
    // tsx handles the TypeScript; require keeps loading synchronous so the
    // registry is complete before the CLI reads it.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(path.join(PROJECT_SCENARIO_DIR, entry)) as Record<string, unknown>;
    for (const value of Object.values(mod)) {
      if (value && typeof value === "object" && "id" in value && "shots" in value) {
        found.push(value as Scenario);
      }
    }
  }
  return found;
}

const registry: Scenario[] = [demoScenario, ...loadProjectScenarios()];

export function getScenario(id: string): Scenario {
  const found = registry.find((s) => s.id === id);
  if (!found) {
    throw new Error(
      `Unknown scenario '${id}'. Available: ${registry.map((s) => s.id).join(", ")}. ` +
        `Project scenarios are read from ${PROJECT_SCENARIO_DIR} (override with CAMERAMAN_SCENARIOS).`,
    );
  }
  return found;
}

export function listScenarios(): Scenario[] {
  return registry;
}

export * from "./types";
