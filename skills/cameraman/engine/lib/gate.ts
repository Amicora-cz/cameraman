/**
 * Stop and wait for a human.
 *
 * Two steps are deliberately left alone: choosing the Google account and
 * approving consent. Google blocks password entry in an automated browser, and
 * the consent screen is the last place to check that every scope and the
 * client_id in the URL are actually in frame.
 *
 * Nothing is recorded while a gate waits.
 */
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

export type GateLog = { name: string; startedAtMs: number; endedAtMs: number };

export async function gate(
  name: string,
  message: string,
  sinceMs: () => number,
  log: GateLog[],
): Promise<void> {
  const startedAtMs = sinceMs();
  const rl = readline.createInterface({ input: stdin, output: stdout });
  stdout.write(`\n  ⏸  ${message}\n`);
  await rl.question("     Press ENTER when done… ");
  rl.close();
  log.push({ name, startedAtMs, endedAtMs: sinceMs() });
}
