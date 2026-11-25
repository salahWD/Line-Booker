import { Router } from 'express';
import * as c from '../controllers/misc.controller.js';

// Machine-to-machine URLs (no CSRF; each one authenticates with its own shared secret).
export const webhookRoutes = Router();
webhookRoutes.post('/sms/twilio', c.twilioStatus); // SMS_WEBHOOK_SECRET

// Hosting cron job → runs the background jobs that are due (CRON_SECRET).
export const internalRoutes = Router();
internalRoutes.get('/tick', c.cronTick);
