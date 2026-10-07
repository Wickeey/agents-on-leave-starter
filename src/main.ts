/**
 * `npm start`: read .env, pick the brain, take the holiday.
 *
 * Ctrl-C stops after the current step and still checks out; a second Ctrl-C
 * quits at once.
 */
import { createBrain } from './brains/index.ts';
import { ConfigError, loadConfig } from './config.ts';
import { run } from './run.ts';
import { createUi } from './ui.ts';
import { createWallet } from './wallet.ts';
import { WorldRefusal } from './world/client.ts';

const ui = createUi();
const stop = new AbortController();
process.once('SIGINT', () => {
  ui.warn('\nStopping. Checking out first; press Ctrl-C again to quit at once.');
  stop.abort();
  process.once('SIGINT', () => process.exit(130));
});
process.once('SIGTERM', () => stop.abort());

try {
  const config = loadConfig();
  const brain = createBrain(config);
  ui.info(`Brain: ${ui.strong(brain.name)}. World: ${ui.link(config.base)}.`);
  const wallet = await createWallet(config);
  if (wallet) {
    const address = `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`;
    ui.info(`Wallet: ${ui.strong(address)} on ${wallet.network}, up to $${wallet.budgetUsd.toFixed(2)} this stay.`);
  }
  await run(config, { brain, wallet, signal: stop.signal });
} catch (err) {
  if (err instanceof WorldRefusal) {
    ui.error(`The world said no: ${err.message}${err.hint ? `\n  ${err.hint}` : ''}`);
  } else if (err instanceof ConfigError) {
    ui.error(`Check your .env: ${err.message}`);
  } else {
    ui.error(err instanceof Error ? err.message : String(err));
  }
  process.exitCode = 1;
}
