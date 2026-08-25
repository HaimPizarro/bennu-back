import * as settingsService from '../services/settings.service.js';

const sucursalDe = (req) => {
  const v = Number(req.query.sucursal_id || req.body?.sucursal_id);
  return Number.isFinite(v) && v > 0 ? v : 1;
};

export async function get(req, res) {
  try {
    const settings = await settingsService.getSettings(sucursalDe(req));
    res.json({ success: true, data: settings });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function update(req, res) {
  try {
    const settings = await settingsService.saveSettings(req.body, req.token, sucursalDe(req));
    res.json({ success: true, data: settings });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}