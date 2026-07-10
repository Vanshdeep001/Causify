// =============================================
// Authentication Middleware — JWT
// =============================================
// Verifies the access token from httpOnly cookies
// or Authorization header, and attaches the user
// payload to the request object.
// =============================================

import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken, TokenPayload } from '../utils/generateToken';
import { ApiError } from '../utils/ApiError';
import { COOKIES } from '../constants';

// Extend Express Request to include user payload
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

/**
 * Authenticate requests using JWT.
 * Checks cookies first, then Authorization header.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    let token: string | undefined;

    // 1. Check httpOnly cookie
    token = req.cookies?.[COOKIES.ACCESS_TOKEN];

    // 2. Fallback to Authorization header
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (!token) {
      throw ApiError.unauthorized('Access token is required');
    }

    // Verify and decode
    const payload = verifyAccessToken(token);
    req.user = payload;
    next();
  } catch (error) {
    if (error instanceof ApiError) {
      next(error);
    } else {
      next(ApiError.unauthorized('Invalid or expired access token'));
    }
  }
}

/**
 * Optional authentication — attaches user if token is
 * present, but doesn't reject if missing. Useful for
 * public pages that personalize content for logged-in users.
 */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    let token: string | undefined;
    token = req.cookies?.[COOKIES.ACCESS_TOKEN];

    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }

    if (token) {
      req.user = verifyAccessToken(token);
    }
  } catch {
    // Token invalid — proceed as unauthenticated
  }
  next();
}
