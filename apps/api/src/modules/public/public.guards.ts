import type { Request } from 'express';
import { AppError } from '../../lib/errors';
import { getWorkspaceId } from '../../lib/workspaceContext';

// The public (external) API is authenticated by `x-api-key` ALONE — no JWT. That
// makes the workspace-scope guard the single most important control here: a key
// with no workspace (the bootstrap/service DEFAULT_API_KEY, whose workspaceId is
// null) would otherwise resolve to `undefined` and read EVERY tenant's rows.
//
// So: the public API is only usable with a workspace-BOUND key (one an operator
// minted inside their workspace via /admin/api-keys). Any request whose key does
// not carry a workspaceId is refused. This closes the cross-tenant IDOR that
// workspaceContext.ts (lines 4-14) warns about.
export function requirePublicWorkspace(req: Request): string {
  const workspaceId = getWorkspaceId(req);
  if (!workspaceId) {
    throw new AppError(
      'Bu uç nokta çalışma alanına bağlı bir API anahtarı gerektirir (servis anahtarı kabul edilmez)',
      403,
      'WORKSPACE_REQUIRED'
    );
  }
  return workspaceId;
}

// Coarse scope check. Reads accept any valid key; writes (send) require a key
// that holds 'write' or 'admin'. Scopes are stored on the ApiKey row and set at
// creation time in /admin/api-keys.
export function requireScope(req: Request, scope: 'read' | 'write'): void {
  const scopes = req.apiKey?.scopes ?? [];
  if (scope === 'read') return; // any authenticated key can read
  if (scopes.includes('write') || scopes.includes('admin')) return;
  throw new AppError(
    "Bu işlem için 'write' kapsamlı bir API anahtarı gerekli",
    403,
    'INSUFFICIENT_SCOPE'
  );
}
