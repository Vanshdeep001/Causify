// =============================================
// Redis Cache Middleware
// =============================================
// Caches GET responses in Redis. Cache key is
// derived from the URL + query params.
// =============================================

import { Request, Response, NextFunction } from 'express';
import { getRedisClient } from '../config/redis';
import logger from '../config/logger';

/**
 * Cache middleware factory.
 *
 * @param ttlSeconds — Cache TTL in seconds
 * @param keyPrefix — Optional prefix for cache keys
 *
 * Usage:
 * ```ts
 * router.get('/products', cache(300, 'products'), productController.list);
 * ```
 */
export function cache(ttlSeconds: number, keyPrefix = 'cache') {
  return async (req: Request, res: Response, next: NextFunction) => {
    const redis = getRedisClient();

    // Skip caching if Redis is unavailable
    if (!redis) {
      return next();
    }

    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }

    const cacheKey = `${keyPrefix}:${req.originalUrl}`;

    try {
      const cachedData = await redis.get(cacheKey);

      if (cachedData) {
        logger.debug(`Cache HIT: ${cacheKey}`);
        const parsed = JSON.parse(cachedData);
        return res.status(200).json(parsed);
      }

      logger.debug(`Cache MISS: ${cacheKey}`);

      // Override res.json to intercept the response and cache it
      const originalJson = res.json.bind(res);
      res.json = ((data: unknown) => {
        // Only cache successful responses
        if (res.statusCode >= 200 && res.statusCode < 300) {
          redis
            .setex(cacheKey, ttlSeconds, JSON.stringify(data))
            .catch((err) => logger.error('Cache write error:', err));
        }
        return originalJson(data);
      }) as Response['json'];

      next();
    } catch (error) {
      logger.error('Cache middleware error:', error);
      next(); // Proceed without cache on error
    }
  };
}

/**
 * Invalidate cache by pattern.
 * Useful when data changes (e.g., product updated).
 */
export async function invalidateCache(pattern: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis) {
    return;
  }

  try {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
      logger.debug(`Cache invalidated: ${keys.length} keys matching "${pattern}"`);
    }
  } catch (error) {
    logger.error('Cache invalidation error:', error);
  }
}
