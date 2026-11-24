import { Router } from 'express';
import { numericIdParams } from '../middleware/params.js';
import * as c from '../controllers/operator.controller.js';
import { requireRole } from '../middleware/auth.js';

// Operators and owners. Branch-level access is checked inside the services.
export const operatorRoutes = numericIdParams(Router());
operatorRoutes.use(requireRole('branch_operator', 'business_owner'));

operatorRoutes.get('/', c.index);

// Live line console
operatorRoutes.get('/lines/:lineId', c.consolePage);
operatorRoutes.get('/lines/:lineId/state', c.state);
operatorRoutes.get('/lines/:lineId/events', c.events);
operatorRoutes.post('/lines/:lineId/call-next', c.callNext);
operatorRoutes.post('/lines/:lineId/walk-in', c.walkIn);
operatorRoutes.post('/lines/:lineId/:action', c.lineAction); // pause | resume | open | close
operatorRoutes.post('/tickets/:ticketId/:action', c.ticketAction); // call | recall | complete | skip | restore | cancel

// Appointments
operatorRoutes.get('/appointments', c.appointmentsPage);
operatorRoutes.get('/appointments/:id', c.appointmentPage);
operatorRoutes.post('/appointments/:id/check-in', c.appointmentCheckIn);
operatorRoutes.post('/appointments/:id/no-show', c.appointmentNoShow);
operatorRoutes.post('/appointments/:id/cancel', c.appointmentCancel);
operatorRoutes.post('/appointments/:id/notes', c.appointmentNote);
