import { getServiceClient } from '../config/supabase.js';

// Configuración de integraciones (correo saliente + Mercado Pago) editable
// desde el panel admin. La tabla singleton (id=1) guarda "overrides" por sobre
// las variables de entorno del .env: un campo NULL/ausente = usar el .env.
// Los secretos solo se leen/escriben con la service_role (RLS sin policies).

const TABLE = 'configuracion_servicios';
const CACHE_TTL_MS = 15000;

let cache = { at: 0, row: null };

// Lee la fila con la service_role; si no hay clave o aún no existe la tabla,
// devuelve null (todo cae al .env). Cache corta para no golpear por request.
async function readRow() {
  const svc = getServiceClient();
  if (!svc) return null;
  const now = Date.now();
  if (now - cache.at < CACHE_TTL_MS) return cache.row;
  const { data, error } = await svc.from(TABLE).select('*').eq('id', 1).maybeSingle();
  if (error) {
    cache.at = now;
    cache.row = null;
    return null;
  }
  cache.row = data || {};
  cache.at = now;
  return cache.row;
}

// Valor efectivo: DB tiene prioridad; si está null/vacío usa el del .env.
const eff = (dbValue, envValue) =>
  dbValue === null || dbValue === undefined || dbValue === '' ? envValue : dbValue;

// ---- Defaults desde el .env ----
function envEmailDefaults() {
  return {
    email_provider: null,
    email_from_name: process.env.EMAIL_FROM_NAME?.trim() || 'bennu',
    email_from: process.env.EMAIL_FROM?.trim() || process.env.SMTP_USER?.trim() || '',
    smtp_host: process.env.SMTP_HOST?.trim() || '',
    smtp_port: Number(process.env.SMTP_PORT) || 587,
    smtp_user: process.env.SMTP_USER?.trim() || '',
    smtp_pass: process.env.SMTP_PASS || '',
    smtp_secure: Number(process.env.SMTP_PORT) === 465,
    resend_api_key: process.env.RESEND_API_KEY?.trim() || '',
  };
}

function envMpDefaults() {
  return {
    mp_access_token: process.env.MERCADOPAGO_ACCESS_TOKEN?.trim() || '',
    mp_currency: process.env.MERCADOPAGO_CURRENCY?.trim() || 'CLP',
  };
}

// ---- Correo ----
export async function getEmailConfig() {
  const row = await readRow();
  const env = envEmailDefaults();
  const resendKey = eff(row?.resend_api_key, env.resend_api_key);
  const smtpHost = eff(row?.smtp_host, env.smtp_host);
  const smtpUser = eff(row?.smtp_user, env.smtp_user);
  const smtpPass = eff(row?.smtp_pass, env.smtp_pass);

  let provider = row?.email_provider?.trim() || null;
  if (!provider) {
    provider = resendKey
      ? 'resend'
      : smtpHost && smtpUser && smtpPass
        ? 'smtp'
        : null;
  }

  return {
    provider,
    fromName: eff(row?.email_from_name, env.email_from_name) || 'bennu',
    from: eff(row?.email_from, env.email_from) || '',
    smtp: {
      host: smtpHost,
      port: Number(eff(row?.smtp_port, env.smtp_port)) || 587,
      user: smtpUser,
      pass: smtpPass,
      secure: row?.smtp_secure != null ? Boolean(row.smtp_secure) : env.smtp_secure,
    },
    resendKey,
  };
}

// ---- Mercado Pago ----
export async function getMpConfig() {
  const row = await readRow();
  const env = envMpDefaults();
  return {
    token: eff(row?.mp_access_token, env.mp_access_token),
    currency: eff(row?.mp_currency, env.mp_currency) || 'CLP',
  };
}

function maskToken(token) {
  if (!token) return '';
  const t = String(token);
  return t.length <= 4 ? '••••' : `••••${t.slice(-4)}`;
}

// ---- Estado seguro para el GET del panel (sin secretos) ----
export async function getIntegracionesStatus() {
  const email = await getEmailConfig();
  const mp = await getMpConfig();
  return {
    db_configurada: Boolean(getServiceClient()),
    email: {
      proveedor: email.provider,
      configurado: email.provider !== null,
      remitente: email.from,
      nombre: email.fromName,
      host: email.smtp.host || null,
      puerto: email.smtp.port || null,
      usuario: email.smtp.user || null,
      resend_activo: Boolean(email.resendKey),
      usa_db: !!(await rowHasField('email_provider')),
    },
    mp: {
      configurado: Boolean(mp.token),
      moneda: mp.currency,
      token_mascara: maskToken(mp.token),
    },
  };
}

