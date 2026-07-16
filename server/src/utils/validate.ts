import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema } from 'zod';

// Validates and replaces req.body with the parsed, typed result.
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) return next(result.error);
    req.body = result.data;
    next();
  };
}
