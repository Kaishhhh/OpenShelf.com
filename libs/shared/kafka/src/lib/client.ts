import { Kafka, logLevel, type SASLOptions } from 'kafkajs';

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

const MECHANISMS = ['plain', 'scram-sha-256', 'scram-sha-512'] as const;
type Mechanism = (typeof MECHANISMS)[number];

/**
 * Confluent Cloud authenticates API keys with SASL/PLAIN, so that is the default.
 * scram-sha-256/512 are accepted for brokers that use them; anything else is a
 * configuration mistake and fails naming the variable rather than as an opaque
 * handshake error from the broker.
 */
function saslMechanism(): Mechanism {
  const raw = (process.env.KAFKA_SASL_MECHANISM ?? 'plain').trim().toLowerCase();
  const mechanism = MECHANISMS.find((m) => m === raw);
  if (!mechanism) {
    throw new Error(
      `KAFKA_SASL_MECHANISM must be one of ${MECHANISMS.join(', ')} (got "${raw}")`
    );
  }
  return mechanism;
}

/**
 * Short enough that a broker outage fails a send in seconds rather than holding a
 * connection attempt open for the kafkajs defaults. Producers here are fire-and-forget,
 * so a quick failure is a log line; a slow one is work piling up in memory.
 */
const CONNECTION_TIMEOUT_MS = 5_000;
const REQUEST_TIMEOUT_MS = 10_000;
const RETRY = { retries: 3, initialRetryTime: 300, maxRetryTime: 5_000 };

let client: Kafka | undefined;

/**
 * The configured client, built on first use rather than at import time.
 *
 * Same reasoning as @openshelf/stripe and @openshelf/imagekit: building it eagerly would
 * stop a service booting for anyone without Kafka credentials, taking every unrelated
 * route down with it. Deferred, the service starts, and the first Kafka use fails loudly
 * with the variable named.
 *
 * Constructing a Kafka instance opens no connection — that happens when a producer,
 * consumer or admin client connects.
 */
export function kafka(): Kafka {
  if (client) {
    return client;
  }

  const brokers = requireEnv('KAFKA_BROKERS')
    .split(',')
    .map((broker) => broker.trim())
    .filter(Boolean);

  const username = process.env.KAFKA_USERNAME?.trim();
  const password = process.env.KAFKA_PASSWORD?.trim();

  // Credentials mean a managed broker, which is always TLS. A local unauthenticated
  // broker (no username) connects in plaintext.
  const sasl: SASLOptions | undefined = username
    ? {
        mechanism: saslMechanism(),
        username,
        password: requireEnv('KAFKA_PASSWORD'),
      } as SASLOptions
    : undefined;
  if (!username && password) {
    throw new Error('KAFKA_USERNAME is not set');
  }

  client = new Kafka({
    clientId: process.env.KAFKA_CLIENT_ID?.trim() || 'openshelf',
    brokers,
    ssl: sasl !== undefined,
    ...(sasl ? { sasl } : {}),
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    requestTimeout: REQUEST_TIMEOUT_MS,
    retry: RETRY,
    logLevel: logLevel.WARN,
  });
  return client;
}

/** For tests: forget the memoised client so a changed environment is re-read. */
export function resetKafkaClientForTests(): void {
  client = undefined;
}
