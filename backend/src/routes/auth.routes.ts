import { Router } from 'express';
import passport from 'passport';
import { oauthCallback, getMe } from '../controllers/auth.controller.js';
import { requireAuth } from '../middleware/auth.middleware.js';

const router = Router();

router.get(
  '/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);
router.get(
  '/google/callback',
  passport.authenticate('google', {
    session: false,
    failureRedirect: '/api/v1/auth/google/failure',
  }),
  oauthCallback
);

router.get(
  '/github',
  passport.authenticate('github', { scope: ['user:email'] })
);
router.get(
  '/github/callback',
  passport.authenticate('github', {
    session: false,
    failureRedirect: '/api/v1/auth/github/failure',
  }),
  oauthCallback
);
router.get('/google/failure', (_req, res) => {
  res.status(401).json({ error: 'Google authentication failed' });
});

router.get('/github/failure', (_req, res) => {
  res.status(401).json({ error: 'GitHub authentication failed' });
});
router.get('/me', requireAuth, getMe as any);

export default router;
