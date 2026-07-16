import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import { validate } from '../middleware/validate.middleware.js';
import {
  createFromUrl,
  createFromExtension,
  getStatus,
  list,
  get,
  deleteMemory,
  rescrape,
  getRelated,
  exportMemoryMd,
  exportCollectionMd,
} from '../controllers/memory.controller.js';
import {
  createMemorySchema,
  createFromExtensionSchema,
} from '../schemas/memory.schema.js';

const router = Router();

// List memories (paginated, with search/filter)
router.get('/memories', requireAuth, list);

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

// Get single memory
router.get('/memories/:id', requireAuth, get);

// Get memory processing status
router.get('/memories/:id/status', requireAuth, getStatus);

// Get related memories (Pinecone similarity)
router.get('/memories/:id/related', requireAuth, getRelated);

// Export memory as markdown
router.get('/memories/:id/export/markdown', requireAuth, exportMemoryMd);

// Rescrape a memory
router.post('/memories/:id/rescrape', requireAuth, rescrape);

// Delete a memory (cascade)
router.delete('/memories/:id', requireAuth, deleteMemory);

// Export collection as markdown
router.get('/collections/:id/export/markdown', requireAuth, exportCollectionMd);

export default router;

