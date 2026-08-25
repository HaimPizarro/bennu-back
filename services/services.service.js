import { supabase, createClientWithToken } from '../config/supabase.js';

const TABLE = 'services';

// Une cada servicio con los ids de sus servicios hijos (combo) vía service_bundles.
async function attachBundles(rows) {
  if (!rows || rows.length === 0) return rows || [];
  let bundles = [];
  try {
    const { data, error } = await supabase
      .from('service_bundles')
      .select('service_id, child_service_id')
      .in('service_id', rows.map((r) => r.id));
    if (!error) bundles = data || [];
  } catch {
    bundles = [];
  }

  const byId = new Map();
  bundles.forEach((b) => {
    const list = byId.get(b.service_id) || [];
    list.push(b.child_service_id);
    byId.set(b.service_id, list);
  });

  return rows.map((r) => ({ ...r, servicios_combo_ids: byId.get(r.id) || [] }));
}

// Resuelve el nombre de la categoría (categoria_id) y lo expone en `categoria`;
// si no hay FK, mantiene el texto original como respaldo. Defensivo: si la
// tabla `categorias` aún no existe (migración pendiente), deja las filas intactas.
async function attachCategoria(rows) {
  if (!rows || rows.length === 0) return rows || [];
  let cats = [];
  const ids = [...new Set(rows.map((r) => r.categoria_id).filter(Boolean))];
  if (ids.length) {
    try {
      const { data, error } = await supabase
        .from('categorias')
        .select('id, nombre')
        .in('id', ids);
      if (!error) cats = data || [];
    } catch {
      cats = [];
    }
  }
  const byId = new Map(cats.map((c) => [c.id, c.nombre]));
  return rows.map((r) => ({
    ...r,
    categoria_id: r.categoria_id ?? null,
    categoria: byId.get(r.categoria_id) ?? r.categoria,
  }));
}

// Convierte `categoria_id` y/o `categoria` (slug) en { categoria_id, categoria }.
// Si viene un slug nuevo, lo inserta en `categorias` (upsert de facto).
async function resolveCategoria(payload, db) {
  const client = db || supabase;
  const categoriaId = payload.categoria_id != null && payload.categoria_id !== ''
    ? Number(payload.categoria_id)
    : null;
  const categoriaText = payload.categoria != null && String(payload.categoria).trim() !== ''
    ? String(payload.categoria).trim()
    : null;

  if (categoriaId != null) {
    const { data } = await client
      .from('categorias')
      .select('id, nombre')
      .eq('id', categoriaId)
      .maybeSingle();
    if (!data) throw new Error('Categoría no encontrada');
    return { categoria_id: data.id, categoria: data.nombre };
  }
  if (categoriaText) {
    let { data } = await client
      .from('categorias')
      .select('id, nombre')
      .eq('nombre', categoriaText)
      .maybeSingle();
    if (!data) {
      const { data: inserted, error: insError } = await client
        .from('categorias')
        .insert({ nombre: categoriaText })
        .select('id, nombre')
        .single();
      if (insError) throw insError;
      data = inserted;
    }
    return { categoria_id: data.id, categoria: data.nombre };
  }
  return { categoria_id: null, categoria: null };
}

export async function listServices(sucursalId) {
  let q = supabase.from(TABLE).select('*').order('created_at', { ascending: false });
  if (sucursalId != null) q = q.eq('sucursal_id', Number(sucursalId));
  const { data, error } = await q;
  if (error) throw error;
  return attachCategoria(await attachBundles(data));
}

export async function getService(id) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  if (!data) return null;
  return (await attachCategoria(await attachBundles([data])))[0];
}

// Campos dinámicos: solo admitimos los tipos conocidos y saneamos la forma.
const CAMPOS_TIPOS = new Set(['text', 'select', 'multiselect']);

function normalizeCampos(campos) {
  if (!Array.isArray(campos)) return [];
  return campos
    .map((c) => {
      if (!c || typeof c.label !== 'string' || !c.label.trim()) return null;
      const tipo = CAMPOS_TIPOS.has(c.tipo) ? c.tipo : 'text';
      const opciones =
        tipo === 'select' || tipo === 'multiselect'
          ? Array.isArray(c.opciones)
            ? c.opciones.map((o) => String(o).trim()).filter(Boolean)
            : []
          : undefined;
      return {
        label: c.label.trim(),
        tipo,
        ...(opciones ? { opciones } : {}),
        requerido: c.requerido === true,
      };
    })
    .filter(Boolean);
}

