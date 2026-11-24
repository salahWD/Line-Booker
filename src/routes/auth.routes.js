import { Router } from 'express';
import * as c from '../controllers/auth.controller.js';
import { requireCustomer } from '../middleware/auth.js';
import { otpRequestLimiter, otpVerifyLimiter, staffLoginLimiter } from '../middleware/rateLimits.js';

export const authRoutes = Router();

// Customers: phone number → SMS code → (first time) name
authRoutes.get('/login', c.showLogin);
authRoutes.post('/login', otpRequestLimiter, c.requestCode);
authRoutes.get('/login/verify', c.showVerify);
authRoutes.post('/login/verify', otpVerifyLimiter, c.verifyCode);
authRoutes.post('/login/resend', otpRequestLimiter, c.resendCode);
authRoutes.get('/welcome', requireCustomer, c.showWelcome);
authRoutes.post('/welcome', requireCustomer, c.saveWelcome);

// Staff: email or phone + password
authRoutes.get('/staff/login', c.showStaffLogin);
authRoutes.post('/staff/login', staffLoginLimiter, c.staffLogin);

authRoutes.post('/logout', c.logout);
