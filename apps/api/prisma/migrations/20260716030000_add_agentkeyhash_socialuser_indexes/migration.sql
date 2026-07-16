-- Index the hot agent-auth lookup column (sha256(agentKey) resolves the Host on
-- every /agent/jobs/next long-poll, heartbeat, and agent WS connect).
CREATE INDEX IF NOT EXISTS "Host_agentKeyHash_idx" ON "Host"("agentKeyHash");

-- Index SocialAccount.userId — the model's primary access pattern
-- (listSocialAccountsForUser filters by userId).
CREATE INDEX IF NOT EXISTS "SocialAccount_userId_idx" ON "SocialAccount"("userId");
