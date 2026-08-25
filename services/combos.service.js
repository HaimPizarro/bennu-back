import { supabase, createClientWithToken } from '../config/supabase.js';
import { getSettings } from './settings.service.js';
import { toUtcMs, toMinutes, dayOfWeek, utcTime, reservaVencida, maxDateISO } from './date.util.js';

const TABLE = 'promotions';

// Mapea fila de promotions + sus servicios a la forma { ...campos, servicios_ids }.
function withServices(promoRows, serviceRows) {
  const byId = new Map(serviceRows || []);
  return (promoRows || []).map((p) => ({
    id: p.id,
    nombre: p.nombre,
    descripcion: p.descripcion,
    costo_en_puntos: p.costo_en_puntos,
    precio: p.precio ?? 0,
    active: p.active,
    created_at: p.created_at,
    servicios_ids: (byId.get(p.id) || []).map((r) => r.service_id),
  }));
}

// Lee promotions + los servicios de cada una en dos queries paralelas.
async function fetchPromotions(extraFilter, sucursalId) {
  let q = supabase.from(TABLE).select('*').order('id', { ascending: true });
  if (extraFilter) q = q.eq(extraFilter.field, extraFilter.value);
  if (sucursalId != null) q = q.eq('sucursal_id', Number(sucursalId));

  const [promosRes, servicesRes] = await Promise.all([
    q,
    supabase
      .from('promotion_services')
      .select('promotion_id, service_id')
      .order('promotion_id', { ascending: true }),
  ]);
  if (promosRes.error) throw promosRes.error;
  if (servicesRes.error) throw servicesRes.error;

  const byId = new Map();
  (servicesRes.data || []).forEach((r) => {
    const list = byId.get(r.promotion_id) || [];
    list.push(r);
    byId.set(r.promotion_id, list);
  });

  return withServices(promosRes.data, byId);
}

export async function listCombos(includeInactive = false, sucursalId) {
  const rows = await fetchPromotions(null, sucursalId);
  return includeInactive ? rows : rows.filter((p) => p.active);
}

export async function getCombo(id) {
  const [promos, servicesRes] = await Promise.all([
    supabase.from(TABLE).select('*').eq('id', id).maybeSingle(),
    supabase.from('promotion_services').select('promotion_id, service_id').eq('promotion_id', id),
  ]);
  if (promos.error) throw promos.error;
  if (servicesRes.error) throw servicesRes.error;
  if (!promos.data) return null;

  const byId = new Map([[id, servicesRes.data || []]]);
  return withServices([promos.data], byId)[0];
}

export async function createCombo(payload, token) {
  const nombre = (payload.nombre || '').trim();
  if (!nombre) throw new Error('El nombre es obligatorio');
  if (payload.costo_en_puntos === undefined || Number(payload.costo_en_puntos) < 0) {
    throw new Error('El costo en puntos es obligatorio');
  }

  const servicios_ids = Array.isArray(payload.servicios_ids)
    ? [...new Set(payload.servicios_ids.map(Number).filter(Boolean))]
    : [];
  if (servicios_ids.length < 1) {
    throw new Error('Debe incluir al menos 1 servicio');
  }

  const db = token ? createClientWithToken(token) : supabase;

  const { data, error } = await db
    .from(TABLE)
    .insert({
      nombre,
      descripcion: payload.descripcion?.trim() || null,
      costo_en_puntos: Math.round(Number(payload.costo_en_puntos)) || 0,
      precio: Number(payload.precio) || 0,
      active: payload.active !== false,
      sucursal_id: payload.sucursal_id != null ? Number(payload.sucursal_id) : 1,
    })
    .select('*')
    .single();
  if (error) throw error;

  if (servicios_ids.length) {
    const { error: jError } = await db.from('promotion_services').insert(
      servicios_ids.map((service_id) => ({ promotion_id: data.id, service_id })),
    );
    if (jError) throw jError;
  }

  return getCombo(data.id);
}

