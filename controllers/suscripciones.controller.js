import * as suscripcionesService from '../services/suscripciones.service.js';

// Planes activos (público, para que el cliente elija).
export async function listPlanes(req, res) {
  try {
    const data = await suscripcionesService.listMembresias({ soloActivas: true });
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// Todos los planes (solo admin).
export async function listPlanesAdmin(req, res) {
  try {
    const data = await suscripcionesService.listMembresias();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// Crea un plan (solo admin).
export async function createPlan(req, res) {
  try {
    const data = await suscripcionesService.saveMembresia(req.body, req.token);
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

// Actualiza un plan (solo admin).
export async function updatePlan(req, res) {
  try {
    const data = await suscripcionesService.saveMembresia(
      { ...req.body, id: req.params.id },
      req.token,
    );
    if (!data) {
      return res.status(404).json({ success: false, message: 'Plan de membresía no encontrado' });
    }
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

// Elimina un plan (solo admin). Las suscripciones quedan sin plan (SET NULL).
export async function deletePlan(req, res) {
  try {
    const data = await suscripcionesService.deleteMembresia(req.params.id);
    if (!data) {
      return res.status(404).json({ success: false, message: 'Plan de membresía no encontrado' });
    }
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

// Listado de suscripciones (solo admin).
export async function list(req, res) {
  try {
    const data = await suscripcionesService.listSuscripciones();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// Última suscripción del cliente autenticado.
export async function miSuscripcion(req, res) {
  try {
    const data = await suscripcionesService.miSuscripcion(req.user.id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// Crea el pago pendiente de la mensualidad de un plan (el cliente luego lo paga en MP).
export async function pagar(req, res) {
  try {
    const data = await suscripcionesService.crearPagoSuscripcion(req.user.id, req.body?.plan_id);
    res.status(201).json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

// Activación manual de la membresía de un cliente (solo admin).
export async function activar(req, res) {
  try {
    const userId = req.body?.user_id;
    if (!userId) {
      return res.status(400).json({ success: false, message: 'user_id es obligatorio' });
    }
    const data = await suscripcionesService.activarManual(userId, req.body?.plan_id);
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

// Desactiva la suscripción de un cliente (solo admin).
export async function desactivar(req, res) {
  try {
    const data = await suscripcionesService.desactivar(req.params.id);
    if (!data) {
      return res.status(404).json({ success: false, message: 'Suscripción no encontrada' });
    }
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}