import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { optionalJwt } from '../../middleware/optionalJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import {
  createFlowHandler,
  deleteFlowHandler,
  getFlowHandler,
  listFlowsHandler,
  runFlowHandler,
  updateFlowHandler
} from './rpa.controller';

export const rpaRouter = Router();

rpaRouter.get('/', requireApiKey, optionalJwt, asyncHandler(listFlowsHandler));
rpaRouter.get('/:id', requireApiKey, asyncHandler(getFlowHandler));
rpaRouter.post('/', requireApiKey, authenticateJwt, asyncHandler(createFlowHandler));
rpaRouter.post('/:id/run', requireApiKey, authenticateJwt, asyncHandler(runFlowHandler));
rpaRouter.put('/:id', requireApiKey, authenticateJwt, asyncHandler(updateFlowHandler));
rpaRouter.delete('/:id', requireApiKey, authenticateJwt, asyncHandler(deleteFlowHandler));
