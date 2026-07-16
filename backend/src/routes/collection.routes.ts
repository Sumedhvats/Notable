import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware.js';
import {
  create,
  listCollections,
  getCollection,
  updateCollection,
  deleteCollection,
  addMemory,
  removeMemory,
} from '../controllers/collection.controller.js';

const router = Router();

// Collection CRUD
router.post('/collections', requireAuth, create);
router.get('/collections', requireAuth, listCollections);
router.get('/collections/:id', requireAuth, getCollection);
router.put('/collections/:id', requireAuth, updateCollection);
router.delete('/collections/:id', requireAuth, deleteCollection);

// Memory membership
router.post('/collections/:id/memories', requireAuth, addMemory);
router.delete('/collections/:id/memories/:memoryId', requireAuth, removeMemory);

export default router;
