import { supabase } from '../config/supabase.js';

const TABLE = 'notificaciones';

const TIPOS = ['sistema', 'cita', 'recordatorio', 'promocion', 'evento'];

// Inserta una notificación sin bloquear el flujo que la dispara (nunca lanza).
export async function crearNotificacion({ userId, tipo = 'sistema', titulo, mensaje, enlace, creadaPor }) {
  if (!titulo) return null;
  if (!TIPOS.includes(tipo)) return null;
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        user_id: userId || null,
        tipo,
        titulo,
        mensaje: mensaje || null,
        enlace: enlace || null,
        creada_por: creadaPor || null,
      })
      .select('*')
      .single();
    if (error) throw error;
    return data;
  } catch {
    return null;
  }
}

// Inserta una notificación por cada admin (rol 0). Útil para avisos dirigidos
// al personal en lugar de usar broadcast (que se les filtraría a los clientes).
export async function notificarAdmins({ tipo = 'sistema', titulo, mensaje, enlace, creadaPor }) {
  if (!titulo) return [];
  const { data: admins, error } = await supabase.from('users').select('id').eq('rol', 0);
  if (error) return [];
  const results = [];
  for (const admin of admins || []) {
    const created = await crearNotificacion({ userId: admin.id, tipo, titulo, mensaje, enlace, creadaPor });
    if (created) results.push(created);
  }
  return results;
}

// Notificaciones visibles para un usuario (las propias + los broadcast con user_id null).
export async function listNotificaciones({ userId, soloNoLeidas = false, limit = 50 }) {
  let q = supabase
    .from(TABLE)
    .select('*')
    .or(`user_id.eq.${userId},user_id.is.null`)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (soloNoLeidas) q = q.eq('leida', false);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function countNoLeidas(userId) {
  const { count, error } = await supabase
    .from(TABLE)
    .select('id', { count: 'exact', head: true })
    .or(`user_id.eq.${userId},user_id.is.null`)
    .eq('leida', false);
  if (error) throw error;
  return count || 0;
}

export async function marcarLeida(id, userId) {
  const { data, error } = await supabase
    .from(TABLE)
    .update({ leida: true })
    .eq('id', Number(id))
    .or(`user_id.eq.${userId},user_id.is.null`)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function marcarTodasLeidas(userId) {
  const { error } = await supabase
    .from(TABLE)
    .update({ leida: true })
    .or(`user_id.eq.${userId},user_id.is.null`)
    .eq('leida', false);
  if (error) throw error;
  return true;
}

// Admin: toda la tabla (cualquier destinatario), opcionalmente filtrada.
export async function listTodas({ limit = 100 } = {}) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*, users:user_id (nombre, email)')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// Admin: elimina una notificación (propia, broadcast o de cualquier usuario).
export async function deleteNotificacion(id) {
  const { error } = await supabase.from(TABLE).delete().eq('id', Number(id));
  if (error) throw error;
  return true;
}
