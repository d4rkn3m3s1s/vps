import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { authRateLimiter } from '../../middleware/rateLimit';
import {
  disable2faHandler,
  enable2faHandler,
  loginHandler,
  logoutHandler,
  meHandler,
  refreshHandler,
  setup2faHandler
} from './auth.controller';

export const authRouter = Router();

authRouter.post('/login', authRateLimiter, asyncHandler(loginHandler));
authRouter.post('/refresh', authRateLimiter, asyncHandler(refreshHandler));
authRouter.post('/logout', asyncHandler(logoutHandler));
authRouter.get('/me', authenticateJwt, asyncHandler(meHandler));

// Two-factor management (require a valid session).
authRouter.post('/2fa/setup', authenticateJwt, asyncHandler(setup2faHandler));
authRouter.post('/2fa/enable', authenticateJwt, asyncHandler(enable2faHandler));
authRouter.post('/2fa/disable', authenticateJwt, asyncHandler(disable2faHandler));
