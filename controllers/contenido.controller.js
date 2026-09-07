import * as contenidoService from '../services/contenido.service.js';

export async function get(req, res) {
  try {
    const contenido = await contenidoService.getContenido();
    res.json({ success: true, data: contenido });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function update(req, res) {
  try {
    const contenido = await contenidoService.saveContenido(req.body, req.token);
    res.json({ success: true, data: contenido });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}
