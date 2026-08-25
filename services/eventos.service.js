import { supabase, createClientWithToken } from '../config/supabase.js';

const TABLE = 'eventos';
const estadosValidos = ['Programado', 'En curso', 'Finalizado', 'Cancelado'];

export async function listEventos({ from, to, sucursalId } = {}) {
  let q = supabase.from(TABLE).select('*').order('fecha_hora_inicio', { ascending: true });
  if (from) q = q.gte('fecha_hora_inicio', from);
  if (to) q = q.lte('fecha_hora_inicio', to);
  if (sucursalId != null) q = q.eq('sucursal_id', Number(sucursalId));
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function getEvento(id) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('id', Number(id))
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function createEvento(payload, token) {
  const db = token ? createClientWithToken(token) : supabase;
  const nombre = (payload.nombre || '').trim();
  if (!nombre) throw new Error('El nombre es obligatorio');
  if (!payload.fecha_hora_inicio) throw new Error('La fecha de inicio es obligatoria');

  const { data, error } = await db
    .from(TABLE)
    .insert({
      nombre,
      descripcion: payload.descripcion?.trim() || null,
      tipo: payload.tipo?.trim() || 'evento',
      fecha_hora_inicio: payload.fecha_hora_inicio,
      fecha_hora_fin: payload.fecha_hora_fin || null,
      capacidad: payload.capacidad != null ? Math.max(1, Number(payload.capacidad) || 1) : null,
      lugar: payload.lugar?.trim() || null,
      estado: payload.estado || 'Programado',
      color: payload.color?.trim() || null,
      recurrencia: payload.recurrencia || 'none',
      creado_por: payload.creado_por || null,
      sucursal_id: payload.sucursal_id != null ? Number(payload.sucursal_id) : 1,
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function updateEvento(id, payload, token) {
  const db = token ? createClientWithToken(token) : supabase;
  const update = {};
  if (payload.nombre !== undefined) {
    const nombre = (payload.nombre || '').trim();
    if (!nombre) throw new Error('El nombre es obligatorio');
    update.nombre = nombre;
  }
  if (payload.descripcion !== undefined) update.descripcion = payload.descripcion?.trim() || null;
  if (payload.tipo !== undefined) update.tipo = payload.tipo?.trim() || 'evento';
  if (payload.fecha_hora_inicio !== undefined) {
    if (!payload.fecha_hora_inicio) throw new Error('La fecha de inicio es obligatoria');
    update.fecha_hora_inicio = payload.fecha_hora_inicio;
  }
  if (payload.fecha_hora_fin !== undefined) update.fecha_hora_fin = payload.fecha_hora_fin || null;
  if (payload.capacidad !== undefined) {
    update.capacidad = payload.capacidad != null ? Math.max(1, Number(payload.capacidad) || 1) : null;
  }
  if (payload.lugar !== undefined) update.lugar = payload.lugar?.trim() || null;
  if (payload.estado !== undefined) {
    if (!estadosValidos.includes(payload.estado)) {
      throw new Error(`Estado inválido. Debe ser: ${estadosValidos.join(', ')}`);
    }
    update.estado = payload.estado;
  }
  if (payload.color !== undefined) update.color = payload.color?.trim() || null;
  if (payload.recurrencia !== undefined) update.recurrencia = payload.recurrencia || 'none';

  const { data, error } = await db.from(TABLE).update(update).eq('id', Number(id)).select('*').maybeSingle();
  if (error) throw error;
  return data;
}

export async function deleteEvento(id, token) {
  const db = token ? createClientWithToken(token) : supabase;
  const { error } = await db.from(TABLE).delete().eq('id', Number(id));
  if (error) throw error;
  return true;
}
