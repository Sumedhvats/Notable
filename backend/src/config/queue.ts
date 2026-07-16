import { Queue } from 'bullmq';
import IORedis from 'ioredis';

// Reuse a single Redis client instance
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

export const redis = new IORedis.default(redisUrl, {
  maxRetriesPerRequest: null, // Required by BullMQ
});

export const memoryQueue = new Queue('memory-pipeline', {
  connection: redis as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000, // 2s, 4s, 8s
    },
    removeOnComplete: { count: 100 }, // Keep last 100 completed jobs
    removeOnFail: { count: 500 }, // Keep last 500 failed jobs for debugging
  },
});

export const enrichmentQueue = new Queue('enrichment-pipeline', {
  connection: redis as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 3000, // 3s, 6s, 12s — slightly longer than memory pipeline
    },
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 200 },
  },
});

