import { supabase } from '../config/supabase.js';
import { getAppointmentById, updateAppointmentStatus } from './appointments.service.js';
import { enviarPagoConfirmadoCita, enviarCanjeConfirmadoCita } from './email.service.js';
import { crearNotificacion } from './notificaciones.service.js';
import { getCombo } from './combos.service.js';
import { getMembresia, isActiveSubscriber, aplicarMembresiaAprobada } from './suscripciones.service.js';

const TABLE = 'pagos';

const MP_URL = 'https://api.mercadopago.com';

// Moneda del cobro: por defecto CLP (cuenta MP de Chile); override con env.
const MONEDA = () => process.env.MERCADOPAGO_CURRENCY?.trim() || 'CLP';

// Estado simplificado en nuestra tabla según el estado real de Mercado Pago.
const ESTADO_MP = {
  approved: 'aprobado',
  pending: 'pendiente',
  in_process: 'pendiente',
  authorized: 'pendiente',
  rejected: 'rechazado',
  cancelled: 'cancelado',
  expired: 'expirado',
  refunded: 'cancelado',
  charged_back: 'cancelado',
};

function accessToken() {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  if (!token) {
    throw new Error('MERCADOPAGO_ACCESS_TOKEN no está configurado en el .env');
  }
  return token;
}

