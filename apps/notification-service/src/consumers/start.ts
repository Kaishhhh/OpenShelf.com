import {
  DEFAULT_BACKOFF_MS,
  ensureTopics,
  runConsumer,
  type RetryPolicy,
  type RunningConsumer,
} from '@openshelf/kafka';
import { TOPICS } from '@openshelf/types';
import { handleOrderEvent } from './order-events.handler.js';

export const GROUP_ID = 'notification-service';
export const RETRY_TOPIC = 'notification-service.retry';
export const DLQ_TOPIC = 'notification-service.dlq';

/**
 * KAFKA_RETRY_BACKOFF_MS overrides the schedule (comma-separated milliseconds) — for
 * demonstrating the retry path locally without waiting minutes. Unset in normal use.
 */
function backoffSchedule(): number[] {
  const raw = process.env.KAFKA_RETRY_BACKOFF_MS?.trim();
  if (!raw) return DEFAULT_BACKOFF_MS;
  const parsed = raw.split(',').map((part) => Number(part.trim()));
  if (parsed.length === 0 || parsed.some((n) => !Number.isFinite(n) || n < 0)) {
    console.warn(`[kafka] ignoring invalid KAFKA_RETRY_BACKOFF_MS "${raw}"`);
    return DEFAULT_BACKOFF_MS;
  }
  return parsed;
}

/**
 * Starts the main consumer and the retry consumer.
 *
 * Two groups, not one, so a message waiting out its backoff on the retry topic never holds
 * up the order topics. Both use the same handler and the same policy.
 */
export async function startConsumers(): Promise<RunningConsumer[]> {
  const policy: RetryPolicy = {
    retryTopic: RETRY_TOPIC,
    dlqTopic: DLQ_TOPIC,
    maxRetries: 3,
    backoffMs: backoffSchedule(),
  };

  await ensureTopics([
    { topic: TOPICS.ORDER_CREATED },
    { topic: TOPICS.ORDER_STATUS_CHANGED },
    { topic: RETRY_TOPIC },
    { topic: DLQ_TOPIC },
  ]);

  const main = await runConsumer({
    groupId: GROUP_ID,
    topics: [TOPICS.ORDER_CREATED, TOPICS.ORDER_STATUS_CHANGED],
    handle: handleOrderEvent,
    policy,
  });

  const retry = await runConsumer({
    groupId: `${GROUP_ID}.retry`,
    topics: [RETRY_TOPIC],
    handle: handleOrderEvent,
    policy,
    honourNotBefore: true,
  });

  return [main, retry];
}
