import { Router } from 'express';
import * as combosController from '../controllers/combos.controller.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

// Público: catálogo de canje (solo activos) + disponibilidad de horarios.
router.get('/', combosController.list);
router.get('/availability/range', combosController.availabilityRange);
router.get('/availability/:date', combosController.availability);
router.get('/:id', combosController.get);

// Admin: CRUD completo (incluye inactivos).
router.get('/admin/all', requireAuth, requireAdmin, combosController.listAdmin);

// Autenticado: canje de combo con puntos (admin o el propio cliente).
router.post('/redeem', requireAuth, combosController.redeem);

// Admin: crear/editar/eliminar.
router.post('/', requireAuth, requireAdmin, combosController.create);
router.put('/:id', requireAuth, requireAdmin, combosController.update);
router.delete('/:id', requireAuth, requireAdmin, combosController.remove);

export default router;
