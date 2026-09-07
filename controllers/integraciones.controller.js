import * as configuracionService from '../services/configuracion.service.js';
import { enviarEmail } from '../services/email.service.js';

// GET /api/integraciones — estado (sin secretos) para el panel admin.
export async function getStatus(req, res) {
  try {
    const data = await configuracionService.getIntegracionesStatus();
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// PUT /api/integraciones — guarda los overrides de correo y Mercado Pago.
export async function update(req, res) {
  try {
    const data = await configuracionService.saveIntegracionesConfig(
      req.body,
      req.user.perfil.id,
    );
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

// POST /api/integraciones/test-email — envía una prueba con la config actual.
export async function testEmail(req, res) {
  try {
    const to = String(req.body?.to || req.user.perfil.email || req.user.email || '').trim();
    if (!to) throw new Error('No hay destinatario para la prueba.');
    const result = await enviarEmail({
      to,
      subject: 'Prueba de correo · bennu',
      html: `<div style="font-family:Inter,Arial,sans-serif;color:#3E4349;">
        <h2 style="color:#5D7A8C;">Correo configurado correctamente</h2>
        <p>Este es un email de prueba enviado desde el panel de Bennu con la nueva configuración de correo.</p>
        <p style="color:#9CAFBE;">Si lo recibiste, el proveedor quedó listo para enviar las citas.</p>
      </div>`,
    });
    if (result?.skipped) {
      throw new Error('No hay proveedor de correo configurado (SMTP o Resend).');
    }
    res.json({ success: true, data: { enviado: true, to } });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

// POST /api/integraciones/test-mp — prueba el Access Token contra Mercado Pago.
export async function testMp(req, res) {
  try {
    const data = await configuracionService.probarMercadoPago();
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}
