import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import { askHandler, askStreamHandler } from '../controllers/ask.controller.js';
import { askSchema } from '../schemas/qa.schema.js';

const router = Router();

router.post('/ask', requireAuth, validate(askSchema), askHandler);
router.post('/ask/stream', requireAuth, validate(askSchema), askStreamHandler);

export default router;
