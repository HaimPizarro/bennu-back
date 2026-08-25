import * as notificacionesService from '../services/notificaciones.service.js';

export async function listMias(req, res) {
  try {
    const notificaciones = await notificacionesService.listNotificaciones({
      userId: req.user.id,
      soloNoLeidas: req.query.noLeidas === 'true',
      limit: Number(req.query.limit) || 50,
    });
    res.json({ success: true, data: notificaciones });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function noLeidas(req, res) {
  try {
    const count = await notificacionesService.countNoLeidas(req.user.id);
    res.json({ success: true, data: count });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function markLeida(req, res) {
  try {
    const notificacion = await notificacionesService.marcarLeida(req.params.id, req.user.id);
    res.json({ success: true, data: notificacion });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function markTodasLeidas(req, res) {
  try {
    await notificacionesService.marcarTodasLeidas(req.user.id);
    res.json({ success: true, data: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function listTodas(req, res) {
  try {
    const notificaciones = await notificacionesService.listTodas({
      limit: Number(req.query.limit) || 100,
    });
    res.json({ success: true, data: notificaciones });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function enviarBroadcast(req, res) {
  try {
    const { titulo, mensaje, tipo, userId } = req.body;
    if (!titulo || !titulo.trim()) {
      return res.status(400).json({ success: false, message: 'El título es obligatorio' });
    }
    const creada = await notificacionesService.crearNotificacion({
      userId: userId || null,
      tipo: tipo || 'sistema',
      titulo: titulo.trim(),
      mensaje: mensaje?.trim() || null,
      enlace: req.body.enlace || null,
      creadaPor: req.user.id,
    });
    res.status(201).json({ success: true, data: creada });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

export async function remove(req, res) {
  try {
    await notificacionesService.deleteNotificacion(req.params.id);
    res.json({ success: true, data: { id: Number(req.params.id) } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}