async function rowHasField(field) {
  const row = await readRow();
  const v = row?.[field];
  return v !== null && v !== undefined && v !== '';
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Prueba el Access Token configurado consultando la cuenta de Mercado Pago.
// Devuelve el identificador público de la cuenta que recibirá el dinero.
export async function probarMercadoPago() {
  const cfg = await getMpConfig();
  if (!cfg.token) {
    throw new Error('No hay Access Token de Mercado Pago configurado (panel Pagos y correo o .env).');
  }
  const res = await fetch('https://api.mercadopago.com/users/me', {
    headers: { Authorization: `Bearer ${cfg.token}` },
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const detalle = json?.message || json?.error || res.statusText;
    throw new Error(`Error de Mercado Pago (${res.status}): ${detalle}`);
  }
  return { ok: true, cuenta: json?.nickname || String(json?.id || '') };
}

// Persiste overrides. '' o undefined se omiten (conservar actual); null borra
// el override para volver al .env.
export async function saveIntegracionesConfig(payload, adminId) {
  const svc = getServiceClient();
  if (!svc) {
    throw new Error(
      'Falta configurar SUPABASE_SERVICE_ROLE_KEY en el backend para guardar credenciales.',
    );
  }

  const patch = {};
  const scalar = (key) => {
    if (payload[key] === undefined) return;
    const value = payload[key];
    if (value === null) patch[key] = null;
    else if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed !== '') patch[key] = trimmed;
    }
  };

  if (payload.email_provider !== undefined && payload.email_provider !== '') {
    const prov = payload.email_provider;
    if (prov !== null && !['smtp', 'resend'].includes(prov)) {
      throw new Error('Proveedor de email inválido (smtp | resend).');
    }
    patch.email_provider = prov;
  }
  scalar('email_from_name');
  if (payload.email_from !== undefined) {
    const value = payload.email_from;
    if (value !== null) {
      const email = String(value).trim();
      if (email !== '' && !EMAIL_RE.test(email)) throw new Error('Remitente de email inválido.');
      if (email !== '') patch.email_from = email;
    } else patch.email_from = null;
  }
  scalar('smtp_host');
  if (payload.smtp_port !== undefined) {
    const value = payload.smtp_port;
    if (value === null) patch.smtp_port = null;
    else {
      const port = Number(value);
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('Puerto SMTP inválido.');
      }
      patch.smtp_port = port;
    }
  }
  scalar('smtp_user');
  scalar('smtp_pass');
  if (payload.smtp_secure !== undefined) {
    patch.smtp_secure = payload.smtp_secure === true || payload.smtp_secure === 'true';
  }
  scalar('resend_api_key');
  scalar('mp_access_token');
  if (payload.mp_currency !== undefined) {
    const value = payload.mp_currency;
    if (value !== null) {
      const moneda = String(value).trim().toUpperCase();
      if (moneda !== '' && !/^[A-Z]{3}$/.test(moneda)) throw new Error('Moneda inválida (usa 3 letras, ej: CLP).');
      if (moneda !== '') patch.mp_currency = moneda;
    } else patch.mp_currency = null;
  }

  if (Object.keys(patch).length === 0) return getIntegracionesStatus();

  const relationMissing = (e) =>
    /could not find the table|does not exist|42p01|pgrst205/i.test(String(e?.message || ''));

  try {
    // Garantiza la fila singleton y guarda.
    const { error: ensureError } = await svc.from(TABLE).upsert(
      { id: 1 },
      { onConflict: 'id', ignoreDuplicates: true },
    );
    if (ensureError) throw ensureError;

    const now = new Date().toISOString();
    const { error } = await svc
      .from(TABLE)
      .update({ ...patch, updated_by: adminId || null, updated_at: now })
      .eq('id', 1);
    if (error) throw error;
  } catch (error) {
    if (relationMissing(error)) {
      throw new Error('Falta ejecutar la migración 033 (tabla configuracion_servicios) en Supabase.');
    }
    throw error;
  }

  cache = { at: 0, row: null };
  return getIntegracionesStatus();
}
