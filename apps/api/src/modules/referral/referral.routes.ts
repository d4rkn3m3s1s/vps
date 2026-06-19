import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { getReferralHandler } from './referral.controller';

export const referralRouter = Router();

referralRouter.get('/', requireApiKey, authenticateJwt, asyncHandler(getReferralHandler));
