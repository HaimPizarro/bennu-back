import * as pagosService from '../services/pagos.service.js';

// Crea la preferencia de pago de una reserva (pública, como el check-out).
export async function crearPreferenciaReserva(req, res) {
  try {
    const appointmentId = Number(req.body.appointmentId);
    if (!appointmentId) {
      return res.status(400).json({ success: false, message: 'appointmentId es obligatorio' });
    }
    const data = await pagosService.crearPreferenciaReserva({ appointmentId });
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

// Crea la preferencia de pago de la diferencia de un canje (tipo 'combo').
export async function crearPreferenciaCanje(req, res) {
  try {
    const pagoId = Number(req.body.pagoId);
    if (!pagoId) {
      return res.status(400).json({ success: false, message: 'pagoId es obligatorio' });
    }
    const data = await pagosService.crearPreferenciaCanje({ pagoId });
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

// Crea la preferencia de pago de la membresía mensual (tipo 'suscripcion').
export async function crearPreferenciaSuscripcion(req, res) {
  try {
    const pagoId = Number(req.body.pagoId);
    if (!pagoId) {
      return res.status(400).json({ success: false, message: 'pagoId es obligatorio' });
    }
    const data = await pagosService.crearPreferenciaSuscripcion({ pagoId });
    res.json({ success: true, data });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

// Webhook de Mercado Pago. Respuesta SIEMPRE 200 para que MP no reintente en
// bucle; el estado final se re-verifica re-consultando el pago en MP.
export async function webhook(req, res) {
  try {
    const body = req.body || {};
    const bodyId = body?.data?.id || body?.id;
    const qId = Number(req.query['data.id']) || Number(req.query.id);
    const paymentId = Number(bodyId) || qId || null;
    if (paymentId) {
      await pagosService.procesarWebhook({ paymentId });
    }
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('[pagos:webhook]', error.message);
    res.status(200).json({ success: false, message: error.message });
  }
}

// Estado de un pago (usado por la página de pago para poll tras el retorno).
// Si sigue pendiente, reconcilia contra MP en el momento (con el payment_id de
// la URL de retorno, o buscando por external_reference como fallback): así no
// depende solo de que el webhook haya llegado.
export async function getEstado(req, res) {
  try {
    const pago = await pagosService.getPago(req.params.id);
    if (!pago) {
      return res.status(404).json({ success: false, message: 'Pago no encontrado' });
    }

    const paymentId = Number(req.query.payment_id);
    if (pago.estado === 'pendiente') {
      try {
        await pagosService.sincronizarPago({ pagoId: pago.id, paymentId });
      } catch (error) {
        console.error('[pagos:sync]', error.message);
      }
      const refreshed = await pagosService.getPago(pago.id);
      return res.json({ success: true, data: refreshed });
    }

    res.json({ success: true, data: pago });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// Pago asociado a una reserva (perspectiva pública, como la página de pago):
// si quedó pendiente, intenta reconciliar contra MP al momento.
export async function pagoPorReserva(req, res) {
  try {
    const appointmentId = Number(req.params.appointmentId);
    if (!appointmentId) {
      return res.status(400).json({ success: false, message: 'appointmentId inválido' });
    }

    const pago = await pagosService.getPagoPorReserva(appointmentId);
    if (!pago) {
      return res.status(404).json({ success: false, message: 'No hay un pago registrado para esta reserva' });
    }

    if (pago.estado === 'pendiente') {
      try {
        await pagosService.reconciliarPago(pago.id);
      } catch (error) {
        console.error('[pagos:reconcile]', error.message);
      }
    }
    const refreshed = await pagosService.getPago(pago.id);
    res.json({ success: true, data: refreshed });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// Pagos del cliente autenticado.
export async function misPagos(req, res) {
  try {
    const pagos = await pagosService.listPagosByUser(req.user.id);
    res.json({ success: true, data: pagos });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}