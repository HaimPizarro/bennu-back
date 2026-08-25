import { Router } from 'express';
import * as eventosController from '../controllers/eventos.controller.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/', eventosController.list);
router.get('/:id', eventosController.getOne);
router.post('/', requireAuth, requireAdmin, eventosController.create);
router.put('/:id', requireAuth, requireAdmin, eventosController.update);
router.delete('/:id', requireAuth, requireAdmin, eventosController.remove);

export default router;
