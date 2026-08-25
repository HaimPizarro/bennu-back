import { getSuscripcionActiva } from '../services/suscripciones.service.js';

// GET /api/auth/me — current authenticated user + their app profile (rol)
export async function me(req, res) {
  try {
    const suscripcion = await getSuscripcionActiva(req.user.id);
    res.json({
      success: true,
      data: {
        id: req.user.id,
        email: req.user.email,
        nombre: req.user.perfil.nombre,
        telefono: req.user.perfil.telefono,
        rol: req.user.perfil.rol,
        puntos_acumulados: req.user.perfil.puntos_acumulados,
        suscripcion_activa: Boolean(suscripcion),
        suscripcion_valida_hasta: suscripcion?.valida_hasta || null,
        suscripcion_plan_id: suscripcion?.membresia?.id ?? suscripcion?.membresia_id ?? null,
        suscripcion_plan_nombre: suscripcion?.membresia?.nombre || null,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}