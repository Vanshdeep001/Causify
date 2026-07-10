// =============================================
// Pagination Utility
// =============================================

export interface PaginationOptions {
  page?: number;
  limit?: number;
  maxLimit?: number;
}

export interface PaginationResult {
  page: number;
  limit: number;
  skip: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

/**
 * Calculate pagination values from query params.
 * Enforces sane defaults and maximum limits.
 */
export function getPagination(
  options: PaginationOptions,
  totalDocuments: number
): PaginationResult {
  const maxLimit = options.maxLimit || 50;
  const page = Math.max(1, options.page || 1);
  const limit = Math.min(Math.max(1, options.limit || 20), maxLimit);
  const skip = (page - 1) * limit;
  const totalPages = Math.ceil(totalDocuments / limit);

  return {
    page,
    limit,
    skip,
    total: totalDocuments,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
}
