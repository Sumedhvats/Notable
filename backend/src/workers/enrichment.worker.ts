import { Worker } from 'bullmq';
import { redis } from '../config/queue.js';
import { enrich } from '../services/enrichment.service.js';
import logger from '../utils/logger.js';

export const enrichmentWorker = new Worker(
  'enrichment-pipeline',
  async (job) => {
    const { memoryId, userId } = job.data;
    logger.info(`Enrichment worker processing job ${job.id} for memory ${memoryId}`);

    try {
      await enrich(memoryId, userId);
      logger.info(`Enrichment worker job ${job.id} completed for memory ${memoryId}`);
    } catch (err) {
      const errMsg = (err as Error).message;
      logger.error(`Enrichment worker job ${job.id} failed for memory ${memoryId}: ${errMsg}`);

      // Rethrow so BullMQ can retry (up to 3 attempts)
      // After all retries exhausted, the job silently fails — memory stays 'ready'
      throw err;
    }
  },
  {
    connection: redis as any,
    concurrency: 1, // Process one enrichment at a time to respect Groq rate limits
  },
);

// Listen to worker errors to prevent uncaught exceptions
enrichmentWorker.on('error', (err) => {
  logger.error('Enrichment worker encountered a global error:', err.message);
});
