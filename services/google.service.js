import { supabase } from '../config/supabase.js';

const OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const CALENDAR_URL = 'https://www.googleapis.com/calendar/v3';
const TIMEZONE = 'America/Argentina/Buenos_Aires';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || '';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ');

export function isGoogleConfigured() {
  return Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI);
}

// ---------------------------------------------------------------------------
// Conexión OAuth
// ---------------------------------------------------------------------------

export async function getConnection() {
  const { data, error } = await supabase
    .from('google_sync')
    .select('*')
    .order('id', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveConnection(row) {
  const { data, error } = await supabase
    .from('google_sync')
    .insert({
      ...row,
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteConnection() {
  const { error } = await supabase.from('google_sync').delete().neq('id', 0);
  if (error) throw error;
}

export function buildAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `${OAUTH_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(code) {
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Google token exchange falló (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json();
}

// Devuelve un access token válido, refrescando si expiró.
export async function getAccessToken(connection) {
  const expiresAt = connection.token_expires_at ? Date.parse(connection.token_expires_at) : 0;
  if (connection.access_token && expiresAt > Date.now() + 60000) {
    return connection.access_token;
  }

  if (!connection.refresh_token) {
    throw new Error('Sin refresh token — vuelva a conectar la cuenta');
  }

  const res = await fetch(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: connection.refresh_token,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Refresh de token falló (${res.status}): ${body.slice(0, 200)}`);
  }
  const json = await res.json();

  const expiresIn = Number(json.expires_in) || 3600;
  const updated = {
    ...connection,
    access_token: json.access_token,
    token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
  };
  const { error } = await supabase.from('google_sync').update(updated).eq('id', connection.id);
  if (error) throw error;

  return updated.access_token;
}

// ---------------------------------------------------------------------------
// Calendar API
// ---------------------------------------------------------------------------

async function calendarFetch(connection, path, options = {}) {
  const token = await getAccessToken(connection);
  const calendarId = connection.calendar_id || 'primary';
  const url = `${CALENDAR_URL}/calendars/${encodeURIComponent(calendarId)}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Calendar API ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

// Convierte una cita a un evento de Google Calendar.
function toEventPayload(appointment) {
  const start = new Date(appointment.fecha_hora);
  const durMin = Number(appointment.services?.duracion_minutos) || 60;
  const end = new Date(start.getTime() + durMin * 60000);

  const cliente = appointment.cliente_nombre || appointment.users?.nombre || 'Cliente';
  const servicio = appointment.services?.nombre || 'Cita';

  const descParts = [];
  if (appointment.cliente_email) descParts.push(`Email: ${appointment.cliente_email}`);
  if (appointment.cliente_telefono) descParts.push(`Tel: ${appointment.cliente_telefono}`);
  if (appointment.notas) descParts.push(`Notas: ${appointment.notas}`);
  if (appointment.user_id) descParts.push(`Usuario: ${appointment.user_id}`);

  return {
    summary: `${servicio} — ${cliente}`,
    description: descParts.join('\n'),
    start: { dateTime: start.toISOString(), timeZone: TIMEZONE },
    end: { dateTime: end.toISOString(), timeZone: TIMEZONE },
    status: appointment.estado === 'Cancelada' ? 'cancelled' : 'confirmed',
  };
}

async function upsertEvent(connection, appointment) {
  const token = await getAccessToken(connection);
  const calendarId = connection.calendar_id || 'primary';
  const payload = toEventPayload(appointment);

  const { data: mapRow } = await supabase
    .from('google_event_map')
    .select('google_event_id')
    .eq('appointment_id', appointment.id)
    .maybeSingle();

  let googleEventId;
  let action = 'updated';
  if (mapRow?.google_event_id) {
    await calendarFetch(connection, `/events/${encodeURIComponent(mapRow.google_event_id)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    googleEventId = mapRow.google_event_id;
  } else {
    const created = await calendarFetch(connection, '/events', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    googleEventId = created.id;
    action = 'created';
    const { error: insError } = await supabase.from('google_event_map').insert({
      appointment_id: appointment.id,
      google_event_id: googleEventId,
    });
    if (insError) throw insError;
  }

  return { id: googleEventId, action };
}

async function deleteEvent(connection, googleEventId) {
  await calendarFetch(connection, `/events/${encodeURIComponent(googleEventId)}`, {
    method: 'DELETE',
  });
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

// Sincroniza una única cita: crea/actualiza el evento. Si la cita está
// cancelada, elimina el evento de Google. No bloquea el flujo que la invoca.
export async function syncAppointment(appointment) {
  try {
    if (!isGoogleConfigured()) return { synced: false, reason: 'no_config' };
    const connection = await getConnection();
    if (!connection) return { synced: false, reason: 'not_connected' };
    if (connection.auto_sync === false) return { synced: false, reason: 'auto_sync_off' };

    // Asegura que la cita tenga la info del servicio para calcular duración.
    let row = appointment;
    if (!appointment.services?.duracion_minutos) {
      const { data } = await supabase
        .from('appointments')
        .select(`
          *,
          users:user_id (nombre, email, telefono),
          services:service_id (nombre, duracion_minutos)
        `)
        .eq('id', appointment.id)
        .maybeSingle();
      row = data || appointment;
    }

    if (row.estado === 'Cancelada') {
      const { data: mapRow } = await supabase
        .from('google_event_map')
        .select('google_event_id')
        .eq('appointment_id', row.id)
        .maybeSingle();
      if (mapRow?.google_event_id) {
        await deleteEvent(connection, mapRow.google_event_id);
        await supabase.from('google_event_map').delete().eq('appointment_id', row.id);
      }
      return { synced: true, action: 'deleted' };
    }

    const result = await upsertEvent(connection, row);
    return { synced: true, action: result.action, googleEventId: result.id };
  } catch (error) {
    return { synced: false, error: error.message };
  }
}

// Sincronización completa de todas las citas no canceladas.
export async function syncAll() {
  if (!isGoogleConfigured()) throw new Error('Google Calendar no está configurado en el servidor');
  const connection = await getConnection();
  if (!connection) throw new Error('No hay cuenta de Google conectada');

  const { data: appointments, error } = await supabase
    .from('appointments')
    .select(`
      *,
      users:user_id (nombre, email, telefono),
      services:service_id (nombre, duracion_minutos)
    `)
    .not('estado', 'eq', 'Cancelada');
  if (error) throw error;

  let created = 0;
  let updated = 0;
  const errors = [];

  for (const appt of appointments || []) {
    try {
      const result = await upsertEvent(connection, appt);
      if (result?.action === 'created') created += 1;
      else updated += 1;
    } catch (e) {
      errors.push({ id: appt.id, error: e.message });
    }
  }

  await supabase.from('google_sync').update({ last_sync_at: new Date().toISOString() }).eq('id', connection.id);

  return { created, updated, total: (appointments || []).length, errors };
}
