import type { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/user.model.js';
import type { AuthenticatedRequest } from '../middleware/auth.middleware.js';
import logger from '../utils/logger.js';

const JWT_EXPIRY = '7d';

function signToken(userId: string): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET not configured');
  return jwt.sign({ userId }, secret, { expiresIn: JWT_EXPIRY });
}

export function oauthCallback(req: Request, res: Response): void {
  try {
    const user = req.user as any;
    if (!user?._id) {
      res.status(401).json({ error: 'Authentication failed' });
      return;
    }

    const token = signToken(user._id.toString());
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/auth/callback?token=${token}`);
  } catch (err) {
    logger.error('OAuth callback error:', err);
    res.status(500).json({ error: 'Authentication failed' });
  }
}
export async function getMe(
  req: AuthenticatedRequest,
  res: Response
): Promise<void> {
  try {
    const user = await User.findById(req.userId).select('-__v');
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    res.json({
      id: user._id,
      provider: user.provider,
      email: user.email,
      name: user.name,
      avatar: user.avatar,
      createdAt: user.createdAt,
    });
  } catch (err) {
    logger.error('getMe error:', err);
    res.status(500).json({ error: 'Failed to fetch user' });
  }
}
