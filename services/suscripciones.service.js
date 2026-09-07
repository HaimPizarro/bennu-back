import { supabase, createClientWithToken } from '../config/supabase.js';
import { crearNotificacion } from './notificaciones.service.js';
import { getMpConfig } from './configuracion.service.js';

const MEMBRESIA_TABLE = 'membresia';
const SUSCRIPCIONES_TABLE = 'suscripciones';
const PAGOS_TABLE = 'pagos';
const USERS_TABLE = 'users';

const DIAS_VIGENCIA = 30;

// ============================================================
// Planes de membresía (múltiples; el cliente elige uno)
// ============================================================

// Lista los planes. Público: solo activos; admin: todos.
export async function listMembresias({ soloActivas = false } = {}) {
  let q = supabase.from(MEMBRESIA_TABLE).select('*').order('precio_mensual', { ascending: true });
  if (soloActivas) q = q.eq('activa', true);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function getMembresia(id) {
  if (id == null) return null;
  const { data, error } = await supabase
    .from(MEMBRESIA_TABLE)
    .select('*')
    .eq('id', Number(id))
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// Crea o actualiza un plan: si payload.id existe, UPDATE; si no, INSERT.
export async function saveMembresia(payload, token) {
  const db = token ? createClientWithToken(token) : supabase;
  const nombre = payload.nombre?.trim();
  if (!nombre) throw new Error('El nombre de la membresía es obligatorio');
  const update = {
    nombre,
    precio_mensual: Math.max(0, Number(payload.precio_mensual) || 0),
    puntos_mes: Math.max(0, Math.round(Number(payload.puntos_mes) || 0)),
    descripcion: payload.descripcion?.trim() || null,
    activa: payload.activa !== false,
    updated_at: new Date().toISOString(),
  };

  let result;
  if (payload.id != null) {
    const { data, error } = await db
      .from(MEMBRESIA_TABLE)
      .update(update)
      .eq('id', Number(payload.id))
      .select('*')
      .single();
    if (error) throw error;
    result = data;
  } else {
    const { data, error } = await db
      .from(MEMBRESIA_TABLE)
      .insert(update)
      .select('*')
      .single();
    if (error) throw error;
    result = data;
  }
  return result;
}

export async function deleteMembresia(id) {
  const { data, error } = await supabase
    .from(MEMBRESIA_TABLE)
    .delete()
    .eq('id', Number(id))
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ============================================================
// Suscripciones activas
// ============================================================

// Devuelve la suscripción aprobada vigente de un usuario (o null), con su plan.
export async function getSuscripcionActiva(userId) {
  if (!userId) return null;
  const { data, error } = await supabase
    .from(SUSCRIPCIONES_TABLE)
    .select('*, membresia:membresia_id (id, nombre)')
    .eq('user_id', userId)
    .eq('estado', 'aprobada')
    .gte('valida_hasta', new Date().toISOString())
    .order('valida_hasta', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function isActiveSubscriber(userId) {
  return Boolean(await getSuscripcionActiva(userId));
}

// Última suscripción del cliente (cualquier estado), para su ficha.
export async function miSuscripcion(userId) {
  const { data, error } = await supabase
    .from(SUSCRIPCIONES_TABLE)
    .select('*, membresia:membresia_id (id, nombre)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// Listado admin: todas las suscripciones con datos del cliente y su plan.
export async function listSuscripciones() {
  const { data, error } = await supabase
    .from(SUSCRIPCIONES_TABLE)
    .select('*, users:user_id (nombre, email, telefono), membresia:membresia_id (id, nombre)')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// Crea o renueva la suscripción de un usuario: si ya tiene una vigente, la
// extiende 30 días desde su vencimiento (apilado); si no, la crea desde hoy.
// planId se guarda para saber a qué plan pertenece la suscripción.
async function renovarSuscripcion(userId, monto, planId) {
  const ahora = Date.now();
  const { data: subs, error } = await supabase
    .from(SUSCRIPCIONES_TABLE)
    .select('id, estado, valida_hasta')
    .eq('user_id', userId)
    .order('valida_hasta', { ascending: false })
    .limit(1);
  if (error) throw error;
  const existente = (subs || [])[0];
  const base =
    existente && existente.estado === 'aprobada' && new Date(existente.valida_hasta).getTime() > ahora
      ? new Date(existente.valida_hasta).getTime()
      : ahora;
  const validaHasta = new Date(base + DIAS_VIGENCIA * 86400000).toISOString();
  const update = {
    estado: 'aprobada',
    monto,
    valida_hasta: validaHasta,
    fecha_proxima: validaHasta,
    updated_at: new Date().toISOString(),
  };
  if (planId != null) update.membresia_id = Number(planId);

  let suscId;
  if (existente) {
    const { data, error: upError } = await supabase
      .from(SUSCRIPCIONES_TABLE)
      .update(update)
      .eq('id', existente.id)
      .select('id')
      .single();
    if (upError) throw upError;
    suscId = data.id;
  } else {
    const { data, error: insError } = await supabase
      .from(SUSCRIPCIONES_TABLE)
      .insert({ user_id: userId, ...update })
      .select('id')
      .single();
    if (insError) throw insError;
    suscId = data.id;
  }

  return { id: suscId, validaHasta };
}

async function sumarPuntos(userId, puntos) {
  const { data: user, error } = await supabase
    .from(USERS_TABLE)
    .select('puntos_acumulados')
    .eq('id', userId)
    .single();
  if (error) throw error;
  const nuevos = (Number(user?.puntos_acumulados) || 0) + puntos;
  const { error: upError } = await supabase
    .from(USERS_TABLE)
    .update({ puntos_acumulados: nuevos })
    .eq('id', userId);
  if (upError) throw upError;
  return nuevos;
}

// ============================================================
// Flujo del cliente
// ============================================================

// Crea el pago (tipo 'suscripcion') de la mensualidad de un plan. La
// preferencia de MP se genera después desde la página de pago.
export async function crearPagoSuscripcion(userId, planId) {
  if (planId == null) throw new Error('Elige un plan de membresía');
  const plan = await getMembresia(planId);
  if (!plan || !plan.activa) throw new Error('La membresía no está disponible por ahora');
  const monto = Number(plan.precio_mensual) || 0;
  if (monto <= 0) throw new Error('La membresía no tiene un precio definido');
  if (await isActiveSubscriber(userId)) {
    throw new Error('Ya cuentas con una membresía activa');
  }

  const { data, error } = await supabase
    .from(PAGOS_TABLE)
    .insert({
      tipo: 'suscripcion',
      user_id: userId,
      monto_total: monto,
      moneda: (await getMpConfig()).currency || 'CLP',
      detalle: {
        concepto: plan.nombre || 'Membresía mensual',
        plan_id: plan.id,
        puntos_mes: Number(plan.puntos_mes) || 0,
      },
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

// ============================================================
// Aprobación / admin
// ============================================================

// Efecto al aprobarse el pago de una suscripción: crea/renueva la membresía,
// acredita los puntos del mes y vincula el pago a la suscripción.
export async function aplicarMembresiaAprobada({ userId, pagoId, monto, planId }) {
  let puntos = 0;
  let planNombre = null;
  if (planId != null) {
    const plan = await getMembresia(planId);
    puntos = Number(plan?.puntos_mes) || 0;
    planNombre = plan?.nombre || null;
  }

  const { id: suscId, validaHasta } = await renovarSuscripcion(userId, monto, planId);

  if (pagoId != null) {
    const { error } = await supabase
      .from(PAGOS_TABLE)
      .update({ suscripcion_id: suscId, updated_at: new Date().toISOString() })
      .eq('id', Number(pagoId));
    if (error) throw error;
  }

  if (puntos > 0) {
    await sumarPuntos(userId, puntos);
  }

  await crearNotificacion({
    userId,
    tipo: 'sistema',
    titulo: 'Membresía activa',
    mensaje:
      puntos > 0
        ? `Tu membresía quedó activa. Sumaste +${puntos} pts de fidelización.`
        : 'Tu membresía quedó activa.',
    enlace: '/mi-cuenta?tab=membresia',
  });

  return { suscripcionId: suscId, validaHasta, puntos, planId: planId ?? null, planNombre };
}

// Activación manual (admin, pago por caja/transferencia): crea o renueva la
// membresía del cliente con el plan elegido y acredita los puntos del mes.
export async function activarManual(userId, planId) {
  if (planId == null) throw new Error('Elige un plan de membresía');
  const plan = await getMembresia(planId);
  if (!plan) throw new Error('Plan de membresía no encontrado');
  const monto = Number(plan.precio_mensual) || 0;
  const puntos = Number(plan.puntos_mes) || 0;

  const { data: user, error: uError } = await supabase
    .from(USERS_TABLE)
    .select('id')
    .eq('id', userId)
    .maybeSingle();
  if (uError) throw uError;
  if (!user) throw new Error('Usuario no encontrado');

  const { id: suscId, validaHasta } = await renovarSuscripcion(userId, monto, planId);

  if (puntos > 0) {
    await sumarPuntos(userId, puntos);
  }

  await crearNotificacion({
    userId,
    tipo: 'sistema',
    titulo: 'Membresía activada',
    mensaje:
      puntos > 0
        ? `Tu membresía fue activada. Sumaste +${puntos} pts de fidelización.`
        : 'Tu membresía fue activada.',
    enlace: '/mi-cuenta?tab=membresia',
  });

  return { suscripcionId: suscId, validaHasta, puntos, planId: plan.id, planNombre: plan.nombre };
}

export async function desactivar(id) {
  const { data, error } = await supabase
    .from(SUSCRIPCIONES_TABLE)
    .update({ estado: 'cancelada', updated_at: new Date().toISOString() })
    .eq('id', Number(id))
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}
