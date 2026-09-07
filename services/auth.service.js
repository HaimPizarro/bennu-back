import { supabase, createServiceClient } from '../config/supabase.js';

// Resolve the authenticated Supabase Auth user from a Bearer JWT token
export async function getUserFromToken(token) {
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

// Load the app profile (with integer rol) for a Supabase Auth user id
export async function getUserProfile(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) return null;
  return data;
}

// Estado de una cuenta por email: si existe y con qué proveedores fue creada
// (google / email). Se consulta con la service role key para distinguir cuentas
// de Google (sin contraseña) de las de email/contraseña. Si la clave no está
// configurada devuelve null para que el cliente use el mensaje genérico.
export async function getAccountStatusByEmail(email) {
  const admin = createServiceClient();
  if (!admin) return null;
  const needle = email.trim().toLowerCase();
  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 50,
    filter: { email: needle },
  });
  if (error) throw error;
  const found = (data?.users || []).find(
    (u) => (u.email || '').trim().toLowerCase() === needle,
  );
  if (!found) return { exists: false, providers: [] };
  const providers = Array.isArray(found.app_metadata?.providers)
    ? found.app_metadata.providers
    : [];
  return { exists: true, providers };
}

// Elimina la propia cuenta por completo (auth + datos) usando la service role.
// No se permite si el usuario tiene citas, pagos o membresías (historial).
export async function deleteOwnAccount(userId) {
  const admin = createServiceClient();
  if (!admin) {
    throw new Error('No se puede eliminar la cuenta en este momento (falta configuración del servidor).');
  }

  const [citas, pagos, suscripciones] = await Promise.all([
    supabase.from('appointments').select('id').eq('user_id', userId).limit(1),
    supabase.from('pagos').select('id').eq('user_id', userId).limit(1),
    supabase.from('suscripciones').select('id').eq('user_id', userId).limit(1),
  ]);
  const cantidad = [citas, pagos, suscripciones].reduce(
    (acc, r) => acc + (r.error ? 0 : (r.data?.length || 0)),
    0,
  );
  if (cantidad > 0) {
    throw new Error(
      'No puedes eliminar tu cuenta porque tiene citas, pagos o membresías registradas. Contáctanos para gestionarlo.',
    );
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) throw error;
  return true;
}