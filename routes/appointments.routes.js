import { Router } from 'express';
import * as appointmentsController from '../controllers/appointments.controller.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.post('/', requireAuth, requireAdmin, appointmentsController.create);
router.post('/recurring', requireAuth, requireAdmin, appointmentsController.createRecurring);
router.get('/', requireAuth, requireAdmin, appointmentsController.listAll);
router.get('/me', requireAuth, appointmentsController.listMy);
router.get('/user/:userId', requireAuth, requireAdmin, appointmentsController.listByUser);
router.get('/:id', requireAuth, requireAdmin, appointmentsController.getOne);
router.put('/:id', requireAuth, requireAdmin, appointmentsController.update);
router.put('/:id/status', requireAuth, requireAdmin, appointmentsController.updateStatus);
router.put('/:id/series', requireAuth, requireAdmin, appointmentsController.cancelSeries);
router.delete('/:id', requireAuth, requireAdmin, appointmentsController.remove);
router.delete('/:id/series', requireAuth, requireAdmin, appointmentsController.removeSeries);

export default router;