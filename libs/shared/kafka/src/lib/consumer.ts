import {
  Partitioners,
  type Consumer,
  type IHeaders,
  type KafkaMessage,
  type Producer,
} from 'kafkajs';
import { kafka } from './client.js';

/**
 * Thrown by a handler for a message that can never succeed — unparseable, failing its
 * schema, or referring to something that does not exist. It skips retries and goes
 * straight to the dead-letter topic: retrying it would only spend the backoff schedule
 * on a certain failure.
 *
 * Anything else a handler throws is treated as transient and retried.
 */
export class PermanentError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PermanentError';
  }
}

export const HEADERS = {
  ORIGINAL_TOPIC: 'x-original-topic',
  ORIGINAL_PARTITION: 'x-original-partition',
  ORIGINAL_OFFSET: 'x-original-offset',
  ATTEMPT: 'x-attempt',
  NOT_BEFORE: 'x-not-before',
  ERROR_CLASS: 'x-error-class',
  ERROR: 'x-error',
} as const;

/** What a handler receives: the raw bytes, so parsing — and failing to — is its job. */
export interface IncomingMessage {
  topic: string;
  key: string | null;
  value: Buffer | null;
  headers: Record<string, string>;
  /** 0 on first delivery; the retry number on the retry topic. */
  attempt: number;
}

export type Handler = (message: IncomingMessage) => Promise<void>;

export interface OutgoingMessage {
  key: Buffer | string | null;
  value: Buffer | string | null;
  headers: Record<string, string>;
}

/** Sends to a topic and resolves only once the broker acknowledged it. */
export type Forward = (topic: string, message: OutgoingMessage) => Promise<void>;

export interface RetryPolicy {
  retryTopic: string;
  dlqTopic: string;
  /** Retries after the first attempt, each on the retry topic. */
  maxRetries: number;
  /** Delay before retry n is `backoffMs[n - 1]` (the last entry repeats). */
  backoffMs: number[];
}

export const DEFAULT_BACKOFF_MS = [5_000, 30_000, 120_000];

const MAX_ERROR_HEADER_LENGTH = 500;

function headerString(value: IHeaders[string]): string | undefined {
  if (value === undefined) return undefined;
  const first = Array.isArray(value) ? value[0] : value;
  return first === undefined ? undefined : first.toString();
}

export function readHeaders(headers: IHeaders | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    const text = headerString(value);
    if (text !== undefined) out[name] = text;
  }
  return out;
}

function describe(err: unknown): { errorClass: string; error: string } {
  const errorClass = err instanceof Error ? err.name : typeof err;
  const error = (err instanceof Error ? err.message : String(err)).slice(
    0,
    MAX_ERROR_HEADER_LENGTH
  );
  return { errorClass, error };
}

export type Outcome =
  | { result: 'handled' }
  | { result: 'retry'; attempt: number; notBefore: number }
  | { result: 'dlq'; reason: 'permanent' | 'retries-exhausted' };

export interface ProcessInput {
  topic: string;
  partition: number;
  message: Pick<KafkaMessage, 'key' | 'value' | 'headers' | 'offset'>;
  handle: Handler;
  forward: Forward;
  policy: RetryPolicy;
  now?: () => number;
}

/**
 * Runs one message through the handler and decides where it goes. The heart of the
 * failure handling, kept free of any Kafka connection so it can be tested directly.
 *
 * - success → handled; the caller commits.
 * - PermanentError → forwarded to the DLQ untouched.
 * - anything else → forwarded to the retry topic with the next attempt number and a
 *   not-before time, or to the DLQ once retries are exhausted.
 *
 * The **original bytes** are forwarded, never a re-serialisation, so the DLQ holds exactly
 * what arrived — including messages that were not valid JSON at all. Where it first came
 * from is carried in headers and preserved across retries.
 *
 * If forwarding itself fails, this throws. The caller then does not commit, and Kafka
 * redelivers: the partition stalls until the broker recovers, but no message is dropped.
 */
export async function processMessage(input: ProcessInput): Promise<Outcome> {
  const { topic, partition, message, handle, forward, policy } = input;
  const now = input.now ?? Date.now;
  const headers = readHeaders(message.headers);
  const attempt = Number(headers[HEADERS.ATTEMPT] ?? 0) || 0;

  // Messages on the retry topic already carry their origin; first deliveries do not.
  const originalTopic = headers[HEADERS.ORIGINAL_TOPIC] ?? topic;

  try {
    await handle({
      topic: originalTopic,
      key: message.key?.toString() ?? null,
      value: message.value,
      headers,
      attempt,
    });
    return { result: 'handled' };
  } catch (err) {
    const { errorClass, error } = describe(err);
    const origin = {
      [HEADERS.ORIGINAL_TOPIC]: originalTopic,
      [HEADERS.ORIGINAL_PARTITION]: headers[HEADERS.ORIGINAL_PARTITION] ?? String(partition),
      [HEADERS.ORIGINAL_OFFSET]: headers[HEADERS.ORIGINAL_OFFSET] ?? message.offset,
    };
    const base = {
      ...headers,
      ...origin,
      [HEADERS.ERROR_CLASS]: errorClass,
      [HEADERS.ERROR]: error,
    };

    if (err instanceof PermanentError || attempt >= policy.maxRetries) {
      const reason = err instanceof PermanentError ? 'permanent' : 'retries-exhausted';
      await forward(policy.dlqTopic, {
        key: message.key,
        value: message.value,
        headers: { ...base, [HEADERS.ATTEMPT]: String(attempt) },
      });
      console.error(
        `[kafka] ${originalTopic}@${origin[HEADERS.ORIGINAL_OFFSET]} -> ${policy.dlqTopic} (${reason}, attempt ${attempt}): ${errorClass}: ${error}`
      );
      return { result: 'dlq', reason };
    }

    const next = attempt + 1;
    const delay =
      policy.backoffMs[Math.min(next - 1, policy.backoffMs.length - 1)] ?? 0;
    const notBefore = now() + delay;
    await forward(policy.retryTopic, {
      key: message.key,
      value: message.value,
      headers: {
        ...base,
        [HEADERS.ATTEMPT]: String(next),
        [HEADERS.NOT_BEFORE]: String(notBefore),
      },
    });
    console.warn(
      `[kafka] ${originalTopic}@${origin[HEADERS.ORIGINAL_OFFSET]} -> ${policy.retryTopic} (attempt ${next} in ${delay}ms): ${errorClass}: ${error}`
    );
    return { result: 'retry', attempt: next, notBefore };
  }
}

