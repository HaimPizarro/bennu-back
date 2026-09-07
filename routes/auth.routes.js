import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as authController from '../controllers/auth.controller.js';

const router = Router();

router.get('/me', requireAuth, authController.me);
router.post('/account-status', authController.accountStatus);
router.post('/delete-account', requireAuth, authController.deleteAccount);

export default router;