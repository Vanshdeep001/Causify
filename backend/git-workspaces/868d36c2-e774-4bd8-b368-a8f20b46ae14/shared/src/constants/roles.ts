// =============================================
// Shared Constants — Roles
// =============================================

export const ROLES = {
  CUSTOMER: 'customer',
  SELLER: 'seller',
  ADMIN: 'admin',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_HIERARCHY: Record<Role, number> = {
  [ROLES.CUSTOMER]: 1,
  [ROLES.SELLER]: 2,
  [ROLES.ADMIN]: 3,
};

/**
 * Check if a role has at least the given access level.
 */
export function hasMinimumRole(userRole: Role, requiredRole: Role): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}
