// =============================================
// Authentication Controller — ShopVerse
// =============================================

import { Request, Response } from 'express';
import { User } from '../models/user.model';
import { hashPassword, comparePassword } from '../utils/hashPassword';
import { generateAccessToken, generateRefreshToken, verifyRefreshToken } from '../utils/generateToken';
import { ApiResponse } from '../utils/ApiResponse';
import { ApiError } from '../utils/ApiError';
import { COOKIES } from '../constants';
import { env } from '../config/env';
import { UserRole, UserStatus, AuthProvider } from '@shopverse/shared';
import { asyncHandler } from '../utils/asyncHandler';

// Helper to set HTTP-only cookies for authentication
const setAuthCookies = (res: Response, accessToken: string, refreshToken: string) => {
  const isProduction = env.NODE_ENV === 'production';

  res.cookie(COOKIES.ACCESS_TOKEN, accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    maxAge: 15 * 60 * 1000, // 15 minutes
  });

  res.cookie(COOKIES.REFRESH_TOKEN, refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
};

// Helper to clear cookies
const clearAuthCookies = (res: Response) => {
  const isProduction = env.NODE_ENV === 'production';

  res.clearCookie(COOKIES.ACCESS_TOKEN, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
  });

  res.clearCookie(COOKIES.REFRESH_TOKEN, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
  });
};

/**
 * Register a new customer user.
 */
export const register = asyncHandler(async (req: Request, res: Response) => {
  const { firstName, lastName, email, password, phone } = req.body;

  // 1. Check if email already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    throw ApiError.conflict('An account with this email already exists');
  }

  // 2. Hash password
  const hashedPassword = await hashPassword(password);

  // 3. Create user (defaults to Customer role, Active status, Local provider)
  const user = await User.create({
    firstName,
    lastName,
    email,
    password: hashedPassword,
    phone,
    role: UserRole.CUSTOMER,
    status: UserStatus.ACTIVE,
    provider: AuthProvider.LOCAL,
  });

  // 4. Generate tokens
  const payload = {
    userId: user.id,
    email: user.email,
    role: user.role,
  };
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  // 5. Set cookies
  setAuthCookies(res, accessToken, refreshToken);

  // 6. Return response
  return ApiResponse.created(
    res,
    {
      user,
      accessToken,
    },
    'User registered successfully'
  );
});

/**
 * Log in a user.
 */
export const login = asyncHandler(async (req: Request, res: Response) => {
  const { email, password } = req.body;

  // 1. Find user by email and select password (which is excluded by default)
  const user = await User.findOne({ email }).select('+password');
  if (!user) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  // 2. Check status
  if (user.status === UserStatus.SUSPENDED) {
    throw ApiError.forbidden('Your account has been suspended. Please contact support.');
  }

  // 3. Verify password
  if (!user.password) {
    throw ApiError.unauthorized('Invalid credentials');
  }
  const isMatch = await comparePassword(password, user.password);
  if (!isMatch) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  // 4. Generate tokens
  const payload = {
    userId: user.id,
    email: user.email,
    role: user.role,
  };
  const accessToken = generateAccessToken(payload);
  const refreshToken = generateRefreshToken(payload);

  // 5. Set cookies
  setAuthCookies(res, accessToken, refreshToken);

  // 6. Return user details
  // Exclude password from the returned object
  const userJson = user.toJSON();

  return ApiResponse.ok(
    res,
    {
      user: userJson,
      accessToken,
    },
    'Logged in successfully'
  );
});

/**
 * Log out a user.
 */
export const logout = asyncHandler(async (_req: Request, res: Response) => {
  clearAuthCookies(res);
  return ApiResponse.ok(res, null, 'Logged out successfully');
});

/**
 * Refresh access token.
 */
export const refreshToken = asyncHandler(async (req: Request, res: Response) => {
  const token = req.cookies?.[COOKIES.REFRESH_TOKEN];

  if (!token) {
    throw ApiError.unauthorized('Session expired. Please log in again.');
  }

  // Verify token
  const payload = verifyRefreshToken(token);

  // Fetch active user
  const user = await User.findById(payload.userId);
  if (!user || user.status === UserStatus.SUSPENDED) {
    clearAuthCookies(res);
    throw ApiError.unauthorized('User session is invalid or user is suspended.');
  }

  // Generate new tokens
  const newPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
  };
  const accessToken = generateAccessToken(newPayload);
  const newRefreshToken = generateRefreshToken(newPayload);

  // Rotate tokens
  setAuthCookies(res, accessToken, newRefreshToken);

  return ApiResponse.ok(
    res,
    {
      accessToken,
    },
    'Token refreshed successfully'
  );
});

/**
 * Retrieve current user's profile.
 */
export const getMe = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw ApiError.unauthorized('Access denied');
  }

  const user = await User.findById(req.user.userId);
  if (!user) {
    throw ApiError.notFound('User profile not found');
  }

  return ApiResponse.ok(res, user, 'Profile retrieved successfully');
});
