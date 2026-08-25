import * as eventosService from '../services/eventos.service.js';

export async function list(req, res) {
  try {
    const sucursalId = req.query.sucursal_id != null ? Number(req.query.sucursal_id) : null;
    const eventos = await eventosService.listEventos({
      from: req.query.from || undefined,
      to: req.query.to || undefined,
      sucursalId,
    });
    res.json({ success: true, data: eventos });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function getOne(req, res) {
  try {
    const { id } = req.params;
    const evento = await eventosService.getEvento(id);
    if (!evento) {
      return res.status(404).json({ success: false, message: 'Evento no encontrado' });
    }
    res.json({ success: true, data: evento });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function create(req, res) {
  try {
    const evento = await eventosService.createEvento(req.body, req.token);
    res.status(201).json({ success: true, data: evento });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

export async function update(req, res) {
  try {
    const { id } = req.params;
    const evento = await eventosService.updateEvento(id, req.body, req.token);
    if (!evento) {
      return res.status(404).json({ success: false, message: 'Evento no encontrado' });
    }
    res.json({ success: true, data: evento });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

export async function remove(req, res) {
  try {
    const { id } = req.params;
    await eventosService.deleteEvento(id, req.token);
    res.json({ success: true, data: { id: Number(id) } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}