export async function updateCombo(id, payload, token) {
  const existing = await getCombo(id);
  if (!existing) return null;

  const update = {};
  if (payload.nombre !== undefined) {
    const nombre = (payload.nombre || '').trim();
    if (!nombre) throw new Error('El nombre es obligatorio');
    update.nombre = nombre;
  }
  if (payload.descripcion !== undefined) update.descripcion = payload.descripcion?.trim() || null;
  if (payload.costo_en_puntos !== undefined) {
    update.costo_en_puntos = Math.max(0, Math.round(Number(payload.costo_en_puntos)) || 0);
  }
  if (payload.precio !== undefined) update.precio = Number(payload.precio) || 0;
  if (payload.active !== undefined) update.active = payload.active !== false;

  const db = token ? createClientWithToken(token) : supabase;

  if (Object.keys(update).length) {
    const { error } = await db.from(TABLE).update(update).eq('id', id);
    if (error) throw error;
  }

  if (Array.isArray(payload.servicios_ids)) {
    const servicios_ids = [...new Set(payload.servicios_ids.map(Number).filter(Boolean))];
    if (servicios_ids.length < 1) {
      throw new Error('Debe incluir al menos 1 servicio');
    }
    const { error: delError } = await db.from('promotion_services').delete().eq('promotion_id', id);
    if (delError) throw delError;
    const { error: insError } = await db.from('promotion_services').insert(
      servicios_ids.map((service_id) => ({ promotion_id: id, service_id })),
    );
    if (insError) throw insError;
  }

  return getCombo(id);
}

export async function deleteCombo(id, token) {
  const db = token ? createClientWithToken(token) : supabase;
  const { error } = await db.from(TABLE).delete().eq('id', id);
  if (error) throw error;
  return true;
}

// ---- Canje: descontar puntos + crear appointments ------------------------

