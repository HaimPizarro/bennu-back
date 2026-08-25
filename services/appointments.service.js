import { supabase } from '../config/supabase.js';
import { getSettings } from './settings.service.js';
import { toUtcMs, reservaVencida } from './date.util.js';
import { crearNotificacion, notificarAdmins } from './notificaciones.service.js';
import { syncAppointment } from './google.service.js';
import { enviarRecordatorioPago, enviarCitaCancelada } from './email.service.js';

const TABLE = 'appointments';
const estadosValidos = ['Pendiente', 'Confirmada', 'Cancelada', 'Completada'];

// Frecuencias soportadas y cómputo de la siguiente ocurrencia.
const FREQ = {
  daily: (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, d.getUTCHours(), d.getUTCMinutes())),
  weekly: (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 7, d.getUTCHours(), d.getUTCMinutes())),
  monthly: (d) => {
    // Mes siguiente conservando el día (misma lógica que Agenda: día > 28 cae al final).
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(day, last), d.getUTCHours(), d.getUTCMinutes()));
  },
};

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

const fmtFecha = (iso) => (iso ? String(iso).slice(0, 10) : '?');
const fmtHora = (iso) => (iso ? String(iso).slice(11, 16) : '?');

// Notifica un cambio de cita: al cliente dueño (si está registrado) y eco a los
// admins para que la actividad se refleje en la campanita del dashboard.
async function notificarCita({ cita, servicio = 'tu servicio', actorId, titulo, mensaje }) {
  const nombre = servicio?.nombre || cita?.services?.nombre || 'tu servicio';
  const nombreCliente = cita?.cliente_nombre || cita?.users?.nombre || 'walk-in';
  if (cita?.user_id) {
    await crearNotificacion({
      userId: cita.user_id,
      tipo: 'cita',
      titulo: typeof titulo === 'function' ? titulo({ nombre, modo: 'cliente' }) : titulo,
      mensaje: typeof mensaje === 'function' ? mensaje({ nombre, modo: 'cliente' }) : mensaje,
      enlace: '/mi-cuenta?tab=agenda',
    });
  }
  await notificarAdmins({
    tipo: 'cita',
    titulo: typeof titulo === 'function' ? titulo({ nombre, nombreCliente, modo: 'admin' }) : titulo,
    mensaje: typeof mensaje === 'function' ? mensaje({ nombre, nombreCliente, modo: 'admin' }) : mensaje,
    enlace: '/dashboard?tab=agenda',
    creadaPor: actorId || null,
  });
}

// Genera las fechas de la serie [startISO, hastaISO] con la frecuencia dada.
function serieDates({ startISO, frecuencia, hastaISO, maxInstancias }) {
  const start = new Date(`${startISO.slice(0, 10)}T00:00:00Z`);
  const hasta = hastaISO ? new Date(`${String(hastaISO).slice(0, 10)}T00:00:00Z`) : null;
  const step = FREQ[frecuencia];
  if (!step) return { dates: [startISO], ids: null };

  const dates = [startISO];
  let cur = start;
  const limit = hasta || new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 365));
  while (true) {
    cur = step(cur);
    if (cur > limit || dates.length >= (maxInstancias || 60)) break;
    dates.push(isoDate(cur));
  }
  return { dates, ids: null };
}

