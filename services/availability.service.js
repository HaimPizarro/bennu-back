import { supabase } from '../config/supabase.js';
import { getSettings } from './settings.service.js';
import { resolveSchedule } from './horarios.service.js';
import { toMinutes, utcTime, reservaVencida } from './date.util.js';

// Genera los horarios de inicio de cada slot dentro de un rango, en pasos de `interval`.
const slotsInRange = (start, end, interval) => {
  const slots = [];
  const startMin = toMinutes(start);
  const endMin = toMinutes(end);
  for (let t = startMin; t < endMin; t += interval) {
    const h = Math.floor(t / 60);
    const m = t % 60;
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
  return slots;
};

// Calcula los slots del día. Cada cita existente ocupa
// [inicio - bufferBefore, inicio + duración + bufferAfter].
// Si `duration` viene (duración del servicio/combos a reservar), evalúa la
// viabilidad completa de cada slot: el bloque [slot - bufferBefore,
// slot + duration + bufferAfter] no debe superar la capacidad disponible
// (`duration.capacidad`, por defecto 1) ni exceder la jornada.
export async function getAvailability(date, duration, empleadoId, sucursalId) {
  const sid = sucursalId != null ? Number(sucursalId) : 1;
  const settings = await getSettings(sid);

  let q = supabase
    .from('appointments')
    .select(
      'id, fecha_hora, service_id, estado, reserva_expiracion, services:service_id (duracion_minutos, buffer_previo_minutos, buffer_posterior_minutos)',
    )
    .gte('fecha_hora', `${date}T00:00:00`)
    .lte('fecha_hora', `${date}T23:59:59`);
  q = q.eq('sucursal_id', sid);
  const appointments = await q;

  if (appointments.error) throw appointments.error;

  const schedule = await resolveSchedule(date, settings.working_hours, empleadoId, sid);
  const ranges = schedule.ranges;

  if (schedule.closed || ranges.length === 0) {
    return {
      date,
      interval: settings.slot_interval_minutes,
      closed: true,
      slots: [],
      blocked: [],
      buffer_before: settings.buffer_before_minutes || 0,
      buffer_after: settings.buffer_after_minutes || 0,
      work_end: null,
    };
  }

  const interval = settings.slot_interval_minutes;
  const globalBefore = settings.buffer_before_minutes || 0;
  const globalAfter = settings.buffer_after_minutes || 0;
  const workEnd = Math.max(...ranges.map((r) => toMinutes(r.end)));

  const times = [];
  for (const range of ranges) {
    times.push(...slotsInRange(range.start, range.end, interval));
  }

  // Buffers del servicio objetivo (viabilidad del slot a reservar). Si el
  // servicio no define los suyos, cae al global de settings.
  const svcBefore = duration != null && duration.bufferBefore != null ? duration.bufferBefore : globalBefore;
  const svcAfter = duration != null && duration.bufferAfter != null ? duration.bufferAfter : globalAfter;

  const blockedRanges = (appointments.data || [])
    .filter((a) => a.estado !== 'Cancelada' && !reservaVencida(a))
    .map((a) => {
      const startMin = utcMinute(utcTime(a.fecha_hora));
      const aDur = Number(a.services?.duracion_minutos) || 0;
      const aBefore = a.services?.buffer_previo_minutos != null ? a.services.buffer_previo_minutos : globalBefore;
      const aAfter = a.services?.buffer_posterior_minutos != null ? a.services.buffer_posterior_minutos : globalAfter;
      return {
        id: a.id,
        startMin: startMin - aBefore,
        endMin: startMin + aDur + aAfter,
        // Tiempo real del servicio (sin márgenes): lo que ve el cliente.
        rawStartMin: startMin,
        rawEndMin: startMin + aDur,
      };
    });

  const overlapsBlocked = (blockStart, blockEnd) => {
    let count = 0;
    for (const b of blockedRanges) {
      if (Math.max(blockStart, b.startMin) < Math.min(blockEnd, b.endMin)) {
        count += 1;
      }
    }
    return count;
  };

  const targetCapacity = duration != null && duration.capacidad != null ? Number(duration.capacidad) : 1;

  const slots = times.map((time) => {
    const timeMin = toMinutes(time);
    let available = true;
    let blockingAppointmentId = null;

    if (duration != null) {
      // Viabilidad completa con la duración del servicio a reservar: el bloque
      // [slot - bufferBefore, slot + duration + bufferAfter] no debe superar la
      // jornada, los ocupantes que lo solapan deben ser menos que la capacidad,
      // y el servicio debe caber dentro de UNA franja (no cruzar una ventana
      // no laborable tipo almuerzo/descanso).
      const blockStart = timeMin - svcBefore;
      const blockEnd = timeMin + Number(duration.duration) + svcAfter;
      const range = ranges.find((r) => timeMin >= toMinutes(r.start) && timeMin < toMinutes(r.end));
      if (blockEnd > workEnd) {
        available = false;
      } else if (range && timeMin + Number(duration.duration) > toMinutes(range.end)) {
        available = false;
      } else {
        const occupiers = overlapsBlocked(blockStart, blockEnd);
        if (occupiers >= targetCapacity) {
          available = false;
          const b = blockedRanges.find(
            (blk) => Math.max(blockStart, blk.startMin) < Math.min(blockEnd, blk.endMin),
          );
          if (b) blockingAppointmentId = b.id;
        }
      }
    } else {
      // Sin duration: comportamiento previo (inicio del slot dentro de un bloqueo).
      const b = blockedRanges.find((blk) => Math.max(timeMin, blk.startMin) < Math.min(timeMin + 1, blk.endMin));
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
    slots,
    blocked: blockedRanges,
    buffer_before: duration != null ? svcBefore : globalBefore,
    buffer_after: duration != null ? svcAfter : globalAfter,
    work_end: workEnd,
  };
}

// "HH:MM" (coordenadas UTC) a minutos desde medianoche.
function utcMinute(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Disponibilidad de un rango de fechas en UNA llamada (pinta los puntos del
// calendario sin 45 requests). Sin duration: solo cuenta de slots por día.
export async function getAvailabilityRange(from, to, sucursalId) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const days = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  const results = await Promise.all(
    days.map((d) => getAvailability(d, null, null, sucursalId)),
  );
  return { from, to, days: results };
}
