export type SocialProvider = 'X' | 'META' | 'INSTAGRAM';

export interface SocialAccountCreate {
  provider: SocialProvider;
  providerAccountId: string;
  userId: string;
  displayName?: string;
  username?: string;
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: Date;
  scopes?: string[];
  metadata?: Record<string, unknown>;
}
