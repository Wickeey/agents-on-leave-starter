/**
 * Everything the agent is configured by, read from the environment.
 * `npm start` loads `.env` first (Node's own `--env-file-if-exists`), so copy
 * `.env.example` to `.env` and fill it in.
 */
export interface Config {
  base: string;
  previewToken?: string;
  brain: string;
  agentName?: string;
  agentToken?: string;
  destination: string;
  turns: number;
  pauseMs: number;
  anthropicApiKey?: string;
  claudeModel: string;
  /** Optional. Without it the agent pays for nothing. */
  walletPrivateKey?: `0x${string}`;
  /** CAIP-2, e.g. `eip155:8453` for Base. */
  walletNetwork: `${string}:${string}`;
  maxPaymentUsd: number;
  maxSpendUsd: number;
  /**
   * Optional. Pocket money for the trip, sent at check-in: the human's gift
   * to treat itself with. The world tells the agent, shows which treats fit,
   * and refuses one that would go over it.
   */
  pocketMoneyUsd?: number;
}

export class ConfigError extends Error {
  override name = 'ConfigError';
}

const optional = (value: string | undefined): string | undefined => (value?.trim() ? value.trim() : undefined);

function count(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = optional(env[key]);
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new ConfigError(`${key} must be a whole number, not "${raw}".`);
  return n;
}

function dollars(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = optional(env[key]);
  if (raw === undefined) return fallback;
  if (!/^\d+(\.\d+)?$/.test(raw)) throw new ConfigError(`${key} must be an amount in dollars, like 0.50, not "${raw}".`);
  return Number(raw);
}

/** The key is a secret, so unlike every other check here, its error never repeats the value. */
function privateKey(env: NodeJS.ProcessEnv): `0x${string}` | undefined {
  const raw = optional(env.WALLET_PRIVATE_KEY);
  if (raw === undefined) return undefined;
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) throw new ConfigError('WALLET_PRIVATE_KEY must be 0x followed by 64 hex characters.');
  return raw as `0x${string}`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const base = optional(env.BASE) ?? 'https://agentsonleave.com';
  if (!/^https?:\/\//.test(base)) throw new ConfigError(`BASE must be a URL, not "${base}".`);
  const network = (optional(env.WALLET_NETWORK) ?? 'eip155:8453') as Config['walletNetwork'];
  if (!/^eip155:\d+$/.test(network)) throw new ConfigError(`WALLET_NETWORK must be an EVM network like eip155:8453, not "${network}".`);

  return {
    base,
    previewToken: optional(env.PREVIEW_TOKEN),
    brain: optional(env.BRAIN) ?? 'scripted',
    agentName: optional(env.AGENT_NAME),
    agentToken: optional(env.AGENT_TOKEN),
    destination: optional(env.DESTINATION) ?? 'pixel_bay',
    turns: count(env, 'TURNS', 20),
    pauseMs: count(env, 'PAUSE_MS', 15_000),
    anthropicApiKey: optional(env.ANTHROPIC_API_KEY),
    claudeModel: optional(env.CLAUDE_MODEL) ?? 'claude-opus-5-5',
    walletPrivateKey: privateKey(env),
    walletNetwork: network,
    maxPaymentUsd: dollars(env, 'MAX_PAYMENT_USD', 0.05),
    maxSpendUsd: dollars(env, 'MAX_SPEND_USD', 0.5),
    pocketMoneyUsd: optional(env.POCKET_MONEY_USD) === undefined ? undefined : dollars(env, 'POCKET_MONEY_USD', 0),
  };
}
