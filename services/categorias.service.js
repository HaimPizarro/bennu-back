import { supabase, createClientWithToken } from '../config/supabase.js';

// Categorías de servicios. La categoría se identifica por su `nombre` visible
// (único). `services.categoria` guarda ese mismo nombre (denormalizado) y
// `services.categoria_id` la referencia. Renombrar/eliminar mantiene ambos
// consistentes.

const TABLE = 'categorias';

const isDuplicate = (e) =>
  String(e?.code || e?.message || '').includes('23505') ||
  String(e?.message || '').includes('duplicate');

function normalizeNombre(nombre) {
  return String(nombre || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function listCategorias() {
  const { data: rows, error } = await supabase
    .from(TABLE)
    .select('*')
    .order('nombre', { ascending: true });
  if (error) throw error;

  const { data: servicios, error: sError } = await supabase
    .from('services')
    .select('categoria_id, categoria');
  if (sError) throw sError;

  const byId = new Map();
  const textOnly = new Set();
  for (const s of servicios || []) {
    if (s.categoria_id != null) {
      byId.set(s.categoria_id, (byId.get(s.categoria_id) || 0) + 1);
    } else if (s.categoria) {
      textOnly.add(String(s.categoria).trim().toLowerCase());
    }
  }

  return (rows || []).map((c) => ({
    id: c.id,
    nombre: c.nombre,
    created_at: c.created_at,
    servicios: (byId.get(c.id) || 0) + (textOnly.has(String(c.nombre).trim().toLowerCase()) ? 1 : 0),
  }));
}

export async function createCategoria(payload, token) {
  const db = token ? createClientWithToken(token) : supabase;
  const nombre = normalizeNombre(payload?.nombre);
  if (!nombre) throw new Error('El nombre de la categoría es obligatorio.');
  const { data, error } = await db.from(TABLE).insert({ nombre }).select('*').single();
  if (error) {
    if (isDuplicate(error)) throw new Error('Ya existe una categoría con ese nombre.');
    throw error;
  }
  return data;
}

export async function renameCategoria(id, payload, token) {
  const db = token ? createClientWithToken(token) : supabase;
  const nombre = normalizeNombre(payload?.nombre);
  if (!nombre) throw new Error('El nombre de la categoría es obligatorio.');

  const categoriaId = Number(id);
  const { data: prev } = await supabase
    .from(TABLE)
    .select('id, nombre')
    .eq('id', categoriaId)
    .single();

  // Renombra la categoría y sincroniza el texto de sus servicios.
  const { data: updated, error } = await db
    .from(TABLE)
    .update({ nombre })
    .eq('id', categoriaId)
    .select('*')
    .single();
  if (error) {
    if (isDuplicate(error)) throw new Error('Ya existe una categoría con ese nombre.');
    throw error;
  }

  const { error: syncError } = await db
    .from('services')
    .update({ categoria: nombre })
    .eq('categoria_id', updated.id);
  if (syncError) throw syncError;

  // Legacy sin categoria_id: también se sincroniza el texto que coincidía.
  if (prev && prev.nombre !== nombre) {
    const { error: legacyError } = await db
      .from('services')
      .update({ categoria: nombre })
      .is('categoria_id', null)
      .eq('categoria', prev.nombre);
    if (legacyError) throw legacyError;
  }

  return updated;
}

export async function deleteCategoria(id) {
  const categoriaId = Number(id);
  const { data: cat, error } = await supabase
    .from(TABLE)
    .select('id, nombre')
    .eq('id', categoriaId)
    .single();
  if (error) return null;

  // No se puede eliminar si hay servicios en la categoría (ni por FK ni por
  // texto denormalizado): pedimos reasignarlos antes.
  const { data: byId } = await supabase
    .from('services')
    .select('id')
    .eq('categoria_id', categoriaId)
    .limit(1);
  const { data: byText } = await supabase
    .from('services')
    .select('id')
    .is('categoria_id', null)
    .eq('categoria', cat.nombre)
    .limit(1);
  if ((byId?.length || 0) + (byText?.length || 0) > 0) {
    throw new Error(
      'No se puede eliminar la categoría mientras tenga servicios asignados. Reasigna o elimina esos servicios primero.',
    );
  }

  const { error: delError } = await supabase.from(TABLE).delete().eq('id', categoriaId);
  if (delError) throw delError;
  return true;
}
