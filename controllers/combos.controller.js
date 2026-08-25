import * as combosService from '../services/combos.service.js';

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function list(req, res) {
  try {
    const sucursalId = req.query.sucursal_id != null ? Number(req.query.sucursal_id) : null;
    const combos = await combosService.listCombos(false, sucursalId);
    res.json({ success: true, data: combos });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function listAdmin(req, res) {
  try {
    const sucursalId = req.query.sucursal_id != null ? Number(req.query.sucursal_id) : null;
    const combos = await combosService.listCombos(true, sucursalId);
    res.json({ success: true, data: combos });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function get(req, res) {
  try {
    const combo = await combosService.getCombo(req.params.id);
    if (!combo) {
      return res.status(404).json({ success: false, message: 'Combo no encontrado' });
    }
    res.json({ success: true, data: combo });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function create(req, res) {
  try {
    const combo = await combosService.createCombo(req.body, req.token);
    res.status(201).json({ success: true, data: combo });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

export async function update(req, res) {
  try {
    const combo = await combosService.updateCombo(req.params.id, req.body, req.token);
    if (!combo) {
      return res.status(404).json({ success: false, message: 'Combo no encontrado' });
    }
    res.json({ success: true, data: combo });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

export async function remove(req, res) {
  try {
    await combosService.deleteCombo(req.params.id, req.token);
    res.json({ success: true, data: null });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

// Disponibilidad para el calendario de canje (público + autenticado).
export async function availability(req, res) {
  try {
    const duration = req.query.duration != null ? Number(req.query.duration) : null;
    const capacidad = req.query.capacidad != null ? Number(req.query.capacidad) : null;
    const data = await combosService.comboAvailability(req.params.date, duration, capacidad);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// Disponibilidad de un rango de fechas en UNA llamada (dots del calendario).
export async function availabilityRange(req, res) {
  try {
    const { from, to } = req.query;
    if (!FECHA_RE.test(from || '') || !FECHA_RE.test(to || '')) {
      return res.status(400).json({ success: false, message: 'from y to son obligatorios (YYYY-MM-DD)' });
    }
    if (String(from) > String(to)) {
      return res.status(400).json({ success: false, message: 'from no puede ser mayor que to' });
    }
    const days = (new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000 + 1;
    if (days > 60) {
      return res.status(400).json({ success: false, message: 'El rango máximo es de 60 días' });
    }
    const data = await combosService.comboAvailabilityRange(
      from,
      to,
      req.query.sucursal_id != null ? Number(req.query.sucursal_id) : null,
    );
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// Canje de un combo con puntos (requiere autenticación).
export async function redeem(req, res) {
  try {
    const { combo_id, fecha_hora, pagar_diferencia } = req.body || {};
    const userId = req.user?.perfil?.id || req.user?.id;
    const data = await combosService.redeemCombo(
      { userId, comboId: combo_id, fecha_hora, pagar_diferencia: Boolean(pagar_diferencia) },
      req.token,
    );
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}
