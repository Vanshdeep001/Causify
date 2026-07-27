// =============================================
// Zod Validation Middleware
// =============================================
// Validates request body, params, and query
// against a Zod schema. Rejects with 400 if
// validation fails.
// =============================================

import { Request, Response, NextFunction } from 'express';
import { ZodTypeAny, ZodError } from 'zod';
import { ApiError } from '../utils/ApiError';

interface ValidationSchema {
  body?: ZodTypeAny;
  params?: ZodTypeAny;
  query?: ZodTypeAny;
}

/**
 * Validate request data against Zod schemas.
 *
 * Usage:
 * ```ts
 * router.post(
 *   '/products',
 *   validate({ body: createProductSchema }),
 *   productController.create
 * );
 * ```
 */
export function validate(schema: ValidationSchema) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (schema.body) {
        req.body = await schema.body.parseAsync(req.body);
      }
      if (schema.params) {
        req.params = await schema.params.parseAsync(req.params) as Record<string, string>;
      }
      if (schema.query) {
        req.query = await schema.query.parseAsync(req.query) as Record<string, string>;
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const errors: Record<string, string[]> = {};
        error.errors.forEach((e) => {
          const path = e.path.join('.');
          if (!errors[path]) {
            errors[path] = [];
          }
          errors[path].push(e.message);
        });
        next(ApiError.badRequest('Validation failed', errors));
      } else {
        next(error);
      }
    }
  };
}
