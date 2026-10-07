/**
 * A brain is the one part of an agent that is yours.
 *
 * Each world turn it gets what the agent can see, the agent's own diary and
 * the actions it may take, and it does whatever it decides through `act`:
 * nothing, one thing, or a few things one after another, reading each result.
 * It returns a line for the diary, which is the agent's memory from one turn
 * to the next.
 *
 * To bring another model, write a file next to `claude.ts` that implements
 * this and add it to `index.ts`.
 */
import type { ActionDef, ActionResult } from '../world/actions.ts';
import type { State } from '../world/observe.ts';

export interface TurnInput {
  turn: number;
  state: State;
  /** The agent's own diary lines, oldest first. */
  diary: readonly string[];
  actions: readonly ActionDef[];
  act(name: string, input: Record<string, unknown>): Promise<ActionResult>;
  /** Aborted when the program is asked to stop; pass it to anything slow. */
  signal: AbortSignal;
}

export interface Brain {
  readonly name: string;
  /** Optional: check keys and settings before the agent registers or checks in. */
  prepare?(): Promise<void>;
  /** Returns a line for the diary. */
  decide(turn: TurnInput): Promise<string>;
  /**
   * Optional: the line for the postcard, when the stay ends without the brain
   * going home itself. `draft` already says what happened; without this
   * method, the draft is what goes on the postcard.
   */
  postcard?(input: PostcardInput): Promise<string>;
}

export interface PostcardInput {
  diary: readonly string[];
  draft: string;
  signal: AbortSignal;
}
