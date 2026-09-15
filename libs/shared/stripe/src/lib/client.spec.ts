const SECRET_KEY = 'sk_test_do_not_leak';
const WEBHOOK_SECRET = 'whsec_test_openshelf';

interface FakeClient {
  v2: {
    core: {
      accounts: { create: jest.Mock; retrieve: jest.Mock };
      accountLinks: { create: jest.Mock };
    };
  };
  parseEventNotification: (...args: unknown[]) => unknown;
}

// A real client, used only for parseEventNotification so the signature tests
// run Stripe's actual HMAC check. Constructing one makes no network call.
let realClient: { parseEventNotification: (...args: unknown[]) => unknown } | undefined;
function real() {
  const RealStripe = jest.requireActual('stripe');
  realClient ??= new RealStripe('sk_test_signature_checks_only');
  return realClient as NonNullable<typeof realClient>;
}

// One stable client object whose methods are re-stubbed per test. The module
// memoises the client it builds, so swapping the object itself would leave the
// memoised one in place after the first test.
const fake: FakeClient = {
  v2: {
    core: {
      accounts: { create: jest.fn(), retrieve: jest.fn() },
      accountLinks: { create: jest.fn() },
    },
  },
  parseEventNotification: (...args) => real().parseEventNotification(...args),
};

const constructed: unknown[][] = [];

jest.mock('stripe', () => {
  const actual = jest.requireActual('stripe');
  const FakeStripe = jest.fn().mockImplementation((...args: unknown[]) => {
    constructed.push(args);
    return fake;
  });
  return Object.assign(FakeStripe, {
    webhooks: actual.webhooks,
    errors: actual.errors,
  });
});

import Stripe from 'stripe';
import {
  createOnboardingLink,
  createRecipientAccount,
  retrieveAccount,
  stripe,
  toPayoutStatus,
  verifyEventNotification,
  type StripeAccount,
} from './client.js';

const { accounts, accountLinks } = fake.v2.core;

beforeAll(() => {
  process.env.STRIPE_SECRET_KEY = SECRET_KEY;
  process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
});

beforeEach(() => {
  accounts.create.mockReset();
  accounts.retrieve.mockReset();
  accountLinks.create.mockReset();
});

describe('stripe()', () => {
  it('configures the client from the environment', () => {
    stripe();
    expect(constructed[0]?.[0]).toBe(SECRET_KEY);
  });

  it('builds the client once and reuses it', () => {
    const before = constructed.length;
    stripe();
    stripe();
    expect(constructed.length).toBe(before);
  });
});

describe('createRecipientAccount', () => {
  const input = {
    sellerId: 'seller_1',
    name: 'Test Seller',
    email: 'seller@example.com',
    country: 'SG',
  };

  it('creates a recipient account with the Express dashboard, tagged with the seller', async () => {
    accounts.create.mockResolvedValue({ id: 'acct_1' });

    await expect(createRecipientAccount(input)).resolves.toEqual({
      id: 'acct_1',
    });
    expect(accounts.create).toHaveBeenCalledWith(
      {
        contact_email: 'seller@example.com',
        display_name: 'Test Seller',
        dashboard: 'express',
        identity: { country: 'SG' },
        configuration: {
          recipient: {
            capabilities: {
              stripe_balance: { stripe_transfers: { requested: true } },
            },
          },
        },
        defaults: {
          responsibilities: {
            fees_collector: 'application_express',
            losses_collector: 'application',
          },
        },
        metadata: { sellerId: 'seller_1' },
        include: ['configuration.recipient', 'requirements'],
      },
      expect.anything()
    );
  });

  // The guarantee behind "never two accounts for one seller" when two
  // onboarding requests race past the stripeId check together.
  it('sends the same idempotency key every time for the same seller', async () => {
    accounts.create.mockResolvedValue({ id: 'acct_1' });

    await createRecipientAccount(input);
    await createRecipientAccount(input);

    const [first, second] = accounts.create.mock.calls.map((call) => call[1]);
    expect(first).toEqual({
      idempotencyKey: expect.stringContaining('seller_1'),
    });
    expect(second).toEqual(first);
  });

  it('sends different keys for different sellers', async () => {
    accounts.create.mockResolvedValue({ id: 'acct_1' });

    await createRecipientAccount(input);
    await createRecipientAccount({ ...input, sellerId: 'seller_2' });

    const [first, second] = accounts.create.mock.calls.map((call) => call[1]);
    expect(second).not.toEqual(first);
  });

  // Shaped like Stripe's real answer to the request that loses the race: a 409
  // whose message blames the parameters even though they are identical.
  const inFlightConflict = {
    type: 'StripeAPIError',
    statusCode: 409,
    code: 'idempotency_error',
    message:
      'Idempotency keys can only be reused with the same parameters they were first used with.',
  };

  describe('when a concurrent request for the same seller is still in flight', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("waits, asks again with the same key, and returns the winner's account", async () => {
      accounts.create
        .mockRejectedValueOnce(inFlightConflict)
        .mockResolvedValueOnce({ id: 'acct_winner' });

      const result = createRecipientAccount(input);
      await jest.advanceTimersByTimeAsync(2000);

      await expect(result).resolves.toEqual({ id: 'acct_winner' });
      expect(accounts.create).toHaveBeenCalledTimes(2);
      const [first, second] = accounts.create.mock.calls;
      expect(second).toEqual(first);
    });

    it('gives up after three retries and rethrows the conflict', async () => {
      accounts.create.mockRejectedValue(inFlightConflict);

      const result = createRecipientAccount(input).catch((err) => err);
      await jest.advanceTimersByTimeAsync(5000);

      await expect(result).resolves.toMatchObject({
        statusCode: 409,
        code: 'idempotency_error',
      });
      expect(accounts.create).toHaveBeenCalledTimes(4);
    });
  });

  it('does not retry any other failure', async () => {
    accounts.create.mockRejectedValue({
      type: 'StripeInvalidRequestError',
      statusCode: 400,
      code: 'invalid_fields',
      message: 'Some fields in the request were invalid',
    });

    await expect(createRecipientAccount(input)).rejects.toMatchObject({
      code: 'invalid_fields',
    });
    expect(accounts.create).toHaveBeenCalledTimes(1);
  });
});

