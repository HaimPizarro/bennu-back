import { supabase, createClientWithToken } from '../config/supabase.js';
import { dayOfWeek } from './date.util.js';

// ============================================================
// Horarios semanales por empleado (override del global)
// ============================================================

// Lista el horario semanal de un empleado agrupado por día.
// Devuelve { 1: [{start, end}], ..., 7: [] }
export async function getEmpleadoHorarios(empleadoId, sucursalId) {
  let q = supabase
    .from('empleado_horarios')
    .select('dia_semana, inicio, fin')
    .eq('empleado_id', Number(empleadoId))
    .order('dia_semana', { ascending: true })
    .order('inicio', { ascending: true });
  if (sucursalId != null) q = q.eq('sucursal_id', Number(sucursalId));
  const { data, error } = await q;
  if (error) throw error;

  const result = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [], 7: [] };
  for (const row of data || []) {
    result[row.dia_semana] = result[row.dia_semana] || [];
    result[row.dia_semana].push({ start: row.inicio, end: row.fin });
  }
  return result;
}

// Reemplaza el horario semanal completo de un empleado.
// `weekly` = { 1: [{start, end}], ..., 7: [] }
export async function saveEmpleadoHorarios(empleadoId, weekly, token, sucursalId) {
  const db = token ? createClientWithToken(token) : supabase;
  const sucursal = sucursalId != null ? Number(sucursalId) : 1;

  const { error: delError } = await db
    .from('empleado_horarios')
    .delete()
    .eq('empleado_id', Number(empleadoId))
    .eq('sucursal_id', sucursal);
  if (delError) throw delError;

  const rows = [];
  for (const [dayStr, ranges] of Object.entries(weekly || {})) {
    const day = Number(dayStr);
    if (day < 1 || day > 7) continue;
    for (const range of ranges || []) {
      const start = (range.start || '').trim();
      const end = (range.end || '').trim();
      if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) continue;
      rows.push({ empleado_id: Number(empleadoId), dia_semana: day, inicio: start, fin: end, sucursal_id: sucursal });
    }
  }

  if (rows.length > 0) {
    const { error: insError } = await db.from('empleado_horarios').insert(rows);
    if (insError) throw insError;
  }

  return getEmpleadoHorarios(empleadoId, sucursal);
}

// ============================================================
// Excepciones puntuales por fecha
// ============================================================

// Lista excepciones en un rango de fechas (opcionalmente de un empleado).
export async function listExcepciones({ from, to, empleadoId, sucursalId } = {}) {
  let q = supabase
    .from('horario_excepciones')
    .select('*')
    .order('fecha', { ascending: true });
  if (from) q = q.gte('fecha', from);
  if (to) q = q.lte('fecha', to);
  if (empleadoId != null) q = q.eq('empleado_id', Number(empleadoId));
  if (sucursalId != null) q = q.eq('sucursal_id', Number(sucursalId));
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function getExcepcion(id) {
  const { data, error } = await supabase
    .from('horario_excepciones')
    .select('*')
    .eq('id', Number(id))
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Crea o actualiza la excepción de una fecha. `cerrado` cierra el día; si no,
// `franjas` (array {start,end}) sobreescribe el horario de esa fecha.
export async function saveExcepcion(payload, token) {
  const db = token ? createClientWithToken(token) : supabase;

  const fecha = String(payload.fecha || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    throw new Error('Fecha inválida (formato YYYY-MM-DD)');
  }
  const cerrado = payload.cerrado === true;
  const franjas = Array.isArray(payload.franjas) ? payload.franjas : [];

  const values = {
    fecha,
    empleado_id: payload.empleado_id != null ? Number(payload.empleado_id) : null,
    cerrado,
    franjas,
    motivo: payload.motivo?.trim() || null,
    sucursal_id: payload.sucursal_id != null ? Number(payload.sucursal_id) : 1,
  };

  if (payload.id) {
    const { data, error } = await db
      .from('horario_excepciones')
      .update(values)
      .eq('id', Number(payload.id))
      .select('*')
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  const { data, error } = await db
    .from('horario_excepciones')
    .insert(values)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function deleteExcepcion(id, token) {
  const db = token ? createClientWithToken(token) : supabase;
  const { error } = await db.from('horario_excepciones').delete().eq('id', Number(id));
  if (error) throw error;
  return true;
}

// ============================================================
// Resolución del horario efectivo de un día
// ============================================================

// Devuelve el horario que aplica a un día para un empleado (o global si
// `empleadoId` es null). Precedencia:
//   1. Excepción del empleado para esa fecha
//   2. Excepción global (empleado_id NULL) para esa fecha
//   3. Horario semanal propio del empleado
//   4. Horario global de settings
// El resultado es { ranges, closed } con `ranges` = [{start, end}].
export async function resolveSchedule(date, globalWorkingHours, empleadoId, sucursalId) {
  let q = supabase
    .from('horario_excepciones')
    .select('*')
    .eq('fecha', date)
    .order('empleado_id', { ascending: false, nullsFirst: true });
  if (sucursalId != null) q = q.eq('sucursal_id', Number(sucursalId));

  const [exceptions, employeeWeekly] = await Promise.all([
    q,
    empleadoId != null
      ? supabase
          .from('empleado_horarios')
          .select('dia_semana, inicio, fin')
          .eq('empleado_id', Number(empleadoId))
          .eq('sucursal_id', sucursalId != null ? Number(sucursalId) : 1)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (exceptions.error) throw exceptions.error;
  if (employeeWeekly.error) throw employeeWeekly.error;

  // Excepción más específica primero (la del empleado gana sobre la global).
  const specific = exceptions.data.find((e) => e.empleado_id != null);
  const generic = exceptions.data.find((e) => e.empleado_id == null);
  const ex = specific || generic;

  if (ex) {
    if (ex.cerrado) return { ranges: [], closed: true };
    if (Array.isArray(ex.franjas) && ex.franjas.length > 0) {
      return { ranges: ex.franjas, closed: false };
    }
  }

  const dow = dayOfWeek(date);
  if (empleadoId != null) {
    const empRanges = (employeeWeekly.data || [])
      .filter((r) => r.dia_semana === dow)
      .map((r) => ({ start: r.inicio, end: r.fin }));
    if (empRanges.length > 0) return { ranges: empRanges, closed: false };
  }

  const global = (globalWorkingHours || {})[String(dow)];
  return { ranges: Array.isArray(global) ? global : [], closed: false };
}

