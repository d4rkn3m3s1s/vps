import type { Request } from 'express';
import { AppError } from './errors';

// The active workspace for a request. For interactive (JWT) calls this comes
// from the token. For service calls (API key only, e.g. the host agent or the
// dashboard service client) there's no workspace in context — those callers must
// pass an explicit workspaceId or operate cross-workspace by design.
export function getWorkspaceId(req: Request): string | undefined {
  return req.auth?.workspaceId;
}

// Use in handlers that MUST be workspace-scoped (all interactive resource reads
// and writes). Throws if there's no active workspace.
export function requireWorkspaceId(req: Request): string {
  const id = req.auth?.workspaceId;
  if (!id) throw new AppError('No active workspace', 400, 'NO_ACTIVE_WORKSPACE');
  return id;
}
