import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireAdmin } from '../../middleware/requireAdmin';
import { requireApiKey } from '../../middleware/requireApiKey';
import { createUserHandler, deleteUserHandler, listUsersHandler } from './users.controller';

export const usersRouter = Router();

usersRouter.get('/', requireApiKey, asyncHandler(listUsersHandler));
usersRouter.post('/', requireApiKey, authenticateJwt, requireAdmin, asyncHandler(createUserHandler));
usersRouter.delete('/:id', requireApiKey, authenticateJwt, requireAdmin, asyncHandler(deleteUserHandler));
