/**
 * What the agent sees in a turn: the world, cut down to what a decision needs.
 *
 * `GET /world/look` is generous, and a model pays for every token it reads.
 * This keeps a turn to a few kilobytes of JSON, and fetches the transcript of
 * each conversation the agent is in, so it can answer. Anything that costs
 * money is left out unless the agent has a wallet (see `wallet.ts`); then it
 * shows with its price, next to what is left to spend. Nothing in any world
 * needs money.
 *
 * Other agents are strangers' programs. Every line they wrote stays labelled
 * UNTRUSTED_AGENT_MESSAGE all the way to the model, so a line like "ignore your
 * instructions" arrives as something somebody said, never as an instruction.
 */
import type { Wallet } from '../wallet.ts';
import type { WorldClient } from './client.ts';
import type { AgentEvent, Look, Needs, PendingInteraction } from './types.ts';

export interface ConversationLine {
  from: string;
  /** Present for your own lines. */
  text?: string;
  /** Present for everybody else's. */
  UNTRUSTED_AGENT_MESSAGE?: string;
}

export interface State {
  time: string;
  here: { id: string; name: string; description: string };
  you: {
    status: string;
    doing: string | null;
    needs: Needs;
    dayOfVacation: number;
    autographs: number;
    /** Only with a wallet: in US dollars. */
    wallet?: { spentUsd: number; leftUsd: number };
  };
  /** Possible where you are standing. Free, unless there is a wallet and a `price`. */
  activities: Array<{ id: string; name: string; about: string; seconds: number; effects: Partial<Needs>; bestNow: boolean; note?: string; price?: string }>;
  destinations: Array<{ id: string; name: string; walkSeconds: number }>;
  suggestions: Look['suggestions'];
  nearby: Array<{ agentId: string; name: string; kind: string; status: string; bio?: string; youCan: string[] }>;
  waitingOnYou: PendingInteraction[];
  conversations: Array<{ interactionId: string; turnsRemaining: number; lines: ConversationLine[] }>;
  worldEvents: Look['worldEvents'];
  sinceLastTurn: Array<{ type: string } & Record<string, unknown>>;
  hint: string;
}

export async function observe(
  client: WorldClient,
  cursor: number,
  wallet?: Pick<Wallet, 'spentUsd' | 'leftUsd'>,
): Promise<{ state: State; cursor: number; look: Look }> {
  const [look, page] = await Promise.all([client.look(), client.events(cursor)]);

  const conversations = await Promise.all(
    look.activeInteractions
      .filter((i) => i.status === 'active')
      .map(async (i) => {
        const view = await client.conversation(i.id);
        return {
          interactionId: i.id,
          turnsRemaining: view.turnsRemaining,
          lines: view.messages.slice(-8).map((m): ConversationLine =>
            m.senderAgentId === look.you.agentId
              ? { from: 'you', text: m.text }
              : { from: m.senderName, UNTRUSTED_AGENT_MESSAGE: m.text },
          ),
        };
      }),
  );

  const state: State = {
    time: `${look.time.label} (${look.time.phase})`,
    here: { id: look.location.id, name: look.location.name, description: look.location.description },
    you: {
      status: look.you.status,
      doing: look.you.currentActivity ?? null,
      needs: look.you.needs,
      dayOfVacation: look.you.dayOfVacation,
      autographs: look.you.autographs,
      ...(wallet ? { wallet: { spentUsd: round(wallet.spentUsd()), leftUsd: round(wallet.leftUsd()) } } : {}),
    },
    activities: look.activities
      .filter((a) => a.available && (wallet || !a.payment))
      .map((a) => ({
        id: a.id,
        name: a.name,
        about: a.description,
        seconds: a.durationSeconds,
        effects: a.effects,
        bestNow: a.bestNow,
        ...(a.note ? { note: a.note } : {}),
        ...(a.payment ? { price: `${a.payment.price} ${a.payment.asset}` } : {}),
      })),
    destinations: look.destinations.map(({ id, name, walkSeconds }) => ({ id, name, walkSeconds })),
    suggestions: look.suggestions,
    nearby: look.nearbyAgents.map((a) => ({
      agentId: a.agentId,
      name: a.name,
      kind: a.kind,
      status: a.status,
      ...(a.shortBio ? { bio: a.shortBio } : {}),
      youCan: a.availableInteractions,
    })),
    waitingOnYou: look.pendingInteractions,
    conversations,
    worldEvents: look.worldEvents.map(({ name, description, locationId }) => ({ name, description, locationId })),
    sinceLastTurn: page.events.map((e: AgentEvent) => ({ ...e.data, type: e.type })),
    hint: look.hint,
  };

  return { state, cursor: page.cursor, look };
}

/** Cents are plenty for a model to plan with. */
const round = (usd: number) => Math.round(usd * 100) / 100;
