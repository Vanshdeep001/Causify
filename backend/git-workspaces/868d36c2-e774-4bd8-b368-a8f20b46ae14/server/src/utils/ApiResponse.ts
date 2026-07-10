// =============================================
// Standardized API Response
// =============================================
// Every successful API response uses this class
// to ensure a consistent shape across all endpoints.
// =============================================

import { Response } from 'express';

export class ApiResponse<T = unknown> {
  public readonly success: boolean;
  public readonly statusCode: number;
  public readonly message: string;
  public readonly data: T;
  public readonly timestamp: string;

  constructor(statusCode: number, message: string, data: T) {
    this.success = statusCode < 400;
    this.statusCode = statusCode;
    this.message = message;
    this.data = data;
    this.timestamp = new Date().toISOString();
  }

  /**
   * Send a standardized JSON response.
   */
  send(res: Response): Response {
    return res.status(this.statusCode).json({
      success: this.success,
      statusCode: this.statusCode,
      message: this.message,
      data: this.data,
      timestamp: this.timestamp,
    });
  }

  // Factory methods
  static ok<T>(res: Response, data: T, message = 'Success') {
    return new ApiResponse(200, message, data).send(res);
  }

  static created<T>(res: Response, data: T, message = 'Created successfully') {
    return new ApiResponse(201, message, data).send(res);
  }

  static noContent(res: Response, message = 'Deleted successfully') {
    return new ApiResponse(204, message, null).send(res);
  }
}
