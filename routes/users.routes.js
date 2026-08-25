import { Router } from 'express';
import * as usersController from '../controllers/users.controller.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, requireAdmin, usersController.listUsers);
router.get('/clients', requireAuth, requireAdmin, usersController.listClients);
router.get('/:id', usersController.getUser);
router.get('/:id/ficha', requireAuth, usersController.getFicha);
router.put('/:id/ficha', requireAuth, requireAdmin, usersController.updateFicha);
router.put('/:id/points', requireAuth, requireAdmin, usersController.updatePoints);
router.put('/:id', requireAuth, requireAdmin, usersController.update);
router.delete('/:id', requireAuth, requireAdmin, usersController.remove);

export default router;