function normalizeBundleIds(ids) {
  return Array.isArray(ids) ? [...new Set(ids.map(Number).filter(Boolean))] : [];
}

async function replaceBundle(serviceId, childIds, db) {
  const client = db || supabase;
  const { error: delError } = await client
    .from('service_bundles')
    .delete()
    .eq('service_id', serviceId);
  if (delError) throw delError;
  if (childIds.length) {
    const { error: insError } = await client.from('service_bundles').insert(
      childIds.map((child_service_id) => ({ service_id: serviceId, child_service_id })),
    );
    if (insError) throw insError;
  }
}

export async function createService(payload, token) {
  const db = token ? createClientWithToken(token) : supabase;
  const childIds = normalizeBundleIds(payload.servicios_combo_ids);
  const cat = await resolveCategoria(payload, db);

  const { data, error } = await db
    .from(TABLE)
    .insert({
      nombre: payload.nombre,
      descripcion: payload.descripcion,
      precio: payload.precio,
      precio_oferta: payload.precio_oferta || null,
      descuento_suscripcion: Math.min(100, Math.max(0, Number(payload.descuento_suscripcion) || 0)),
      categoria: cat.categoria ?? payload.categoria,
      categoria_id: cat.categoria_id,
      duracion_minutos: payload.duracion_minutos,
      capacidad: Math.max(1, Number(payload.capacidad) || 1),
      buffer_previo_minutos: payload.buffer_previo_minutos ?? null,
      buffer_posterior_minutos: payload.buffer_posterior_minutos ?? null,
      puntos_otorgados: payload.puntos_otorgados,
      active: payload.active !== false,
      campos: normalizeCampos(payload.campos),
      sucursal_id: payload.sucursal_id != null ? Number(payload.sucursal_id) : 1,
    })
    .select()
    .single();
  if (error) throw error;

  if (childIds.length) {
    await replaceBundle(data.id, childIds, db);
  }
  return (await attachCategoria(await attachBundles([data])))[0];
}

export async function updateService(id, payload, token) {
  const db = token ? createClientWithToken(token) : supabase;

  const { servicio: _, ...fields } = payload;
  const update = {};
  if (fields.nombre !== undefined) update.nombre = fields.nombre;
  if (fields.descripcion !== undefined) update.descripcion = fields.descripcion;
  if (fields.precio !== undefined) update.precio = fields.precio;
  if (fields.precio_oferta !== undefined) update.precio_oferta = fields.precio_oferta || null;
  if (fields.descuento_suscripcion !== undefined) {
    update.descuento_suscripcion = Math.min(100, Math.max(0, Number(fields.descuento_suscripcion) || 0));
  }
  if (fields.duracion_minutos !== undefined) update.duracion_minutos = fields.duracion_minutos;
  if (fields.capacidad !== undefined) update.capacidad = Math.max(1, Number(fields.capacidad) || 1);
  if (fields.buffer_previo_minutos !== undefined) {
    update.buffer_previo_minutos = fields.buffer_previo_minutos ?? null;
  }
  if (fields.buffer_posterior_minutos !== undefined) {
    update.buffer_posterior_minutos = fields.buffer_posterior_minutos ?? null;
  }
  if (fields.puntos_otorgados !== undefined) update.puntos_otorgados = fields.puntos_otorgados;
  if (fields.active !== undefined) update.active = fields.active !== false;
  if (fields.campos !== undefined) update.campos = normalizeCampos(fields.campos);
  if (fields.categoria !== undefined || fields.categoria_id !== undefined) {
    const cat = await resolveCategoria(fields, db);
    update.categoria = cat.categoria ?? fields.categoria ?? null;
    update.categoria_id = cat.categoria_id;
  }

  const { data, error } = await db.from(TABLE).update(update).eq('id', id).select().single();
  if (error) throw error;
  if (!data) return null;

  if (Array.isArray(payload.servicios_combo_ids)) {
    await replaceBundle(id, normalizeBundleIds(payload.servicios_combo_ids), db);
  }
  return (await attachCategoria(await attachBundles([data])))[0];
}

export async function deleteService(id) {
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq('id', id);
  if (error) throw error;
  return true;
}
