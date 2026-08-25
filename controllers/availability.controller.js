import * as availabilityService from '../services/availability.service.js';
import { supabase } from '../config/supabase.js';

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function getRange(req, res) {
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
    const data = await availabilityService.getAvailabilityRange(
      from,
      to,
      req.query.sucursal_id != null ? Number(req.query.sucursal_id) : null,
    );
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function getForDate(req, res) {
  try {
    const { date } = req.params;
    if (!FECHA_RE.test(date)) {
      return res.status(400).json({ success: false, message: 'Fecha inválida (formato YYYY-MM-DD)' });
    }

    // Si viene `service_id`, resuelve duración y buffers del servicio objetivo.
    // Si viene `duration` (combos), usa los buffers globales de settings.
    let target = null;
    if (req.query.service_id) {
      const { data: service } = await supabase
        .from('services')
        .select('duracion_minutos, capacidad, buffer_previo_minutos, buffer_posterior_minutos')
        .eq('id', Number(req.query.service_id))
        .maybeSingle();
      if (service) {
        target = {
          duration: Number(service.duracion_minutos) || 0,
          capacidad: Number(service.capacidad) || 1,
          bufferBefore: service.buffer_previo_minutos,
          bufferAfter: service.buffer_posterior_minutos,
        };
      }
    } else if (req.query.duration != null) {
      target = {
        duration: Number(req.query.duration) || 0,
        capacidad: req.query.capacidad != null ? Number(req.query.capacidad) : 1,
        bufferBefore: null,
        bufferAfter: null,
      };
    }

    const data = await availabilityService.getAvailability(
      date,
      target,
      req.query.empleado_id != null ? Number(req.query.empleado_id) : null,
      req.query.sucursal_id != null ? Number(req.query.sucursal_id) : null,
    );
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}