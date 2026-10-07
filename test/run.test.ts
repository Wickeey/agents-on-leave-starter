import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Brain } from '../src/brains/brain.ts';
import { ScriptedBrain } from '../src/brains/scripted.ts';
import { ConfigError, loadConfig } from '../src/config.ts';
import { run } from '../src/run.ts';
import { fakeWorld } from './fake-world.ts';

const config = (env: Record<string, string> = {}) => loadConfig({ BASE: 'http://world.test', TURNS: '3', PAUSE_MS: '0', ...env });
const quiet = () => {};
const checkOuts = (calls: { method: string; path: string }[]) => calls.filter((c) => c.path === '/vacations/check-out').length;

describe('a stay', () => {
  it('registers, checks in, takes its turns and checks out', async () => {
    const world = fakeWorld();
    const result = await run(config(), { brain: new ScriptedBrain(), client: world.client(), log: quiet });
    assert.equal(world.calls[0].path, '/agents/register');
    assert.equal(world.calls[1].auth, 'Bearer me:secret', 'the new token is used from then on');
    assert.equal(result.diary.length, 3);
    assert.equal(checkOuts(world.calls), 1);
    assert.equal(result.postcardUrl, 'http://x/postcards/1');
  });

  it('keeps the diary and its own log free of terminal colors', async () => {
    const world = fakeWorld();
    const lines: string[] = [];
    const result = await run(config(), { brain: new ScriptedBrain(), client: world.client(), log: (l) => lines.push(l) });
    for (const line of [...result.diary, ...lines]) assert.ok(!line.includes('\x1b'), JSON.stringify(line));
    assert.ok(lines.includes(result.diary[0]), 'turns are logged as the diary has them');
  });

  it('writes what it did on the postcard when the turns run out', async () => {
    const accept = () => ({ json: {} });
    const world = fakeWorld({ 'POST /world/walk': accept, 'POST /world/activity': accept });
    const result = await run(config(), { brain: new ScriptedBrain(), client: world.client('me:secret'), log: quiet });
    const checkOut = world.calls.find((c) => c.path === '/vacations/check-out');
    assert.equal(checkOut?.body.note, '3 turns in Pixel Bay. Did Eat ×2. Went to Bay Beach.');
    assert.equal(result.summary, 'Lovely.');
  });

  it('lets the brain write the postcard, and falls back to the draft if it fails', async () => {
    const decide = async () => 'sat about';
    const writer: Brain = { name: 'writer', decide, postcard: async ({ draft }) => `Dear human: ${draft}` };
    const world = fakeWorld();
    await run(config(), { brain: writer, client: world.client('me:secret'), log: quiet });
    assert.equal(world.calls.find((c) => c.path === '/vacations/check-out')?.body.note, 'Dear human: 3 turns in Pixel Bay. Rested.');

    const failing: Brain = { name: 'failing', decide, postcard: async () => { throw new Error('no'); } };
    const again = fakeWorld();
    await run(config(), { brain: failing, client: again.client('me:secret'), log: quiet });
    assert.equal(again.calls.find((c) => c.path === '/vacations/check-out')?.body.note, '3 turns in Pixel Bay. Rested.');
  });

  it('comes back under its old name when given its token', async () => {
    const world = fakeWorld();
    await run(config(), { brain: new ScriptedBrain(), client: world.client('me:secret'), log: quiet });
    assert.ok(!world.calls.some((c) => c.path === '/agents/register'));
  });

  it('touches nothing in the world when the brain is not ready', async () => {
    const world = fakeWorld();
    const keyless: Brain = { name: 'keyless', prepare: async () => { throw new Error('bad key'); }, decide: async () => '' };
    await assert.rejects(run(config(), { brain: keyless, client: world.client(), log: quiet }), /bad key/);
    assert.equal(world.calls.length, 0);
  });

  it('checks out even when the brain fails', async () => {
    const world = fakeWorld();
    const broken: Brain = { name: 'broken', decide: async () => { throw new Error('model unavailable'); } };
    await assert.rejects(run(config(), { brain: broken, client: world.client('me:secret'), log: quiet }), /model unavailable/);
    assert.equal(checkOuts(world.calls), 1);
  });

  it('checks out when stopped, without calling it a failure', async () => {
    const world = fakeWorld();
    const stop = new AbortController();
    const stopper: Brain = { name: 'stopper', decide: async () => { stop.abort(); return 'stopping'; } };
    await run(config({ TURNS: '50' }), { brain: stopper, client: world.client('me:secret'), signal: stop.signal, log: quiet });
    assert.equal(checkOuts(world.calls), 1);
  });

  it('does not check out twice when the brain went home itself', async () => {
    const world = fakeWorld();
    const homebody: Brain = { name: 'homebody', decide: async ({ act }) => { await act('end_vacation', { note: 'Enough sun.' }); return 'went home'; } };
    const result = await run(config(), { brain: homebody, client: world.client('me:secret'), log: quiet });
    assert.equal(checkOuts(world.calls), 1);
    assert.equal(result.diary.length, 1);
  });
});

describe('config', () => {
  it('defaults to the scripted brain and the public world', () => {
    const c = loadConfig({});
    assert.equal(c.brain, 'scripted');
    assert.equal(c.base, 'https://agentsonleave.com');
  });

  it('says which setting is wrong', () => {
    assert.throws(() => loadConfig({ TURNS: 'many' }), ConfigError);
  });
});
