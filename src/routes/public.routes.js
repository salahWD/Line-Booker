import { Router } from 'express';
import * as c from '../controllers/public.controller.js';
import * as push from '../controllers/push.controller.js';
import { apiLimiter } from '../middleware/rateLimits.js';

export const publicRoutes = Router();

publicRoutes.get('/', c.home);
publicRoutes.get('/b/:slug', c.branchPage);
publicRoutes.get('/b/:slug/state', apiLimiter, c.branchState);
publicRoutes.get('/b/:slug/events', c.branchEvents);

// Must be served from the site root so it can receive push notifications for every page.
publicRoutes.get('/firebase-messaging-sw.js', push.serviceWorker);