// Genera slots de inicio para un rango "HH:MM" con paso de `interval` minutos.
function slotsInRange(start, end, interval) {
  const slots = [];
  const startMin = toMinutes(start);
  const endMin = toMinutes(end);
  for (let t = startMin; t < endMin; t += interval) {
    const h = Math.floor(t / 60);
    const m = t % 60;
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
  return slots;
}

// Calcula los slots libres de un día respetando horario de trabajo y solapamientos.
// Si `duration` viene (duración del combo a canjear), evalúa la viabilidad
// completa de cada slot: [slot - bufferBefore, slot + duration + bufferAfter]
// no debe superar la capacidad disponible (`capacidad`, por defecto 1) ni
// exceder la jornada. `appointments` es la lista cruda del día (sin filtrar).
function buildDayAvailability(date, settings, combos, appointments, duration, capacidad) {
  const dow = dayOfWeek(date);
  const ranges = (settings.working_hours || {})[String(dow)];

  if (!Array.isArray(ranges) || ranges.length === 0) {
    return { date, interval: settings.slot_interval_minutes, closed: true, slots: [], combos };
  }

  const interval = settings.slot_interval_minutes;
  const globalBefore = settings.buffer_before_minutes || 0;
  const globalAfter = settings.buffer_after_minutes || 0;
  const workEnd = Math.max(...ranges.map((r) => toMinutes(r.end)));
  const targetCapacity = capacidad != null ? Number(capacidad) : 1;

  const times = [];
  for (const range of ranges) times.push(...slotsInRange(range.start, range.end, interval));

  const blocked = (appointments || [])
    .filter((a) => a.estado !== 'Cancelada' && !reservaVencida(a))
    .map((a) => {
      const startMin = toMinutes(utcTime(a.fecha_hora));
      const dur = Number(a.services?.duracion_minutos) || 0;
      const aBefore = a.services?.buffer_previo_minutos != null ? a.services.buffer_previo_minutos : globalBefore;
      const aAfter = a.services?.buffer_posterior_minutos != null ? a.services.buffer_posterior_minutos : globalAfter;
      return {
        id: a.id,
        startMin: startMin - aBefore,
        endMin: startMin + dur + aAfter,
      };
    });

  const overlapsBlocked = (blockStart, blockEnd) => {
    let count = 0;
    for (const b of blocked) {
      if (Math.max(blockStart, b.startMin) < Math.min(blockEnd, b.endMin)) count += 1;
    }
    return count;
  };

  const slots = times.map((time) => {
    const timeMin = toMinutes(time);
    let available = true;
    let blockingAppointmentId = null;

    if (duration != null) {
      const blockStart = timeMin - globalBefore;
      const blockEnd = timeMin + Number(duration) + globalAfter;
      const range = ranges.find((r) => timeMin >= toMinutes(r.start) && timeMin < toMinutes(r.end));
      if (blockEnd > workEnd) {
        available = false;
      } else if (range && timeMin + Number(duration) > toMinutes(range.end)) {
        available = false;
      } else {
        const occupiers = overlapsBlocked(blockStart, blockEnd);
        if (occupiers >= targetCapacity) {
          available = false;
          const b = blocked.find((blk) => Math.max(blockStart, blk.startMin) < Math.min(blockEnd, blk.endMin));
          if (b) blockingAppointmentId = b.id;
        }
      }
    } else {
      const b = blocked.find((blk) => Math.max(timeMin, blk.startMin) < Math.min(timeMin + 1, blk.endMin));
      if (b) {
        available = false;
        blockingAppointmentId = b.id;
      }
    }

    return { time, available, blockingAppointmentId };
  });

  return {
    date,
    interval,
    closed: false,
    buffer_before: globalBefore,
    buffer_after: globalAfter,
    work_end: workEnd,
    slots,
    combos,
  };
}

const APPOINTMENT_SELECT = 'id, fecha_hora, service_id, estado, reserva_expiracion, services:service_id (duracion_minutos, buffer_previo_minutos, buffer_posterior_minutos)';

// Devuelve los slots libres de un día (ver buildDayAvailability).
export async function comboAvailability(date, duration, capacidad) {
  const [settings, combos, appointments] = await Promise.all([
    getSettings(),
    listCombos(false),
    supabase
      .from('appointments')
      .select(APPOINTMENT_SELECT)
      .gte('fecha_hora', `${date}T00:00:00`)
      .lte('fecha_hora', `${date}T23:59:59`),
  ]);
  if (appointments.error) throw appointments.error;
  return buildDayAvailability(date, settings, combos, appointments.data || [], duration, capacidad);
}

// Disponibilidad de un rango de fechas en UNA llamada (puntos del calendario de
// canje): settings, combos y appointments se leen una sola vez para todo el rango.
export async function comboAvailabilityRange(from, to, sucursalId) {
  const sid = sucursalId != null ? Number(sucursalId) : undefined;
  const [settings, combos, appointments] = await Promise.all([
    getSettings(sid),
    listCombos(false, sid),
    supabase
      .from('appointments')
      .select(APPOINTMENT_SELECT)
      .gte('fecha_hora', `${from}T00:00:00`)
      .lte('fecha_hora', `${to}T23:59:59`),
  ]);
  if (appointments.error) throw appointments.error;

  const byDate = new Map();
  (appointments.data || []).forEach((a) => {
    const d = String(a.fecha_hora || '').slice(0, 10);
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(a);
  });

  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const days = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10);
    days.push(buildDayAvailability(dateStr, settings, combos, byDate.get(dateStr) || [], null, null));
  }

  return { from, to, days };
}

