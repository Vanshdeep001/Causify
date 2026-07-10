// =============================================
// API Types — ShopVerse
// =============================================
// Standardized API response shapes used across
// both frontend (parsing) and backend (construction)
// =============================================

export interface IApiResponse<T = unknown> {
  success: boolean;
  statusCode: number;
  message: string;
  data: T;
  timestamp: string;
}

export interface IApiError {
  success: false;
  statusCode: number;
  message: string;
  errors?: Record<string, string[]>;
  stack?: string;
  timestamp: string;
}

export interface IPaginatedResponse<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

export interface ISortOptions {
  field: string;
  order: 'asc' | 'desc';
}

export interface IQueryParams {
  page?: number;
  limit?: number;
  sort?: string;
  order?: 'asc' | 'desc';
  search?: string;
  [key: string]: unknown;
}
