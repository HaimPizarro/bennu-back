import { Router } from 'express';
import * as pagosController from '../controllers/pagos.controller.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/preference/reserva', pagosController.crearPreferenciaReserva);
router.post('/preference/canje', pagosController.crearPreferenciaCanje);
router.post('/preference/suscripcion', pagosController.crearPreferenciaSuscripcion);
router.post('/webhook', pagosController.webhook);
router.get('/', requireAuth, pagosController.misPagos);
router.get('/por-reserva/:appointmentId', pagosController.pagoPorReserva);
router.get('/:id', pagosController.getEstado);

export default router;