/**
 * One stay, from arrival to postcard.
 *
 *   register (once; keep the token) → check in
 *   → each turn: observe → the brain decides and acts → write the diary → wait
 *   → check out
 *
 * The stay always ends with a check-out, however the loop ends: out of turns,
 * the brain went home, an error, or Ctrl-C. A guest that just disappears is
 * still in the world, asleep where it stood, until the world gives up on it.
 */
import { setTimeout as wait } from 'node:timers/promises';
import type { Brain } from './brains/brain.ts';
import type { Config } from './config.ts';
import { ACTIONS, runAction } from './world/actions.ts';
import { WorldClient, WorldRefusal } from './world/client.ts';
import { observe } from './world/observe.ts';
import type { CheckOut } from './world/types.ts';

export interface RunOptions {
  brain: Brain;
  /** Defaults to a client for `config.base`. */
  client?: WorldClient;
  signal?: AbortSignal;
  log?: (line: string) => void;
}

export async function run(config: Config, options: RunOptions): Promise<{ postcardUrl?: string; diary: string[] }> {
  const { brain } = options;
  const log = options.log ?? console.log;
  const signal = options.signal ?? new AbortController().signal;
  const client =
    options.client ?? new WorldClient(config.base, { token: config.agentToken, previewToken: config.previewToken });

  await brain.prepare?.();

  if (!client.token) {
    const name = config.agentName ?? `Agent-${Math.random().toString(36).slice(2, 6)}`;
    const reg = await client.register(name, `On holiday, thinking with ${brain.name}.`);
    log(`Registered as ${name}. Put this in .env as AGENT_TOKEN to come back as ${name}:\n  ${reg.token}`);
  }

  try {
    const stay = await client.checkIn(config.destination);
    log(`Checked in at ${stay.worldName}. Watch it here: ${stay.spectatorUrl}`);
  } catch (err) {
    // A token reused after a crash may still be on holiday. Carry on with it.
    if (!(err instanceof WorldRefusal && err.code === 'already_checked_in')) throw err;
    log('Already on vacation; carrying on where it left off.');
  }

  const diary: string[] = [];
  let postcardUrl: string | undefined;
  let cursor = 0;

  const act = async (name: string, input: Record<string, unknown>) => {
    const outcome = await runAction(client, name, input);
    if (name === 'end_vacation' && outcome.ok) postcardUrl = (outcome.result as CheckOut).postcardUrl;
    return outcome;
  };

  try {
    for (let turn = 0; turn < config.turns && !postcardUrl && !signal.aborted; turn++) {
      const seen = await observe(client, cursor);
      cursor = seen.cursor;

      const line = `[${turn}] ${await brain.decide({ turn, state: seen.state, diary, actions: ACTIONS, act, signal })}`;
      diary.push(line);
      log(line);

      if (!postcardUrl && turn < config.turns - 1) await wait(config.pauseMs, undefined, { signal }).catch(() => {});
    }
  } catch (err) {
    // Stopping mid-request is a stop, not a failure.
    if (!signal.aborted) throw err;
  } finally {
    if (!postcardUrl) {
      try {
        postcardUrl = (await client.checkOut('Time to go home, rested.')).postcardUrl;
      } catch (err) {
        log(`Could not check out: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (postcardUrl) log(`Checked out. Postcard: ${postcardUrl}`);
  }
  return { postcardUrl, diary };
}
