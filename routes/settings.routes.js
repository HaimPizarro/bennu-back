import { Router } from 'express';
import * as settingsController from '../controllers/settings.controller.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/', settingsController.get);
router.put('/', requireAuth, requireAdmin, settingsController.update);

export default router;