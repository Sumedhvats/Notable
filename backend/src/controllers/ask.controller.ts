import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import { ask, askStream } from '../services/qa.service.js';
import logger from '../utils/logger.js';

export async function askHandler(req: AuthenticatedRequest, res: Response) {
  try {
    const { question } = req.body;
    const userId = req.userId!;

    const result = await ask(question, userId);
    return res.status(200).json(result);
  } catch (error) {
    logger.error('Error in ask:', (error as Error).message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

export async function askStreamHandler(req: AuthenticatedRequest, res: Response) {
  try {
    const { question } = req.body;
    const userId = req.userId!;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    for await (const event of askStream(question, userId)) {
      res.write(event);
    }

    res.end();
  } catch (error) {
    logger.error('Error in ask stream:', (error as Error).message);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Internal server error' });
    }
    res.write(`data: ${JSON.stringify({ type: 'error', content: 'Internal server error' })}\n\n`);
    res.end();
  }
}
