const initializeApp = jest.fn((options: unknown, name: string) => ({ name, options }));
const cert = jest.fn((account: unknown) => ({ account }));
const sendEachForMulticast = jest.fn();

jest.mock('firebase-admin/app', () => ({
  initializeApp: (...args: [unknown, string]) => initializeApp(...args),
  cert: (account: unknown) => cert(account),
  getApps: () => [],
}));

jest.mock('firebase-admin/messaging', () => ({
  getMessaging: () => ({ sendEachForMulticast }),
}));

import { firebase, isDeadTokenError, resetFirebaseForTests, sendPush } from './client.js';

const ACCOUNT = {
  project_id: 'openshelf-test',
  client_email: 'svc@openshelf-test.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nSECRET\n-----END PRIVATE KEY-----\n',
};
const encoded = Buffer.from(JSON.stringify(ACCOUNT)).toString('base64');

const saved = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;

beforeEach(() => {
  resetFirebaseForTests();
  initializeApp.mockClear();
  cert.mockClear();
  sendEachForMulticast.mockReset();
  process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 = encoded;
});

afterAll(() => {
  if (saved === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  else process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 = saved;
});

describe('firebase()', () => {
  it('initialises a named app from the base64 service account, once', () => {
    firebase();
    firebase();
    expect(initializeApp).toHaveBeenCalledTimes(1);
    expect(cert).toHaveBeenCalledWith(ACCOUNT);
    expect(initializeApp.mock.calls[0][1]).toBe('openshelf');
  });

  it('names the missing variable', () => {
    delete process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
    expect(() => firebase()).toThrow('FIREBASE_SERVICE_ACCOUNT_BASE64 is not set');
  });

  it('rejects a blob that is not a service account, without echoing it', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 = Buffer.from('{"private_key":"SECRET"}').toString(
      'base64'
    );
    let message = '';
    try {
      firebase();
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('does not decode to a service account JSON');
    expect(message).not.toContain('SECRET');
  });

  it('rejects base64 that is not JSON', () => {
    process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 = Buffer.from('not json').toString('base64');
    expect(() => firebase()).toThrow('does not decode');
  });
});

describe('sendPush', () => {
  it('makes no call with no tokens', async () => {
    await expect(sendPush([], { title: 't', body: 'b' })).resolves.toEqual({
      successCount: 0,
      failureCount: 0,
      invalidTokens: [],
    });
    expect(sendEachForMulticast).not.toHaveBeenCalled();
  });

  it('sends a web push with a click-through link to each unique token', async () => {
    sendEachForMulticast.mockResolvedValue({
      successCount: 2,
      failureCount: 0,
      responses: [{ success: true }, { success: true }],
    });

    await sendPush(['a', 'b', 'a'], {
      title: 'New order',
      body: 'You have a new order for $24.00.',
      link: 'http://localhost:3001/orders/o1',
      data: { orderId: 'o1' },
    });

    expect(sendEachForMulticast).toHaveBeenCalledWith({
      tokens: ['a', 'b'],
      notification: { title: 'New order', body: 'You have a new order for $24.00.' },
      data: { orderId: 'o1' },
      webpush: { fcmOptions: { link: 'http://localhost:3001/orders/o1' } },
    });
  });

  it('reports only dead tokens as invalid, not transient failures', async () => {
    sendEachForMulticast.mockResolvedValue({
      successCount: 1,
      failureCount: 3,
      responses: [
        { success: true },
        { success: false, error: { code: 'messaging/registration-token-not-registered' } },
        { success: false, error: { code: 'messaging/internal-error' } },
        { success: false, error: { code: 'messaging/invalid-registration-token' } },
      ],
    });

    const result = await sendPush(['ok', 'gone', 'flaky', 'bad'], { title: 't', body: 'b' });

    expect(result).toEqual({ successCount: 1, failureCount: 3, invalidTokens: ['gone', 'bad'] });
  });

  it('rejects when the whole request fails', async () => {
    sendEachForMulticast.mockRejectedValue(new Error('invalid credentials'));
    await expect(sendPush(['a'], { title: 't', body: 'b' })).rejects.toThrow('invalid credentials');
  });
});

describe('isDeadTokenError', () => {
  it('matches only the two permanent codes', () => {
    expect(isDeadTokenError({ code: 'messaging/registration-token-not-registered' })).toBe(true);
    expect(isDeadTokenError({ code: 'messaging/quota-exceeded' })).toBe(false);
    expect(isDeadTokenError(undefined)).toBe(false);
  });
});
