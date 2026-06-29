import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import {
  applyFingerprintHandler,
  getFingerprintHandler,
  listCountriesHandler,
  provisionIntegrityHandler,
  regenerateFingerprintHandler,
  updateGpsHandler
} from './fingerprint.controller';

export const fingerprintRouter = Router();

// Country catalog for GPS/SIM selection.
fingerprintRouter.get('/countries', requireApiKey, asyncHandler(listCountriesHandler));
fingerprintRouter.get('/:deviceId', requireApiKey, asyncHandler(getFingerprintHandler));
fingerprintRouter.post('/:deviceId/regenerate', requireApiKey, authenticateJwt, asyncHandler(regenerateFingerprintHandler));
fingerprintRouter.put('/:deviceId/gps', requireApiKey, authenticateJwt, asyncHandler(updateGpsHandler));
// Apply the stored fingerprint to the device + provision integrity (over ADB).
fingerprintRouter.post('/:deviceId/apply', requireApiKey, authenticateJwt, asyncHandler(applyFingerprintHandler));
fingerprintRouter.post('/:deviceId/provision-integrity', requireApiKey, authenticateJwt, asyncHandler(provisionIntegrityHandler));
