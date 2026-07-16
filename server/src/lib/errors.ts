import type { Request, Response, NextFunction } from 'express';

export class AppError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const notFound = (msg = 'Resource not found') => new AppError(404, msg);
export const badRequest = (msg = 'Bad request', details?: unknown) => new AppError(400, msg, details);
export const unauthorized = (msg = 'Not authenticated') => new AppError(401, msg);
export const forbidden = (msg = 'Not authorized') => new AppError(403, msg);

// Wraps async route handlers so thrown/rejected errors reach the error middleware.
export const asyncHandler =
  <T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(fn: T) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next);
