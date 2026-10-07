/**
 * An optional wallet, for the few extras in the world that cost a little USDC.
 *
 * The world asks for money the x402 way: a paid request first comes back
 * `402 Payment Required` with what it costs, and the client signs a USDC
 * transfer and sends the request again. `@x402/fetch` does that dance inside
 * a `fetch`, and `WorldClient` already takes any `fetch`, so nothing else in
 * the starter has to know about payments.
 *
 * Two limits keep a brain from spending more than you meant it to:
 * - MAX_PAYMENT_USD caps any single payment (the library enforces it).
 * - MAX_SPEND_USD caps the whole stay (a policy here enforces it).
 * Past either one nothing is signed, and the brain gets an ordinary refusal
 * saying why, as it would for anything else the world turned down.
 *
 * Use a fresh wallet holding a few dollars, never one you care about. The
 * private key is used once, to make the account; only the address is shown.
 */
import type { Config } from './config.ts';

export interface Wallet {
  address: string;
  /** Short and readable, e.g. "Base". */
  network: string;
  budgetUsd: number;
  /** Pays when the world asks for it; hand it to `WorldClient`. */
  fetch: typeof fetch;
  spentUsd(): number;
  leftUsd(): number;
}

/** USDC has 6 decimals: 1 dollar is 1_000_000 of its smallest unit. */
const UNITS_PER_DOLLAR = 1_000_000;

const NETWORK_NAMES: Record<string, string> = { 'eip155:8453': 'Base', 'eip155:84532': 'Base Sepolia' };

/** None without WALLET_PRIVATE_KEY. The payment libraries load only when there is one. */
export async function createWallet(config: Config, baseFetch: typeof fetch = fetch): Promise<Wallet | undefined> {
  if (!config.walletPrivateKey) return undefined;

  const [{ privateKeyToAccount }, { x402Client, wrapFetchWithPayment }, { ExactEvmScheme }, v1] = await Promise.all([
    import('viem/accounts'),
    import('@x402/fetch'),
    import('@x402/evm'),
    import('@x402/evm/v1'),
  ]);

  const account = privateKeyToAccount(config.walletPrivateKey);
  const budget = BigInt(Math.round(config.maxSpendUsd * UNITS_PER_DOLLAR));
  let spent = 0n;
  let pending: bigint | undefined;

  const client = x402Client
    .fromConfig({
      schemes: [{ network: config.walletNetwork, client: new ExactEvmScheme(account) }],
      spendControls: { maxAmountPerPayment: `$${config.maxPaymentUsd}` },
      // Offers that would take the stay over its budget are not offers.
      policies: [(_version, offers) => offers.filter((offer) => spent + amountOf(offer) <= budget)],
    })
    // Remember what is about to be paid; it counts once the world says yes.
    .onAfterPaymentCreation(async ({ selectedRequirements }) => {
      pending = amountOf(selectedRequirements);
    });

  // The world may still speak x402 v1, which names networks instead of numbering them.
  const chainId = Number(config.walletNetwork.split(':')[1]);
  const v1Name = Object.entries(v1.EVM_NETWORK_CHAIN_ID_MAP).find(([, id]) => id === chainId)?.[0];
  if (v1Name) client.registerV1(v1Name, new v1.ExactEvmSchemeV1(account));

  const paying = wrapFetchWithPayment(baseFetch, client);

  const walletFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    pending = undefined;
    let res: Response;
    try {
      res = await paying(input, init);
    } catch (err) {
      // The library throws when it will not pay. Give the brain a refusal it can read instead.
      if (!(err instanceof Error && /payment/i.test(err.message))) throw err;
      return declined(err.message);
    }
    if (pending !== undefined && res.ok) spent += pending;
    return res;
  };

  const spentUsd = () => Number(spent) / UNITS_PER_DOLLAR;
  return {
    address: account.address,
    network: NETWORK_NAMES[config.walletNetwork] ?? config.walletNetwork,
    budgetUsd: config.maxSpendUsd,
    fetch: walletFetch as typeof fetch,
    spentUsd,
    leftUsd: () => Math.max(0, config.maxSpendUsd - spentUsd()),
  };
}

/** What an offer costs, in USDC's smallest unit. v2 calls it `amount`, v1 `maxAmountRequired`. */
function amountOf(offer: object): bigint {
  const { amount, maxAmountRequired } = offer as { amount?: string; maxAmountRequired?: string };
  return BigInt(amount ?? maxAmountRequired ?? 0);
}

/**
 * Shaped like any other refusal from the world, so `WorldClient` throws it as
 * a `WorldRefusal`. The library's own message is advice for programmers
 * ("disable spend controls"), so the brain gets a plain reason instead.
 */
function declined(libraryMessage: string): Response {
  const why = /policies/.test(libraryMessage)
    ? 'it costs more than is left to spend this stay'
    : /spendControls/.test(libraryMessage)
      ? 'it costs more than one payment may'
      : 'this wallet cannot pay for it here';
  const body = { code: 'payment_declined', message: `Not paid: ${why}.`, hint: 'Free things still work.' };
  return new Response(JSON.stringify(body), { status: 402, headers: { 'content-type': 'application/json' } });
}
