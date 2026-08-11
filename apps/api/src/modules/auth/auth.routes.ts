import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { authRateLimiter, refreshRateLimiter, twoFactorRateLimiter } from '../../middleware/rateLimit';
import {
  disable2faHandler,
  enable2faHandler,
  loginHandler,
  logoutHandler,
  meHandler,
  refreshHandler,
  setup2faHandler,
  wsTokenHandler
} from './auth.controller';

export const authRouter = Router();

authRouter.post('/login', authRateLimiter, asyncHandler(loginHandler));
// Refresh uses its own looser limiter so multi-tab users aren't logged out.
authRouter.post('/refresh', refreshRateLimiter, asyncHandler(refreshHandler));
authRouter.post('/logout', asyncHandler(logoutHandler));
authRouter.get('/me', authenticateJwt, asyncHandler(meHandler));

// Two-factor management (require a valid session). enable/disable verify a TOTP
// code, so they carry a tight anti-brute-force limiter on top of the session.
authRouter.post('/2fa/setup', authenticateJwt, asyncHandler(setup2faHandler));
authRouter.post('/2fa/enable', twoFactorRateLimiter, authenticateJwt, asyncHandler(enable2faHandler));
authRouter.post('/2fa/disable', twoFactorRateLimiter, authenticateJwt, asyncHandler(disable2faHandler));

// ★2026-08-12: tarayicinin /ws/devices soketini acmasi icin KISA OMURLU token.
// Panel bunu admin servis kimligiyle cagirir ve donen 10 dakikalik token'i tarayiciya
// verir — boylece 2 saatlik ADMIN token'i artik tarayiciya inmiyor.
authRouter.post('/ws-token', authenticateJwt, asyncHandler(wsTokenHandler));
