import { Router } from 'express';
import * as availabilityController from '../controllers/availability.controller.js';

const router = Router();

router.get('/range', availabilityController.getRange);
router.get('/:date', availabilityController.getForDate);

export default router;