import { Partitioners, type Producer } from 'kafkajs';
import type { OrderEvent, Topic } from '@openshelf/types';
import { kafka } from './client.js';

export interface EventProducer {
  /**
   * Sends one event and resolves once the broker has acknowledged it. Rejects on any
   * failure — use emitEvent where a failure must not reach the caller.
   */
  publish(topic: Topic, event: OrderEvent, key: string): Promise<void>;
  disconnect(): Promise<void>;
}

/** Header carrying the event type, so a consumer can route or filter without parsing. */
export const EVENT_TYPE_HEADER = 'x-event-type';

/**
 * A producer that connects on first publish.
 *
 * One connect promise is shared by every concurrent publish, and cleared if connecting
 * fails, so a broker that was down at the first send is retried on the next one rather
 * than leaving the producer permanently broken.
 *
 * `acks: -1` waits for all in-sync replicas: an event this service believes it sent
 * should survive a broker failover.
 */
export function createProducer(
  factory: () => Producer = () =>
    kafka().producer({
      allowAutoTopicCreation: false,
      // Pinned explicitly: kafkajs 2 changed its default partitioner and warns on every
      // producer that leaves it implicit. This is that default (murmur2, Java-compatible).
      createPartitioner: Partitioners.DefaultPartitioner,
    })
): EventProducer {
  let producer: Producer | undefined;
  let connecting: Promise<Producer> | undefined;

  function connected(): Promise<Producer> {
    connecting ??= (async () => {
      producer ??= factory();
      await producer.connect();
      return producer;
    })().catch((err) => {
      connecting = undefined;
      throw err;
    });
    return connecting;
  }

  return {
    async publish(topic, event, key) {
      const p = await connected();
      await p.send({
        topic,
        acks: -1,
        messages: [
          {
            key,
            value: JSON.stringify(event),
            headers: { [EVENT_TYPE_HEADER]: event.type },
          },
        ],
      });
    },
    async disconnect() {
      connecting = undefined;
      await producer?.disconnect();
    },
  };
}

/**
 * Sends an event without letting the outcome reach the caller.
 *
 * The originating request has already committed — an order is written, a buyer has paid —
 * and a broker outage must not turn that into a 500. So this never throws and is never
 * awaited by request handlers. A failure is logged with console.error, loudly, because it
 * is the only trace: the event is lost. (A transactional outbox is the fix for that; this
 * is deliberately the simpler posture, the same one sendOtpEmail takes.)
 *
 * The returned promise always resolves; it exists so tests can wait for the attempt.
 */
export function emitEvent(
  producer: EventProducer,
  topic: Topic,
  event: OrderEvent,
  key: string
): Promise<void> {
  return producer.publish(topic, event, key).then(
    () => {
      console.log(`[kafka] produced ${event.type} ${event.eventId} key=${key}`);
    },
    (err: unknown) => {
      console.error(
        `[kafka] FAILED to produce ${event.type} ${event.eventId} key=${key} — event lost:`,
        err instanceof Error ? `${err.name}: ${err.message}` : err
      );
    }
  );
}
