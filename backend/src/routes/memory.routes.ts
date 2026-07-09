import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import {
  createFromUrl,
  createFromExtension,
  getStatus,
} from '../controllers/memory.controller.js';
import {
  createMemorySchema,
  createFromExtensionSchema,
} from '../schemas/memory.schema.js';

const router = Router();

// Create memory from URL
router.post(
  '/memories',
  requireAuth,
  validate(createMemorySchema),
  createFromUrl
);

// Create memory from Chrome extension
router.post(
  '/memories/extension',
  requireAuth,
  validate(createFromExtensionSchema),
  createFromExtension
);

// Get memory processing status
router.get(
  '/memories/:id/status',
  requireAuth,
  getStatus
);

export default router;
