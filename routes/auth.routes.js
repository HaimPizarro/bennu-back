import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as authController from '../controllers/auth.controller.js';

const router = Router();

router.get('/me', requireAuth, authController.me);

export default router;