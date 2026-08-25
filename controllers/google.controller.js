import { supabase } from '../config/supabase.js';
import * as googleService from '../services/google.service.js';

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';

export async function status(req, res) {
  try {
    const configured = googleService.isGoogleConfigured();
    const connection = await googleService.getConnection();
    const state = {
      configured,
      connected: Boolean(connection),
      email: connection?.google_email || null,
      autoSync: Boolean(connection?.auto_sync),
      lastSyncAt: connection?.last_sync_at || null,
    };
    res.json({ success: true, data: state });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function authUrl(req, res) {
  try {
    if (!googleService.isGoogleConfigured()) {
      return res
        .status(400)
        .json({ success: false, message: 'Google Calendar no está configurado en el servidor' });
    }
    const state = Buffer.from(`${req.user.id}:${Date.now()}`).toString('base64');
    res.json({ success: true, data: { url: googleService.buildAuthUrl(state) } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function callback(req, res) {
  try {
    const { code } = req.query;
    if (!code) {
      return res.status(400).json({ success: false, message: 'Falta el parámetro code' });
    }
    const tokens = await googleService.exchangeCode(code);

    if (!tokens.refresh_token) {
      return res
        .status(400)
        .send('Google no devolvió refresh_token — revoque el acceso previo en myaccount.google.com y vuelva a intentar.');
    }

    await googleService.deleteConnection();
    await googleService.saveConnection({
      google_email: tokens.email || null,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString(),
      calendar_id: 'primary',
      auto_sync: true,
    });

    res.redirect(`${FRONTEND_URL}/dashboard?google=connected`);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function disconnect(req, res) {
  try {
    await googleService.deleteConnection();
    res.json({ success: true, data: { connected: false } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function updateSettings(req, res) {
  try {
    const connection = await googleService.getConnection();
    if (!connection) {
      return res.status(400).json({ success: false, message: 'No hay cuenta de Google conectada' });
    }
    const patch = { updated_at: new Date().toISOString() };
    if (req.body.autoSync !== undefined) patch.auto_sync = Boolean(req.body.autoSync);
    if (req.body.calendarId !== undefined) patch.calendar_id = req.body.calendarId;
    if (req.body.googleEmail !== undefined) patch.google_email = req.body.googleEmail;

    const { data, error } = await supabase.from('google_sync').update(patch).eq('id', connection.id).select('*').single();
    if (error) throw error;
    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function syncNow(req, res) {
  try {
    const result = await googleService.syncAll();
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}
