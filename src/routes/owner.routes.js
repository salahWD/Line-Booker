import { Router } from 'express';
import { numericIdParams } from '../middleware/params.js';
import * as c from '../controllers/owner.controller.js';
import { requireRole } from '../middleware/auth.js';

export const ownerRoutes = numericIdParams(Router());
ownerRoutes.use(requireRole('business_owner'));

ownerRoutes.get('/', c.dashboard);

// Branches
ownerRoutes.get('/branches', c.branches);
ownerRoutes.get('/branches/new', c.newBranch);
ownerRoutes.post('/branches', c.createBranch);
ownerRoutes.get('/branches/:branchId', c.editBranch);
ownerRoutes.post('/branches/:branchId', c.updateBranch);
ownerRoutes.post('/branches/:branchId/hours', c.saveHours);
ownerRoutes.post('/branches/:branchId/holidays', c.addHoliday);
ownerRoutes.post('/branches/:branchId/holidays/:holidayId/delete', c.removeHoliday);
ownerRoutes.post('/branches/:branchId/display-token', c.regenerateDisplay);

// Lines
ownerRoutes.get('/branches/:branchId/lines/new', c.newLine);
ownerRoutes.post('/branches/:branchId/lines', c.createLine);
ownerRoutes.get('/lines/:lineId/edit', c.editLine);
ownerRoutes.post('/lines/:lineId', c.updateLine);

// Free appointment slots
ownerRoutes.get('/lines/:lineId/slots', c.slots);
ownerRoutes.post('/lines/:lineId/slots/generate', c.generateSlots);
ownerRoutes.post('/lines/:lineId/slots', c.addSlot);
ownerRoutes.post('/lines/:lineId/slots/close-day', c.closeDay);
ownerRoutes.post('/slots/:slotId/toggle', c.toggleSlot);
ownerRoutes.post('/slots/:slotId/delete', c.deleteSlot);

// Operators
ownerRoutes.get('/operators', c.operators);
ownerRoutes.get('/operators/new', c.newOperator);
ownerRoutes.post('/operators', c.createOperator);
ownerRoutes.get('/operators/:id', c.editOperator);
ownerRoutes.post('/operators/:id', c.updateOperator);

// Reports, reviews, audit
ownerRoutes.get('/reports', c.reports);
ownerRoutes.get('/reports/export.csv', c.exportCsv);
ownerRoutes.get('/reviews', c.reviews);
ownerRoutes.post('/reviews/:id/reply', c.replyReview);
ownerRoutes.get('/audit', c.audit);
