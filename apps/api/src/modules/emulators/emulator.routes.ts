import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import {
  closeAppHandler,
  createEmulatorHandler,
  deleteEmulatorHandler,
  installApkHandler,
  listEmulatorsHandler,
  screenshotHandler,
  shellHandler,
  startEmulatorHandler,
  stopEmulatorHandler,
  openAppHandler
} from './emulator.controller';

export const emulatorRouter = Router();

emulatorRouter.get('/', requireApiKey, asyncHandler(listEmulatorsHandler));
emulatorRouter.post('/', requireApiKey, authenticateJwt, asyncHandler(createEmulatorHandler));
emulatorRouter.post('/:id/start', requireApiKey, authenticateJwt, asyncHandler(startEmulatorHandler));
emulatorRouter.post('/:id/stop', requireApiKey, authenticateJwt, asyncHandler(stopEmulatorHandler));
emulatorRouter.delete('/:id', requireApiKey, authenticateJwt, asyncHandler(deleteEmulatorHandler));
emulatorRouter.post('/:id/install', requireApiKey, authenticateJwt, asyncHandler(installApkHandler));
emulatorRouter.post('/:id/screenshot', requireApiKey, authenticateJwt, asyncHandler(screenshotHandler));
emulatorRouter.post('/:id/shell', requireApiKey, authenticateJwt, asyncHandler(shellHandler));
emulatorRouter.post('/:id/open-app', requireApiKey, authenticateJwt, asyncHandler(openAppHandler));
emulatorRouter.post('/:id/close-app', requireApiKey, authenticateJwt, asyncHandler(closeAppHandler));
