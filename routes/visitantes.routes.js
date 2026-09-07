import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as visitantesController from '../controllers/visitantes.controller.js';

const router = Router();

// Rutas de perfil propio (exigen sesión).
router.post('/', requireAuth, visitantesController.upsertMiVisitante);
router.get('/me', requireAuth, visitantesController.getMe);
router.delete('/me', requireAuth, visitantesController.deleteMe);

// Rutas de administración (listado y borrado de cualquier fila).
router.get('/', requireAuth, requireAdmin, visitantesController.listVisitantes);
router.delete('/:id', requireAuth, requireAdmin, visitantesController.deleteVisitante);

export default router;
