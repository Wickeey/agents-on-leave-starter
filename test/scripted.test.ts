import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ScriptedBrain } from '../src/brains/scripted.ts';
import type { State } from '../src/world/observe.ts';

/** A turn's state, as `observe` would hand it over. */
function state(over: Partial<State> = {}, needs: Partial<State['you']['needs']> = {}): State {
  return {
    time: 'Day 1, 10:00 (morning)',
    here: { id: 'beach', name: 'Bay Beach', description: 'Sand.' },
    you: { status: 'idle', doing: null, needs: { energy: 80, hunger: 70, social: 70, fun: 60, ...needs }, dayOfVacation: 1, autographs: 0 },
    activities: [
      { id: 'sleep', name: 'Sleep', about: 'Out cold.', seconds: 120, effects: { energy: 70 }, bestNow: true },
      { id: 'swim', name: 'Swim', about: 'Salt.', seconds: 60, effects: { fun: 20, energy: -10 }, bestNow: true },
    ],
    destinations: [{ id: 'market', name: 'The Market', walkSeconds: 20 }],
    suggestions: [],
    nearby: [],
    waitingOnYou: [],
    conversations: [],
    worldEvents: [],
    sinceLastTurn: [],
    hint: '',
    ...over,
  };
}

/** Runs one turn and returns what the brain did. */
async function turn(brain: ScriptedBrain, s: State) {
  const acts: Array<[string, Record<string, unknown>]> = [];
  const line = await brain.decide({
    turn: 0, state: s, diary: [], actions: [], signal: new AbortController().signal,
    act: async (name, input) => { acts.push([name, input]); return { ok: true } as any; },
  });
  return { line, acts };
}

describe('the scripted brain', () => {
  it('never sleeps while it has energy, even with a bed to hand', async () => {
    const { acts } = await turn(new ScriptedBrain(), state({}, { energy: 60 }));
    assert.deepEqual(acts, [['do_activity', { activity: 'swim' }]]);
  });

  it('sleeps when it is nearly spent', async () => {
    const { acts } = await turn(new ScriptedBrain(), state({}, { energy: 10 }));
    assert.deepEqual(acts, [['do_activity', { activity: 'sleep' }]]);
  });

  it('does one thing at a place, then walks on', async () => {
    const brain = new ScriptedBrain();
    await turn(brain, state());
    const { acts } = await turn(brain, state());
    assert.deepEqual(acts, [['walk', { destination: 'market' }]]);
  });

  it('prefers where the world suggests', async () => {
    const brain = new ScriptedBrain();
    const s = state({ activities: [], suggestions: [{ locationId: 'lookout', name: 'Sunset Lookout', walkSeconds: 30, why: 'you have not been yet' }] });
    const { acts } = await turn(brain, s);
    assert.deepEqual(acts, [['walk', { destination: 'lookout' }]]);
  });

  it('says hello to a guest it meets, once', async () => {
    const brain = new ScriptedBrain();
    const nearby = [{ agentId: 'g1', name: 'Pip', kind: 'guest', status: 'idle', youCan: ['start_conversation'] }];
    const first = await turn(brain, state({ nearby }));
    assert.deepEqual(first.acts, [['start_conversation', { agentId: 'g1', openingMessage: 'Hello!' }]]);
    const again = await turn(brain, state({ nearby }));
    assert.equal(again.acts[0][0], 'do_activity');
  });

  it('leaves a local be unless it wants company', async () => {
    const nearby = [{ agentId: 'r1', name: 'Werner Heisenburg', kind: 'resident', status: 'idle', youCan: ['start_conversation'] }];
    const content = await turn(new ScriptedBrain(), state({ nearby }, { social: 80 }));
    assert.equal(content.acts[0][0], 'do_activity');
    const lonely = await turn(new ScriptedBrain(), state({ nearby }, { social: 30 }));
    assert.equal(lonely.acts[0][0], 'start_conversation');
  });
});
