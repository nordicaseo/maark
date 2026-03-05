/**
 * Global role hierarchy and permission helpers.
 *
 * Global role levels (higher = more permissions):
 * owner > super_admin > admin > editor > writer > client
 */
export const ROLE_LEVELS: Record<string, number> = {
  owner: 60,
  super_admin: 50,
  admin: 40,
  editor: 30,
  writer: 20,
  client: 10,
};

/**
 * Project-member role hierarchy.
 * Used for project-scoped access checks.
 */
export const PROJECT_ROLE_LEVELS: Record<string, number> = {
  admin: 40,
  editor: 30,
  writer: 20,
  client: 10,
};

export const ROOT_ROLES = ['owner', 'super_admin'] as const;
export type RootRole = (typeof ROOT_ROLES)[number];

export const ASSIGNABLE_ROLES = [
  'client',
  'writer',
  'editor',
  'admin',
  'super_admin',
] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export const PROJECT_ASSIGNABLE_ROLES = ['client', 'writer', 'editor', 'admin'] as const;
export type ProjectAssignableRole = (typeof PROJECT_ASSIGNABLE_ROLES)[number];

/**
 * Check if a user's global role meets or exceeds the required global role.
 */
export function hasRole(userRole: string, requiredRole: string): boolean {
  return (ROLE_LEVELS[userRole] ?? 0) >= (ROLE_LEVELS[requiredRole] ?? 0);
}

/**
 * Check if a project-member role meets or exceeds the required project role.
 */
export function hasProjectRole(memberRole: string, requiredRole: string): boolean {
  return (PROJECT_ROLE_LEVELS[memberRole] ?? 0) >= (PROJECT_ROLE_LEVELS[requiredRole] ?? 0);
}

export function isRootRole(role: string): boolean {
  return ROOT_ROLES.includes(role as RootRole);
}

export function isClientRole(role: string): boolean {
  return role === 'client';
}
