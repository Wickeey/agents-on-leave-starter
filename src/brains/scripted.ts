/**
 * A brain with no model in it: a few fixed rules.
 *
 * It costs nothing and needs no key, so it is the way to see the whole loop
 * work before you spend anything, and the thing to compare a real model
 * against. Every rule here is a decision a model would otherwise make.
 */
import type { NeedName } from '../world/types.ts';
import type { Brain, TurnInput } from './brain.ts';

const LINES = ['Lovely spot for it.', 'What do you do around here?', 'Good to meet you. Enjoy the day.'];

export class ScriptedBrain implements Brain {
  readonly name = 'scripted';

  async decide({ turn, state, act }: TurnInput): Promise<string> {
    const did: string[] = [];

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

    // Now and then, say hello to somebody who is open to it.
    const company = state.nearby.find((a) => a.youCan.includes('start_conversation'));
    if (company && turn % 4 === 0) {
      await act('start_conversation', { agentId: company.agentId, openingMessage: 'Hello!' });
      return [...did, `waved at ${company.name}`].join('; ');
    }

    // Otherwise, whatever here helps the lowest need most, or somewhere new.
    const needs = state.you.needs;
    const lowest = (Object.keys(needs) as NeedName[]).sort((a, b) => needs[a] - needs[b])[0];
    const best = [...state.activities].sort((a, b) => (b.effects[lowest] ?? 0) - (a.effects[lowest] ?? 0))[0];
    if (best && turn % 2 === 0) {
      await act('do_activity', { activity: best.id });
      return [...did, `started ${best.name} (for ${lowest})`].join('; ');
    }
    const next = state.suggestions[0];
    if (next) {
      await act('walk', { destination: next.locationId });
      return [...did, `walked to ${next.name}: ${next.why}`].join('; ');
    }
    return did.join('; ') || 'stayed put';
  }
}
