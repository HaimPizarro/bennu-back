import { Router } from 'express';
import * as contenidoController from '../controllers/contenido.controller.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/', contenidoController.get);
router.put('/', requireAuth, requireAdmin, contenidoController.update);

export default router;
