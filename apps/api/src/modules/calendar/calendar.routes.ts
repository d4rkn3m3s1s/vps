import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { authenticateJwt } from '../../middleware/authenticateJwt';
import { requireApiKey } from '../../middleware/requireApiKey';
import { createPostHandler, deletePostHandler, listPostsHandler, updatePostHandler } from './calendar.controller';

export const calendarRouter = Router();

calendarRouter.use(requireApiKey, authenticateJwt);

calendarRouter.get('/posts', asyncHandler(listPostsHandler));
calendarRouter.post('/posts', asyncHandler(createPostHandler));
calendarRouter.put('/posts/:id', asyncHandler(updatePostHandler));
calendarRouter.delete('/posts/:id', asyncHandler(deletePostHandler));
