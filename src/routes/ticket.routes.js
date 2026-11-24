import { Router } from 'express';
import { numericIdParams } from '../middleware/params.js';
import * as c from '../controllers/ticket.controller.js';
import { requireCustomer } from '../middleware/auth.js';
import { joinLimiter, apiLimiter } from '../middleware/rateLimits.js';

export const ticketRoutes = numericIdParams(Router());

// Take a number (customer must be logged in with a verified phone)
ticketRoutes.post('/lines/:lineId/join', requireCustomer, joinLimiter, c.join);
ticketRoutes.get('/join/:token', c.onsitePage); // QR poster at the branch
ticketRoutes.post('/join/:token', requireCustomer, joinLimiter, c.onsiteJoin);

// Live tracker — anyone holding the secret link (the customer, or someone they shared it with)
ticketRoutes.get('/t/:token', c.trackerPage);
ticketRoutes.get('/t/:token/state', apiLimiter, c.trackerState);
ticketRoutes.get('/t/:token/events', c.trackerEvents);
ticketRoutes.post('/t/:token/alert', apiLimiter, c.setAlert);
ticketRoutes.post('/t/:token/cancel', c.cancel);
