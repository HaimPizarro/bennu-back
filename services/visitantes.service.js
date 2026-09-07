import { supabase, createClientWithToken } from '../config/supabase.js';

// Perfil de bienvenida por CUENTA (una fila por usuario logueado). La fila se
// identifica por user_id y device_id = id del usuario (para respetar el unique
// de device_id sin más migraciones). Los visitantes sin sesión no usan esto.

const TABLE = 'visitantes';

const relationMissing = (e) =>
  /could not find the table|does not exist|42p01|pgrst205/i.test(String(e?.message || ''));

function cleanText(value, max = 80) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function validateAge(value) {
  if (value === '' || value === null || value === undefined) return null;
  const edad = Number(value);
  if (!Number.isInteger(edad) || edad < 0 || edad > 120) {
    throw new Error('La edad debe ser un número entre 0 y 120.');
  }
  return edad;
}

function handleDbError(error) {
  if (relationMissing(error)) {
    throw new Error('Falta ejecutar la migración 035 (tabla visitantes) en Supabase.');
  }
  throw error;
}

// Crea o actualiza el perfil de bienvenida del usuario logueado.
export async function upsertMiVisitante(userId, payload, token) {
  const db = token ? createClientWithToken(token) : supabase;
  const nombre = cleanText(payload?.nombre);
  const alias = cleanText(payload?.alias);
  if (!nombre) throw new Error('El nombre es obligatorio.');
  if (!alias) throw new Error('El alias es obligatorio.');
  const edad = validateAge(payload?.edad);

  try {
    const { data, error } = await db
      .from(TABLE)
      .upsert(
        {
          device_id: String(userId),
          user_id: userId,
          nombre,
          alias,
          edad,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'device_id' },
      )
      .select('*')
      .single();
    if (error) throw error;
    return data;
  } catch (error) {
    handleDbError(error);
  }
}

// Perfil del usuario (null si no configuró uno todavía).
export async function getMiVisitante(userId, token) {
  const db = token ? createClientWithToken(token) : supabase;
  try {
    const { data, error } = await db
      .from(TABLE)
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  } catch (error) {
    if (relationMissing(error)) return null;
    throw error;
  }
}

// Borra el perfil propio.
export async function deleteMiVisitante(userId, token) {
  const db = token ? createClientWithToken(token) : supabase;
  const { error } = await db.from(TABLE).delete().eq('user_id', userId);
  if (error) handleDbError(error);
  return true;
}

// Listado admin (con token de admin para pasar la policy de lectura).
export async function listVisitantes(token) {
  const db = token ? createClientWithToken(token) : supabase;
  try {
    const { data, error } = await db
      .from(TABLE)
      .select('*')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (error) {
    handleDbError(error);
  }
}

// Borrado admin por id de fila.
export async function deleteVisitanteById(id, token) {
  const db = token ? createClientWithToken(token) : supabase;
  const { error } = await db.from(TABLE).delete().eq('id', Number(id));
  if (error) handleDbError(error);
  return true;
}