// Verifica que otra fecha no supere la capacidad del servicio (incluye buffers).
// Ventana efectiva de cada cita: [inicio - buffer, inicio + duración + buffer].
// Cada cita existente usa los buffers de SU servicio (o global si no los define).
// excludeId (opcional) ignora la propia cita en ediciones.
// `service` es el servicio objetivo: { duracion_minutos, capacidad,
// buffer_previo_minutos, buffer_posterior_minutos }. La cita se permite si la
// cantidad de citas que solapan el bloque es menor a la capacidad (1 = exclusivo).
async function checkOverlap(fechaInicio, service, excludeId, sucursalId) {
  const settings = await getSettings(sucursalId);
  const globalBefore = settings.buffer_before_minutes || 0;
  const globalAfter = settings.buffer_after_minutes || 0;

  const svcBefore = service?.buffer_previo_minutos != null ? service.buffer_previo_minutos : globalBefore;
  const svcAfter = service?.buffer_posterior_minutos != null ? service.buffer_posterior_minutos : globalAfter;
  const capacity = service?.capacidad != null ? Number(service.capacidad) : 1;

  const targetStart = toUtcMs(fechaInicio) - svcBefore * 60000;
  const targetEnd = toUtcMs(fechaInicio) + (Number(service?.duracion_minutos || 0) + svcAfter) * 60000;

  let q = supabase
    .from(TABLE)
    .select(
      'id, fecha_hora, reserva_expiracion, services:service_id (duracion_minutos, buffer_previo_minutos, buffer_posterior_minutos)',
    )
    .not('estado', 'eq', 'Cancelada');
  if (sucursalId != null) q = q.eq('sucursal_id', Number(sucursalId));
  const { data, error } = await q;
  if (error) throw error;

  const occupiers = (data || []).filter((a) => {
    if (reservaVencida(a)) return false;
    if (excludeId && Number(a.id) === Number(excludeId)) return false;
    const aStart = toUtcMs(a.fecha_hora);
    const aDur = Number(a.services?.duracion_minutos) || 0;
    const aBefore = a.services?.buffer_previo_minutos != null ? a.services.buffer_previo_minutos : globalBefore;
    const aAfter = a.services?.buffer_posterior_minutos != null ? a.services.buffer_posterior_minutos : globalAfter;
    const aEffStart = aStart - aBefore * 60000;
    const aEffEnd = aStart + (aDur + aAfter) * 60000;
    return Math.max(targetStart, aEffStart) < Math.min(targetEnd, aEffEnd);
  }).length;

  return occupiers >= capacity;
}

// Servicio objetivo (duración + buffers + capacidad + sucursal + campos) para calcular solapamiento.
async function serviceInfo(serviceId) {
  if (!serviceId) return null;
  const { data } = await supabase
    .from('services')
    .select('id, nombre, duracion_minutos, capacidad, buffer_previo_minutos, buffer_posterior_minutos, sucursal_id, campos')
    .eq('id', serviceId)
    .maybeSingle();
  return data || null;
}

// Valida las respuestas contra los campos dinámicos del servicio y devuelve
// el objeto saneado keyed por label. Lanza si falta un campo requerido o si
// un select/multiselect no coincide con las opciones definidas.
function validateRespuestas(service, respuestas) {
  const campos = Array.isArray(service?.campos) ? service.campos : [];
  if (campos.length === 0) return {};

  const raw = respuestas && typeof respuestas === 'object' && !Array.isArray(respuestas) ? respuestas : {};
  const out = {};
  for (const campo of campos) {
    const value = raw[campo.label];
    const empty = value === undefined || value === null || value === '';
    if (empty) {
      if (campo.requerido) {
        throw new Error(`El campo "${campo.label}" es obligatorio`);
      }
      continue;
    }
    if (campo.tipo === 'multiselect') {
      const items = Array.isArray(value) ? value : [value];
      for (const item of items) {
        if (campo.opciones?.length && !campo.opciones.includes(String(item))) {
          throw new Error(`Opción inválida para "${campo.label}"`);
        }
      }
      out[campo.label] = items.map(String);
    } else if (campo.tipo === 'select') {
      if (campo.opciones?.length && !campo.opciones.includes(String(value))) {
        throw new Error(`Opción inválida para "${campo.label}"`);
      }
      out[campo.label] = String(value);
    } else {
      out[campo.label] = String(value);
    }
  }
  return out;
}

export async function createAppointment(payload, actorId) {
  if (!payload.service_id || !payload.fecha_hora) {
    throw new Error('service_id y fecha_hora son requeridos');
  }

  const service = await serviceInfo(payload.service_id);
  const sucursalId = payload.sucursal_id != null ? Number(payload.sucursal_id) : service?.sucursal_id || 1;
  const respuestas = validateRespuestas(service, payload.respuestas);
  const overlap = await checkOverlap(payload.fecha_hora, service, null, sucursalId);
  if (overlap) {
    throw new Error('Ya existe una cita en ese horario (o se solapa con los márgenes)');
  }

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      user_id: payload.user_id || null,
      service_id: payload.service_id,
      fecha_hora: payload.fecha_hora,
      estado: payload.estado || 'Pendiente',
      cliente_nombre: payload.cliente_nombre || null,
      cliente_email: payload.cliente_email || null,
      cliente_telefono: payload.cliente_telefono || null,
      notas: payload.notas || null,
      respuestas,
      puntos_abonados: false,
      sucursal_id: sucursalId,
    })
    .select('*')
    .single();
  if (error) throw error;
  await notificarCita({
    cita: data,
    servicio: service,
    actorId,
    titulo: 'Nueva cita',
    mensaje: ({ nombre, nombreCliente, modo }) =>
      modo === 'cliente'
        ? `Tienes una cita de "${nombre}" el ${fmtFecha(data.fecha_hora)} a las ${fmtHora(data.fecha_hora)}.`
        : `Se creó una cita de "${nombre}" el ${fmtFecha(data.fecha_hora)} a las ${fmtHora(data.fecha_hora)} · ${nombreCliente}.`,
  });
  syncAppointment(data);
  return data;
}

