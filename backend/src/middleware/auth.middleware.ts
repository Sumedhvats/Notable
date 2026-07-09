import type { Request, Response, NextFunction } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { getAuth } from "../lib/auth.js";

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userRole?: string;
  session?: {
    user: {
      id: string;
      email: string;
      name: string;
      role: string;
    };
  };
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const auth = getAuth();
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    if (!session) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    req.userId = session.user.id;
    req.userRole = (session.user as any).role || "paid";
    req.session = session as any;
    next();
  } catch (err) {
    res.status(500).json({ error: "Authentication failed" });
  }
}
