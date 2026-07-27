// =============================================
// Server-side Constants — Re-export + extras
// =============================================

export { ROLES, ROLE_HIERARCHY, hasMinimumRole } from '@shopverse/shared';
export { ORDER_STATUS, ORDER_STATUS_TRANSITIONS, isValidStatusTransition } from '@shopverse/shared';
export { PAYMENT_METHODS, PAYMENT_STATUS, DEFAULT_CURRENCY } from '@shopverse/shared';
export { HTTP_STATUS } from './httpStatus';

// Cookie names
export const COOKIES = {
  ACCESS_TOKEN: 'shopverse_access_token',
  REFRESH_TOKEN: 'shopverse_refresh_token',
} as const;

// Cache TTLs (in seconds)
export const CACHE_TTL = {
  PRODUCT: 600,         // 10 minutes
  PRODUCT_LIST: 300,    // 5 minutes
  SEARCH: 300,          // 5 minutes
  CATEGORIES: 3600,     // 1 hour
  TRENDING: 3600,       // 1 hour
  CART: 86400,          // 24 hours
  SESSION: 604800,      // 7 days
} as const;

// Pagination defaults
export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 50,
} as const;
