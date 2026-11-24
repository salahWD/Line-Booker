import { Router } from 'express';
import * as c from '../controllers/misc.controller.js';

// DEVELOPMENT ONLY (returns 404 in production): inbox of mocked SMS / push messages.
export const devRoutes = Router();
devRoutes.get('/notifications', c.devInbox);
devRoutes.get('/notifications.json', c.devInboxJson);