describe('createOnboardingLink', () => {
  it('requests a recipient onboarding link with both urls and returns only the url', async () => {
    accountLinks.create.mockResolvedValue({
      object: 'v2.core.account_link',
      url: 'https://connect.stripe.com/d/setup/e/acct_1/abc',
      created: '2026-09-15T00:00:00.000Z',
      expires_at: '2026-09-15T00:05:00.000Z',
    });

    await expect(
      createOnboardingLink('acct_1', {
        returnUrl: 'https://seller.test/dashboard?stripe=return',
        refreshUrl: 'https://seller.test/dashboard?stripe=refresh',
      })
    ).resolves.toBe('https://connect.stripe.com/d/setup/e/acct_1/abc');

    expect(accountLinks.create).toHaveBeenCalledWith({
      account: 'acct_1',
      use_case: {
        type: 'account_onboarding',
        account_onboarding: {
          configurations: ['recipient'],
          return_url: 'https://seller.test/dashboard?stripe=return',
          refresh_url: 'https://seller.test/dashboard?stripe=refresh',
        },
      },
    });
  });
});

describe('retrieveAccount', () => {
  // Without include, v2 omits both blocks and every flag reads false.
  it('asks for the recipient configuration and requirements', async () => {
    accounts.retrieve.mockResolvedValue({ id: 'acct_1' });

    await expect(retrieveAccount('acct_1')).resolves.toEqual({ id: 'acct_1' });
    expect(accounts.retrieve).toHaveBeenCalledWith('acct_1', {
      include: ['configuration.recipient', 'requirements'],
    });
  });
});

describe('toPayoutStatus', () => {
  type Entry = {
    awaiting_action_from: 'user' | 'stripe';
    minimum_deadline: { status: 'currently_due' | 'eventually_due' | 'past_due' };
  };

  function account({
    transfers,
    payouts,
    entries = [],
    withRequirements = true,
  }: {
    transfers?: string;
    payouts?: string;
    entries?: Entry[];
    withRequirements?: boolean;
  }) {
    return {
      id: 'acct_1',
      contact_email: 'seller@example.com',
      configuration: {
        recipient: {
          applied: true,
          capabilities: {
            stripe_balance: {
              ...(transfers ? { stripe_transfers: { status: transfers, status_details: [] } } : {}),
              ...(payouts ? { payouts: { status: payouts, status_details: [] } } : {}),
            },
          },
        },
      },
      ...(withRequirements ? { requirements: { entries } } : {}),
    } as unknown as StripeAccount;
  }

  const owed = (status: Entry['minimum_deadline']['status']): Entry => ({
    awaiting_action_from: 'user',
    minimum_deadline: { status },
  });

  it('returns exactly chargesEnabled, payoutsEnabled and detailsSubmitted', () => {
    const status = toPayoutStatus(account({ transfers: 'active', payouts: 'pending' }));

    expect(Object.keys(status).sort()).toEqual([
      'chargesEnabled',
      'detailsSubmitted',
      'payoutsEnabled',
    ]);
    expect(status).toEqual({
      chargesEnabled: true,
      payoutsEnabled: false,
      detailsSubmitted: true,
    });
  });

  it('reads chargesEnabled from the transfers capability, not payouts', () => {
    expect(
      toPayoutStatus(account({ transfers: 'pending', payouts: 'active' }))
    ).toMatchObject({ chargesEnabled: false, payoutsEnabled: true });
  });

  it.each(['pending', 'restricted', 'unsupported'])(
    'treats a %s capability as not enabled',
    (capabilityStatus) => {
      expect(
        toPayoutStatus(account({ transfers: capabilityStatus, payouts: capabilityStatus }))
      ).toMatchObject({ chargesEnabled: false, payoutsEnabled: false });
    }
  );

  it.each(['currently_due', 'past_due'] as const)(
    'is not submitted while the seller owes a %s requirement',
    (deadline) => {
      expect(
        toPayoutStatus(account({ entries: [owed(deadline)] })).detailsSubmitted
      ).toBe(false);
    }
  );

  // Stripe often sends the seller back here: everything submitted, Stripe
  // still verifying. That is submitted, but nothing is enabled yet.
  it('is submitted when the only open requirements are Stripe’s to act on', () => {
    const status = toPayoutStatus(
      account({
        transfers: 'pending',
        entries: [{ awaiting_action_from: 'stripe', minimum_deadline: { status: 'currently_due' } }],
      })
    );
    expect(status).toEqual({
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: true,
    });
  });

  it('is submitted when the seller only owes something eventually due', () => {
    expect(
      toPayoutStatus(account({ entries: [owed('eventually_due')] })).detailsSubmitted
    ).toBe(true);
  });

  it('reads an account fetched without its blocks as nothing done', () => {
    expect(toPayoutStatus({} as StripeAccount)).toEqual({
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
    });
    expect(
      toPayoutStatus(account({ transfers: 'active', withRequirements: false }))
        .detailsSubmitted
    ).toBe(false);
  });
});