// Valida que la fecha/hora caiga dentro de una franja y alineada al intervalo.
async function inWorkingHours(fechaHora, interval) {
  const settings = await getSettings();
  const dateStr = fechaHora.slice(0, 10);
  const dow = dayOfWeek(dateStr);
  const ranges = (settings.working_hours || {})[String(dow)];
  if (!Array.isArray(ranges) || ranges.length === 0) return false;
  const d = new Date(toUtcMs(fechaHora));
  const minuteOfDay = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (minuteOfDay % interval !== 0) return false;
  return ranges.some((r) => minuteOfDay >= toMinutes(r.start) && minuteOfDay < toMinutes(r.end));
}

// Canjea un combo: valida puntos, verifica horario/solapamiento y crea una cita
// por cada servicio del combo en la misma fecha/hora. El cliente (userId) entrega
// sus puntos; los appointments quedan asociados a su cuenta.
// - Si los puntos alcanzan: descuenta el costo y crea las citas CONFIRMADAS al
//   instante (el canje con puntos equivale a pagar).
// - Si no alcanzan y `pagar_diferencia` es true: crea las citas en PENDIENTE con
//   hold de 1 hora + un pago tipo 'combo' por la diferencia ($1 = 1 punto). Los
//   puntos se descuentan recién cuando se aprueba el pago (no se pierden si el
//   pago expira). Devuelve { pagoId } para abrir el flujo de pago.
export async function redeemCombo({ userId, comboId, fecha_hora, pagar_diferencia = false }, token) {
  if (!userId) throw new Error('Debes iniciar sesión para canjear puntos');
  if (!fecha_hora) throw new Error('Fecha y hora requeridas');

  const combo = await getCombo(comboId);
  if (!combo || !combo.active) throw new Error('Combo no encontrado');
  if (!combo.servicios_ids.length) throw new Error('El servicio combinado no tiene servicios');

  const { data: user, error: uError } = await supabase
    .from('users')
    .select('id, nombre, email, telefono, puntos_acumulados')
    .eq('id', userId)
    .single();
  if (uError) throw uError;
  if (!user) throw new Error('Usuario no encontrado');

  const puntos = Number(user.puntos_acumulados) || 0;
  const costo = Number(combo.costo_en_puntos) || 0;
  let puntos_finales = puntos;

  if (puntos < costo) {
    if (!pagar_diferencia) {
      const faltante = costo - puntos;
      throw new Error(
        `No cuenta con los puntos suficientes. Le faltan ${faltante} pts ($${faltante}) para el canje.`,
      );
    }
  }

  const settings = await getSettings();
  // Los clientes solo pueden canjear con hasta 30 días corridos de anticipación.
  if (fecha_hora.slice(0, 10) > maxDateISO(30)) {
    throw new Error('Solo puedes agendar turnos con hasta un mes de anticipación');
  }
  const inHours = await inWorkingHours(fecha_hora, settings.slot_interval_minutes || 5);
  if (!inHours) {
    throw new Error('La fecha/hora debe estar dentro del horario de trabajo');
  }

  // Cada servicio del combo debe caber sin solaparse con otras citas.
  const serviceIds = combo.servicios_ids;
  const { data: services, error: svError } = await supabase
    .from('services')
    .select('id, duracion_minutos, buffer_previo_minutos, buffer_posterior_minutos')
    .in('id', serviceIds);
  if (svError) throw svError;

  const { data: existing, error: exError } = await supabase
    .from('appointments')
    .select(
      'id, fecha_hora, service_id, estado, reserva_expiracion, services:service_id (duracion_minutos, buffer_previo_minutos, buffer_posterior_minutos)',
    )
    .not('estado', 'eq', 'Cancelada');
  if (exError) throw exError;

  const targetStart = toUtcMs(fecha_hora);
  const globalBefore = settings.buffer_before_minutes || 0;
  const globalAfter = settings.buffer_after_minutes || 0;

  // Todos los servicios del combo arrancan a la misma hora; el bloqueo cubre
  // hasta la mayor duración y el mayor buffer posterior, y empieza antes por el
  // mayor buffer previo. Las citas existentes se expanden con sus propios buffers.
  // La capacidad efectiva del combo es el mínimo entre sus servicios (el bloque
  // es compartido: capacidad 1 = exclusivo).
  const maxDur = Math.max(0, ...services.map((s) => Number(s.duracion_minutos) || 0));
  const comboBefore = Math.max(
    0,
    ...services.map((s) => (s.buffer_previo_minutos != null ? Number(s.buffer_previo_minutos) : globalBefore)),
  );
  const comboAfter = Math.max(
    0,
    ...services.map((s) => (s.buffer_posterior_minutos != null ? Number(s.buffer_posterior_minutos) : globalAfter)),
  );
  const comboCapacity = Math.min(...services.map((s) => Number(s.capacidad) || 1));
  const blockStart = targetStart - comboBefore * 60000;
  const blockEnd = targetStart + (maxDur + comboAfter) * 60000;

  const occupiers = (existing || []).filter((a) => {
    if (reservaVencida(a)) return false;
    const aStart = toUtcMs(a.fecha_hora);
    const aDur = Number(a.services?.duracion_minutos) || 0;
    const aBefore = a.services?.buffer_previo_minutos != null ? a.services.buffer_previo_minutos : globalBefore;
    const aAfter = a.services?.buffer_posterior_minutos != null ? a.services.buffer_posterior_minutos : globalAfter;
    const aEffStart = aStart - aBefore * 60000;
    const aEffEnd = aStart + (aDur + aAfter) * 60000;
    return Math.max(blockStart, aEffStart) < Math.min(blockEnd, aEffEnd);
  }).length;
  if (occupiers >= comboCapacity) throw new Error('Ese horario ya no está disponible');

  // ¿El canje se cubre con puntos o queda diferencia a abonar?
  const conDiferencia = pagar_diferencia && puntos < costo;
  const aDescontar = conDiferencia ? puntos : costo;
  const diferencia = conDiferencia ? costo - puntos : 0;

  const estado = conDiferencia ? 'Pendiente' : 'Confirmada';
  const expiracion = conDiferencia ? new Date(Date.now() + 60 * 60000).toISOString() : null;

  // Crear una cita por servicio del combo.
  const created = [];
  for (const serviceId of serviceIds) {
    const { data: row, error: insError } = await supabase
      .from('appointments')
      .insert({
        user_id: userId,
        service_id: serviceId,
        fecha_hora,
        estado,
        reserva_expiracion: expiracion,
        promotion_id: combo.id,
        cliente_nombre: user.nombre,
        cliente_email: user.email || null,
        cliente_telefono: user.telefono || null,
        puntos_abonados: false,
      })
      .select('*')
      .single();
    if (insError) throw insError;
    created.push(row);
  }

  // Descontar puntos: inmediato solo si el canje queda saldado (sin diferencia).
  if (!conDiferencia && aDescontar > 0) {
    const { error: pError } = await supabase
      .from('users')
      .update({ puntos_acumulados: puntos - aDescontar })
      .eq('id', userId);
    if (pError) throw pError;
  }

  // Con diferencia: crear el pago tipo 'combo' por el faltante (1 punto = $1).
  // Los puntos comprometidos quedan en detalle para descontarlos al aprobarse
  // el pago (aplicarEstadoPago).
  let pagoId = null;
  if (conDiferencia) {
    const { data: pago, error: pagoError } = await supabase
      .from('pagos')
      .insert({
        tipo: 'combo',
        user_id: userId,
        appointment_id: created[0]?.id || null,
        promotion_id: combo.id,
        monto_total: diferencia,
        moneda: process.env.MERCADOPAGO_CURRENCY?.trim() || 'CLP',
        detalle: { puntos_a_descontar: aDescontar },
      })
      .select('id')
      .single();
    if (pagoError) throw pagoError;
    pagoId = pago.id;
  }

  return { combo, appointments: created, puntos_restantes: puntos - aDescontar, pagoId };
}
