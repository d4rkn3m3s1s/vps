import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors';

// Platform roles, from most to least privileged. `admin` can do everything;
// `operator` runs day-to-day fleet ops but not account/billing changes;
// `viewer` is read-only.
export const ROLES = ['admin', 'operator', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

const RANK: Record<Role, number> = { admin: 3, operator: 2, viewer: 1 };

// Gate a route to a minimum role. `requireRole('operator')` allows operator+admin.
export function requireRole(min: Role) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const role = req.auth?.role as Role | undefined;
    if (!role || !(role in RANK) || RANK[role] < RANK[min]) {
      next(new AppError(`Requires ${min} role or higher`, 403, 'FORBIDDEN'));
      return;
    }
    next();
  };
}