describe('verifyEventNotification', () => {
  const payload = JSON.stringify({
    id: 'evt_test_1',
    object: 'v2.core.event',
    type: 'v2.core.account[configuration.recipient].capability_status_updated',
    created: '2026-09-15T00:00:00.000Z',
    livemode: false,
    related_object: {
      id: 'acct_1',
      type: 'v2.core.account',
      url: '/v2/core/accounts/acct_1',
    },
  });

  const sign = (body: string, secret = WEBHOOK_SECRET) =>
    Stripe.webhooks.generateTestHeaderString({ payload: body, secret });

  it('returns the notification for a correctly signed body', () => {
    expect(
      verifyEventNotification(Buffer.from(payload), sign(payload))
    ).toMatchObject({
      id: 'evt_test_1',
      type: 'v2.core.account[configuration.recipient].capability_status_updated',
      related_object: { id: 'acct_1', type: 'v2.core.account' },
    });
  });

  // Equivalent JSON, different bytes — the failure a JSON parser mounted ahead
  // of the webhook route would cause on every request.
  it('returns null for a body that was parsed and re-serialised', () => {
    const reserialised = JSON.stringify(JSON.parse(payload), null, 2);
    expect(
      verifyEventNotification(Buffer.from(reserialised), sign(payload))
    ).toBeNull();
  });

  it('returns null for a tampered body', () => {
    const tampered = payload.replace('acct_1', 'acct_2');
    expect(
      verifyEventNotification(Buffer.from(tampered), sign(payload))
    ).toBeNull();
  });

  it('returns null when signed with a different secret', () => {
    expect(
      verifyEventNotification(Buffer.from(payload), sign(payload, 'whsec_other'))
    ).toBeNull();
  });

  it('returns null without a signature', () => {
    expect(verifyEventNotification(Buffer.from(payload), undefined)).toBeNull();
    expect(verifyEventNotification(Buffer.from(payload), '')).toBeNull();
  });

  it('returns null for a malformed signature header', () => {
    expect(
      verifyEventNotification(Buffer.from(payload), 'not-a-stripe-signature')
    ).toBeNull();
  });

  it('returns null for a repeated signature header', () => {
    const header = sign(payload);
    expect(
      verifyEventNotification(Buffer.from(payload), [header, header])
    ).toBeNull();
  });

  // Signed with our secret, so not a forgery: the endpoint is subscribed to the
  // wrong kind of event. That must surface as a failure, not a quiet 400.
  it('throws for a correctly signed v1 snapshot event', () => {
    const v1 = JSON.stringify({ id: 'evt_1', object: 'event', type: 'account.updated' });
    expect(() => verifyEventNotification(Buffer.from(v1), sign(v1))).toThrow();
  });

  it('throws, naming the variable, when STRIPE_WEBHOOK_SECRET is unset', () => {
    const saved = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    try {
      expect(() =>
        verifyEventNotification(Buffer.from(payload), sign(payload))
      ).toThrow('STRIPE_WEBHOOK_SECRET is not set');
    } finally {
      process.env.STRIPE_WEBHOOK_SECRET = saved;
    }
  });
});
