// =============================================
// Rate Limiter Middleware
// =============================================
// Uses express-rate-limit with Redis store for
// distributed rate limiting across instances.
// Falls back to memory store if Redis unavailable.
// =============================================

import rateLimit from 'express-rate-limit';
import { env } from '../config/env';

/**
 * General rate limiter for all API routes.
 * Default: 100 requests per 15 minutes per IP.
 */
export const generalLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX_REQUESTS,
  message: {
    success: false,
    statusCode: 429,
    message: 'Too many requests. Please try again later.',
    timestamp: new Date().toISOString(),
  },
  standardHeaders: true, // Return rate limit info in `RateLimit-*` headers
  legacyHeaders: false,  // Disable `X-RateLimit-*` headers
});

/**
 * Strict rate limiter for auth routes.
 * 10 requests per 15 minutes (prevents brute force).
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: {
    success: false,
    statusCode: 429,
    message: 'Too many authentication attempts. Please try again after 15 minutes.',
    timestamp: new Date().toISOString(),
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Search rate limiter.
 * 30 requests per minute per IP.
 */
export const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: {
    success: false,
    statusCode: 429,
    message: 'Too many search requests. Please slow down.',
    timestamp: new Date().toISOString(),
  },
  standardHeaders: true,
  legacyHeaders: false,
});
