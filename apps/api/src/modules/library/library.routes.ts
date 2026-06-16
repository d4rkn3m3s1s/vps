import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { createAssetHandler, deleteAssetHandler, listAssetsHandler } from './library.controller';

export const libraryRouter = Router();

libraryRouter.get('/', requireApiKey, asyncHandler(listAssetsHandler));
libraryRouter.post('/', requireApiKey, authenticateJwt, asyncHandler(createAssetHandler));
libraryRouter.delete('/:id', requireApiKey, authenticateJwt, asyncHandler(deleteAssetHandler));
