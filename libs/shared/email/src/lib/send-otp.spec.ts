interface FakeClient {
  emails: { send: jest.Mock };
}

// One stable client object whose method is re-stubbed per test. The module memoises
// the client it builds, so swapping the object itself would leave the memoised one in
// place after the first test.
const fake: FakeClient = { emails: { send: jest.fn() } };

const constructed: unknown[] = [];

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation((apiKey: unknown) => {
    constructed.push(apiKey);
    return fake;
  }),
}));

import { sendOtpEmail } from './send-otp.js';
import { otpEmailHtml, subjectFor } from './template.js';

const API_KEY = 're_test_key';
const FROM = 'OpenShelf <onboarding@resend.dev>';

let errorSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;

beforeEach(() => {
  process.env.RESEND_API_KEY = API_KEY;
  process.env.EMAIL_FROM = FROM;
  delete process.env.NODE_ENV;

  fake.emails.send.mockReset();
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  errorSpy.mockRestore();
  warnSpy.mockRestore();
});

describe('sendOtpEmail', () => {
  it('sends the code to the right address from the configured sender', async () => {
    fake.emails.send.mockResolvedValue({ data: { id: 'abc' }, error: null });

    const sent = await sendOtpEmail({
      to: 'someone@example.com',
      code: '123456',
      purpose: 'user',
    });

    expect(sent).toBe(true);
    expect(fake.emails.send).toHaveBeenCalledTimes(1);

    const payload = fake.emails.send.mock.calls[0][0];
    expect(payload.to).toBe('someone@example.com');
    expect(payload.from).toBe(FROM);
    expect(payload.subject).toBe(subjectFor('user'));
    expect(payload.html).toContain('123456');
    expect(payload.text).toContain('123456');
  });

  it('builds the client from the environment and reuses it', async () => {
    fake.emails.send.mockResolvedValue({ data: { id: 'abc' }, error: null });

    await sendOtpEmail({ to: 'a@example.com', code: '111111', purpose: 'user' });
    const after = constructed.length;
    await sendOtpEmail({ to: 'b@example.com', code: '222222', purpose: 'user' });

    expect(constructed).toContain(API_KEY);
    expect(constructed.length).toBe(after);
  });

  it('varies the copy by purpose', async () => {
    expect(subjectFor('user')).not.toBe(subjectFor('seller'));
    expect(otpEmailHtml({ code: '123456', purpose: 'user' })).not.toBe(
      otpEmailHtml({ code: '123456', purpose: 'seller' })
    );
  });

  // The three failure shapes the caller must never see.
  describe('never throws', () => {
    it('returns false when the provider rejects the request', async () => {
      // The SDK resolves with an error rather than throwing for API failures.
      fake.emails.send.mockResolvedValue({
        data: null,
        error: { statusCode: 403, message: 'Recipient not allowed' },
      });

      await expect(
        sendOtpEmail({ to: 'x@example.com', code: '123456', purpose: 'user' })
      ).resolves.toBe(false);
      expect(errorSpy).toHaveBeenCalled();
    });

    it('returns false when the request throws', async () => {
      fake.emails.send.mockRejectedValue(new Error('ECONNREFUSED'));

      await expect(
        sendOtpEmail({ to: 'x@example.com', code: '123456', purpose: 'user' })
      ).resolves.toBe(false);
      expect(errorSpy).toHaveBeenCalled();
    });

    it('returns false when RESEND_API_KEY is not set', async () => {
      // Registration has to survive an unconfigured deployment.
      delete process.env.RESEND_API_KEY;
      jest.resetModules();
      const { sendOtpEmail: fresh } = await import('./send-otp.js');

      await expect(
        fresh({ to: 'x@example.com', code: '123456', purpose: 'user' })
      ).resolves.toBe(false);
    });

    it('returns false when EMAIL_FROM is not set', async () => {
      delete process.env.EMAIL_FROM;

      await expect(
        sendOtpEmail({ to: 'x@example.com', code: '123456', purpose: 'user' })
      ).resolves.toBe(false);
    });
  });

  describe('development fallback', () => {
    it('logs the code when a send fails outside production', async () => {
      fake.emails.send.mockResolvedValue({
        data: null,
        error: { message: 'nope' },
      });

      await sendOtpEmail({ to: 'x@example.com', code: '424242', purpose: 'user' });

      expect(warnSpy.mock.calls.flat().join(' ')).toContain('424242');
    });

    it('never logs the code in production', async () => {
      process.env.NODE_ENV = 'production';
      fake.emails.send.mockResolvedValue({
        data: null,
        error: { message: 'nope' },
      });

      await sendOtpEmail({ to: 'x@example.com', code: '424242', purpose: 'user' });

      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy.mock.calls.flat().join(' ')).not.toContain('424242');
    });

    it('never logs the code on a successful send', async () => {
      fake.emails.send.mockResolvedValue({ data: { id: 'ok' }, error: null });

      await sendOtpEmail({ to: 'x@example.com', code: '424242', purpose: 'user' });

      expect(warnSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });
});
