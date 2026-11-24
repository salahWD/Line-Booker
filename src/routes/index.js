// All routes. Each file groups the URLs of one area; access rules are applied per router.
import { Router } from 'express';
import { publicRoutes } from './public.routes.js';
import { authRoutes } from './auth.routes.js';
import { customerRoutes } from './customer.routes.js';
import { ticketRoutes } from './ticket.routes.js';
import { displayRoutes } from './display.routes.js';
import { operatorRoutes } from './operator.routes.js';
import { ownerRoutes } from './owner.routes.js';
import { adminRoutes } from './admin.routes.js';
import { devRoutes } from './dev.routes.js';

export const routes = Router();
routes.use(publicRoutes); // /, /b/:slug, service worker
routes.use(authRoutes); // /login, /staff/login, /logout
routes.use(ticketRoutes); // /t/:token, /lines/:id/join, /join/:token
routes.use(customerRoutes); // /me/*, /book/*
routes.use('/display', displayRoutes);
routes.use('/operator', operatorRoutes);
routes.use('/owner', ownerRoutes);
routes.use('/admin', adminRoutes);
routes.use('/dev', devRoutes);
