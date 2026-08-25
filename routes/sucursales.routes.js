import { Router } from 'express';
import * as sucursalesController from '../controllers/sucursales.controller.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, requireAdmin, sucursalesController.list);
router.get('/:id', requireAuth, requireAdmin, sucursalesController.getOne);
router.post('/', requireAuth, requireAdmin, sucursalesController.create);
router.put('/:id', requireAuth, requireAdmin, sucursalesController.update);
router.delete('/:id', requireAuth, requireAdmin, sucursalesController.remove);

export default router;
