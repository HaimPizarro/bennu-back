import { supabase } from '../config/supabase.js';
import { getSettings } from './settings.service.js';
import { toMinutes, toUtcMs, dayOfWeek, reservaVencida, maxDateISO } from './date.util.js';
import { crearNotificacion, notificarAdmins } from './notificaciones.service.js';
import { syncAppointment } from './google.service.js';
import { isActiveSubscriber } from './suscripciones.service.js';

// Verifica si existe otra cita (no cancelada) que se solape con la ventana
// efectiva [inicio - bufferBefore, inicio + duracion + bufferAfter]. Cada cita
// existente se expande con los buffers de SU servicio (o global si no los define).
// `service` es el servicio objetivo: { duracion_minutos, buffer_previo_minutos,
// buffer_posterior_minutos }.
async function checkOverlap(fechaInicio, service, excludeId, sucursalId) {
  const settings = await getSettings(sucursalId);
  const globalBefore = settings.buffer_before_minutes || 0;
  const globalAfter = settings.buffer_after_minutes || 0;

  const svcBefore = service?.buffer_previo_minutos != null ? service.buffer_previo_minutos : globalBefore;
  const svcAfter = service?.buffer_posterior_minutos != null ? service.buffer_posterior_minutos : globalAfter;

  const targetStart = toUtcMs(fechaInicio) - svcBefore * 60000;
  const targetEnd = toUtcMs(fechaInicio) + (Number(service?.duracion_minutos || 0) + svcAfter) * 60000;

  let q = supabase
    .from('appointments')
    .select(
      'id, fecha_hora, reserva_expiracion, services:service_id (duracion_minutos, buffer_previo_minutos, buffer_posterior_minutos)',
    )
    .not('estado', 'eq', 'Cancelada');
  if (sucursalId != null) q = q.eq('sucursal_id', Number(sucursalId));
  const { data, error } = await q;
  if (error) throw error;

  const conflict = (data || []).find((a) => {
    if (reservaVencida(a)) return false;
    if (excludeId && Number(a.id) === Number(excludeId)) return false;
    const aStart = toUtcMs(a.fecha_hora);
    const aDur = Number(a.services?.duracion_minutos) || 0;
    const aBefore = a.services?.buffer_previo_minutos != null ? a.services.buffer_previo_minutos : globalBefore;
    const aAfter = a.services?.buffer_posterior_minutos != null ? a.services.buffer_posterior_minutos : globalAfter;
    const aEffStart = aStart - aBefore * 60000;
    const aEffEnd = aStart + (aDur + aAfter) * 60000;
    return Math.max(targetStart, aEffStart) < Math.min(targetEnd, aEffEnd);
  });

  return Boolean(conflict);
}

// Valida las respuestas contra los campos dinámicos del servicio y devuelve el
// objeto saneado keyed por label. Lanza si falta un campo requerido o si un
// select/multiselect no coincide con las opciones definidas.
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

// Valida que la cita caiga alineada al intervalo, dentro de una franja de
// trabajo y que su duración quepa en esa misma franja (no cruce una ventana
// no laborable tipo almuerzo/descanso).
async function validateWorkingHours(fechaInicio, interval, sucursalId, durationMin = 0) {
  const settings = await getSettings(sucursalId);
  const dateStr = fechaInicio.slice(0, 10);
  const dow = dayOfWeek(dateStr);
  const ranges = (settings.working_hours || {})[String(dow)];

  if (!Array.isArray(ranges) || ranges.length === 0) return false;

  const d = new Date(toUtcMs(fechaInicio));
  const minuteOfDay = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (minuteOfDay % interval !== 0) return false;

  const range = ranges.find((r) => minuteOfDay >= toMinutes(r.start) && minuteOfDay < toMinutes(r.end));
  if (!range) return false;
  return minuteOfDay + durationMin <= toMinutes(range.end);
}

