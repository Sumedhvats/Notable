import type { Request, Response, NextFunction } from 'express';
import { ZodType } from 'zod';

export function validate(schema: ZodType, source: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((e: { path: (string | number | symbol)[]; message: string }) => ({
        path: e.path.join('.'),
        message: e.message,
      }));
      res.status(400).json({ error: 'ValidationError', details });
      return;
    }
    req[source] = result.data;
    next();
  };
}
