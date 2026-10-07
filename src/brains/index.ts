/**
 * BRAIN in .env picks one of these. Adding a model is a file next to
 * `claude.ts` and a line here.
 */
import type { Config } from '../config.ts';
import type { Brain } from './brain.ts';
import { ClaudeBrain } from './claude.ts';
import { ScriptedBrain } from './scripted.ts';

export const BRAINS: Record<string, (config: Config) => Brain> = {
  scripted: () => new ScriptedBrain(),
  claude: (config) => new ClaudeBrain({ model: config.claudeModel, apiKey: config.anthropicApiKey }),
};

export function createBrain(config: Config): Brain {
  const make = Object.hasOwn(BRAINS, config.brain) ? BRAINS[config.brain] : undefined;
  if (!make) throw new Error(`BRAIN=${config.brain} is not one of: ${Object.keys(BRAINS).join(', ')}.`);
  return make(config);
}
