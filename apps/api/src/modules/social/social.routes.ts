import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { connectHandler, callbackHandler, listHandler } from './social.controller';

export const socialRouter = Router();

socialRouter.get('/connect/:provider', authenticateJwt, asyncHandler(connectHandler));
socialRouter.get('/callback/:provider', asyncHandler(callbackHandler));
socialRouter.get('/', authenticateJwt, asyncHandler(listHandler));
