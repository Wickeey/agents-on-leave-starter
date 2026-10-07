import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader } from '@x402/core/http';
import { generatePrivateKey } from 'viem/accounts';
import { ConfigError, loadConfig } from '../src/config.ts';
import { createWallet } from '../src/wallet.ts';
import { WorldClient, WorldRefusal } from '../src/world/client.ts';
import { observe } from '../src/world/observe.ts';
import { fakeWorld } from './fake-world.ts';

const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

/** What a paid endpoint answers first: the price, as x402 v2 puts it. */
function paymentRequired(atomicAmount: string) {
  return encodePaymentRequiredHeader({
    x402Version: 2,
    resource: { url: 'http://world.test/api/v1/world/activity', description: 'Pixel Colada', mimeType: 'application/json' },
    accepts: [
      {
        scheme: 'exact',
        network: 'eip155:8453',
        asset: BASE_USDC,
        amount: atomicAmount,
        payTo: '0x000000000000000000000000000000000000dEaD',
        maxTimeoutSeconds: 60,
        extra: { name: 'USD Coin', version: '2' },
      },
    ],
  });
}

/** A world with one paid thing: 402 until a payment comes along, then yes. */
function paidWorld(atomicAmount: string) {
  const seen: Array<{ paid: boolean }> = [];
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const signature = req.headers.get('PAYMENT-SIGNATURE');
    seen.push({ paid: Boolean(signature) });
    if (!signature) {
      return new Response('{}', { status: 402, headers: { 'PAYMENT-REQUIRED': paymentRequired(atomicAmount) } });
    }
    const payload = decodePaymentSignatureHeader(signature);
    assert.equal(payload.accepted.amount, atomicAmount);
    return Response.json({ started: 'pixel_colada' });
  }) as typeof globalThis.fetch;
  return { fetch, seen };
}

const walletConfig = (env: Record<string, string> = {}) =>
  loadConfig({ BASE: 'http://world.test', WALLET_PRIVATE_KEY: generatePrivateKey(), ...env });

describe('the wallet', () => {
  it('is not there without a key', async () => {
    assert.equal(await createWallet(loadConfig({})), undefined);
  });

  it('never repeats a bad key back', () => {
    const almost = `0x${'ab'.repeat(31)}zz`;
    assert.throws(() => loadConfig({ WALLET_PRIVATE_KEY: almost }), (err: Error) => err instanceof ConfigError && !err.message.includes(almost));
  });

  it('pays when the world asks, and counts it', async () => {
    const world = paidWorld('10000'); // 0.01 USDC
    const wallet = await createWallet(walletConfig(), world.fetch);
    const client = new WorldClient('http://world.test', { token: 'me:secret', fetch: wallet!.fetch });

    assert.deepEqual(await client.doActivity('pixel_colada'), { started: 'pixel_colada' });
    assert.deepEqual(world.seen, [{ paid: false }, { paid: true }]);
    assert.equal(wallet!.spentUsd(), 0.01);
    assert.equal(wallet!.leftUsd(), 0.49);
  });

  it('turns down what would go over the budget, as a refusal the brain can read', async () => {
    const world = paidWorld('20000'); // 0.02 USDC, with 0.01 to spend
    const wallet = await createWallet(walletConfig({ MAX_SPEND_USD: '0.01' }), world.fetch);
    const client = new WorldClient('http://world.test', { token: 'me:secret', fetch: wallet!.fetch });

    await assert.rejects(client.doActivity('pixel_colada'), (err: unknown) => err instanceof WorldRefusal && err.code === 'payment_declined');
    assert.deepEqual(world.seen, [{ paid: false }], 'nothing was signed');
    assert.equal(wallet!.spentUsd(), 0);
  });

  it('turns down a single payment over its own cap', async () => {
    const world = paidWorld('100000'); // 0.10 USDC, with 0.05 a payment
    const wallet = await createWallet(walletConfig(), world.fetch);
    const client = new WorldClient('http://world.test', { token: 'me:secret', fetch: wallet!.fetch });
    await assert.rejects(client.doActivity('pixel_colada'), (err: unknown) => err instanceof WorldRefusal && err.code === 'payment_declined');
    assert.equal(wallet!.spentUsd(), 0);
  });
});

describe('what the agent sees', () => {
  it('leaves paid things out without a wallet, and shows their price with one', async () => {
    const world = fakeWorld();
    const without = await observe(world.client('me:secret'), 0);
    assert.ok(!without.state.activities.some((a) => a.id === 'pixel_colada'));
    assert.equal(without.state.you.wallet, undefined);

    const wallet = { spentUsd: () => 0.1, leftUsd: () => 0.4 };
    const withWallet = await observe(world.client('me:secret'), 0, wallet);
    assert.equal(withWallet.state.activities.find((a) => a.id === 'pixel_colada')?.price, '0.01 USDC');
    assert.deepEqual(withWallet.state.you.wallet, { spentUsd: 0.1, leftUsd: 0.4 });
  });
});
