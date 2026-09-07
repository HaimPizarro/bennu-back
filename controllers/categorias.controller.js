import * as categoriasService from '../services/categorias.service.js';

export async function listCategorias(req, res) {
  try {
    const data = await categoriasService.listCategorias();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function createCategoria(req, res) {
  try {
    const data = await categoriasService.createCategoria(req.body, req.token);
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

export async function renameCategoria(req, res) {
  try {
    const data = await categoriasService.renameCategoria(req.params.id, req.body, req.token);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

export async function deleteCategoria(req, res) {
  try {
    const data = await categoriasService.deleteCategoria(req.params.id);
    if (!data) {
      return res.status(404).json({ success: false, message: 'Categoría no encontrada' });
    }
    res.json({ success: true, data: null });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}
