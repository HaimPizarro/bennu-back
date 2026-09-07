import { supabase, createClientWithToken } from '../config/supabase.js';

const TABLE = 'contenido_sitio';

// Contenido por defecto del sitio. Es la semilla para la landing cuando
// todavía no se guardó nada en la DB. Textos en español neutro (tuteo).
const DEFAULT_CONTENIDO = {
  seo: {
    titulo: 'bennu — Estudio de cosmetología',
    descripcion:
      'Tratamientos faciales y corporales con protocolos precisos y productos premium. Reserva tu turno en bennu, estudio de cosmetología.',
    keywords: [
      'cosmetología',
      'limpieza facial',
      'tratamientos faciales',
      'tratamientos corporales',
      'micropunción',
      'piel',
      'estética',
      'bennu',
    ],
    og_imagen: null,
  },
  marca: {
    nombre: 'bennu',
    eslogan: 'Renace en tu piel',
    descripcion: 'Estudio de cosmetología',
  },
  hero: {
    eyebrow: 'Estudio de cosmética · Bennu',
    titulo: 'Renace en tu piel',
    lead: 'Tratamientos faciales y corporales con protocolos precisos y productos premium, pensados para que tu piel luzca su mejor versión.',
    cta_primario: { texto: 'Reservar turno', destino: '/agenda' },
    cta_secundario: { texto: 'Ver servicios', destino: '#servicios' },
    imagenes: [],
    stats: [
      { valor: '12+', etiqueta: 'años de experiencia' },
      { valor: '3000+', etiqueta: 'sesiones realizadas' },
      { valor: '98%', etiqueta: 'clientas que recomiendan' },
    ],
  },
  servicios: {
    eyebrow: 'Servicios',
    titulo: 'Tratamientos con precisión',
    lead: 'Tres líneas de cuidado para cada necesidad. Elige una categoría para filtrar.',
  },
  sobreMi: {
    eyebrow: 'Sobre mí',
    titulo: 'La piel cuenta una historia',
    parrafos: [
      'Soy especialista en estética y cosmética con más de una década de práctica. Fundé Bennu como un espacio donde cada tratamiento se diseña a medida: analizo, escucho y protocolizo según tu tipo de piel, tu rutina y tus objetivos.',
      'El nombre Bennu viene del ave del renacimiento: cada sesión es una oportunidad de renovar, iluminar y reconstruir. Nada de protocolos de manual: cada piel es un caso, y cada caso tiene su plan.',
    ],
    credenciales: [
      'Cosmetóloga y esteticista certificada',
      'Especialización en dermo-estética avanzada',
      'Formación continua en protocolos no invasivos',
    ],
    imagen: null,
  },
  resultados: {
    eyebrow: 'Resultados',
    titulo: 'Lo que cuentan nuestras clientas',
    lead: 'Resultados medibles, piel a piel. Esto es lo que eligen quienes ya pasaron por Bennu.',
    // 'texto' (tarjetas actuales) | 'imagenes' (galería) | 'ambos' (tarjetas + galería)
    modo: 'texto',
    items: [
      {
        cliente: 'Florencia D.',
        tratamiento: 'Limpieza facial profunda',
        metrica: 'Piel visiblemente más luminosa',
        detalle:
          'Eliminó impurezas acumuladas y recuperó el brillo natural en una sola sesión.',
        imagen: null,
      },
      {
        cliente: 'María S.',
        tratamiento: 'Micropunción facial',
        metrica: 'Firmeza y textura renovadas',
        detalle: 'Serie de tres sesiones para atenuar marcas y redefinir el óvalo facial.',
        imagen: null,
      },
      {
        cliente: 'Lucía P.',
        tratamiento: 'Tratamiento anti-acné',
        metrica: 'Control de brotes en 6 semanas',
        detalle: 'Protocolo mensual que redujo la inflamación y reguló el exceso de sebo.',
        imagen: null,
      },
      {
        cliente: 'Andrea V.',
        tratamiento: 'Hidratación hialurónica',
        metrica: 'Hidratación profunda sostenida',
        detalle: 'Recuperó elasticidad y suavidad tras una rutina muy deshidratante.',
        imagen: null,
      },
    ],
  },
  contacto: {
    eyebrow: 'Contacto',
    titulo: 'Cuéntanos tu consulta',
    lead: 'Respondemos a la brevedad. También puedes escribirnos directamente.',
    boton_formulario: 'Enviar mensaje',
    items: [
      { etiqueta: 'Dirección', valor: 'Av. siempre 1234, Ciudad', tipo: 'direccion' },
      { etiqueta: 'Teléfono / WhatsApp', valor: '+54 11 5555 0202', tipo: 'telefono' },
      { etiqueta: 'Email', valor: 'hola@bennu.com', tipo: 'email' },
      { etiqueta: 'Horario', valor: 'Lun a Vie 9:00–18:00', tipo: 'horario' },
    ],
  },
  tema: {
    // Paleta de marca global (panel Apariencia): se aplica a todos los
    // visitantes. Valores iguales al default claro usan las variables CSS.
    colors: {
      bg: '#feffff',
      'bg-mist': '#eff5f9',
      steel: '#5d7a8c',
      mist: '#9cafbe',
      slate: '#3e4349',
    },
  },
};

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Mezcla recursiva: los arrays y los null del payload reemplazan; los objetos
// se fusionan clave a clave; los primitivos se pisán cuando vienen definidos.
function mergeContenido(base = {}, extra) {
  if (!isPlainObject(extra)) return extra === undefined ? base : extra;
  const out = isPlainObject(base) ? { ...base } : {};
  for (const key of Object.keys(extra)) {
    const value = extra[key];
    if (value === undefined) continue;
    out[key] = mergeContenido(base?.[key], value);
  }
  return out;
}

