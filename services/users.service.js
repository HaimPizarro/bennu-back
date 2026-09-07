import { supabase } from '../config/supabase.js';

const TABLE = 'users';

// Lista todos los usuarios con estadisticas derivadas de citas Completada:
// `visitas` (cantidad) y `ultima_visita` (max fecha_hora).
export async function listUsers() {
  const [usersRes, statsRes] = await Promise.all([
    supabase.from(TABLE).select('*').order('rol', { ascending: true }).order('nombre', { ascending: true }),
    supabase
      .from('appointments')
      .select('user_id, fecha_hora')
      .eq('estado', 'Completada'),
  ]);
  if (usersRes.error) throw usersRes.error;
  if (statsRes.error) throw statsRes.error;

  const byUser = new Map();
  (statsRes.data || []).forEach((a) => {
    if (!a.user_id) return;
    const cur = byUser.get(a.user_id) || { visitas: 0, ultima: null };
    cur.visitas += 1;
    if (!cur.ultima || new Date(a.fecha_hora) > new Date(cur.ultima)) cur.ultima = a.fecha_hora;
    byUser.set(a.user_id, cur);
  });

  return (usersRes.data || []).map((u) => ({
    ...u,
    visitas: byUser.get(u.id)?.visitas || 0,
    ultima_visita: byUser.get(u.id)?.ultima || null,
  }));
}

export async function listClients() {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('rol', 1)
    .order('nombre', { ascending: true });
  if (error) throw error;
  return data;
}

export async function getUserById(id) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}

export async function updateUserPoints(id, puntos) {
  const user = await getUserById(id);
  if (!user) return null;

  const nuevosPuntos = (user.puntos_acumulados || 0) + puntos;
  if (nuevosPuntos < 0) {
    throw new Error('Puntos insuficientes para esta operación');
  }

  const { data, error } = await supabase
    .from(TABLE)
    .update({ puntos_acumulados: nuevosPuntos })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Actualiza campos editables de un usuario (admin). No permite modificar rol/puntos aqui.
export async function updateUser(id, payload) {
  const existing = await getUserById(id);
  if (!existing) return null;

  const name = (payload.nombre ?? existing.nombre)?.toString().trim();
  if (!name) {
    throw new Error('El nombre es obligatorio');
  }

  const { data, error } = await supabase
    .from(TABLE)
    .update({
      nombre: name,
      email: (payload.email ?? existing.email)?.toString().trim(),
      telefono: (payload.telefono ?? existing.telefono)?.toString().trim() || null,
    })
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// El propio usuario edita sus datos (nombre y teléfono). El email se gestiona
// por Supabase y no se modifica desde acá.
export async function updateOwnProfile(userId, payload) {
  const existing = await getUserById(userId);
  if (!existing) return null;

  const update = {};
  if (payload?.nombre !== undefined) {
    const nombre = String(payload.nombre ?? '').replace(/\s+/g, ' ').trim();
    if (!nombre) throw new Error('El nombre es obligatorio.');
    update.nombre = nombre;
  }
  if (payload?.telefono !== undefined) {
    update.telefono = String(payload.telefono ?? '').trim() || null;
  }
  if (Object.keys(update).length === 0) return existing;

  const { data, error } = await supabase
    .from(TABLE)
    .update(update)
    .eq('id', userId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Elimina un usuario (la FK a auth.users con CASCADE elimina la cuenta de auth).
export async function deleteUser(id) {
  const { data, error } = await supabase.from(TABLE).delete().eq('id', id).select();
  if (error) throw error;
  return data?.[0] || null;
}

// Ficha clínica. `contenido` guarda las seis secciones (datos personales,
// anamnesis, hábitos, análisis cutáneo, sesiones, consentimiento).
export async function getFicha(userId) {
  const { data, error } = await supabase
    .from('fichas_clinicas')
    .select('contenido, created_at, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// Crea o actualiza la ficha completa (el frontend envía todas las secciones).
export async function upsertFicha(userId, contenido) {
  const { data, error } = await supabase
    .from('fichas_clinicas')
    .upsert(
      { user_id: userId, contenido, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
    .select('contenido, created_at, updated_at')
    .single();
  if (error) throw error;
  return data;
}
