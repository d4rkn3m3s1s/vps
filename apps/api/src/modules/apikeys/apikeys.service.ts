import { prisma } from '../../db/prisma';
import { AppError } from '../../lib/errors';
import { createKeyPair } from '../../lib/crypto';

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
