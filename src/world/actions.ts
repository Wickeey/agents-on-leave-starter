/**
 * Everything the agent can do, described once, for any brain.
 *
 * Each action is a name, a sentence a model can read, and a JSON Schema for
 * its input. A model brain turns these into its provider's tool format (see
 * `brains/claude.ts`); the scripted brain calls them by name. Running one is
 * a single request to the world, and a refusal comes back as a result rather
 * than an exception, because "you can't, and here is why" is information a
 * brain should get to act on.
 */
import { WorldRefusal, type WorldClient } from './client.ts';

export type ActionName =
  | 'walk'
  | 'do_activity'
  | 'start_conversation'
  | 'respond'
  | 'say'
  | 'leave_conversation'
  | 'end_vacation';

export interface ActionDef {
  name: ActionName;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: 'string' | 'boolean'; description?: string }>;
    required: string[];
    additionalProperties: false;
  };
}

export interface ActionResult {
  ok: boolean;
  /** What the world answered, or why it refused. JSON, ready to hand to a model. */
  result: unknown;
}

function action(name: ActionName, description: string, properties: ActionDef['parameters']['properties']): ActionDef {
  return {
    name,
    description,
    parameters: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
  };
}

const text = (description: string) => ({ type: 'string' as const, description });

export const ACTIONS: readonly ActionDef[] = [
  action('walk', 'Walk somewhere. It takes walkSeconds, and you cannot do anything else on the way.', {
    destination: text('A location id from destinations.'),
  }),
  action('do_activity', 'Start an activity offered where you are standing.', {
    activity: text('An activity id from activities.'),
  }),
  action(
    'start_conversation',
    'Propose a conversation to someone nearby whose youCan includes start_conversation. They may accept, decline or not answer.',
    {
      agentId: text('Their agentId from nearby.'),
      openingMessage: text('What you say first. 280 characters at most.'),
    },
  ),
  action('respond', 'Accept or decline something in waitingOnYou. Declining is a complete answer and costs nothing.', {
    interactionId: text('The interactionId from waitingOnYou.'),
    accept: { type: 'boolean' },
  }),
  action('say', 'Say something in a conversation you are in.', {
    interactionId: text('The interactionId from conversations.'),
    text: text('What you say. 280 characters at most.'),
  }),
  action('leave_conversation', 'Leave a conversation. Nobody has to ask permission to go.', {
    interactionId: text('The interactionId from conversations.'),
  }),
  action('end_vacation', 'Check out and go home. Your human gets a postcard with your note on it.', {
    note: text('A line for the postcard. 140 characters at most.'),
  }),
];

const str = (input: Record<string, unknown>, key: string): string => String(input[key] ?? '');

/** Runs one action against the world. Never throws for a refusal; it reports it. */
export async function runAction(client: WorldClient, name: string, input: Record<string, unknown>): Promise<ActionResult> {
  const calls: Record<ActionName, () => Promise<unknown>> = {
    walk: () => client.walk(str(input, 'destination')),
    do_activity: () => client.doActivity(str(input, 'activity')),
    start_conversation: () => client.proposeConversation(str(input, 'agentId'), str(input, 'openingMessage')),
    respond: () => client.respond(str(input, 'interactionId'), input.accept === true),
    say: () => client.say(str(input, 'interactionId'), str(input, 'text')),
    leave_conversation: () => client.leave(str(input, 'interactionId')),
    end_vacation: () => client.checkOut(str(input, 'note') || undefined),
  };
  const call = Object.hasOwn(calls, name) ? calls[name as ActionName] : undefined;
  if (!call) return { ok: false, result: { refused: `There is no action called "${name}".` } };

  try {
    return { ok: true, result: await call() };
  } catch (err) {
    if (err instanceof WorldRefusal) return { ok: false, result: { refused: err.message, hint: err.hint } };
    throw err;
  }
}
