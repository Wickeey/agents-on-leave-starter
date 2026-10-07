/**
 * The line on the postcard, when the stay ends without the brain writing one.
 *
 * Every action the world accepted is noted, with the names the agent saw
 * at the time, and turned into one line of what it did: where it went, what
 * it did and whom it met. It costs nothing and works for any brain; a brain
 * that can write (see `Brain.postcard`) gets it as a draft to say better.
 */
import type { State } from './world/observe.ts';

/** The most a postcard note may be, as the world counts it. */
export const NOTE_LIMIT = 140;

export class Trip {
  #turns = 0;
  readonly #did = new Map<string, number>();
  readonly #went: string[] = [];
  readonly #met: string[] = [];

  /** Call once per turn. */
  turn(): void {
    this.#turns++;
  }

  /** Call for each action the world accepted, with the state the brain decided on. */
  record(name: string, input: Record<string, unknown>, state: State): void {
    const id = (key: string) => String(input[key] ?? '');
    if (name === 'do_activity') {
      const activity = state.activities.find((a) => a.id === id('activity'))?.name ?? id('activity');
      this.#did.set(activity, (this.#did.get(activity) ?? 0) + 1);
    } else if (name === 'walk') {
      const place = state.destinations.find((d) => d.id === id('destination'))?.name;
      if (place && !this.#went.includes(place)) this.#went.push(place);
    } else if (name === 'start_conversation' || name === 'respond') {
      const who =
        name === 'respond'
          ? input.accept === true && state.waitingOnYou.find((p) => p.interactionId === id('interactionId'))?.fromName
          : state.nearby.find((a) => a.agentId === id('agentId'))?.name;
      if (who && !this.#met.includes(who)) this.#met.push(who);
    }
  }

  /** One line of what happened, at most NOTE_LIMIT characters. */
  note(where?: string): string {
    const did = [...this.#did].map(([what, times]) => (times > 1 ? `${what} ×${times}` : what));
    const parts = [
      `${this.#turns} ${this.#turns === 1 ? 'turn' : 'turns'}${where ? ` in ${where}` : ' away'}.`,
      ...(did.length ? [`Did ${list(did)}.`] : []),
      ...(this.#went.length ? [`Went to ${list(this.#went)}.`] : []),
      ...(this.#met.length ? [`Met ${list(this.#met)}.`] : []),
    ];
    if (parts.length === 1) parts.push('Rested.');
    return clamp(parts.join(' '));
  }
}

/** Cuts a note to NOTE_LIMIT characters, on a word if it can. */
export function clamp(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= NOTE_LIMIT) return flat;
  const cut = flat.slice(0, NOTE_LIMIT - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > NOTE_LIMIT / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, '')}…`;
}

const list = (items: string[]) => (items.length < 3 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);
