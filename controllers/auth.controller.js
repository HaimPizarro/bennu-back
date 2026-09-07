import { getSuscripcionActiva } from '../services/suscripciones.service.js';
import { getAccountStatusByEmail, deleteOwnAccount as deleteAccountService } from '../services/auth.service.js';

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

// POST /api/auth/account-status — si un email ya tiene cuenta y con qué
// proveedor (google vs email/contraseña). Lo usa la pantalla de registro para
// avisar sin intentar crear un duplicado.
export async function accountStatus(req, res) {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Email inválido' });
    }
    const data = await getAccountStatusByEmail(email);
    res.json({
      success: true,
      data: data || { exists: null, providers: [] },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// POST /api/auth/delete-account — el usuario elimina su propia cuenta.
export async function deleteAccount(req, res) {
  try {
    await deleteAccountService(req.user.id);
    res.json({ success: true, data: null });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}