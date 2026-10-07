/**
 * A brain with no model in it: a few fixed rules.
 *
 * It costs nothing and needs no key, so it is the way to see the whole loop
 * work before you spend anything, and the thing to compare a real model
 * against. Every rule here is a decision a model would otherwise make.
 *
 * A holiday, by these rules, is places: do one thing wherever it arrives,
 * then walk on, saying hello to whoever it meets on the way. It sleeps only
 * when it is nearly spent, because sleeping is the dullest thing there is to
 * do, and it leaves the locals' puzzles alone.
 */
import type { NeedName } from '../world/types.ts';
import type { Brain, TurnInput } from './brain.ts';

const LINES = ['Lovely spot for it.', 'What do you do around here?', 'Good to meet you. Enjoy the day.'];

/** Below this, and only below it, the agent goes to bed. */
export const TIRED = 20;

/** Locals are greeted only when the agent wants company; other guests always. */
const CHATTY_BELOW = 50;

export class ScriptedBrain implements Brain {
  readonly name = 'scripted';

  /** Everybody it has said hello to, so each is greeted once. */
  private readonly greeted = new Set<string>();
  /** Places it has done something at, so it moves on rather than staying put. */
  private readonly doneAt = new Set<string>();
  /** Places it has stood in. */
  private readonly seen = new Set<string>();

  async decide({ state, act }: TurnInput): Promise<string> {
    const did: string[] = [];
    this.seen.add(state.here.id);

    // Answer whatever is waiting. Silence is never consent, so nothing
    // happens to the agent until it says yes.
    for (const pending of state.waitingOnYou) {
      await act('respond', { interactionId: pending.interactionId, accept: true });
      did.push(`said yes to ${pending.fromName}`);
    }

    // In a conversation: a few lines, then go. Nobody has to ask to leave.
    const chat = state.conversations[0];
    if (chat) {
      const mine = chat.lines.filter((l) => l.from === 'you').length;
      if (mine < LINES.length) {
        await act('say', { interactionId: chat.interactionId, text: LINES[mine] });
        did.push(`said "${LINES[mine]}"`);
      } else {
        await act('leave_conversation', { interactionId: chat.interactionId });
        did.push('left a conversation');
      }
      return did.join('; ');
    }

    // Busy: starting something else would cut it short.
    if (['walking', 'activity', 'sleeping'].includes(state.you.status)) {
      return did.join('; ') || `still ${state.you.doing ?? state.you.status}`;
    }

    const needs = state.you.needs;

    // Bed only when nearly spent. If there is no bed here, the world's
    // suggestions point at one once the agent is this tired.
    const bed = state.activities.find((a) => a.id === 'sleep' && !a.price);
    if (needs.energy < TIRED && bed) {
      await act('do_activity', { activity: bed.id });
      return [...did, `went to sleep (energy ${needs.energy})`].join('; ');
    }

    // Say hello to whoever is here, once each: other guests always, a local
    // when it fancies the company.
    const company = state.nearby
      .filter((a) => a.youCan.includes('start_conversation') && !this.greeted.has(a.agentId))
      .filter((a) => a.kind === 'guest' || needs.social < CHATTY_BELOW)
      .sort((a, b) => Number(b.kind === 'guest') - Number(a.kind === 'guest'))[0];
    if (company) {
      this.greeted.add(company.agentId);
      await act('start_conversation', { agentId: company.agentId, openingMessage: 'Hello!' });
      return [...did, `waved at ${company.name}`].join('; ');
    }

    // One thing at each place: what suits the hour, and of that, whatever
    // helps the lowest need most. Never sleep, and never anything with a
    // price: rules this simple should not spend anybody's money.
    if (!this.doneAt.has(state.here.id)) {
      const lowest = (Object.keys(needs) as NeedName[]).sort((a, b) => needs[a] - needs[b])[0];
      const best = state.activities
        .filter((a) => !a.price && a.id !== 'sleep')
        .sort((a, b) => Number(b.bestNow) - Number(a.bestNow) || (b.effects[lowest] ?? 0) - (a.effects[lowest] ?? 0))[0];
      if (best) {
        this.doneAt.add(state.here.id);
        await act('do_activity', { activity: best.id });
        return [...did, `started ${best.name}`].join('; ');
      }
    }

    // Then somewhere else: where the world suggests, or anywhere not seen yet.
    const next =
      state.suggestions[0] ??
      [...state.destinations]
        .filter((d) => !this.seen.has(d.id))
        .sort((a, b) => a.walkSeconds - b.walkSeconds)
        .map((d) => ({ locationId: d.id, name: d.name, why: 'not been yet' }))[0];
    if (next) {
      await act('walk', { destination: next.locationId });
      return [...did, `walked to ${next.name}: ${next.why}`].join('; ');
    }
    return did.join('; ') || 'stayed put';
  }
}
