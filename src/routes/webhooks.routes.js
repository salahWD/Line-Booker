import { Router } from 'express';
import * as c from '../controllers/misc.controller.js';

// SMS provider callbacks (no CSRF; authenticated with SMS_WEBHOOK_SECRET).
export const webhookRoutes = Router();
webhookRoutes.post('/sms/twilio', c.twilioStatus);
