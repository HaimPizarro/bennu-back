import { supabase, createClientWithToken } from '../config/supabase.js';

const TABLE = 'empleados';

export async function listEmpleados(includeInactive = false, sucursalId) {
  let q = supabase.from(TABLE).select('*').order('nombre', { ascending: true });
  if (!includeInactive) q = q.eq('activo', true);
  if (sucursalId != null) q = q.eq('sucursal_id', Number(sucursalId));
  const { data, error } = await q;
  if (error) throw error;

  const ids = (data || []).map((e) => e.id);
  if (ids.length === 0) return [];

  const { data: rel, error: relError } = await supabase
    .from('empleado_servicios')
    .select('empleado_id, service_id')
    .in('empleado_id', ids);
  if (relError) throw relError;

  const byEmpleado = new Map();
  for (const r of rel || []) {
    if (!byEmpleado.has(r.empleado_id)) byEmpleado.set(r.empleado_id, []);
    byEmpleado.get(r.empleado_id).push(r.service_id);
  }

  return (data || []).map((e) => ({ ...e, servicios_ids: byEmpleado.get(e.id) || [] }));
}

export async function getEmpleado(id) {
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createEmpleado(payload, token) {
  const db = token ? createClientWithToken(token) : supabase;
  const nombre = (payload.nombre || '').trim();
  if (!nombre) throw new Error('El nombre es obligatorio');

  const { data, error } = await db
    .from(TABLE)
    .insert({
      nombre,
      email: payload.email?.trim() || null,
      telefono: payload.telefono?.trim() || null,
      especialidad: payload.especialidad?.trim() || null,
      notas: payload.notas?.trim() || null,
      activo: payload.activo !== false,
      sucursal_id: payload.sucursal_id != null ? Number(payload.sucursal_id) : 1,
    })
    .select('*')
    .single();
  if (error) throw error;

  if (Array.isArray(payload.servicios_ids)) {
    await setServiciosDeEmpleado(data.id, payload.servicios_ids, token);
  }
  return { ...data, servicios_ids: await listServiciosDeEmpleado(data.id) };
}

export async function updateEmpleado(id, payload, token) {
  const db = token ? createClientWithToken(token) : supabase;
  const update = {};
  if (payload.nombre !== undefined) {
    const nombre = (payload.nombre || '').trim();
    if (!nombre) throw new Error('El nombre es obligatorio');
    update.nombre = nombre;
  }
  if (payload.email !== undefined) update.email = payload.email?.trim() || null;
  if (payload.telefono !== undefined) update.telefono = payload.telefono?.trim() || null;
  if (payload.especialidad !== undefined) update.especialidad = payload.especialidad?.trim() || null;
  if (payload.notas !== undefined) update.notas = payload.notas?.trim() || null;
  if (payload.activo !== undefined) update.activo = payload.activo !== false;

  const { data, error } = await db.from(TABLE).update(update).eq('id', id).select('*').maybeSingle();
  if (error) throw error;

  if (Array.isArray(payload.servicios_ids)) {
    await setServiciosDeEmpleado(id, payload.servicios_ids, token);
  }
  return { ...data, servicios_ids: await listServiciosDeEmpleado(id) };
}

export async function deleteEmpleado(id, token) {
  const db = token ? createClientWithToken(token) : supabase;
  const { error } = await db.from(TABLE).delete().eq('id', id);
  if (error) throw error;
  return true;
}

// ============================================================
// Relacion empleado <-> servicios
// ============================================================

// IDs de los servicios que un empleado puede realizar.
export async function listServiciosDeEmpleado(empleadoId) {
  const { data, error } = await supabase
    .from('empleado_servicios')
    .select('service_id')
    .eq('empleado_id', Number(empleadoId));
  if (error) throw error;
  return (data || []).map((r) => r.service_id);
}

// Reemplaza el set completo de servicios del empleado.
export async function setServiciosDeEmpleado(empleadoId, serviceIds, token) {
  const db = token ? createClientWithToken(token) : supabase;
  const ids = (Array.isArray(serviceIds) ? serviceIds : [])
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n));

  const { error: delError } = await db
    .from('empleado_servicios')
    .delete()
    .eq('empleado_id', Number(empleadoId));
  if (delError) throw delError;

  if (ids.length > 0) {
    const rows = ids.map((service_id) => ({ empleado_id: Number(empleadoId), service_id }));
    const { error: insError } = await db.from('empleado_servicios').insert(rows);
    if (insError) throw insError;
  }

  return listServiciosDeEmpleado(empleadoId);
}