// Crea una cita recurrente: valida que CADA instancia de la serie no solape
// (excluyendo las propias instancias del lote) y crea todas las citas de una.
export async function createRecurring(payload, actorId) {
  if (!payload.service_id || !payload.fecha_hora) {
    throw new Error('service_id y fecha_hora son requeridos');
  }
  const frecuencia = payload.recurrencia || 'none';
  if (!FREQ[frecuencia]) {
    throw new Error('Frecuencia inválida. Debe ser daily, weekly o monthly');
  }

  const service = await serviceInfo(payload.service_id);
  const sucursalId = payload.sucursal_id != null ? Number(payload.sucursal_id) : service?.sucursal_id || 1;
  const respuestas = validateRespuestas(service, payload.respuestas);
  const { dates } = serieDates({
    startISO: payload.fecha_hora,
    frecuencia,
    hastaISO: payload.recurrencia_hasta || null,
  });

  // El lote comparte un mismo recurrencia_id. Insertamos todas las instancias y
  // al final reasignamos el grupo (id de la primera) a toda la serie.
  const created = [];
  for (const dateISO of dates) {
    const fechaHora = dateISO.slice(0, 10) + payload.fecha_hora.slice(10);
    const overlap = await checkOverlap(fechaHora, service, null, sucursalId);
    if (overlap) {
      throw new Error(`Solapamiento en la fecha ${dateISO.slice(0, 10)} — cancele o reubique la cita existente`);
    }
    const row = await insertAppointmentRow({
      ...payload,
      fecha_hora: fechaHora,
      recurrencia: frecuencia,
      sucursal_id: sucursalId,
      respuestas,
    });
    created.push(row);
  }

  const recurrenciaId = created[0].id;
  await supabase.from(TABLE).update({ recurrencia_id: recurrenciaId }).in('id', created.map((c) => c.id));

  created.forEach((c) => syncAppointment(c));

  await notificarCita({
    cita: created[0],
    servicio: service,
    actorId,
    titulo: 'Nueva serie de citas',
    mensaje: ({ nombre, nombreCliente, modo }) =>
      modo === 'cliente'
        ? `Se creó una serie de "${nombre}" con ${created.length} citas desde el ${fmtFecha(created[0].fecha_hora)}.`
        : `Se creó una serie de "${nombre}" con ${created.length} citas desde el ${fmtFecha(created[0].fecha_hora)} · ${nombreCliente}.`,
  });

  return { count: created.length, appointments: created.map((c) => ({ ...c, recurrencia_id: recurrenciaId })) };
}

