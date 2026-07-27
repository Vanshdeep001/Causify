// =============================================
// Role-Based Access Control Middleware
// =============================================
// Restricts routes to specific user roles.
// Must be used AFTER authenticate middleware.
// =============================================

import { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/ApiError';

/**
 * Restrict access to specific roles.
 *
 * Usage:
 * ```ts
 * router.post(
 *   '/products',
 *   authenticate,
 *   authorize('seller', 'admin'),
 *   productController.create
 * );
 * ```
 */
export function authorize(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(ApiError.unauthorized('Authentication required'));
    }

    if (!roles.includes(req.user.role)) {
      return next(
        ApiError.forbidden(
          `Access denied. Required role(s): ${roles.join(', ')}. Your role: ${req.user.role}`
        )
      );
    }

    next();
  };
}
