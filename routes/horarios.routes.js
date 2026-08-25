import { Router } from 'express';
import * as horariosController from '../controllers/horarios.controller.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/empleados/:empleadoId', horariosController.getEmpleadoHorarios);
router.put('/empleados/:empleadoId', requireAuth, requireAdmin, horariosController.saveEmpleadoHorarios);

router.get('/excepciones', horariosController.listExcepciones);
router.get('/excepciones/:id', horariosController.getExcepcion);
router.post('/excepciones', requireAuth, requireAdmin, horariosController.saveExcepcion);
router.put('/excepciones/:id', requireAuth, requireAdmin, horariosController.saveExcepcion);
router.delete('/excepciones/:id', requireAuth, requireAdmin, horariosController.deleteExcepcion);

export default router;
