import { Router } from 'express';
import * as googleController from '../controllers/google.controller.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/status', requireAuth, requireAdmin, googleController.status);
router.get('/auth-url', requireAuth, requireAdmin, googleController.authUrl);
router.get('/callback', googleController.callback);
router.post('/disconnect', requireAuth, requireAdmin, googleController.disconnect);
router.put('/settings', requireAuth, requireAdmin, googleController.updateSettings);
router.post('/sync', requireAuth, requireAdmin, googleController.syncNow);

export default router;
