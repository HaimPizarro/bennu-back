import nodemailer from 'nodemailer';
import { supabase } from '../config/supabase.js';

// Envío de emails transaccionales con proveedor intercambiable por env.
// - Si RESEND_API_KEY está configurada -> Resend (API REST, dominio verificado).
// - Si SMTP_HOST/USER/PASS están configurados -> SMTP (hoy: Gmail app password).
// - Sin ninguna credencial -> se loguea y no envía (nunca bloquea el flujo).

const NOMBRE = process.env.EMAIL_FROM_NAME?.trim() || 'bennu';

function provider() {
  if (process.env.RESEND_API_KEY?.trim()) return 'resend';
  if (process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASS?.trim()) {
    return 'smtp';
  }
  return null;
}

let transport;
function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transport;
}

function from() {
  const address = process.env.EMAIL_FROM?.trim() || process.env.SMTP_USER?.trim() || '';
  return NOMBRE && address ? `"${NOMBRE}" <${address}>` : address || NOMBRE;
}

export async function enviarEmail({ to, subject, html }) {
  const prov = provider();
  if (!prov) {
    console.warn(`[email] sin credenciales configuradas (SMTP o RESEND_API_KEY) — no se envió a ${to}`);
    return { skipped: true };
  }
  if (!to) {
    console.warn('[email] sin destinatario — no se envió');
    return { skipped: true };
  }

  if (prov === 'resend') {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY.trim()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: from(), to, subject, html }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`Resend (${res.status}): ${json?.message || res.statusText}`);
    return { ok: true, id: json?.id };
  }

  await getTransport().sendMail({ from: from(), to, subject, html });
  return { ok: true };
}

