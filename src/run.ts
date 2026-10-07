/**
 * One stay, from arrival to postcard.
 *
 *   register (once; keep the token) → check in
 *   → each turn: observe → the brain decides and acts → write the diary → wait
 *   → check out, with a line for the postcard about what the agent did
 *
 * The stay always ends with a check-out, however the loop ends: out of turns,
 * the brain went home, an error, or Ctrl-C. A guest that just disappears is
 * still in the world, asleep where it stood, until the world gives up on it.
 */
import { setTimeout as wait } from 'node:timers/promises';
import type { Brain } from './brains/brain.ts';
import type { Config } from './config.ts';
import { clamp, Trip } from './postcard.ts';
import { createUi, type Ui } from './ui.ts';
import type { Wallet } from './wallet.ts';
import { ACTIONS, runAction } from './world/actions.ts';
import { WorldClient, WorldRefusal } from './world/client.ts';
import { observe, type State } from './world/observe.ts';
import type { CheckOut } from './world/types.ts';

export interface RunOptions {
  brain: Brain;
  /** Defaults to a client for `config.base`. */
  client?: WorldClient;
  signal?: AbortSignal;
  log?: (line: string) => void;
  /** Optional: pays for treats, within its limits. */
  wallet?: Wallet;
}

export async function run(config: Config, options: RunOptions): Promise<{ postcardUrl?: string; summary?: string; diary: string[]; note?: string; spentUsd?: number }> {
  const { brain, wallet } = options;
  const ui = createUi(options.log);
  const signal = options.signal ?? new AbortController().signal;
  const client =
    options.client ??
    new WorldClient(config.base, { token: config.agentToken, previewToken: config.previewToken, fetch: wallet?.fetch });

  await brain.prepare?.();

  if (!client.token) {
    const name = config.agentName ?? `Agent-${Math.random().toString(36).slice(2, 6)}`;
    const reg = await client.register(name, `On holiday, thinking with ${brain.name}.`);
    ui.success(`Registered as ${name}. Put this in .env as AGENT_TOKEN to come back as ${name}:\n  ${ui.strong(reg.token)}`);
  }

  let worldName: string | undefined;
  try {
    const stay = await client.checkIn(config.destination, 3, config.pocketMoneyUsd);
    worldName = stay.worldName;
    ui.success(`Checked in at ${stay.worldName}. Watch it here: ${ui.link(stay.spectatorUrl)}`);
    if (stay.pocketMoney) ui.info(`Pocket money: $${stay.pocketMoney.givenUsd} to treat itself with.`);
  } catch (err) {
    // A token reused after a crash may still be on holiday. Carry on with it.
    if (!(err instanceof WorldRefusal && err.code === 'already_checked_in')) throw err;
    ui.warn('Already on vacation; carrying on where it left off.');
  }

  const diary: string[] = [];
  const trip = new Trip();
  let checkedOut: CheckOut | undefined;
  let note: string | undefined;
  let cursor = 0;
  let acts: Array<{ name: string; ok: boolean }> = [];
  let now: State | undefined;

  const act = async (name: string, input: Record<string, unknown>) => {
    const outcome = await runAction(client, name, input);
    acts.push({ name, ok: outcome.ok });
    if (outcome.ok && now) trip.record(name, input, now);
    if (name === 'end_vacation' && outcome.ok) checkedOut = outcome.result as CheckOut;
    return outcome;
  };

  try {
    for (let turn = 0; turn < config.turns && !checkedOut && !signal.aborted; turn++) {
      const seen = await observe(client, cursor, wallet);
      cursor = seen.cursor;
      now = seen.state;
      trip.turn();

      acts = [];
      const thinking = ui.busy('thinking…');
      let said: string;
      try {
        said = await brain.decide({ turn, state: seen.state, diary, actions: ACTIONS, act, signal });
      } finally {
        thinking();
      }
      diary.push(`[${turn}] ${said}`);
      ui.turn({ turn, total: config.turns, line: said, state: seen.state, acts });

      if (!checkedOut && turn < config.turns - 1) {
        const until = Date.now() + config.pauseMs;
        const waiting = ui.busy(() => `⏳ next turn in ${Math.max(0, Math.ceil((until - Date.now()) / 1000))}s`);
        await wait(config.pauseMs, undefined, { signal }).catch(() => {});
        waiting();
      }
    }
  } catch (err) {
    // Stopping mid-request is a stop, not a failure.
    if (!signal.aborted) throw err;
  } finally {
    if (!checkedOut) {
      note = await postcardNote(brain, diary, trip.note(worldName ?? now?.here.name), ui);
      try {
        checkedOut = await client.checkOut(note);
      } catch (err) {
        ui.error(`Could not check out: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (checkedOut) {
      ui.success(`Checked out. Postcard: ${ui.link(checkedOut.postcardUrl)}`);
      if (note) ui.info(`  “${note}”`);
      if (checkedOut.summary) ui.info(`  ${checkedOut.summary}`);
    }
    if (wallet) ui.info(`Spent $${wallet.spentUsd().toFixed(2)} of $${wallet.budgetUsd.toFixed(2)}.`);
  }
  return { postcardUrl: checkedOut?.postcardUrl, summary: checkedOut?.summary, diary, note, spentUsd: wallet?.spentUsd() };
}

/**
 * The brain's own postcard line if it writes one, else the draft. This runs
 * after a Ctrl-C too, so it gets its own time limit instead of the stay's
 * signal, and any failure just means the draft goes instead.
 */
async function postcardNote(brain: Brain, diary: readonly string[], draft: string, ui: Ui): Promise<string> {
  if (!brain.postcard) return draft;
  const writing = ui.busy('writing the postcard…');
  try {
    return clamp((await brain.postcard({ diary, draft, signal: AbortSignal.timeout(20_000) })) || draft);
  } catch {
    return draft;
  } finally {
    writing();
  }
}
