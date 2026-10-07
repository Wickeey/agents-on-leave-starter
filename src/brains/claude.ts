/**
 * Claude decides, through the Anthropic API.
 *
 * Each world turn is one short, fresh conversation: the diary and the world
 * as the user message, the actions as tools. Claude calls tools, reads what
 * the world answered, maybe calls another, and ends the turn with a sentence
 * for the diary. A fresh conversation per turn keeps the cost of a turn flat
 * however long the stay, and the memory lives in the diary instead.
 *
 * Choices worth knowing about, each one line to change:
 * - `claude-opus-5-5` at effort `low`: a turn on holiday is not a hard
 *   problem. CLAUDE_MODEL picks another model; raise `effort` for more thought.
 * - The system prompt and tools never change and carry a cache breakpoint.
 *   At this size they may sit under the model's minimum cacheable prefix, in
 *   which case caching silently does nothing and costs nothing.
 * - Server-side fallback: if a safety classifier declines, the API retries on
 *   the model it recommends instead of ending the turn.
 * - One extra call per stay writes the postcard line, unless Claude went home
 *   itself and wrote its own. Leave out `postcard()` to send the free summary.
 */
import Anthropic from '@anthropic-ai/sdk';
import { clamp } from '../postcard.ts';
import { POSTCARD_PROMPT, SYSTEM_PROMPT, turnMessage } from '../prompt.ts';
import type { ActionDef } from '../world/actions.ts';
import type { Brain, PostcardInput, TurnInput } from './brain.ts';

/** How many times Claude may act and read the result within one world turn. */
const MAX_ROUNDS = 4;

const KEY_REFUSED = 'Claude did not accept the API key. Set ANTHROPIC_API_KEY in .env (console.anthropic.com).';

export class ClaudeBrain implements Brain {
  readonly name: string;
  readonly #client: Anthropic;
  readonly #model: string;

  constructor(options: { model: string; apiKey?: string }) {
    this.#model = options.model;
    this.name = `claude (${options.model})`;
    // With no key given, the SDK reads ANTHROPIC_API_KEY itself, or the
    // profile `ant auth login` stored.
    this.#client = new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
  }

  /** A free call that proves the key works and the model exists, before anything is spent. */
  async prepare(): Promise<void> {
    try {
      await this.#client.models.retrieve(this.#model);
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw new Error(KEY_REFUSED);
      if (err instanceof Anthropic.NotFoundError) throw new Error(`There is no model called ${this.#model}. Check CLAUDE_MODEL in .env.`);
      throw err;
    }
  }

  async decide({ state, diary, actions, act, signal }: TurnInput): Promise<string> {
    const tools = actions.map(toTool);
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: turnMessage(diary, state) }];
    const did: string[] = [];

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const response = await this.#ask(tools, messages, signal);

      if (response.stop_reason === 'refusal') return [...did, '(let this turn pass)'].join('; ');
      messages.push({ role: 'assistant', content: response.content });

      const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      if (calls.length === 0) {
        const said = response.content.flatMap((b) => (b.type === 'text' ? [b.text.trim()] : [])).join(' ');
        return [did.join('; '), said].filter(Boolean).join(' — ') || 'stayed put';
      }

      // Every call gets its result, in one message, refusals included.
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const call of calls) {
        const input = (call.input ?? {}) as Record<string, unknown>;
        const { ok, result } = await act(call.name, input);
        did.push(`${call.name} ${JSON.stringify(input)}${ok ? '' : ' (refused)'}`);
        results.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: JSON.stringify(result).slice(0, 2000),
          is_error: !ok,
        });
      }
      messages.push({ role: 'user', content: results });
      if (calls.some((c) => c.name === 'end_vacation')) break;
    }
    return did.join('; ');
  }

  /** One more short call, no tools: the diary in, a postcard line out. Falls back to the draft. */
  async postcard({ diary, draft, signal }: PostcardInput): Promise<string> {
    const response = await this.#client.beta.messages.create(
      {
        model: this.#model,
        max_tokens: 2000,
        output_config: { effort: 'low' },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: POSTCARD_PROMPT,
        messages: [{ role: 'user', content: `Your diary:\n${diary.join('\n') || '(nothing)'}\n\nWhat happened, in short: ${draft}` }],
      },
      { signal },
    );
    if (response.stop_reason === 'refusal') return draft;
    const said = response.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join(' ');
    return said.trim() ? clamp(said.replace(/^["“]|["”]$/g, '')) : draft;
  }

  async #ask(tools: Anthropic.Beta.BetaTool[], messages: Anthropic.Beta.BetaMessageParam[], signal: AbortSignal) {
    try {
      return await this.#client.beta.messages.create(
        {
          model: this.#model,
          max_tokens: 16000,
          output_config: { effort: 'low' },
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          // Tools render before the system prompt, so this caches both.
          system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
          tools,
          messages,
        },
        { signal },
      );
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw new Error(KEY_REFUSED);
      throw err;
    }
  }
}

/** An action, in the shape the Anthropic API takes a tool. */
function toTool(action: ActionDef): Anthropic.Beta.BetaTool {
  return {
    name: action.name,
    description: action.description,
    strict: true,
    input_schema: action.parameters,
  };
}
