import { Router } from 'express';
import * as notificacionesController from '../controllers/notificaciones.controller.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/mias', requireAuth, notificacionesController.listMias);
router.get('/no-leidas', requireAuth, notificacionesController.noLeidas);
router.put('/leer-todas', requireAuth, notificacionesController.markTodasLeidas);
router.put('/:id/leida', requireAuth, notificacionesController.markLeida);
router.get('/', requireAuth, requireAdmin, notificacionesController.listTodas);
router.post('/', requireAuth, requireAdmin, notificacionesController.enviarBroadcast);
router.delete('/:id', requireAuth, requireAdmin, notificacionesController.remove);

export default router;
