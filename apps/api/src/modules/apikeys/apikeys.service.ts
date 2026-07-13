import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { createKeyPair, encryptString, decryptString } from '../../lib/crypto';

// The single, stable name of the per-workspace key whose plaintext we keep
// (encrypted) so the docs page can show a real, copy-pasteable key. Kept in one
// place so create/lookup never drift.
export const DOC_KEY_NAME = 'API Dokümantasyonu';

// Scopes a key may hold. Coarse-grained for now; enforced by future scope checks.
export const API_SCOPES = ['read', 'write', 'admin'] as const;
export type ApiScope = (typeof API_SCOPES)[number];

// Public shape — never includes the hash or the plaintext key.
function present(k: {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: string[];
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: k.id,
    name: k.name,
    // A non-secret display hint, e.g. "flk_…a1b2c3c4". The full key is shown once.
    maskedKey: `flk_…${k.keyPrefix.slice(-8)}`,
    scopes: k.scopes,
    lastUsedAt: k.lastUsedAt,
    revoked: Boolean(k.revokedAt),
    createdAt: k.createdAt
  };
}

export class ApiKeysService {
  async list(workspaceId?: string) {
    const keys = await prisma.apiKey.findMany({
      where: {
        // Never expose the bootstrap service key in the management UI.
        keyPrefix: { not: 'default' },
        ...(workspaceId ? { workspaceId } : {})
      },
      orderBy: { createdAt: 'desc' }
    });
    return keys.map(present);
  }

  // Creates a key and returns the plaintext exactly once. Caller must surface it
  // to the user immediately; it is never retrievable again.
  async create(params: { name: string; scopes: ApiScope[]; workspaceId?: string; userId?: string }) {
    const { plain, prefix, hash } = createKeyPair('flk');
    const created = await prisma.apiKey.create({
      data: {
        name: params.name,
        keyPrefix: prefix,
        keyHash: hash,
        scopes: params.scopes.length ? params.scopes : ['read'],
        ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
        ...(params.userId ? { userId: params.userId } : {})
      }
    });
    return { key: present(created), plaintext: plain };
  }

  // Returns (creating on first call) the plaintext of the workspace's dedicated
  // documentation key. Unlike normal keys — which are hash-only and revealed
  // once — this ONE key stores its plaintext AES-encrypted at rest so the docs
  // page can render a ready-to-copy example. It carries read+write scope so all
  // documented endpoints work, and is workspace-scoped like any other key.
  async getOrCreateDocKey(workspaceId?: string): Promise<{ plaintext: string; maskedKey: string }> {
    // Reuse an existing, non-revoked doc key for this workspace if present.
    const existing = await prisma.apiKey.findFirst({
      where: {
        name: DOC_KEY_NAME,
        revokedAt: null,
        keyPrefix: { not: 'default' },
        ...(workspaceId ? { workspaceId } : { workspaceId: null })
      },
      orderBy: { createdAt: 'desc' }
    });
    if (existing?.docPlaintext) {
      try {
        return { plaintext: decryptString(existing.docPlaintext), maskedKey: present(existing).maskedKey };
      } catch {
        // Undecryptable (e.g. key rotated away) — fall through and mint a fresh
        // one below rather than surfacing a broken example.
      }
    }

    const { plain, prefix, hash } = createKeyPair('flk');
    const created = await prisma.apiKey.create({
      data: {
        name: DOC_KEY_NAME,
        keyPrefix: prefix,
        keyHash: hash,
        // Read-only: this is a documentation/playground example key whose
        // plaintext is stored + returned. A write-scoped key that leaks (it is
        // shown in the docs UI) could drive real devices; read scope contains
        // the blast radius to non-mutating endpoints.
        scopes: ['read'],
        docPlaintext: encryptString(plain),
        ...(workspaceId ? { workspaceId } : {})
      }
    });
    return { plaintext: plain, maskedKey: present(created).maskedKey };
  }

  async revoke(id: string, workspaceId?: string) {
    const key = await prisma.apiKey.findUnique({ where: { id } });
    if (!key || (workspaceId && key.workspaceId !== workspaceId)) {
      throw new AppError('API key not found', 404, 'API_KEY_NOT_FOUND');
    }
    if (key.keyPrefix === 'default') {
      throw new AppError('The default service key cannot be revoked here', 400, 'PROTECTED_KEY');
    }
    if (key.revokedAt) return present(key);
    const updated = await prisma.apiKey.update({ where: { id }, data: { revokedAt: new Date() } });
    return present(updated);
  }
}

export const apiKeysService = new ApiKeysService();
