#!/usr/bin/env node
/**
 * Repo self-check: the things that rot quietly.
 *
 * A skill is prose that points at files and documents flags. Both drift — a
 * reference gets renamed, a flag gets removed — and nothing fails until an
 * agent follows the instruction mid-shoot.
 */
import { existsSync, readFileSync, readdirSync, lstatSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skillDir = path.join(root, "skills", "cameraman");
const failures = [];

// 1. Every markdown link inside the skill resolves.
for (const file of [
  path.join(skillDir, "SKILL.md"),
  ...readdirSync(path.join(skillDir, "references")).map((f) =>
    path.join(skillDir, "references", f),
  ),
]) {
  const text = readFileSync(file, "utf8");
  for (const [, target] of text.matchAll(/\]\((?!https?:)([^)#]+)(?:#[^)]*)?\)/g)) {
    const resolved = path.resolve(path.dirname(file), target);
    if (!existsSync(resolved)) {
      failures.push(`${path.relative(root, file)} links to missing ${target}`);
    }
  }
}

// 2. Every flag the skill documents exists in the CLI.
const skill = readFileSync(path.join(skillDir, "SKILL.md"), "utf8");
const cli = readFileSync(path.join(skillDir, "engine", "cli.ts"), "utf8");
// Only rows the table marks as engine-handled. Agent-level options change what
// the agent writes, not how the CLI is called, so they have no flag to match.
const documented = new Set();
for (const line of skill.split("\n")) {
  if (!line.includes("| engine |")) continue;
  for (const [, flag] of line.matchAll(/`--([a-z-]+)`/g)) documented.add(flag);
}
for (const flag of documented) {
  if (!cli.includes(`"${flag}"`)) {
    failures.push(`SKILL.md documents --${flag}, which the CLI does not parse`);
  }
}

// 3. The agent discovery symlinks still point at the skill.
for (const dir of [".claude", ".agents", ".opencode"]) {
  const link = path.join(root, dir, "skills", "cameraman");
  if (!existsSync(link)) {
    failures.push(`${dir}/skills/cameraman is missing`);
  } else if (!lstatSync(link).isSymbolicLink()) {
    failures.push(`${dir}/skills/cameraman is not a symlink (EOL normalization?)`);
  }
}

// 4. The plugin manifest name matches the skill directory.
const plugin = JSON.parse(readFileSync(path.join(root, ".claude-plugin", "plugin.json"), "utf8"));
if (plugin.name !== "cameraman") {
  failures.push(`plugin.json names "${plugin.name}", the skill directory is "cameraman"`);
}

if (failures.length) {
  console.error("check-skill failed:\n" + failures.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
console.log("check-skill: links, flags, symlinks and manifest all consistent.");
