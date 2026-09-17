import express from 'express';
import type { AddressInfo } from 'net';
import type { Server } from 'http';
// Also what brings the req.seller augmentation into this compilation.
import type { AuthenticatedSeller } from '@openshelf/middleware';

jest.mock('@openshelf/prisma', () => ({
  prisma: {
    seller: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

// Every Stripe call is faked, including toPayoutStatus — its mapping has its
// own coverage in @openshelf/stripe. This file is about what the handlers do
// with the result.
jest.mock('@openshelf/stripe', () => ({
  createRecipientAccount: jest.fn(),
  createOnboardingLink: jest.fn(),
  retrieveAccount: jest.fn(),
  toPayoutStatus: jest.fn(),
  verifyEventNotification: jest.fn(),
}));

import { errorMiddleware } from '@openshelf/errors';
import { prisma } from '@openshelf/prisma';
import * as stripeLib from '@openshelf/stripe';
import {
  getStripeStatus,
  handleStripeWebhook,
  startStripeOnboarding,
} from './stripe.controller.js';

const db = prisma.seller as unknown as {
  findFirst: jest.Mock;
  findUnique: jest.Mock;
  updateMany: jest.Mock;
};

const stripeApi = stripeLib as unknown as {
  createRecipientAccount: jest.Mock;
  createOnboardingLink: jest.Mock;
  retrieveAccount: jest.Mock;
  toPayoutStatus: jest.Mock;
  verifyEventNotification: jest.Mock;
};

const SELLER_ID = '111111111111111111111111';
const ONBOARDING_URL = 'https://connect.stripe.com/d/setup/e/acct_1/abc';
const ACCOUNT = { id: 'acct_1', configuration: {}, requirements: { entries: [] } };
const ENABLED = { chargesEnabled: true, payoutsEnabled: true, detailsSubmitted: true };

function makeSeller(stripeId: string | null): AuthenticatedSeller {
  return {
    id: SELLER_ID,
    name: 'Test Seller',
    email: 'seller@example.com',
    phoneNumber: '+6500000000',
    country: 'SG',
    stripeId,
    stripeChargesEnabled: false,
    stripePayoutsEnabled: false,
    fcmTokens: [],
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

let currentSeller: AuthenticatedSeller | undefined;

// Mirrors main.ts: the webhook on express.raw ahead of express.json. With
// jsonFirst, a JSON parser is mounted ahead of it too — the misconfiguration
// the handler is meant to catch.
function buildApp({ jsonFirst = false } = {}) {
  const app = express();
  if (jsonFirst) {
    app.use(express.json());
  }
  app.post(
    '/api/stripe/webhook',
    express.raw({ type: 'application/json' }),
    handleStripeWebhook
  );
  app.use(express.json());
  // Stands in for isSellerAuthenticated, which has its own coverage.
  app.use((req, _res, next) => {
    req.seller = currentSeller;
    next();
  });
  app.post('/api/stripe/onboard', startStripeOnboarding);
  app.get('/api/stripe/status', getStripeStatus);
  app.use(errorMiddleware);
  return app;
}

const servers: Server[] = [];
let base: string;
let jsonFirstBase: string;

async function listen(app: express.Express): Promise<string> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeAll(async () => {
  process.env.SELLER_UI_URL = 'http://seller.test';
  base = await listen(buildApp());
  jsonFirstBase = await listen(buildApp({ jsonFirst: true }));
});

afterAll(async () => {
  await Promise.all(
    servers.map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        })
    )
  );
});

beforeEach(() => {
  jest.resetAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  currentSeller = makeSeller(null);
});

async function postWebhook(
  body: string,
  { url = base, signature = 't=1,v1=sig' } = {}
) {
  const res = await fetch(`${url}/api/stripe/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signature },
    body,
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

// A thin notification: a type and a pointer, no account state.
function notification(
  type = 'v2.core.account[configuration.recipient].capability_status_updated',
  related: { id: string; type: string } | null = { id: 'acct_1', type: 'v2.core.account' }
) {
  return {
    id: 'evt_1',
    object: 'v2.core.event',
    type,
    created: '2026-09-15T00:00:00.000Z',
    livemode: false,
    related_object: related && { ...related, url: `/v2/core/accounts/${related.id}` },
  };
}

describe('POST /api/stripe/webhook', () => {
  it('hands the verifier the exact bytes that were sent, and the signature', async () => {
    // Odd spacing on purpose: any re-serialisation would normalise it away.
    const body = '{"id":"evt_1",   "object":"v2.core.event"}';
    stripeApi.verifyEventNotification.mockReturnValue(null);

    await postWebhook(body, { signature: 't=123,v1=abc' });

    const [raw, signature] = stripeApi.verifyEventNotification.mock.calls[0];
    expect(Buffer.isBuffer(raw)).toBe(true);
    expect(raw.toString('utf8')).toBe(body);
    expect(signature).toBe('t=123,v1=abc');
  });

  it('rejects a bad signature with 400 and writes nothing', async () => {
    stripeApi.verifyEventNotification.mockReturnValue(null);

    const res = await postWebhook(JSON.stringify(notification()));

    expect(res.status).toBe(400);
    expect(stripeApi.retrieveAccount).not.toHaveBeenCalled();
    expect(db.findFirst).not.toHaveBeenCalled();
    expect(db.updateMany).not.toHaveBeenCalled();
  });

  // If this ever passes signature checks, the route has lost its raw body.
  it('fails as a server error when a JSON parser already consumed the body', async () => {
    const res = await postWebhook('{"id":"evt_1"}', { url: jsonFirstBase });

    expect(res.status).toBe(500);
    expect(stripeApi.verifyEventNotification).not.toHaveBeenCalled();
    expect(db.updateMany).not.toHaveBeenCalled();
  });

  it('acknowledges a notification that is not about an account without touching anything', async () => {
    stripeApi.verifyEventNotification.mockReturnValue(
      notification('v1.billing.meter.error_report_triggered', { id: 'mtr_1', type: 'billing.meter' })
    );

    const res = await postWebhook('{}');

    expect(res).toEqual({ status: 200, body: { received: true } });
    expect(db.findFirst).not.toHaveBeenCalled();
    expect(stripeApi.retrieveAccount).not.toHaveBeenCalled();
  });

  it('acknowledges an account notification with no related object', async () => {
    stripeApi.verifyEventNotification.mockReturnValue(notification('v2.core.account.updated', null));

    const res = await postWebhook('{}');

    expect(res).toEqual({ status: 200, body: { received: true } });
    expect(stripeApi.retrieveAccount).not.toHaveBeenCalled();
  });

  // A 4xx or 5xx here would have Stripe retrying something nobody can act on.
  it('acknowledges an account no seller owns without calling Stripe', async () => {
    stripeApi.verifyEventNotification.mockReturnValue(notification());
    db.findFirst.mockResolvedValue(null);

    const res = await postWebhook('{}');

    expect(res).toEqual({ status: 200, body: { received: true, applied: false } });
    expect(stripeApi.retrieveAccount).not.toHaveBeenCalled();
    expect(db.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    'v2.core.account[configuration.recipient].capability_status_updated',
    'v2.core.account[requirements].updated',
    'v2.core.account.updated',
  ])('fetches the account and stores its current state for %s', async (type) => {
    stripeApi.verifyEventNotification.mockReturnValue(notification(type));
    db.findFirst.mockResolvedValue({ id: SELLER_ID });
    stripeApi.retrieveAccount.mockResolvedValue(ACCOUNT);
    stripeApi.toPayoutStatus.mockReturnValue(ENABLED);
    db.updateMany.mockResolvedValue({ count: 1 });

    const res = await postWebhook('{}');

    expect(res).toEqual({ status: 200, body: { received: true, applied: true } });
    expect(db.findFirst).toHaveBeenCalledWith({
      where: { stripeId: 'acct_1' },
      select: { id: true },
    });
    expect(stripeApi.retrieveAccount).toHaveBeenCalledWith('acct_1');
    expect(stripeApi.toPayoutStatus).toHaveBeenCalledWith(ACCOUNT);
    expect(db.updateMany).toHaveBeenCalledWith({
      where: {
        stripeId: 'acct_1',
        OR: [
          { stripeChargesEnabled: { not: true } },
          { stripePayoutsEnabled: { not: true } },
        ],
      },
      data: { stripeChargesEnabled: true, stripePayoutsEnabled: true },
    });
  });

  it('reports a replay whose state is already stored as not applied', async () => {
    stripeApi.verifyEventNotification.mockReturnValue(notification());
    db.findFirst.mockResolvedValue({ id: SELLER_ID });
    stripeApi.retrieveAccount.mockResolvedValue(ACCOUNT);
    stripeApi.toPayoutStatus.mockReturnValue(ENABLED);
    db.updateMany.mockResolvedValue({ count: 0 });

    const res = await postWebhook('{}');

    expect(res).toEqual({ status: 200, body: { received: true, applied: false } });
  });

  // A 5xx is what makes Stripe retry, which is the right outcome here.
  it('fails with 500 when Stripe cannot be reached, so Stripe retries', async () => {
    stripeApi.verifyEventNotification.mockReturnValue(notification());
    db.findFirst.mockResolvedValue({ id: SELLER_ID });
    stripeApi.retrieveAccount.mockRejectedValue(new Error('connection reset'));

    const res = await postWebhook('{}');

    expect(res.status).toBe(500);
    expect(db.updateMany).not.toHaveBeenCalled();
  });
});

describe('POST /api/stripe/onboard', () => {
  async function onboard() {
    const res = await fetch(`${base}/api/stripe/onboard`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  it('never creates a second account for a seller who already has one', async () => {
    currentSeller = makeSeller('acct_existing');
    stripeApi.createOnboardingLink.mockResolvedValue(ONBOARDING_URL);

    const res = await onboard();

    expect(res).toEqual({ status: 200, body: { url: ONBOARDING_URL } });
    expect(stripeApi.createRecipientAccount).not.toHaveBeenCalled();
    expect(db.updateMany).not.toHaveBeenCalled();
    expect(stripeApi.createOnboardingLink).toHaveBeenCalledWith('acct_existing', {
      returnUrl: 'http://seller.test/dashboard?stripe=return',
      refreshUrl: 'http://seller.test/dashboard?stripe=refresh',
    });
  });

  it('creates an account for a seller without one and stores its id only if none is stored', async () => {
    stripeApi.createRecipientAccount.mockResolvedValue({ id: 'acct_new' });
    db.updateMany.mockResolvedValue({ count: 1 });
    stripeApi.createOnboardingLink.mockResolvedValue(ONBOARDING_URL);

    const res = await onboard();

    expect(res).toEqual({ status: 200, body: { url: ONBOARDING_URL } });
    expect(stripeApi.createRecipientAccount).toHaveBeenCalledWith({
      sellerId: SELLER_ID,
      name: 'Test Seller',
      email: 'seller@example.com',
      country: 'SG',
    });
    expect(db.updateMany).toHaveBeenCalledWith({
      where: {
        id: SELLER_ID,
        OR: [{ stripeId: null }, { stripeId: { isSet: false } }],
      },
      data: { stripeId: 'acct_new' },
    });
    expect(stripeApi.createOnboardingLink).toHaveBeenCalledWith('acct_new', expect.anything());
  });

  it('uses the stored account when a concurrent request stored one first', async () => {
    stripeApi.createRecipientAccount.mockResolvedValue({ id: 'acct_new' });
    db.updateMany.mockResolvedValue({ count: 0 });
    db.findUnique.mockResolvedValue({ stripeId: 'acct_winner' });
    stripeApi.createOnboardingLink.mockResolvedValue(ONBOARDING_URL);

    const res = await onboard();

    expect(res.status).toBe(200);
    expect(stripeApi.createOnboardingLink).toHaveBeenCalledWith('acct_winner', expect.anything());
  });

  it.each(['identity.country', 'configuration.recipient.capabilities.stripe_balance.stripe_transfers'])(
    "returns 400 with Stripe's reason when it refuses the seller over %s",
    async (param) => {
      stripeApi.createRecipientAccount.mockRejectedValue({
        type: 'StripeInvalidRequestError',
        param,
        message: 'Not supported for this country.',
      });

      const res = await onboard();

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Not supported for this country.');
      expect(db.updateMany).not.toHaveBeenCalled();
    }
  );

  // The shape of the Accounts v1 refusal seen on this platform: about the
  // platform's setup, so it must not read as the seller's fault.
  it('keeps a Stripe refusal about anything else a 500', async () => {
    stripeApi.createRecipientAccount.mockRejectedValue({
      type: 'StripeInvalidRequestError',
      message: 'Stripe no longer recommends Accounts v1 for new Connect integrations.',
    });

    const res = await onboard();

    expect(res.status).toBe(500);
  });
});

describe('GET /api/stripe/status', () => {
  async function status() {
    const res = await fetch(`${base}/api/stripe/status`);
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  it('reports not connected without calling Stripe', async () => {
    const res = await status();

    expect(res).toEqual({
      status: 200,
      body: {
        connected: false,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: false,
      },
    });
    expect(stripeApi.retrieveAccount).not.toHaveBeenCalled();
  });

  it('reports live state from Stripe and syncs it onto the seller', async () => {
    currentSeller = makeSeller('acct_1');
    stripeApi.retrieveAccount.mockResolvedValue(ACCOUNT);
    stripeApi.toPayoutStatus.mockReturnValue({
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: true,
    });
    db.updateMany.mockResolvedValue({ count: 0 });

    const res = await status();

    expect(res).toEqual({
      status: 200,
      body: {
        connected: true,
        chargesEnabled: false,
        payoutsEnabled: false,
        detailsSubmitted: true,
      },
    });
    expect(stripeApi.retrieveAccount).toHaveBeenCalledWith('acct_1');
    expect(db.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ stripeId: 'acct_1' }),
        data: { stripeChargesEnabled: false, stripePayoutsEnabled: false },
      })
    );
  });
});
