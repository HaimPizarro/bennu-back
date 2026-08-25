import { Router } from 'express';
import * as servicesController from '../controllers/services.controller.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/', servicesController.listServices);
router.get('/:id', servicesController.getService);
router.post('/', requireAuth, requireAdmin, servicesController.createService);
router.put('/:id', requireAuth, requireAdmin, servicesController.updateService);
router.delete('/:id', requireAuth, requireAdmin, servicesController.deleteService);

export default router;