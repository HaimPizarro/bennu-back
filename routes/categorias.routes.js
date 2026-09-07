import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import * as categoriasController from '../controllers/categorias.controller.js';

const router = Router();

router.get('/', categoriasController.listCategorias);
router.post('/', requireAuth, requireAdmin, categoriasController.createCategoria);
router.put('/:id', requireAuth, requireAdmin, categoriasController.renameCategoria);
router.delete('/:id', requireAuth, requireAdmin, categoriasController.deleteCategoria);

export default router;
