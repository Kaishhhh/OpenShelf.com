const constructed: Record<string, unknown>[] = [];

jest.mock('kafkajs', () => ({
  logLevel: { WARN: 4 },
  Kafka: jest.fn().mockImplementation((config: Record<string, unknown>) => {
    constructed.push(config);
    return { config };
  }),
}));

import { kafka, resetKafkaClientForTests } from './client.js';

const KEYS = ['KAFKA_BROKERS', 'KAFKA_USERNAME', 'KAFKA_PASSWORD', 'KAFKA_SASL_MECHANISM'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  constructed.length = 0;
  resetKafkaClientForTests();
});

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

describe('kafka()', () => {
  it('names the missing variable', () => {
    expect(() => kafka()).toThrow('KAFKA_BROKERS is not set');
  });

  it('builds once and reuses the client', () => {
    process.env.KAFKA_BROKERS = 'localhost:9092';
    const a = kafka();
    const b = kafka();
    expect(a).toBe(b);
    expect(constructed).toHaveLength(1);
  });

  // Confluent Cloud: API key and secret over SASL/PLAIN, always TLS.
  it('defaults to SASL/PLAIN over TLS when credentials are set', () => {
    process.env.KAFKA_BROKERS = 'pkc-1.region.aws.confluent.cloud:9092, other:9092';
    process.env.KAFKA_USERNAME = 'KEY';
    process.env.KAFKA_PASSWORD = 'SECRET';

    kafka();

    expect(constructed[0]).toMatchObject({
      brokers: ['pkc-1.region.aws.confluent.cloud:9092', 'other:9092'],
      ssl: true,
      sasl: { mechanism: 'plain', username: 'KEY', password: 'SECRET' },
    });
  });

  it('accepts a SCRAM mechanism, case-insensitively', () => {
    process.env.KAFKA_BROKERS = 'b:9092';
    process.env.KAFKA_USERNAME = 'u';
    process.env.KAFKA_PASSWORD = 'p';
    process.env.KAFKA_SASL_MECHANISM = ' SCRAM-SHA-256 ';
    kafka();
    expect(constructed[0]).toMatchObject({ sasl: { mechanism: 'scram-sha-256' } });
  });

  it('rejects an unknown mechanism by name', () => {
    process.env.KAFKA_BROKERS = 'b:9092';
    process.env.KAFKA_USERNAME = 'u';
    process.env.KAFKA_PASSWORD = 'p';
    process.env.KAFKA_SASL_MECHANISM = 'gssapi';
    expect(() => kafka()).toThrow('KAFKA_SASL_MECHANISM');
  });

  it('requires the password once a username is set', () => {
    process.env.KAFKA_BROKERS = 'b:9092';
    process.env.KAFKA_USERNAME = 'u';
    expect(() => kafka()).toThrow('KAFKA_PASSWORD is not set');
  });

  it('connects in plaintext without credentials, for a local broker', () => {
    process.env.KAFKA_BROKERS = 'localhost:9092';
    kafka();
    expect(constructed[0]).toMatchObject({ ssl: false });
    expect(constructed[0]).not.toHaveProperty('sasl');
  });
});
