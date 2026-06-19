import type { ApiKey, Host, User } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      auth?: {
        userId: string;
        email: string;
        role: string;
        workspaceId?: string;
        workspaceRole?: string;
      };
      apiKey?: ApiKey;
      user?: User;
      hostAgent?: Host;
    }
  }
}

export {};
