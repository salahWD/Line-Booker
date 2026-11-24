import { Router } from 'express';
import * as c from '../controllers/display.controller.js';

// Public waiting-room screens, protected only by the secret display token in the URL.
export const displayRoutes = Router();

displayRoutes.get('/:token', c.page);
displayRoutes.get('/:token/state', c.state);
displayRoutes.get('/:token/events', c.events);
