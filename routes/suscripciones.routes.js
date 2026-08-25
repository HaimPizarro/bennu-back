import { Router } from 'express';
import * as suscripcionesController from '../controllers/suscripciones.controller.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/planes', suscripcionesController.listPlanes);
router.get('/planes/admin', requireAuth, requireAdmin, suscripcionesController.listPlanesAdmin);
router.post('/planes', requireAuth, requireAdmin, suscripcionesController.createPlan);
router.put('/planes/:id', requireAuth, requireAdmin, suscripcionesController.updatePlan);
router.delete('/planes/:id', requireAuth, requireAdmin, suscripcionesController.deletePlan);
router.get('/mia', requireAuth, suscripcionesController.miSuscripcion);
router.post('/pagar', requireAuth, suscripcionesController.pagar);
router.get('/', requireAuth, requireAdmin, suscripcionesController.list);
router.post('/activar', requireAuth, requireAdmin, suscripcionesController.activar);
router.post('/:id/desactivar', requireAuth, requireAdmin, suscripcionesController.desactivar);

export default router;