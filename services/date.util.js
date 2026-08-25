// Helpers de fecha normalizados a UTC, ya que Supabase guarda `fecha_hora` como
// timestamptz (+00:00). El front envía horario "HH:MM" local sin offset; tratamos
// esos strings como si fueran UTC para que coincidan con lo almacenado.

// "YYYY-MM-DDTHH:MM:SS" (o con offset) -> ms UTC. Fallback a Date normal.
export function toUtcMs(value) {
  const s = String(value || '');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const [, y, mo, d, h, mi, se] = m;
    return Date.UTC(
      Number(y),
      Number(mo) - 1,
      Number(d),
      Number(h),
      Number(mi),
      Number(se || 0),
    );
  }
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? 0 : t;
}

// El string de fecha que devuelve a formato "HH:MM" (coordenadas UTC).
export function utcTime(value) {
  const d = new Date(toUtcMs(value));
  const h = String(d.getUTCHours()).padStart(2, '0');
  const m = String(d.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

// "YYYY-MM-DD" -> día de la semana (1=Lunes...7=Domingo).
export function dayOfWeek(dateStr) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`);
  return ((d.getUTCDay() + 6) % 7) + 1;
}

// Fecha "YYYY-MM-DD" de hoy + `daysAhead` días corridos (coordenadas UTC).
export function maxDateISO(daysAhead) {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysAhead))
    .toISOString()
    .slice(0, 10);
}

// Convierte "HH:MM" a minutos desde medianoche.
export function toMinutes(hhmm) {
  const [h, m] = String(hhmm || '0').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

// Una reserva online (Pendiente) con reserva_expiracion ya vencida dejó de
// reservar el turno: no debe bloquear horarios en las consultas de solape.
export const reservaVencida = (cita) =>
  cita?.estado === 'Pendiente' &&
  Boolean(cita?.reserva_expiracion) &&
  Date.now() > new Date(cita.reserva_expiracion).getTime();