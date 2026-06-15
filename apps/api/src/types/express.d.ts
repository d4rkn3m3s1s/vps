import type { ApiKey, User } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      auth?: {
        userId: string;
        email: string;
        role: string;
      };
      apiKey?: ApiKey;
      user?: User;
    }
  }
}

export {};