// Devuelve true cuando el error es por tabla/bucket aún inexistente (migración
// pendiente), para poder servir el contenido por defecto sin romper la landing.
function tableMissing(error) {
  const msg = String(error?.message || '').toLowerCase();
  return (
    msg.includes('42p01') ||
    msg.includes('does not exist') ||
    msg.includes('could not find the table') ||
    msg.includes('pgrst205')
  );
}

function normalizeDoc(payload) {
  if (!isPlainObject(payload)) return {};
  return isPlainObject(payload.contenido) ? payload.contenido : payload;
}

export async function getContenido() {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('contenido')
      .eq('id', 1)
      .maybeSingle();
    if (error) throw error;
    return mergeContenido(DEFAULT_CONTENIDO, data?.contenido || {});
  } catch (error) {
    if (tableMissing(error)) return mergeContenido(DEFAULT_CONTENIDO, {});
    throw error;
  }
}

export async function saveContenido(payload, token) {
  const db = token ? createClientWithToken(token) : supabase;
  const doc = normalizeDoc(payload);

  try {
    const { error: ensureError } = await db.from(TABLE).upsert(
      { id: 1, contenido: {}, created_at: new Date().toISOString() },
      { onConflict: 'id', ignoreDuplicates: true },
    );
    if (ensureError) throw ensureError;

    const { data: current, error: readError } = await db
      .from(TABLE)
      .select('contenido')
      .eq('id', 1)
      .maybeSingle();
    if (readError) throw readError;

    const merged = mergeContenido(
      DEFAULT_CONTENIDO,
      mergeContenido(current?.contenido || {}, doc),
    );

    const { data, error } = await db
      .from(TABLE)
      .update({ contenido: merged, updated_at: new Date().toISOString() })
      .eq('id', 1)
      .select('contenido')
      .single();
    if (error) throw error;

    return mergeContenido(DEFAULT_CONTENIDO, data?.contenido || {});
  } catch (error) {
    if (tableMissing(error)) {
      throw new Error('Falta ejecutar la migración 032 (tabla contenido_sitio) en Supabase.');
    }
    throw error;
  }
}
