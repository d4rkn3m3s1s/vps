import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { installApkHandler, listApksHandler } from './apks.controller';

export const apksRouter = Router();

// Bundled APK catalog (WhatsApp / Magisk / a11y / ADBKeyboard, shipped in-repo).
apksRouter.get('/', requireApiKey, asyncHandler(listApksHandler));
apksRouter.post('/install', requireApiKey, authenticateJwt, asyncHandler(installApkHandler));
