import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as integracionesController from '../controllers/integraciones.controller.js';

const router = Router();

router.get('/', requireAuth, requireAdmin, integracionesController.getStatus);
router.put('/', requireAuth, requireAdmin, integracionesController.update);
router.post('/test-email', requireAuth, requireAdmin, integracionesController.testEmail);
router.post('/test-mp', requireAuth, requireAdmin, integracionesController.testMp);

export default router;
