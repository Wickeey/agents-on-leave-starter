import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clamp, NOTE_LIMIT, Trip } from '../src/postcard.ts';
import type { State } from '../src/world/observe.ts';

const state = {
  activities: [{ id: 'eat', name: 'Eat' }, { id: 'swim', name: 'Swim' }],
  destinations: [{ id: 'beach', name: 'Bay Beach' }],
  nearby: [{ agentId: 'a1', name: 'Ada Example' }],
  waitingOnYou: [{ interactionId: 'i1', fromName: 'Bo Sample' }, { interactionId: 'i2', fromName: 'Cy Declined' }],
} as unknown as State;

describe('the postcard note', () => {
  it('says what was done, where it went and whom it met, by name', () => {
    const trip = new Trip();
    trip.turn();
    trip.turn();
    trip.record('do_activity', { activity: 'eat' }, state);
    trip.record('do_activity', { activity: 'eat' }, state);
    trip.record('do_activity', { activity: 'swim' }, state);
    trip.record('walk', { destination: 'beach' }, state);
    trip.record('start_conversation', { agentId: 'a1' }, state);
    trip.record('respond', { interactionId: 'i1', accept: true }, state);
    trip.record('respond', { interactionId: 'i2', accept: false }, state);
    assert.equal(trip.note('Pixel Bay'), '2 turns in Pixel Bay. Did Eat ×2 and Swim. Went to Bay Beach. Met Ada Example and Bo Sample.');
  });

  it('still says something when nothing happened', () => {
    const trip = new Trip();
    trip.turn();
    assert.equal(trip.note(), '1 turn away. Rested.');
  });

  it('never runs past the limit', () => {
    const long = clamp(`${'a very long day at the beach, '.repeat(10)}`);
    assert.ok(long.length <= NOTE_LIMIT, String(long.length));
    assert.ok(long.endsWith('…'));
    assert.equal(clamp('  short   and\nsweet '), 'short and sweet');
  });
});
