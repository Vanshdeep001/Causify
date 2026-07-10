// =============================================
// Global Error Handler Middleware
// =============================================
// Catches all errors thrown by controllers/services,
// classifies them, and sends a standardized response.
// =============================================

import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { ApiError } from '../utils/ApiError';
import logger from '../config/logger';
import { env } from '../config/env';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  // Default values
  let statusCode = 500;
  let message = 'Internal Server Error';
  let errors: Record<string, string[]> = {};
  let stack: string | undefined;

  // Known operational error
  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    message = err.message;
    errors = err.errors;
  }
  // Zod validation error
  else if (err instanceof ZodError) {
    statusCode = 400;
    message = 'Validation failed';
    errors = {};
    err.errors.forEach((e) => {
      const path = e.path.join('.');
      if (!errors[path]) {
        errors[path] = [];
      }
      errors[path].push(e.message);
    });
  }
  // Mongoose validation error
  else if (err.name === 'ValidationError') {
    statusCode = 400;
    message = 'Validation failed';
  }
  // Mongoose duplicate key error
  else if (err.name === 'MongoServerError' && (err as unknown as Record<string, unknown>).code === 11000) {
    statusCode = 409;
    message = 'Duplicate entry. This resource already exists.';
  }
  // JWT errors
  else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    message = 'Invalid token';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    message = 'Token expired';
  }

  // Include stack trace only in development
  if (env.NODE_ENV === 'development') {
    stack = err.stack;
  }

  // Log the error
  if (statusCode >= 500) {
    logger.error(`[${statusCode}] ${message}`, {
      error: err.message,
      stack: err.stack,
    });
  } else {
    logger.warn(`[${statusCode}] ${message}`);
  }

  res.status(statusCode).json({
    success: false,
    statusCode,
    message,
    errors: Object.keys(errors).length > 0 ? errors : undefined,
    stack,
    timestamp: new Date().toISOString(),
  });
}
