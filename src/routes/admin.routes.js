import { Router } from 'express';
import { numericIdParams } from '../middleware/params.js';
import * as c from '../controllers/admin.controller.js';
import { requireRole } from '../middleware/auth.js';

export const adminRoutes = numericIdParams(Router());
adminRoutes.use(requireRole('platform_admin'));

adminRoutes.get('/', c.dashboard);

adminRoutes.get('/businesses', c.businesses);
adminRoutes.get('/businesses/new', c.newBusiness);
adminRoutes.post('/businesses', c.createBusiness);
adminRoutes.post('/businesses/:id/active', c.toggleBusiness);

adminRoutes.get('/settings', c.settings);
adminRoutes.post('/settings', c.saveSettings);

// Manual Whish payment verification (platform admin only)
adminRoutes.get('/payments', c.paymentQueue);
adminRoutes.post('/payments/:id/confirm', c.confirmPayment);
adminRoutes.post('/payments/:id/reject', c.rejectPayment);
adminRoutes.get('/payments/:id/proof', c.proof);

adminRoutes.get('/settlement', c.settlement);
adminRoutes.get('/notifications', c.notifications);
adminRoutes.get('/audit', c.audit);
