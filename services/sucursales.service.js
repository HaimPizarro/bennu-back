import { supabase, createClientWithToken } from '../config/supabase.js';

const TABLE = 'sucursales';

export async function listSucursales(includeInactive = false) {
  let q = supabase.from(TABLE).select('*').order('nombre', { ascending: true });
  if (!includeInactive) q = q.eq('activa', true);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function getSucursal(id) {
  const { data, error } = await supabase.from(TABLE).select('*').eq('id', Number(id)).maybeSingle();
  if (error) throw error;
  return data;
}

export async function createSucursal(payload, token) {
  const db = token ? createClientWithToken(token) : supabase;
  const nombre = (payload.nombre || '').trim();
  if (!nombre) throw new Error('El nombre es obligatorio');

  const { data, error } = await db
    .from(TABLE)
    .insert({
      nombre,
      direccion: payload.direccion?.trim() || null,
      telefono: payload.telefono?.trim() || null,
      activa: payload.activa !== false,
    })
    .select('*')
    .single();
  if (error) throw error;

  // Cada sucursal arranca con su propia fila de settings (hereda los globales).
  try {
    const { data: settings } = await supabase.from('settings').select('*').eq('sucursal_id', 1).single();
    if (settings) {
      await db.from('settings').insert({
        sucursal_id: data.id,
        slot_interval_minutes: settings.slot_interval_minutes,
        buffer_before_minutes: settings.buffer_before_minutes,
        buffer_after_minutes: settings.buffer_after_minutes,
        working_hours: settings.working_hours,
      });
    }
  } catch {
    // no-op: settings se auto-crea con defaults al primer getSettings().
  }

  return data;
}

export async function updateSucursal(id, payload, token) {
  const db = token ? createClientWithToken(token) : supabase;
  const update = {};
  if (payload.nombre !== undefined) {
    const nombre = (payload.nombre || '').trim();
    if (!nombre) throw new Error('El nombre es obligatorio');
    update.nombre = nombre;
  }
  if (payload.direccion !== undefined) update.direccion = payload.direccion?.trim() || null;
  if (payload.telefono !== undefined) update.telefono = payload.telefono?.trim() || null;
  if (payload.activa !== undefined) update.activa = payload.activa !== false;

  const { data, error } = await db.from(TABLE).update(update).eq('id', Number(id)).select('*').maybeSingle();
  if (error) throw error;
  return data;
}

// No permite borrar la sucursal 1 (la original) ni la última activa.
export async function deleteSucursal(id, token) {
  const db = token ? createClientWithToken(token) : supabase;
  const target = Number(id);
  if (target === 1) throw new Error('No se puede eliminar la sucursal principal');

  const { data: all } = await supabase.from(TABLE).select('id, activa').eq('activa', true);
  const actives = (all || []).filter((s) => s.activa).length;
  const targetIsActive = (all || []).some((s) => s.id === target && s.activa);
  if (targetIsActive && actives <= 1) {
    throw new Error('No se puede eliminar la última sucursal activa');
  }

  const { error } = await db.from(TABLE).delete().eq('id', target);
  if (error) throw error;
  return true;
}
