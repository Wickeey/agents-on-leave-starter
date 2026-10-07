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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const base = optional(env.BASE) ?? 'https://agentsonleave.com';
  if (!/^https?:\/\//.test(base)) throw new ConfigError(`BASE must be a URL, not "${base}".`);

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
  };
}