// Crea una cita pública. Si `userId` viene, se asocia (suma puntos al completarse);
// si no, queda como walk-in (user_id null).
export async function createPublicBooking(payload, userId) {
  const { service_id, fecha_hora, cliente_nombre, cliente_email, cliente_telefono } = payload;

  if (!service_id || !fecha_hora) {
    throw new Error('service_id y fecha_hora son requeridos');
  }
  if (!cliente_nombre || !cliente_nombre.trim()) {
    throw new Error('El nombre es obligatorio para reservar');
  }

  const { data: service, error: svError } = await supabase
    .from('services')
    .select(
      'id, nombre, duracion_minutos, buffer_previo_minutos, buffer_posterior_minutos, sucursal_id, campos',
    )
    .eq('id', service_id)
    .maybeSingle();
  if (svError) throw svError;
  if (!service) throw new Error('Servicio no encontrado');

  const sucursalId = service.sucursal_id || 1;
  const settings = await getSettings(sucursalId);
  const respuestas = validateRespuestas(service, payload.respuestas);

  // Los clientes solo pueden agendar con hasta 30 días corridos de anticipación.
  if (fecha_hora.slice(0, 10) > maxDateISO(30)) {
    throw new Error('Solo puedes agendar turnos con hasta un mes de anticipación');
  }

  const inHours = await validateWorkingHours(
    fecha_hora,
    settings.slot_interval_minutes || 5,
    sucursalId,
    Number(service.duracion_minutos) || 0,
  );
  if (!inHours) {
    throw new Error('La cita debe estar dentro del horario de trabajo y en intervalos válidos');
  }

  const overlap = await checkOverlap(fecha_hora, service, null, sucursalId);
  if (overlap) {
    throw new Error('Ese horario ya no está disponible');
  }

  const { data, error } = await supabase
    .from('appointments')
    .insert({
      user_id: userId || null,
      service_id,
      fecha_hora,
      estado: 'Pendiente',
      reserva_expiracion: new Date(Date.now() + 60 * 60000).toISOString(),
      cliente_nombre: cliente_nombre.trim(),
      cliente_email: cliente_email?.trim() || null,
      cliente_telefono: cliente_telefono?.trim() || null,
      notas: payload.notas || null,
      respuestas,
      puntos_abonados: false,
      sucursal_id: sucursalId,
    })
    .select('*')
    .single();
  if (error) throw error;

  if (userId) {
    await crearNotificacion({
      userId,
      tipo: 'cita',
      titulo: 'Cita solicitada',
      mensaje: `Tu cita de "${service.nombre}" quedó registrada para el ${fecha_hora.slice(0, 10)}.`,
      enlace: `/mi-cuenta?tab=agenda`,
    });
  }

  await notificarAdmins({
    tipo: 'cita',
    titulo: 'Nueva reserva',
    mensaje: `Nueva reserva de ${cliente_nombre.trim()} — "${service.nombre}" para el ${fecha_hora.slice(0, 10)} a las ${fecha_hora.slice(11, 16)}.`,
    enlace: '/dashboard?tab=agenda',
  });

  syncAppointment({ ...data, services: service });

  return data;
}

// Cita pública para confirmación/pago: incluye servicio para mostrar detalle.
export async function getPublicBooking(id) {
  const { data, error } = await supabase
    .from('appointments')
    .select(`
      *,
      services:service_id (nombre, precio, precio_oferta, descuento_suscripcion, duracion_minutos, puntos_otorgados)
    `)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;

  if (!data) return data;
  data.suscripcion_activa = data.user_id ? await isActiveSubscriber(data.user_id) : false;
  return data;
}

// Cancela una reserva pública para liberar el turno. Solo se permite mientras
// no esté confirmada/completada (una vez pagada, no se revierte desde aquí).
export async function cancelPublicBooking(id) {
  const { data: existing, error } = await supabase
    .from('appointments')
    .select('id, estado')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!existing) throw new Error('Reserva no encontrada');
  if (existing.estado === 'Confirmada' || existing.estado === 'Completada') {
    throw new Error('La reserva ya fue confirmada y no puede cancelarse');
  }
  if (existing.estado === 'Cancelada') return existing;

  const { data, error: uError } = await supabase
    .from('appointments')
    .update({ estado: 'Cancelada' })
    .eq('id', id)
    .select('*')
    .single();
  if (uError) throw uError;
  return data;
}