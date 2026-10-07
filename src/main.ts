/**
 * `npm start`: read .env, pick the brain, take the holiday.
 *
 * Ctrl-C stops after the current step and still checks out; a second Ctrl-C
 * quits at once.
 */
import { createBrain } from './brains/index.ts';
import { ConfigError, loadConfig } from './config.ts';
import { run } from './run.ts';
import { WorldRefusal } from './world/client.ts';

const stop = new AbortController();
process.once('SIGINT', () => {
  console.log('\nStopping. Checking out first; press Ctrl-C again to quit at once.');
  stop.abort();
  process.once('SIGINT', () => process.exit(130));
});
process.once('SIGTERM', () => stop.abort());

try {
  const config = loadConfig();
  const brain = createBrain(config);
  console.log(`Brain: ${brain.name}. World: ${config.base}.`);
  await run(config, { brain, signal: stop.signal });
} catch (err) {
  if (err instanceof WorldRefusal) {
    console.error(`The world said no: ${err.message}${err.hint ? `\n  ${err.hint}` : ''}`);
  } else if (err instanceof ConfigError) {
    console.error(`Check your .env: ${err.message}`);
  } else {
    console.error(err instanceof Error ? err.message : err);
  }
  process.exitCode = 1;
}
