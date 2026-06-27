/**
 * Role-based access control.
 *
 * Roles: 'user' (default), 'merchant', 'dpo', 'admin'.
 * Multiple roles allowed (user can be both 'user' and 'merchant').
 */

import { ForbiddenError } from "./errors.js";
import type { AuthContext, Role } from "./types.js";

export const ROLES = {
  USER: "user",
  MERCHANT: "merchant",
  DPO: "dpo",
  ADMIN: "admin",
} as const satisfies Record<string, Role>;

export function hasRole(ctx: AuthContext, role: Role | Role[]): boolean {
  const required = Array.isArray(role) ? role : [role];
  return required.some((r) => ctx.groups.includes(r));
}

export function requireRole(ctx: AuthContext, role: Role | Role[]): void {
  if (!hasRole(ctx, role)) {
    throw new ForbiddenError();
  }
}

export function requireDpo(ctx: AuthContext): void {
  requireRole(ctx, "dpo");
}

export function requireUser(ctx: AuthContext): { userId: string; email: string } {
  return { userId: ctx.userId, email: ctx.email };
}
