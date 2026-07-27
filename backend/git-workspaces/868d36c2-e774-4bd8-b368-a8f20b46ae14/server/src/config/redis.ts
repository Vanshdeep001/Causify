// =============================================
// Redis Connection — ioredis
// =============================================
// Provides a singleton Redis client with
// automatic reconnection and error handling.
// =============================================

import Redis from 'ioredis';
import { env } from './env';
import logger from './logger';

let redisClient: Redis | null = null;

export function createRedisClient(): Redis {
  if (redisClient) {
    return redisClient;
  }

  redisClient = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 3000);
      logger.warn(`Redis retry attempt ${times}, next in ${delay}ms`);
      return delay;
    },
    lazyConnect: true,
  });

  redisClient.on('connect', () => {
    logger.info('🔴 Redis connected successfully');
  });

  redisClient.on('error', (error) => {
    logger.error('Redis connection error:', error);
  });

  redisClient.on('close', () => {
    logger.warn('Redis connection closed');
  });

  redisClient.on('reconnecting', () => {
    logger.info('Redis reconnecting...');
  });

  return redisClient;
}

export async function connectRedis(): Promise<void> {
  try {
    const client = createRedisClient();
    await client.connect();
  } catch (error) {
    logger.error('❌ Redis connection failed:', error);
    // Redis is non-critical — app can still function with degraded caching
    logger.warn('⚠️ Continuing without Redis. Caching will be disabled.');
  }
}

export async function disconnectRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info('Redis disconnected gracefully');
  }
}

export function getRedisClient(): Redis | null {
  return redisClient;
}

export default { createRedisClient, connectRedis, disconnectRedis, getRedisClient };
