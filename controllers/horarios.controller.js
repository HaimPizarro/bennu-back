import * as horariosService from '../services/horarios.service.js';

const sucursalDe = (req) => {
  const v = Number(req.query.sucursal_id || req.body?.sucursal_id);
  return Number.isFinite(v) && v > 0 ? v : null;
};

export async function getEmpleadoHorarios(req, res) {
  try {
    const { empleadoId } = req.params;
    const horarios = await horariosService.getEmpleadoHorarios(empleadoId, sucursalDe(req));
    res.json({ success: true, data: horarios });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function saveEmpleadoHorarios(req, res) {
  try {
    const { empleadoId } = req.params;
    const { weekly } = req.body;
    const horarios = await horariosService.saveEmpleadoHorarios(
      empleadoId,
      weekly,
      req.token,
      sucursalDe(req) || 1,
    );
    res.json({ success: true, data: horarios });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

export async function listExcepciones(req, res) {
  try {
    const excepciones = await horariosService.listExcepciones({
      from: req.query.from || undefined,
      to: req.query.to || undefined,
      empleadoId: req.query.empleado_id != null ? Number(req.query.empleado_id) : undefined,
      sucursalId: sucursalDe(req),
    });
    res.json({ success: true, data: excepciones });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function getExcepcion(req, res) {
  try {
    const { id } = req.params;
    const excepcion = await horariosService.getExcepcion(id);
    if (!excepcion) {
      return res.status(404).json({ success: false, message: 'Excepción no encontrada' });
    }
    res.json({ success: true, data: excepcion });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function saveExcepcion(req, res) {
  try {
    const payload = req.params.id ? { ...req.body, id: req.params.id } : req.body;
    const excepcion = await horariosService.saveExcepcion(payload, req.token);
    res.json({ success: true, data: excepcion });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

export async function deleteExcepcion(req, res) {
  try {
    const { id } = req.params;
    await horariosService.deleteExcepcion(id, req.token);
    res.json({ success: true, data: { id: Number(id) } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}
