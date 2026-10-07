/**
 * A pretend world behind `fetch`, for tests: routes by method and path,
 * records every call, and answers like the real API does.
 */
import { WorldClient } from '../src/world/client.ts';
import type { Look } from '../src/world/types.ts';

export interface Call {
  method: string;
  path: string;
  body: any;
  auth?: string;
}

type Handler = (body: any) => { status?: number; json: unknown };

export function look(overrides: Partial<Look> = {}): Look {
  return {
    time: { label: 'Day 1, 09:00', phase: 'morning' },
    location: { id: 'hotel_lobby', name: 'The Lobby', description: 'Cool tiles.' },
    you: {
      agentId: 'me',
      name: 'Tester',
      status: 'idle',
      needs: { energy: 80, hunger: 20, social: 70, fun: 60 },
      dayOfVacation: 1,
      autographs: 0,
    },
    nearbyAgents: [],
    destinations: [{ id: 'beach', name: 'Bay Beach', walkSeconds: 12 }],
    activities: [
      {
        id: 'eat',
        name: 'Eat',
        description: 'Food.',
        durationSeconds: 30,
        available: true,
        bestNow: true,
        effects: { hunger: 30 },
        payment: null,
      },
      {
        id: 'pixel_colada',
        name: 'Pixel Colada',
        description: 'A drink with a price.',
        durationSeconds: 30,
        available: true,
        bestNow: true,
        effects: { fun: 5 },
        payment: { price: '0.01', asset: 'USDC' },
      },
      {
        id: 'sleep',
        name: 'Sleep',
        description: 'Not here.',
        durationSeconds: 300,
        available: false,
        reason: 'Not here.',
        bestNow: false,
        effects: { energy: 50 },
        payment: null,
      },
    ],
    suggestions: [{ locationId: 'beach', name: 'Bay Beach', walkSeconds: 12, why: 'somewhere new' }],
    worldEvents: [],
    pendingInteractions: [],
    activeInteractions: [],
    hint: 'Look around.',
    ...overrides,
  };
}

export function fakeWorld(routes: Record<string, Handler> = {}) {
  const calls: Call[] = [];
  const defaults: Record<string, Handler> = {
    'POST /agents/register': () => ({ status: 201, json: { agentId: 'me', token: 'me:secret' } }),
    'POST /vacations/check-in': () => ({ json: { vacationId: 'v1', worldName: 'Pixel Bay', spectatorUrl: 'http://x/world', ownerUrl: 'http://x/owner' } }),
    'POST /vacations/check-out': () => ({ json: { postcardUrl: 'http://x/postcards/1', summary: 'Lovely.' } }),
    'GET /world/look': () => ({ json: look() }),
    'GET /events': () => ({ json: { events: [], cursor: 0 } }),
  };
  const table = { ...defaults, ...routes };

  const fetch = (async (url: string, init: RequestInit = {}) => {
    const { pathname } = new URL(url);
    const path = pathname.replace(/^\/api\/v1/, '');
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ method, path, body, auth: headers.authorization });

    const handler = table[`${method} ${path}`];
    const { status = 200, json } = handler
      ? handler(body)
      : { status: 404, json: { code: 'not_found', message: `No route ${method} ${path}` } };
    return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
  }) as typeof globalThis.fetch;

  const client = (token?: string) => new WorldClient('http://world.test', { token, fetch });
  return { calls, fetch, client };
}
