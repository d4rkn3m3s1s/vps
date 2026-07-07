import type { Request } from 'express';
import { AppError } from './errors';

// The active workspace for a request. For interactive (JWT) calls this comes
// from the token. When there's no JWT but the caller authenticated with a
// workspace-bound API key (one an operator minted inside their workspace), fall
// back to THAT key's workspace so the request is still scoped — otherwise a
// tenant could call an `optionalJwt` route with only `x-api-key` and, with an
// undefined workspace, read every tenant's rows (cross-tenant IDOR).
//
// A service/global key with no workspaceId (e.g. the bootstrap DEFAULT_API_KEY
// used by the host agent / dashboard service client) still yields undefined here;
// those callers are cross-workspace by design and pass an explicit workspaceId or
// arrive with a JWT that sets req.auth.workspaceId.
export function getWorkspaceId(req: Request): string | undefined {
  return req.auth?.workspaceId ?? req.apiKey?.workspaceId ?? undefined;
}

// Use in handlers that MUST be workspace-scoped (all interactive resource reads
// and writes). Throws if there's no active workspace.
export function requireWorkspaceId(req: Request): string {
  const id = req.auth?.workspaceId;
  if (!id) throw new AppError('No active workspace', 400, 'NO_ACTIVE_WORKSPACE');
  return id;
}