async function insertAppointmentRow(payload) {
  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      user_id: payload.user_id || null,
      service_id: payload.service_id,
      fecha_hora: payload.fecha_hora,
      estado: payload.estado || 'Pendiente',
      cliente_nombre: payload.cliente_nombre || null,
      cliente_email: payload.cliente_email || null,
      cliente_telefono: payload.cliente_telefono || null,
      notas: payload.notas || null,
      respuestas: payload.respuestas || {},
      puntos_abonados: false,
      recurrencia: payload.recurrencia || 'none',
      recurrencia_id: payload.recurrencia_id || null,
      recurrencia_hasta: payload.recurrencia_hasta || null,
      origen_id: payload.origen_id || null,
      sucursal_id: payload.sucursal_id != null ? Number(payload.sucursal_id) : 1,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function listAppointments(sucursalId) {
  let q = supabase
    .from(TABLE)
    .select(`
      *,
      users:user_id (nombre, email, telefono, puntos_acumulados),
      services:service_id (nombre, precio, precio_oferta, descuento_suscripcion, duracion_minutos, puntos_otorgados)
    `)
    .order('fecha_hora', { ascending: true });
  if (sucursalId != null) q = q.eq('sucursal_id', Number(sucursalId));
  const { data, error } = await q;
  if (error) throw error;
  return data;
}

export async function listAppointmentsByUser(userId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select(`
      *,
      services:service_id (nombre, precio, duracion_minutos, puntos_otorgados)
    `)
    .eq('user_id', userId)
    .order('fecha_hora', { ascending: true });
  if (error) throw error;
  return data;
}

export async function getAppointmentById(id) {
  const { data, error } = await supabase
    .from(TABLE)
    .select(`
      *,
      users:user_id (nombre, email, telefono, puntos_acumulados),
      services:service_id (nombre, precio, precio_oferta, descuento_suscripcion, duracion_minutos, puntos_otorgados)
    `)
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function updateAppointment(id, payload, actorId) {
  if (!payload.service_id || !payload.fecha_hora) {
    throw new Error('service_id y fecha_hora son requeridos');
  }
  if (estadosValidos.includes(payload.estado) === false) {
    throw new Error(`Estado inválido. Debe ser: ${estadosValidos.join(', ')}`);
  }

  const service = await serviceInfo(payload.service_id);
  const sucursalId = payload.sucursal_id != null ? Number(payload.sucursal_id) : service?.sucursal_id || 1;
  const overlap = await checkOverlap(payload.fecha_hora, service, id, sucursalId);
  if (overlap) {
    throw new Error('Ya existe otra cita en ese horario (o se solapa con los márgenes)');
  }

  const update = {
    service_id: payload.service_id,
    fecha_hora: payload.fecha_hora,
    estado: payload.estado,
    user_id: payload.user_id || null,
    cliente_nombre: payload.cliente_nombre || null,
    cliente_email: payload.cliente_email || null,
    cliente_telefono: payload.cliente_telefono || null,
    notas: payload.notas || null,
    sucursal_id: sucursalId,
  };

  const { data, error } = await supabase
    .from(TABLE)
    .update(update)
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  await notificarCita({
    cita: data,
    servicio: service,
    actorId,
    titulo: 'Cita reprogramada',
    mensaje: ({ nombre, nombreCliente, modo }) =>
      modo === 'cliente'
        ? `Tu cita de "${nombre}" quedó para el ${fmtFecha(data.fecha_hora)} a las ${fmtHora(data.fecha_hora)}.`
        : `Se modificó la cita de ${nombreCliente} — ahora ${fmtHora(data.fecha_hora)} del ${fmtFecha(data.fecha_hora)} · "${nombre}".`,
  });
  syncAppointment({ ...data, services: service });
  return data;
}

export async function deleteAppointment(id, actorId) {
  const existing = await getAppointmentById(id);
  const { error } = await supabase.from(TABLE).delete().eq('id', id);
  if (error) throw error;
  if (existing) {
    await notificarCita({
      cita: existing,
      actorId,
      titulo: 'Cita eliminada',
      mensaje: ({ nombre, nombreCliente, modo }) =>
        modo === 'cliente'
          ? `Tu cita de "${nombre}" del ${fmtFecha(existing.fecha_hora)} a las ${fmtHora(existing.fecha_hora)} fue eliminada. Si quieres reagendarla, haz una nueva reserva.`
          : `Se eliminó la cita de ${nombreCliente} — "${nombre}" del ${fmtFecha(existing.fecha_hora)} a las ${fmtHora(existing.fecha_hora)}.`,
    });
    syncAppointment({ ...existing, estado: 'Cancelada' });
  }
  return true;
}

// Award loyalty points when an appointment with a registered user is completed.
// The `puntos_abonados` flag prevents double-awarding. Returns { award } info.
export async function updateAppointmentStatus(id, estado, actorId) {
  if (!estadosValidos.includes(estado)) {
    throw new Error(`Estado inválido. Debe ser: ${estadosValidos.join(', ')}`);
  }

  const existing = await getAppointmentById(id);
  if (!existing) return null;

  const { data, error } = await supabase
    .from(TABLE)
    .update({ estado })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;

  syncAppointment({ ...data, services: existing.services });

  const target = existing.user_id || null;
  const fecha = existing.fecha_hora?.slice(0, 10);
  const servicio = existing.services?.nombre || 'tu servicio';
  const nombreCliente = existing.cliente_nombre || existing.users?.nombre || 'walk-in';

  if (target && estado === 'Completada') {
    const puntos = Number(existing.services?.puntos_otorgados) || 0;
    await crearNotificacion({
      userId: target,
      tipo: 'cita',
      titulo: 'Cita completada',
      mensaje: puntos > 0 && !existing.puntos_abonados && !existing.promotion_id
        ? `Tu cita de "${servicio}" del ${fecha} fue completada. Sumaste ${puntos} pts.`
        : `Tu cita de "${servicio}" del ${fecha} fue completada.`,
      enlace: `/mi-cuenta?tab=agenda`,
    });
  } else if (target && estado === 'Confirmada') {
    await crearNotificacion({
      userId: target,
      tipo: 'cita',
      titulo: 'Cita confirmada',
      mensaje: `Tu cita de "${servicio}" del ${fecha} fue confirmada.`,
      enlace: `/mi-cuenta?tab=agenda`,
    });
  } else if (target && estado === 'Cancelada') {
    await crearNotificacion({
      userId: target,
      tipo: 'cita',
      titulo: 'Cita cancelada',
      mensaje: `Tu cita de "${servicio}" del ${fecha} fue cancelada.`,
      enlace: `/mi-cuenta?tab=agenda`,
    });
  }

  const etiquetas = {
    Confirmada: { titulo: 'Cita confirmada', mensaje: `Se confirmó la cita de ${nombreCliente} — "${servicio}" del ${fecha}.` },
    Cancelada: { titulo: 'Cita cancelada', mensaje: `Se canceló la cita de ${nombreCliente} — "${servicio}" del ${fecha}.` },
    Completada: { titulo: 'Cita completada', mensaje: `Se completó la cita de ${nombreCliente} — "${servicio}" del ${fecha}.` },
  };
  if (etiquetas[estado]) {
    await notificarAdmins({ ...etiquetas[estado], tipo: 'cita', enlace: '/dashboard?tab=agenda', creadaPor: actorId || null });
  }

  let award = { awarded: false, puntos: 0 };

  if (estado === 'Completada' && existing.user_id && !existing.puntos_abonados && !existing.promotion_id) {
    const puntos = Number(existing.services?.puntos_otorgados) || 0;
    if (puntos > 0) {
      const { data: user } = await supabase
        .from('users')
        .select('puntos_acumulados')
        .eq('id', existing.user_id)
        .single();
      const nuevos = (Number(user?.puntos_acumulados) || 0) + puntos;
      const upd = await supabase
        .from('users')
        .update({ puntos_acumulados: nuevos })
        .eq('id', existing.user_id);
      if (upd.error) throw upd.error;

      await supabase.from(TABLE).update({ puntos_abonados: true }).eq('id', id);
      award = { awarded: true, puntos };
    }
  }

  return { ...data, __award: award };
}

// Cancela toda la serie recurrente a la que pertenece una cita (estado a
// Cancelada). Devuelve la cantidad de citas canceladas.
export async function cancelSeries(id, actorId) {
  const existing = await getAppointmentById(id);
  if (!existing) return null;

  const q = existing.recurrencia_id
    ? supabase.from(TABLE).select('id').eq('recurrencia_id', existing.recurrencia_id)
    : supabase.from(TABLE).select('id').eq('id', id);
  const { data, error } = await q;
  if (error) throw error;

  const ids = (data || []).map((a) => a.id);
  if (ids.length === 0) return { cancelled: 0 };

  const { error: upError } = await supabase
    .from(TABLE)
    .update({ estado: 'Cancelada' })
    .in('id', ids);
  if (upError) throw upError;

  if (existing.user_id) {
    await crearNotificacion({
      userId: existing.user_id,
      tipo: 'cita',
      titulo: 'Serie de citas cancelada',
      mensaje: `Se cancelaron ${ids.length} citas de la serie de "${existing.services?.nombre || 'tu servicio'}".`,
      enlace: `/mi-cuenta?tab=agenda`,
    });
  }

  const nombreCliente = existing.cliente_nombre || existing.users?.nombre || 'walk-in';
  await notificarAdmins({
    tipo: 'cita',
    titulo: 'Serie de citas cancelada',
    mensaje: `Se cancelaron ${ids.length} citas de la serie de "${existing.services?.nombre || 'tu servicio'}" de ${nombreCliente}.`,
    enlace: '/dashboard?tab=agenda',
    creadaPor: actorId || null,
  });

  ids.forEach((i) => syncAppointment({ ...existing, id: i, estado: 'Cancelada' }));

  return { cancelled: ids.length };
}

// Elimina toda la serie recurrente a la que pertenece una cita.
export async function deleteSeries(id, actorId) {
  const existing = await getAppointmentById(id);
  if (!existing) return null;

  const q = existing.recurrencia_id
    ? supabase.from(TABLE).select('id').eq('recurrencia_id', existing.recurrencia_id)
    : supabase.from(TABLE).select('id').eq('id', id);
  const { data, error } = await q;
  if (error) throw error;

  const ids = (data || []).map((a) => a.id);
  if (ids.length === 0) return { deleted: 0 };

  const { error: delError } = await supabase.from(TABLE).delete().in('id', ids);
  if (delError) throw delError;

  const nombreServicio = existing.services?.nombre || 'tu servicio';
  if (existing.user_id) {
    await crearNotificacion({
      userId: existing.user_id,
      tipo: 'cita',
      titulo: 'Serie de citas eliminada',
      mensaje: `Se eliminaron ${ids.length} citas de la serie de "${nombreServicio}". Si quieres reagendarlas, haz una nueva reserva.`,
      enlace: `/mi-cuenta?tab=agenda`,
    });
  }
  const nombreCliente = existing.cliente_nombre || existing.users?.nombre || 'walk-in';
  await notificarAdmins({
    tipo: 'cita',
    titulo: 'Serie de citas eliminada',
    mensaje: `Se eliminaron ${ids.length} citas de la serie de "${nombreServicio}" de ${nombreCliente}.`,
    enlace: '/dashboard?tab=agenda',
    creadaPor: actorId || null,
  });

  ids.forEach((i) => syncAppointment({ ...existing, id: i, estado: 'Cancelada' }));

  return { deleted: ids.length };
}

// Job periódico de reservas online (hold de 1 hora):
// - Recordatorio (T+20 min): email con link de pago a las Pendientes cuyo hold
//   pasó 20 min y quedan menos de 40. Se envía UNA sola vez (flag).
// - Cancelación (T+60 min): expirada la hora sin pago -> email avisando que se
//   canceló + estado Cancelada para liberar el turno.
export async function procesarReservasOnline() {
  const ahora = Date.now();

  const [{ data, error }, pagosRes] = await Promise.all([
    supabase
      .from(TABLE)
      .select('*, services:service_id (nombre, duracion_minutos, precio)')
      .eq('estado', 'Pendiente')
      .not('reserva_expiracion', 'is', null),
    supabase.from('pagos').select('id, user_id, promotion_id').eq('tipo', 'combo').eq('estado', 'pendiente'),
  ]);
  if (error) throw error;

  // Pago de diferencia por canje (user+promotion) -> link de pago del recordatorio.
  const pagoCanjePor = new Map();
  (pagosRes.data || []).forEach((p) => {
    if (p.user_id && p.promotion_id) pagoCanjePor.set(`${p.user_id}:${p.promotion_id}`, p.id);
  });

  const recordatorio = [];
  const aCancelar = [];
  for (const cita of data || []) {
    const exp = new Date(cita.reserva_expiracion).getTime();
    if (exp <= ahora) {
      aCancelar.push(cita);
    } else if (!cita.recordatorio_pago_enviado && exp <= ahora + 40 * 60000) {
      recordatorio.push(cita);
    }
  }

  for (const cita of recordatorio) {
    const pagoId =
      cita.promotion_id && cita.user_id ? pagoCanjePor.get(`${cita.user_id}:${cita.promotion_id}`) : null;
    const urlPago = pagoId
      ? `${process.env.FRONTEND_URL || 'http://localhost:5173'}/pago/canje/${pagoId}`
      : null;
    await enviarRecordatorioPago(cita, cita.services, urlPago);
    await supabase.from(TABLE).update({ recordatorio_pago_enviado: true }).eq('id', cita.id);
  }

  for (const cita of aCancelar) {
    await enviarCitaCancelada(cita, cita.services);
  }
  if (aCancelar.length) {
    const { error: upError } = await supabase
      .from(TABLE)
      .update({ estado: 'Cancelada' })
      .in('id', aCancelar.map((c) => c.id));
    if (upError) throw upError;
  }

  return { recordatorios: recordatorio.length, cancelados: aCancelar.length };
}