async function mpFetch(path, options = {}) {
  const res = await fetch(`${MP_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detalle = json?.message || json?.error || res.statusText;
    throw new Error(`Error de Mercado Pago (${res.status}): ${detalle}`);
  }
  return json;
}

export async function getPago(id) {
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', Number(id)).maybeSingle();
  if (error) throw error;
  return data;
}

// Último pago de una reserva (para reutilizar la fila en lugar de duplicar).
export async function getPagoPorReserva(appointmentId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('appointment_id', Number(appointmentId))
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listPagosByUser(userId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// Crea (o reutiliza) la preferencia de Checkout Pro para pagar una reserva.
// Quien crea la preferencia (con su Access Token) recibe el 100% del dinero,
// es decir la cuenta de la dueña que haya configurado MERCADOPAGO_ACCESS_TOKEN.
export async function crearPreferenciaReserva({ appointmentId }) {
  const appointment = await getAppointmentById(appointmentId);
  if (!appointment) throw new Error('Reserva no encontrada');
  if (appointment.estado === 'Confirmada' || appointment.estado === 'Completada') {
    throw new Error('La reserva ya está confirmada');
  }
  if (appointment.estado === 'Cancelada') {
    throw new Error('La reserva fue cancelada');
  }

  const service = appointment.services || {};
  let monto = Number(service.precio_oferta ?? service.precio) || 0;
  if (monto <= 0) throw new Error('El servicio no tiene un precio válido para cobrar');

  // Descuento de membresía: aplica solo a servicios y solo a clientes con una
  // suscripción aprobada vigente. Combos y canjes quedan fuera.
  const precioOriginal = monto;
  let descuentoSuscripcion = 0;
  if (appointment.user_id && (await isActiveSubscriber(appointment.user_id))) {
    descuentoSuscripcion = Math.min(100, Math.max(0, Number(service.descuento_suscripcion) || 0));
  }
  if (descuentoSuscripcion > 0) {
    monto = Math.round(precioOriginal * (1 - descuentoSuscripcion / 100) * 100) / 100;
  }

  const titulo = `Turno de ${service.nombre || 'Servicio'}`;
  const nombreCliente = appointment.cliente_nombre || appointment.users?.nombre || 'Cliente';
  const emailCliente = appointment.cliente_email || appointment.users?.email || null;

  let pago = await getPagoPorReserva(appointmentId);
  if (!pago) {
    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        tipo: 'reserva',
        user_id: appointment.user_id || null,
        appointment_id: appointment.id,
        monto_total: monto,
        moneda: MONEDA(),
        detalle: {
          descuento_suscripcion: descuentoSuscripcion,
          precio_original: precioOriginal,
        },
      })
      .select('*')
      .single();
    if (error) throw error;
    pago = data;
  }

  const externalReference = `bennu-pago-${pago.id}`;
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  // back_urls apuntan a /cerrar: el popup de MP se cierra solo tras pagar; la
  // página principal (con polling) muestra el resultado. MP_BACK_URL_BASE evita
  // el cartel intermedio de ngrok en dev (default: FRONTEND_URL).
  const backUrlBase = process.env.MP_BACK_URL_BASE?.trim() || frontendUrl;
  // auto_return exige back_urls en https: se activa solo en producción.
  const autoReturn = frontendUrl.startsWith('https://') ? 'approved' : null;
  const backUrls = {
    success: `${backUrlBase}/cerrar?r=success`,
    pending: `${backUrlBase}/cerrar?r=pending`,
    failure: `${backUrlBase}/cerrar?r=failure`,
  };

  const body = {
    items: [
      {
        id: `servicio-${appointment.service_id}`,
        title: titulo,
        description: `${nombreCliente} · ${String(appointment.fecha_hora).slice(0, 16).replace('T', ' ')} hs`,
        quantity: 1,
        currency_id: MONEDA(),
        unit_price: monto,
      },
    ],
    payer: emailCliente ? { name: nombreCliente, email: emailCliente } : { name: nombreCliente },
    external_reference: externalReference,
    back_urls: backUrls,
    ...(autoReturn ? { auto_return: autoReturn } : {}),
    ...(process.env.MERCADOPAGO_WEBHOOK_URL?.trim()
      ? { notification_url: process.env.MERCADOPAGO_WEBHOOK_URL.trim() }
      : {}),
  };

  const preference = await mpFetch('/checkout/preferences', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const initPoint = preference?.init_point || preference?.sandbox_init_point;
  if (!initPoint || !preference?.id) {
    throw new Error('No se pudo generar el pago en Mercado Pago');
  }

  const detalle = {
    ...(pago.detalle || {}),
    init_point: initPoint,
    external_reference: externalReference,
  };
  const { data: updated, error: upError } = await supabase
    .from(TABLE)
    .update({ mp_preference_id: preference.id, detalle, updated_at: new Date().toISOString() })
    .eq('id', pago.id)
    .select('*')
    .single();
  if (upError) throw upError;

  return { pago: updated, init_point: initPoint, preference_id: preference.id };
}

// Preferencia de Checkout Pro para el pago de la diferencia de un canje.
// El pago (tipo 'combo') ya existe: lo crea redeemCombo con el monto de la
// diferencia y los puntos comprometidos en detalle. Idempotente: si el pago ya
// no está pendiente, no regenera la preferencia.
export async function crearPreferenciaCanje({ pagoId }) {
  const pago = await getPago(pagoId);
  if (!pago) throw new Error('Pago no encontrado');
  if (pago.tipo !== 'combo') throw new Error('El pago no corresponde a un canje');
  if (pago.estado !== 'pendiente') throw new Error('El pago ya fue procesado');

  const combo = await getCombo(pago.promotion_id);
  if (!combo) throw new Error('Combo no encontrado');

  const monto = Number(pago.monto_total) || 0;
  if (monto <= 0) throw new Error('No hay diferencia que abonar');

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const backUrlBase = process.env.MP_BACK_URL_BASE?.trim() || frontendUrl;
  const autoReturn = frontendUrl.startsWith('https://') ? 'approved' : null;

  const body = {
    items: [
      {
        id: `combo-${combo.id}`,
        title: `Canje: ${combo.nombre}`,
        quantity: 1,
        currency_id: MONEDA(),
        unit_price: monto,
      },
    ],
    external_reference: `bennu-pago-${pago.id}`,
    back_urls: {
      success: `${backUrlBase}/cerrar?r=success`,
      pending: `${backUrlBase}/cerrar?r=pending`,
      failure: `${backUrlBase}/cerrar?r=failure`,
    },
    ...(autoReturn ? { auto_return: autoReturn } : {}),
    ...(process.env.MERCADOPAGO_WEBHOOK_URL?.trim()
      ? { notification_url: process.env.MERCADOPAGO_WEBHOOK_URL.trim() }
      : {}),
  };

  const preference = await mpFetch('/checkout/preferences', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const initPoint = preference?.init_point || preference?.sandbox_init_point;
  if (!initPoint || !preference?.id) {
    throw new Error('No se pudo generar el pago en Mercado Pago');
  }

  const { error: upError } = await supabase
    .from(TABLE)
    .update({
      mp_preference_id: preference.id,
      detalle: { ...(pago.detalle || {}), init_point: initPoint },
      updated_at: new Date().toISOString(),
    })
    .eq('id', pago.id);
  if (upError) throw upError;

  return { pagoId: pago.id, init_point: initPoint, preference_id: preference.id };
}

// Preferencia de Checkout Pro para el pago de la membresía mensual.
// El pago (tipo 'suscripcion') ya existe: lo crea crearPagoSuscripcion con el
// monto de la mensualidad. Idempotente: si el pago ya no está pendiente, no
// regenera la preferencia.
export async function crearPreferenciaSuscripcion({ pagoId }) {
  const pago = await getPago(pagoId);
  if (!pago) throw new Error('Pago no encontrado');
  if (pago.tipo !== 'suscripcion') throw new Error('El pago no corresponde a una membresía');
  if (pago.estado !== 'pendiente') throw new Error('El pago ya fue procesado');

  const monto = Number(pago.monto_total) || 0;
  if (monto <= 0) throw new Error('No hay monto que abonar');

  const planId = pago.detalle?.plan_id;
  const plan = planId != null ? await getMembresia(planId) : null;
  const titulo = plan?.nombre || pago.detalle?.concepto || 'Membresía mensual bennu';
  const descripcion = plan?.descripcion || 'Membresía mensual con descuentos y puntos';

  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
  const backUrlBase = process.env.MP_BACK_URL_BASE?.trim() || frontendUrl;
  const autoReturn = frontendUrl.startsWith('https://') ? 'approved' : null;

  const body = {
    items: [
      {
        id: plan ? `membresia-${plan.id}` : 'membresia',
        title: titulo,
        description: descripcion,
        quantity: 1,
        currency_id: MONEDA(),
        unit_price: monto,
      },
    ],
    external_reference: `bennu-pago-${pago.id}`,
    back_urls: {
      success: `${backUrlBase}/cerrar?r=success`,
      pending: `${backUrlBase}/cerrar?r=pending`,
      failure: `${backUrlBase}/cerrar?r=failure`,
    },
    ...(autoReturn ? { auto_return: autoReturn } : {}),
    ...(process.env.MERCADOPAGO_WEBHOOK_URL?.trim()
      ? { notification_url: process.env.MERCADOPAGO_WEBHOOK_URL.trim() }
      : {}),
  };

  const preference = await mpFetch('/checkout/preferences', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  const initPoint = preference?.init_point || preference?.sandbox_init_point;
  if (!initPoint || !preference?.id) {
    throw new Error('No se pudo generar el pago en Mercado Pago');
  }

  const { error: upError } = await supabase
    .from(TABLE)
    .update({
      mp_preference_id: preference.id,
      detalle: { ...(pago.detalle || {}), init_point: initPoint },
      updated_at: new Date().toISOString(),
    })
    .eq('id', pago.id);
  if (upError) throw upError;

  return { pagoId: pago.id, init_point: initPoint, preference_id: preference.id };
}

async function findByPreference(preferenceId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('mp_preference_id', preferenceId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Aplica el estado real de MP a la fila de pago y dispara los efectos
// (confirmar la reserva). Idempotente: un mismo payment id ya aplicado
// no se vuelve a procesar.
async function aplicarEstadoPago(pago, payment) {
  const estado = ESTADO_MP[payment.status] || 'pendiente';

  // Idempotencia: el pago ya fue procesado con este mismo payment.
  if (pago.estado === 'aprobado' && Number(pago.mp_payment_id) === Number(payment.id)) {
    return { pagoId: pago.id, estado };
  }

  const detalle = {
    ...(pago.detalle || {}),
    transaction_amount: payment.transaction_amount || null,
    payment_method: payment.payment_method_id || null,
    merchant_order_id: payment.merchant_order_id || null,
  };
  const { error } = await supabase
    .from(TABLE)
    .update({
      mp_payment_id: Number(payment.id),
      mp_status: payment.status,
      mp_status_detail: payment.status_detail || null,
      estado,
      detalle,
      updated_at: new Date().toISOString(),
    })
    .eq('id', pago.id);
  if (error) throw error;

  // Si es el pago de una reserva aprobada, confirmar la cita, avisar por email
  // y acreditar los puntos de fidelización (solo usuarios registrados, una vez).
  // Fire-and-forget del email: nunca bloquea el webhook/poll.
  if (pago.tipo === 'reserva' && estado === 'aprobado' && pago.appointment_id) {
    const appt = await getAppointmentById(pago.appointment_id);
    if (appt && appt.estado === 'Pendiente') {
      await updateAppointmentStatus(pago.appointment_id, 'Confirmada', null);
    }
    if (appt?.user_id && !appt.puntos_abonados) {
      const puntos = Number(appt.services?.puntos_otorgados) || 0;
      if (puntos > 0) {
        const { data: user } = await supabase
          .from('users')
          .select('puntos_acumulados')
          .eq('id', appt.user_id)
          .single();
        const nuevos = (Number(user?.puntos_acumulados) || 0) + puntos;
        const upd = await supabase.from('users').update({ puntos_acumulados: nuevos }).eq('id', appt.user_id);
        if (upd.error) throw upd.error;
        await supabase.from('appointments').update({ puntos_abonados: true }).eq('id', appt.id);
        await crearNotificacion({
          userId: appt.user_id,
          tipo: 'cita',
          titulo: 'Puntos sumados',
          mensaje: `Tu compra fue acreditada. Sumaste +${puntos} pts de fidelización.`,
          enlace: '/mi-cuenta?tab=inicio',
        });
      }
    }
    enviarPagoConfirmadoCita(appt || { id: pago.appointment_id }, appt?.services || null);
  }

  // Canje con diferencia: al aprobarse, confirmar todas las citas del combo y
  // descontar los puntos comprometidos (guardados en detalle al canjear).
  if (pago.tipo === 'combo' && estado === 'aprobado' && pago.promotion_id) {
    const { data: citas, error: cError } = await supabase
      .from('appointments')
      .select('*, services:service_id (nombre, puntos_otorgados)')
      .eq('promotion_id', pago.promotion_id)
      .eq('user_id', pago.user_id)
      .eq('estado', 'Pendiente');
    if (cError) throw cError;

    for (const c of citas || []) {
      await updateAppointmentStatus(c.id, 'Confirmada', null);
    }

    const aDescontar = Number(pago.detalle?.puntos_a_descontar) || 0;
    if (aDescontar > 0 && pago.user_id) {
      const { data: user } = await supabase
        .from('users')
        .select('puntos_acumulados')
        .eq('id', pago.user_id)
        .single();
      const nuevos = Math.max(0, (Number(user?.puntos_acumulados) || 0) - aDescontar);
      const upd = await supabase.from('users').update({ puntos_acumulados: nuevos }).eq('id', pago.user_id);
      if (upd.error) throw upd.error;
      await crearNotificacion({
        userId: pago.user_id,
        tipo: 'cita',
        titulo: 'Canje confirmado',
        mensaje: `Tu canje quedó confirmado. Se descontaron ${aDescontar} pts.`,
        enlace: '/mi-cuenta?tab=canje',
      });
    }

    const anchor = (citas || [])[0];
    const combo = await getCombo(pago.promotion_id).catch(() => null);
    if (anchor) {
      enviarCanjeConfirmadoCita(anchor, anchor.services, combo?.nombre || null);
    }
  }

  // Pago de membresía aprobado: activar/renovar la suscripción del cliente y
  // acreditar los puntos del mes (membresia.puntos_mes).
  if (pago.tipo === 'suscripcion' && estado === 'aprobado' && pago.user_id) {
    await aplicarMembresiaAprobada({
      userId: pago.user_id,
      pagoId: pago.id,
      monto: Number(pago.monto_total) || 0,
      planId: pago.detalle?.plan_id ?? null,
    });
  }

  return { pagoId: pago.id, estado };
}

// Webhook de Mercado Pago. Siempre re-consulta el pago en MP
// (GET /v1/payments/:id): el body del webhook nunca se toma como verdad.
export async function procesarWebhook({ paymentId }) {
  if (!paymentId) return { handled: false };

  const payment = await mpFetch(`/v1/payments/${paymentId}`);

  let pago = null;
  if (payment.preference_id) pago = await findByPreference(payment.preference_id);
  if (!pago && payment.external_reference) {
    const extId = Number(String(payment.external_reference).replace('bennu-pago-', ''));
    if (extId) pago = await getPago(extId);
  }
  if (!pago) return { handled: false };

  return { handled: true, ...(await aplicarEstadoPago(pago, payment)) };
}

// Reconciliación completa: busca el pago real en Mercado Pago asociado a
// nuestra fila (por mp_payment_id o por external_reference "bennu-pago-{id}")
// y aplica su estado. Es el fallback último: cubre pagos aprobados cuyo
// webhook nunca llegó o cuya fila quedó sin mp_payment_id (cliente pagó y
// volvió a la web sin que nos notifique MP).
export async function reconciliarPago(pagoId) {
  const pago = await getPago(pagoId);
  if (!pago) return { handled: false };
  if (pago.estado !== 'pendiente') return { handled: true, pagoId: pago.id, estado: pago.estado };

  let payment = null;
  if (pago.mp_payment_id) {
    payment = await mpFetch(`/v1/payments/${pago.mp_payment_id}`);
  } else {
    const ref = `bennu-pago-${pago.id}`;
    const data = await mpFetch(
      `/v1/payments/search?external_reference=${encodeURIComponent(ref)}&limit=1`,
    );
    payment = (Array.isArray(data?.results) ? data.results : [])[0] || null;
  }
  if (!payment) return { handled: false };

  return { handled: true, ...(await aplicarEstadoPago(pago, payment)) };
}

// Fallback del polling: con el payment_id que MP deja en la URL de retorno
// reconcilia directo; sin él, busca por external_reference (reconciliarPago).
export async function sincronizarPago({ pagoId, paymentId }) {
  const pago = await getPago(pagoId);
  if (!pago) return { handled: false };
  if (pago.estado !== 'pendiente') return { handled: true, pagoId: pago.id, estado: pago.estado };
  if (!paymentId) return reconciliarPago(pagoId);

  const payment = await mpFetch(`/v1/payments/${paymentId}`);
  return { handled: true, ...(await aplicarEstadoPago(pago, payment)) };
}