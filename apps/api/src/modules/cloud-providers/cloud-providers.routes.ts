import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import {
  listProvidersHandler, createProviderHandler, updateProviderHandler, deleteProviderHandler,
  checkProviderHandler, syncProviderHandler, createPhoneHandler,
  deviceActionHandler, deviceShellHandler, deviceProxyHandler, deviceScreenshotHandler
} from './cloud-providers.controller';

export const cloudProvidersRouter = Router();

// Provider account CRUD + connectivity.
cloudProvidersRouter.get('/', requireApiKey, authenticateJwt, asyncHandler(listProvidersHandler));
cloudProvidersRouter.post('/', requireApiKey, authenticateJwt, asyncHandler(createProviderHandler));
cloudProvidersRouter.patch('/:id', requireApiKey, authenticateJwt, asyncHandler(updateProviderHandler));
cloudProvidersRouter.delete('/:id', requireApiKey, authenticateJwt, asyncHandler(deleteProviderHandler));
cloudProvidersRouter.post('/:id/check', requireApiKey, authenticateJwt, asyncHandler(checkProviderHandler));

// Phone fleet ops on a provider.
cloudProvidersRouter.post('/:id/sync', requireApiKey, authenticateJwt, asyncHandler(syncProviderHandler));
cloudProvidersRouter.post('/:id/phones', requireApiKey, authenticateJwt, asyncHandler(createPhoneHandler));

// Per-device control (our device id → resolves provider + externalId).
cloudProvidersRouter.post('/devices/:deviceId/action', requireApiKey, authenticateJwt, asyncHandler(deviceActionHandler));
cloudProvidersRouter.post('/devices/:deviceId/shell', requireApiKey, authenticateJwt, asyncHandler(deviceShellHandler));
cloudProvidersRouter.post('/devices/:deviceId/proxy', requireApiKey, authenticateJwt, asyncHandler(deviceProxyHandler));
cloudProvidersRouter.get('/devices/:deviceId/screenshot', requireApiKey, authenticateJwt, asyncHandler(deviceScreenshotHandler));
