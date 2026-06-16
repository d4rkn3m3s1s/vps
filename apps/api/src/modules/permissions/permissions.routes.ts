import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireAdmin } from '../../middleware/requireAdmin';
import { requireApiKey } from '../../middleware/requireApiKey';
import {
  grantPermissionHandler,
  listPermissionsHandler,
  revokePermissionHandler
} from './permissions.controller';

export const permissionsRouter = Router();

permissionsRouter.get('/', requireApiKey, authenticateJwt, asyncHandler(listPermissionsHandler));
permissionsRouter.post('/', requireApiKey, authenticateJwt, requireAdmin, asyncHandler(grantPermissionHandler));
permissionsRouter.delete('/:id', requireApiKey, authenticateJwt, requireAdmin, asyncHandler(revokePermissionHandler));
