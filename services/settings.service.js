import { supabase, createClientWithToken } from '../config/supabase.js';

const TABLE = 'settings';
const DEFAULT_SUCURSAL = 1;

// Valores por defecto si la fila singleton no existe aún.
const DEFAULT_WORKING_HOURS = {
  1: [
    { start: '10:00', end: '12:00' },
    { start: '14:00', end: '18:00' },
  ],
  2: [
    { start: '10:00', end: '12:00' },
    { start: '14:00', end: '18:00' },
  ],
  3: [
    { start: '10:00', end: '12:00' },
    { start: '14:00', end: '18:00' },
  ],
  4: [
    { start: '10:00', end: '12:00' },
    { start: '14:00', end: '18:00' },
  ],
  5: [
    { start: '10:00', end: '12:00' },
    { start: '14:00', end: '18:00' },
  ],
  6: [{ start: '09:00', end: '13:00' }],
  7: [],
};

const DEFAULT_SETTINGS = {
  slot_interval_minutes: 5,
  buffer_before_minutes: 10,
  buffer_after_minutes: 20,
  working_hours: DEFAULT_WORKING_HOURS,
};

// Garantiza que exista la fila de settings para la sucursal.
async function ensureRow(sucursalId = DEFAULT_SUCURSAL, db = supabase) {
  const { data, error } = await db
    .from(TABLE)
    .select('sucursal_id')
    .eq('sucursal_id', sucursalId)
    .maybeSingle();
  if (error) throw error;
  if (data) return;

  const { error: insError } = await db
    .from(TABLE)
    .insert({ sucursal_id: sucursalId, ...DEFAULT_SETTINGS });
  if (insError) throw insError;
}

export async function getSettings(sucursalId = DEFAULT_SUCURSAL) {
  if (sucursalId == null) sucursalId = DEFAULT_SUCURSAL;
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('sucursal_id', sucursalId)
    .maybeSingle();
  if (error) throw error;
  return data || { sucursal_id: sucursalId, ...DEFAULT_SETTINGS };
}

export async function saveSettings(payload, token, sucursalId = DEFAULT_SUCURSAL) {
  const db = token ? createClientWithToken(token) : supabase;
  await ensureRow(sucursalId, db);

  const update = {};
  if (payload.slot_interval_minutes !== undefined) {
    const interval = Number(payload.slot_interval_minutes);
    if (![5, 10, 15, 20, 30, 60].includes(interval)) {
      throw new Error('Intervalo inválido. Debe ser 5, 10, 15, 20, 30 o 60 minutos.');
    }
    update.slot_interval_minutes = interval;
  }
  if (payload.buffer_before_minutes !== undefined) {
    update.buffer_before_minutes = Math.max(0, Number(payload.buffer_before_minutes) || 0);
  }
  if (payload.buffer_after_minutes !== undefined) {
    update.buffer_after_minutes = Math.max(0, Number(payload.buffer_after_minutes) || 0);
  }
  if (payload.working_hours !== undefined) {
    update.working_hours = payload.working_hours;
  }
  update.updated_at = new Date().toISOString();

  const { data, error } = await db
    .from(TABLE)
    .update(update)
    .eq('sucursal_id', sucursalId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}