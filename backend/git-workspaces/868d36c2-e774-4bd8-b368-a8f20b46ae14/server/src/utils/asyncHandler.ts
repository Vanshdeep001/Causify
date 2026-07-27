// =============================================
// Async Handler Wrapper
// =============================================
// Wraps async route handlers to automatically
// catch errors and forward them to the global
// error handler. Eliminates try-catch in every
// controller method.
// =============================================

import { Request, Response, NextFunction, RequestHandler } from 'express';

type AsyncRequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => Promise<unknown>;

/**
 * Wraps an async Express route handler to catch
 * rejected promises and forward errors to next().
 *
 * Usage:
 * ```ts
 * router.get('/products', asyncHandler(async (req, res) => {
 *   const products = await productService.findAll();
 *   ApiResponse.ok(res, products);
 * }));
 * ```
 */
export const asyncHandler = (fn: AsyncRequestHandler): RequestHandler => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
