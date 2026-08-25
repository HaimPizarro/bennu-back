import { Router } from 'express';
import * as bookingsController from '../controllers/bookings.controller.js';

const router = Router();

router.post('/', bookingsController.create);
router.get('/:id', bookingsController.getOne);
router.delete('/:id', bookingsController.cancel);

export default router;