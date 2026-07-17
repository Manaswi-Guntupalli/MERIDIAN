import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/errors.js';
import { ZodError } from 'zod';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  // Never leak internal error details (stack traces, SQL, file paths) to
  // clients in production — log server-side, return a generic message.
  const isProd = process.env.NODE_ENV === 'production';
  console.error('[error]', err);
  res.status(500).json({
    error: isProd ? 'Internal server error' : err instanceof Error ? err.message : 'Internal server error',
  });
}
