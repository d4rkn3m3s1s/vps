import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { optionalJwt } from '../../middleware/optionalJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { createInstanceHandler, provisionStatusHandler, provisionStepsHandler } from './provision.controller';

// Tek-tıkla cihaz oluşturma. Sıfırdan yeni izole Waydroid instance kurar; ilerleme
// canlı olarak /ws/devices üzerinden `provision.progress` event'iyle akar (agent → API).
export const provisionRouter = Router();

provisionRouter.get('/steps', requireApiKey, optionalJwt, asyncHandler(provisionStepsHandler));
provisionRouter.get('/status/:jobId', requireApiKey, authenticateJwt, asyncHandler(provisionStatusHandler));
provisionRouter.post('/create', requireApiKey, authenticateJwt, asyncHandler(createInstanceHandler));
