// =============================================
// JWT Token Generation Utility
// =============================================

import jwt, { SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
}

/**
 * Generate a short-lived access token (default: 15 minutes).
 */
export function generateAccessToken(payload: TokenPayload): string {
  const options: SignOptions = {
    expiresIn: env.JWT_ACCESS_EXPIRY as string as unknown as number,
    issuer: 'shopverse',
    audience: 'shopverse-client',
  };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, options);
}

/**
 * Generate a long-lived refresh token (default: 7 days).
 */
export function generateRefreshToken(payload: TokenPayload): string {
  const options: SignOptions = {
    expiresIn: env.JWT_REFRESH_EXPIRY as string as unknown as number,
    issuer: 'shopverse',
    audience: 'shopverse-client',
  };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, options);
}

/**
 * Verify and decode an access token.
 */
export function verifyAccessToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: 'shopverse',
    audience: 'shopverse-client',
  }) as TokenPayload;
}

/**
 * Verify and decode a refresh token.
 */
export function verifyRefreshToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET, {
    issuer: 'shopverse',
    audience: 'shopverse-client',
  }) as TokenPayload;
}
