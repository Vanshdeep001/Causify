// =============================================
// Custom API Error Class
// =============================================
// Extends Error with HTTP status codes and
// operational error classification for the
// global error handler to distinguish between
// programmer errors and user-facing errors.
// =============================================

export class ApiError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly errors: Record<string, string[]>;

  constructor(
    statusCode: number,
    message: string,
    errors: Record<string, string[]> = {},
    isOperational = true,
    stack = ''
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.errors = errors;

    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }

    // Ensure instanceof works correctly across module boundaries
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  // Factory methods for common HTTP errors
  static badRequest(message = 'Bad Request', errors: Record<string, string[]> = {}) {
    return new ApiError(400, message, errors);
  }

  static unauthorized(message = 'Unauthorized') {
    return new ApiError(401, message);
  }

  static forbidden(message = 'Forbidden') {
    return new ApiError(403, message);
  }

  static notFound(message = 'Resource not found') {
    return new ApiError(404, message);
  }

  static conflict(message = 'Conflict') {
    return new ApiError(409, message);
  }

  static tooManyRequests(message = 'Too many requests') {
    return new ApiError(429, message);
  }

  static internal(message = 'Internal Server Error') {
    return new ApiError(500, message, {}, false);
  }
}
