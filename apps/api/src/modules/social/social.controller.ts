import type { Request, Response, NextFunction } from 'express';
import { env } from '../../config/env';
import {
  createPkcePair,
  createSignedState,
  exchangeXCodeForToken,
  fetchXMe,
  getProviderRedirectUrl,
  parseAndVerifyState
} from './oauth';
import { upsertSocialAccount, listSocialAccountsForUser } from './social.service';
import { writeAuditLog } from '../audit/audit.service';

export async function connectHandler(req: Request, res: Response, _next: NextFunction): Promise<void> {
  const provider = String(req.params.provider ?? '').toUpperCase();
  const user = (req as any).user;
  if (!user?.id) {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Authentication required' });
    return;
  }

  const { verifier, challenge } = createPkcePair();
  const state = createSignedState({ uid: user.id, p: provider, ts: Date.now(), cv: verifier });
  const redirectUri = `${env.apiBaseUrl}/social/callback/${provider}`;
  const scopes = provider === 'X'
    ? ['tweet.read', 'tweet.write', 'users.read', 'offline.access']
    : [];
  const url = getProviderRedirectUrl(provider, state, redirectUri, scopes);
  const urlObj = new URL(url);
  if (provider === 'X') {
    urlObj.searchParams.set('code_challenge', challenge);
    urlObj.searchParams.set('code_challenge_method', 'S256');
  }
  res.redirect(urlObj.toString());
}

export async function callbackHandler(req: Request, res: Response, _next: NextFunction): Promise<void> {
  const provider = String(req.params.provider ?? '').toUpperCase();
  const { code, state } = req.query as any;

  if (!code) {
    res.status(400).json({ error: 'Missing code' });
    return;
  }

  const parsedState = parseAndVerifyState(String(state ?? ''));
  if (!parsedState?.uid || parsedState.p !== provider) {
    res.status(400).json({ error: 'Invalid state' });
    return;
  }

  if (provider !== 'X') {
    res.status(501).json({ error: 'NOT_IMPLEMENTED', message: `${provider} token exchange is not implemented yet` });
    return;
  }

  if (!parsedState.cv) {
    res.status(400).json({ error: 'Invalid state' });
    return;
  }

  const redirectUri = `${env.apiBaseUrl}/social/callback/${provider}`;
  const tokenResult = await exchangeXCodeForToken({
    code: String(code),
    redirectUri,
    codeVerifier: parsedState.cv
  });

  const me = await fetchXMe(tokenResult.accessToken);
  const tokenExpiresAt = tokenResult.expiresIn
    ? new Date(Date.now() + tokenResult.expiresIn * 1000)
    : undefined;

  const scopes = tokenResult.scope
    ? tokenResult.scope.split(' ').filter(Boolean)
    : [];

  const record = await upsertSocialAccount({
    provider,
    providerAccountId: me.id,
    userId: parsedState.uid,
    displayName: me.name,
    username: me.username,
    accessToken: tokenResult.accessToken,
    refreshToken: tokenResult.refreshToken,
    tokenExpiresAt,
    scopes,
    metadata: { source: 'oauth_callback' }
  });

  await writeAuditLog({
    userId: parsedState.uid,
    action: 'social.account.connected',
    resourceType: 'socialAccount',
    resourceId: record.id,
    requestId: req.requestId,
    ip: req.ip,
    userAgent: req.get('user-agent') ?? undefined,
    metadata: {
      provider,
      providerAccountId: me.id,
      username: me.username ?? null
    }
  });

  res.json({
    ok: true,
    provider,
    account: {
      id: record.id,
      providerAccountId: record.providerAccountId,
      username: record.username,
      displayName: record.displayName
    }
  });
}

export async function listHandler(req: Request, res: Response, _next: NextFunction): Promise<void> {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ error: 'unauthenticated' });
    return;
  }
  const rows = await listSocialAccountsForUser(user.id);
  res.json(rows);
}
