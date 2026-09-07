import * as visitantesService from '../services/visitantes.service.js';

// POST /api/visitantes — (auth) guarda/actualiza el perfil del usuario.
export async function upsertMiVisitante(req, res) {
  try {
    const data = await visitantesService.upsertMiVisitante(req.user.id, req.body, req.token);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

// GET /api/visitantes/me — (auth) perfil del usuario (o null).
export async function getMe(req, res) {
  try {
    const data = await visitantesService.getMiVisitante(req.user.id, req.token);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// DELETE /api/visitantes/me — (auth) quita el propio perfil.
export async function deleteMe(req, res) {
  try {
    await visitantesService.deleteMiVisitante(req.user.id, req.token);
    res.json({ success: true, data: null });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

// GET /api/visitantes — (admin) listado.
export async function listVisitantes(req, res) {
  try {
    const data = await visitantesService.listVisitantes(req.token);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// DELETE /api/visitantes/:id — (admin) borra una fila por id.
export async function deleteVisitante(req, res) {
  try {
    await visitantesService.deleteVisitanteById(req.params.id, req.token);
    res.json({ success: true, data: null });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}