const HEARTBEAT_EVERY_MS = 3_000;

/**
 * Holds a retry message until its not-before time, heartbeating so the group coordinator
 * does not consider this consumer dead while it waits.
 */
export async function waitUntil(
  notBefore: number,
  heartbeat: () => Promise<void>,
  now: () => number = Date.now
): Promise<void> {
  for (;;) {
    const remaining = notBefore - now();
    if (remaining <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, Math.min(remaining, HEARTBEAT_EVERY_MS)));
    await heartbeat();
  }
}

export interface RunConsumerOptions {
  groupId: string;
  topics: string[];
  handle: Handler;
  policy: RetryPolicy;
  /** Whether messages on these topics carry a not-before to wait for (the retry topic). */
  honourNotBefore?: boolean;
}

export interface RunningConsumer {
  consumer: Consumer;
  disconnect(): Promise<void>;
}

function rawForwarder(producer: Producer): Forward {
  return async (topic, message) => {
    await producer.send({
      topic,
      acks: -1,
      messages: [
        { key: message.key, value: message.value, headers: message.headers },
      ],
    });
  };
}

/**
 * Starts a consumer group with the retry/DLQ policy applied to every message.
 *
 * Offsets are committed per message only after processMessage returns — that is, after
 * the handler succeeded or the message was safely forwarded. A throw (a failed forward)
 * leaves the offset uncommitted and kafkajs retries; if its own retries run out the
 * consumer restarts rather than the process exiting.
 */
export async function runConsumer(options: RunConsumerOptions): Promise<RunningConsumer> {
  const client = kafka();
  const producer = client.producer({
    allowAutoTopicCreation: false,
    createPartitioner: Partitioners.DefaultPartitioner,
  });
  const consumer = client.consumer({
    groupId: options.groupId,
    allowAutoTopicCreation: false,
    retry: {
      retries: 5,
      restartOnFailure: async (err) => {
        console.error(`[kafka] consumer ${options.groupId} crashed; restarting —`, err);
        return true;
      },
    },
  });

  await producer.connect();
  await consumer.connect();
  await consumer.subscribe({ topics: options.topics, fromBeginning: false });

  const forward = rawForwarder(producer);

  await consumer.run({
    autoCommit: true,
    eachMessage: async ({ topic, partition, message, heartbeat }) => {
      if (options.honourNotBefore) {
        const notBefore = Number(readHeaders(message.headers)[HEADERS.NOT_BEFORE] ?? 0);
        if (notBefore > Date.now()) {
          await waitUntil(notBefore, heartbeat);
        }
      }
      await processMessage({
        topic,
        partition,
        message,
        handle: options.handle,
        forward,
        policy: options.policy,
      });
    },
  });

  console.log(`[kafka] consumer ${options.groupId} running on ${options.topics.join(', ')}`);

  return {
    consumer,
    async disconnect() {
      await consumer.disconnect();
      await producer.disconnect();
    },
  };
}

export interface TopicSpec {
  topic: string;
  numPartitions?: number;
}

/**
 * Makes sure topics exist, treating "already exists" as success.
 *
 * Lists first and creates only what is missing, so pre-created topics (the normal case on
 * a managed cluster) cost one metadata call. TOPIC_ALREADY_EXISTS from a race with
 * another instance is also success. A refused create — the API key lacks the ACL — is
 * logged and not thrown: the service can still run against the topics that do exist.
 */
export async function ensureTopics(specs: TopicSpec[]): Promise<void> {
  const admin = kafka().admin();
  await admin.connect();
  try {
    const existing = new Set(await admin.listTopics());
    const missing = specs.filter((spec) => !existing.has(spec.topic));
    if (missing.length === 0) {
      console.log(`[kafka] topics present: ${specs.map((s) => s.topic).join(', ')}`);
      return;
    }
    try {
      await admin.createTopics({
        waitForLeaders: true,
        topics: missing.map((spec) => ({
          topic: spec.topic,
          numPartitions: spec.numPartitions ?? 1,
        })),
      });
      console.log(`[kafka] created topics: ${missing.map((s) => s.topic).join(', ')}`);
    } catch (err) {
      const type = (err as { type?: string } | null)?.type;
      if (type === 'TOPIC_ALREADY_EXISTS') {
        return;
      }
      console.error(
        `[kafka] could not create topics ${missing.map((s) => s.topic).join(', ')} —`,
        err
      );
    }
  } finally {
    await admin.disconnect();
  }
}
