/**
 * Role hierarchy and permission helpers.
 *
 * Role levels (higher = more permissions):
 *   owner: 40, admin: 30, editor: 20, writer: 10
 */

export const ROLE_LEVELS: Record<string, number> = {
  owner: 40,
  admin: 30,
  editor: 20,
  writer: 10,
};

export const ASSIGNABLE_ROLES = ['writer', 'editor', 'admin'] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/**
 * Check if a user's role meets or exceeds the required role level.
 */
export function hasRole(userRole: string, requiredRole: string): boolean {
  return (ROLE_LEVELS[userRole] ?? 0) >= (ROLE_LEVELS[requiredRole] ?? 0);
}
