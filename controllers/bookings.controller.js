import * as bookingsService from '../services/bookings.service.js';
import { getUserFromToken } from '../services/auth.service.js';

// Crea una cita pública. Auth opcional: si hay Bearer token valido, se asocia el
// usuario logueado (para acumular puntos); si no, queda como walk-in.
export async function create(req, res) {
  try {
    const authHeader = req.headers.authorization || '';
    let userId = null;
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice('Bearer '.length).trim();
      const authUser = await getUserFromToken(token);
      userId = authUser?.id || null;
    }

    const booking = await bookingsService.createPublicBooking(req.body, userId);
    res.status(201).json({ success: true, data: booking, userId });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

export async function getOne(req, res) {
  try {
    const { id } = req.params;
    const booking = await bookingsService.getPublicBooking(id);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Reserva no encontrada' });
    }
    res.json({ success: true, data: booking });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// Cancela una reserva pública pendiente para liberar el turno.
export async function cancel(req, res) {
  try {
    const data = await bookingsService.cancelPublicBooking(Number(req.params.id));
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}