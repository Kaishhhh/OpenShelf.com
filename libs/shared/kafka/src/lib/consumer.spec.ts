import {
  HEADERS,
  PermanentError,
  processMessage,
  waitUntil,
  type Forward,
  type OutgoingMessage,
  type RetryPolicy,
} from './consumer.js';

const policy: RetryPolicy = {
  retryTopic: 'svc.retry',
  dlqTopic: 'svc.dlq',
  maxRetries: 3,
  backoffMs: [5_000, 30_000, 120_000],
};

const NOW = 1_800_000_000_000;

function recorder(fail = false) {
  const sent: { topic: string; message: OutgoingMessage }[] = [];
  const forward: Forward = async (topic, message) => {
    if (fail) throw new Error('broker unavailable');
    sent.push({ topic, message });
  };
  return { sent, forward };
}

const message = (over: {
  value?: Buffer | null;
  headers?: Record<string, string>;
  offset?: string;
} = {}) => ({
  key: Buffer.from('order-1'),
  value: over.value === undefined ? Buffer.from('{"ok":true}') : over.value,
  headers: over.headers ?? { 'x-event-type': 'order.created' },
  offset: over.offset ?? '42',
});

const run = (
  handle: () => Promise<void>,
  over: Partial<Parameters<typeof processMessage>[0]> = {},
  forward: Forward = recorder().forward
) =>
  processMessage({
    topic: 'order.created',
    partition: 0,
    message: message(),
    handle,
    forward,
    policy,
    now: () => NOW,
    ...over,
  });

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('processMessage', () => {
  it('reports success and forwards nothing', async () => {
    const { sent, forward } = recorder();
    const handle = jest.fn().mockResolvedValue(undefined);

    await expect(run(handle, {}, forward)).resolves.toEqual({ result: 'handled' });
    expect(sent).toHaveLength(0);
    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'order.created', key: 'order-1', attempt: 0 })
    );
  });

  it('sends a permanent failure straight to the DLQ with the original bytes, no retries', async () => {
    const { sent, forward } = recorder();
    const raw = Buffer.from([0xff, 0xfe, 0x00, 0x7b]); // not UTF-8, not JSON
    const outcome = await run(
      () => Promise.reject(new PermanentError('not JSON')),
      { message: message({ value: raw }) },
      forward
    );

    expect(outcome).toEqual({ result: 'dlq', reason: 'permanent' });
    expect(sent).toHaveLength(1);
    expect(sent[0].topic).toBe('svc.dlq');
    expect(Buffer.compare(sent[0].message.value as Buffer, raw)).toBe(0);
    expect(sent[0].message.headers).toMatchObject({
      [HEADERS.ORIGINAL_TOPIC]: 'order.created',
      [HEADERS.ORIGINAL_PARTITION]: '0',
      [HEADERS.ORIGINAL_OFFSET]: '42',
      [HEADERS.ERROR_CLASS]: 'PermanentError',
      [HEADERS.ERROR]: 'not JSON',
      [HEADERS.ATTEMPT]: '0',
    });
  });

  it('sends a transient failure to the retry topic as attempt 1 with the first backoff', async () => {
    const { sent, forward } = recorder();
    const outcome = await run(() => Promise.reject(new Error('db timeout')), {}, forward);

    expect(outcome).toEqual({ result: 'retry', attempt: 1, notBefore: NOW + 5_000 });
    expect(sent[0].topic).toBe('svc.retry');
    expect(sent[0].message.headers).toMatchObject({
      [HEADERS.ATTEMPT]: '1',
      [HEADERS.NOT_BEFORE]: String(NOW + 5_000),
      [HEADERS.ORIGINAL_TOPIC]: 'order.created',
      [HEADERS.ERROR]: 'db timeout',
    });
  });

  it('keeps the original origin and escalates the backoff across retries', async () => {
    const { sent, forward } = recorder();
    const onRetryTopic = message({
      offset: '7', // offset on the retry topic, not the original
      headers: {
        [HEADERS.ORIGINAL_TOPIC]: 'order.created',
        [HEADERS.ORIGINAL_PARTITION]: '0',
        [HEADERS.ORIGINAL_OFFSET]: '42',
        [HEADERS.ATTEMPT]: '1',
      },
    });
    const handle = jest.fn().mockRejectedValue(new Error('still down'));

    const outcome = await run(
      handle,
      { topic: 'svc.retry', message: onRetryTopic },
      forward
    );

    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({ topic: 'order.created', attempt: 1 })
    );
    expect(outcome).toEqual({ result: 'retry', attempt: 2, notBefore: NOW + 30_000 });
    expect(sent[0].message.headers).toMatchObject({
      [HEADERS.ORIGINAL_TOPIC]: 'order.created',
      [HEADERS.ORIGINAL_OFFSET]: '42',
    });
  });

  it('dead-letters once retries are exhausted', async () => {
    const { sent, forward } = recorder();
    const outcome = await run(
      () => Promise.reject(new Error('still down')),
      {
        topic: 'svc.retry',
        message: message({
          headers: { [HEADERS.ORIGINAL_TOPIC]: 'order.created', [HEADERS.ATTEMPT]: '3' },
        }),
      },
      forward
    );
    expect(outcome).toEqual({ result: 'dlq', reason: 'retries-exhausted' });
    expect(sent.map((s) => s.topic)).toEqual(['svc.dlq']);
    expect(sent[0].message.headers[HEADERS.ATTEMPT]).toBe('3');
  });

  it('dead-letters a permanent failure met during a retry', async () => {
    const { sent, forward } = recorder();
    await run(
      () => Promise.reject(new PermanentError('order gone')),
      { message: message({ headers: { [HEADERS.ATTEMPT]: '1' } }) },
      forward
    );
    expect(sent.map((s) => s.topic)).toEqual(['svc.dlq']);
  });

  // No commit happens, so Kafka redelivers: the message is delayed, never dropped.
  it('throws when the forward itself fails', async () => {
    const { forward } = recorder(true);
    await expect(
      run(() => Promise.reject(new Error('db down')), {}, forward)
    ).rejects.toThrow('broker unavailable');
  });

  it('truncates a long error into the header', async () => {
    const { sent, forward } = recorder();
    await run(() => Promise.reject(new PermanentError('x'.repeat(5_000))), {}, forward);
    expect(sent[0].message.headers[HEADERS.ERROR].length).toBe(500);
  });
});

describe('waitUntil', () => {
  it('returns immediately when the time has passed', async () => {
    const heartbeat = jest.fn().mockResolvedValue(undefined);
    await waitUntil(NOW - 1, heartbeat, () => NOW);
    expect(heartbeat).not.toHaveBeenCalled();
  });

  it('heartbeats while it waits', async () => {
    jest.useFakeTimers();
    let clock = NOW;
    const heartbeat = jest.fn().mockResolvedValue(undefined);
    const done = waitUntil(NOW + 7_000, heartbeat, () => clock);

    for (let i = 0; i < 3; i++) {
      clock += 3_000;
      await jest.advanceTimersByTimeAsync(3_000);
    }
    await done;
    expect(heartbeat).toHaveBeenCalledTimes(3);
    jest.useRealTimers();
  });
});