// !!! ------------------------------------------------------------------
// Cuerpo HTML compartido (estilos inline, paleta "Técnico Etéreo").
// `filas` es un array de [label, valor]; `cta` es { texto, href } opcional.
// ----------------------------------------------------------------------
function layoutEmail({ titulo, saludo, filas, nota = '', cta = null }) {
  const filasHtml = (filas || [])
    .map(
      ([label, valor]) =>
        `<tr><td style="padding:4px 0;font-size:12px;letter-spacing:0.5px;color:#9CAFBE;">${label}</td></tr>
         <tr><td style="padding:0 0 12px 0;font-size:16px;font-weight:600;color:#3E4349;">${valor || '—'}</td></tr>`,
    )
    .join('');
  const ctaHtml = cta
    ? `<tr>
        <td align="center" style="padding:24px 32px 8px 32px;">
          <a href="${cta.href}" style="display:inline-block;background:#5D7A8C;color:#FEFFFF;text-decoration:none;font-size:15px;font-weight:600;padding:14px 28px;border-radius:999px;">${cta.texto}</a>
        </td>
      </tr>`
    : '';

  return `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:0;background:#EFF5F9;font-family:Inter,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EFF5F9;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" max-width="520" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#FEFFFF;border-radius:16px;overflow:hidden;box-shadow:0 8px 30px rgba(61,74,86,0.10);">
            <tr>
              <td style="padding:32px 32px 8px 32px;">
                <p style="margin:0 0 6px 0;font-family:'Space Grotesk',sans-serif;font-size:22px;font-weight:700;letter-spacing:0.5px;color:#5D7A8C;">bennu</p>
                <p style="margin:0 0 4px 0;font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:2px;color:#9CAFBE;">COSMETOLOGÍA STUDIO</p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px;">
                <h1 style="margin:0 0 8px 0;font-size:24px;line-height:1.2;color:#3E4349;">${titulo}</h1>
                <p style="margin:0;font-size:15px;line-height:1.5;color:#5D7A8C;">${saludo}</p>
              </td>
            </tr>
            ${filasHtml ? `
            <tr>
              <td style="padding:20px 32px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EFF5F9;border-radius:12px;">
                  <tr>
                    <td style="padding:16px 20px;">
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${filasHtml}</table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>` : ''}
            ${nota ? `
            <tr>
              <td style="padding:8px 32px 0 32px;">
                <p style="margin:0;font-size:13px;line-height:1.5;color:#5D7A8C;">${nota}</p>
              </td>
            </tr>` : ''}
            ${ctaHtml}
            <tr>
              <td style="padding:24px 32px 32px 32px;">
                <hr style="border:none;border-top:1px solid #EFF5F9;margin:0 0 16px 0;" />
                <p style="margin:0;font-size:12px;line-height:1.5;color:#9CAFBE;">Si tienes dudas, escríbenos sin problema.</p>
                <p style="margin:8px 0 0 0;font-size:12px;color:#9CAFBE;">bennu — cosmetología studio</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// Resuelve el destino: si la persona está registrada, el email de su cuenta;
// si no (walk-in), el email que ingresó al reservar.
async function emailDestino(cita) {
  if (cita?.user_id) {
    const { data, error } = await supabase
      .from('users')
      .select('email')
      .eq('id', cita.user_id)
      .maybeSingle();
    if (!error && data?.email) return data.email;
  }
  return cita?.cliente_email || null;
}

function datosCita(cita, service) {
  const nombre = (cita?.cliente_nombre || '').trim() || '';
  return {
    nombre: nombre.split(' ')[0] || nombre,
    servicio: service?.nombre || cita?.services?.nombre || null,
    fecha: String(cita?.fecha_hora || '').slice(0, 10),
    hora: String(cita?.fecha_hora || '').slice(11, 16),
    duracion: service?.duracion_minutos || cita?.services?.duracion_minutos || null,
  };
}

// T+20 min: recordatorio con link de pago. Solo queda la mitad del hold.
export async function enviarRecordatorioPago(cita, service, urlPago) {
  try {
    const to = await emailDestino(cita);
    if (!to) return { skipped: true };
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const { nombre, servicio, fecha, hora } = datosCita(cita, service);
    return await enviarEmail({
      to,
      subject: 'Te quedan 40 minutos para completar el pago de tu turno',
      html: layoutEmail({
        titulo: 'Tu turno está reservado, pero falta el pago',
        saludo: `Hola ${nombre || '!'}, guardamos tu horario por 1 hora. Ya pasaron 20 minutos y todavía no confirmamos el pago.`,
        filas: [
          ['SERVICIO', servicio],
          ['FECHA', fecha && hora ? `${fecha} a las ${hora} hs` : null],
        ],
        nota: 'Completa el pago dentro de los próximos 40 minutos para no perder tu turno.',
        cta: { texto: 'Completar mi pago', href: urlPago || `${frontendUrl}/pago/${cita.id}` },
      }),
    });
  } catch (error) {
    console.error('[email:recordatorio]', error.message);
    return { skipped: true };
  }
}

// T+60 min: la reserva venció sin pago y el turno se liberó.
export async function enviarCitaCancelada(cita, service) {
  try {
    const to = await emailDestino(cita);
    if (!to) return { skipped: true };
    const { nombre, servicio, fecha, hora } = datosCita(cita, service);
    return await enviarEmail({
      to,
      subject: 'Tu turno fue cancelado automáticamente',
      html: layoutEmail({
        titulo: 'Turno cancelado por falta de pago',
        saludo: `Hola ${nombre || '!'}, tu turno se canceló automáticamente porque no se completó el pago dentro de la hora reservada.`,
        filas: [
          ['SERVICIO', servicio],
          ['FECHA', fecha && hora ? `${fecha} a las ${hora} hs` : null],
        ],
        nota: 'Si quieres reagendar, reserva un nuevo horario desde la web. ¡Te esperamos!',
      }),
    });
  } catch (error) {
    console.error('[email:cancelada]', error.message);
    return { skipped: true };
  }
}

// Pago aprobado: confirmación final, sin link de pago.
export async function enviarPagoConfirmadoCita(cita, service) {
  try {
    const to = await emailDestino(cita);
    if (!to) return { skipped: true };
    const { nombre, servicio, fecha, hora, duracion } = datosCita(cita, service);
    const puntos = Number(service?.puntos_otorgados || cita?.services?.puntos_otorgados) || 0;
    const filas = [
      ['SERVICIO', servicio],
      ['FECHA', fecha && hora ? `${fecha} a las ${hora} hs` : null],
      ['DURACIÓN', duracion ? `${duracion} min` : null],
    ];
    if (cita?.user_id && puntos > 0) filas.push(['PUNTOS SUMADOS', `+${puntos} pts de fidelización`]);
    return await enviarEmail({
      to,
      subject: 'Tu cita fue pagada y agendada con éxito',
      html: layoutEmail({
        titulo: '¡Tu cita fue pagada y agendada con éxito!',
        saludo: `Hola ${nombre || '!'}, recibimos tu pago y tu turno quedó confirmado. ¡Nos vemos pronto!`,
        filas,
        nota: 'Guarda tu turno en el calendario para no perderlo.',
      }),
    });
  } catch (error) {
    console.error('[email:confirmado]', error.message);
    return { skipped: true };
  }
}

// Canje confirmado: citas de un combo ya "pagadas" con puntos (o con pago de
// diferencia aprobado). Sin link de pago.
export async function enviarCanjeConfirmadoCita(cita, service, comboNombre) {
  try {
    const to = await emailDestino(cita);
    if (!to) return { skipped: true };
    const { nombre, fecha, hora } = datosCita(cita, service);
    return await enviarEmail({
      to,
      subject: 'Tu canje fue confirmado',
      html: layoutEmail({
        titulo: '¡Tu canje fue confirmado!',
        saludo: `Hola ${nombre || '!'}, tus turnos quedaron confirmados. ¡Te esperamos!`,
        filas: [
          ['CANJE', comboNombre || 'Servicios combinados'],
          ['FECHA', fecha && hora ? `${fecha} a las ${hora} hs` : null],
        ],
        nota: 'Guarda tus turnos en el calendario para no perderlos.',
      }),
    });
  } catch (error) {
    console.error('[email:canje]', error.message);
    return { skipped: true };
  }
}