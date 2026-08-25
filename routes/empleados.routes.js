import { Router } from 'express';
import * as empleadosController from '../controllers/empleados.controller.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/', empleadosController.listEmpleados);
router.get('/:id', empleadosController.getEmpleado);
router.post('/', requireAuth, requireAdmin, empleadosController.createEmpleado);
router.put('/:id', requireAuth, requireAdmin, empleadosController.updateEmpleado);
router.delete('/:id', requireAuth, requireAdmin, empleadosController.deleteEmpleado);
router.get('/:id/servicios', requireAuth, requireAdmin, empleadosController.getServiciosEmpleado);
router.put('/:id/servicios', requireAuth, requireAdmin, empleadosController.setServiciosEmpleado);

export default router;
