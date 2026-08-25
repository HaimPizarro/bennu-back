import * as appointmentsService from '../services/appointments.service.js';

export async function create(req, res) {
  try {
    const appointment = await appointmentsService.createAppointment(req.body, req.user?.perfil?.id);
    res.status(201).json({ success: true, data: appointment });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

export async function listAll(req, res) {
  try {
    const sucursalId = req.query.sucursal_id != null ? Number(req.query.sucursal_id) : null;
    const appointments = await appointmentsService.listAppointments(sucursalId);
    res.json({ success: true, data: appointments });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function listMy(req, res) {
  try {
    const userId = req.user?.perfil?.id;
    const appointments = await appointmentsService.listAppointmentsByUser(userId);
    res.json({ success: true, data: appointments });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function listByUser(req, res) {
  try {
    const { userId } = req.params;
    const appointments = await appointmentsService.listAppointmentsByUser(userId);
    res.json({ success: true, data: appointments });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function getOne(req, res) {
  try {
    const { id } = req.params;
    const appointment = await appointmentsService.getAppointmentById(id);
    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Cita no encontrada' });
    }
    res.json({ success: true, data: appointment });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function update(req, res) {
  try {
    const { id } = req.params;
    const appointment = await appointmentsService.updateAppointment(id, req.body, req.user?.perfil?.id);
    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Cita no encontrada' });
    }
    res.json({ success: true, data: appointment });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

export async function updateStatus(req, res) {
  try {
    const { id } = req.params;
    const { estado } = req.body;

    if (!estado) {
      return res.status(400).json({ success: false, message: 'El campo "estado" es requerido' });
    }

    const appointment = await appointmentsService.updateAppointmentStatus(id, estado, req.user?.perfil?.id);
    if (!appointment) {
      return res.status(404).json({ success: false, message: 'Cita no encontrada' });
    }
    res.json({ success: true, data: appointment });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

export async function remove(req, res) {
  try {
    const { id } = req.params;
    await appointmentsService.deleteAppointment(id, req.user?.perfil?.id);
    res.json({ success: true, data: { id: Number(id) } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function createRecurring(req, res) {
  try {
    const result = await appointmentsService.createRecurring(req.body, req.user?.perfil?.id);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

export async function cancelSeries(req, res) {
  try {
    const { id } = req.params;
    const result = await appointmentsService.cancelSeries(id, req.user?.perfil?.id);
    if (!result) {
      return res.status(404).json({ success: false, message: 'Cita no encontrada' });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

export async function removeSeries(req, res) {
  try {
    const { id } = req.params;
    const result = await appointmentsService.deleteSeries(id, req.user?.perfil?.id);
    if (!result) {
      return res.status(404).json({ success: false, message: 'Cita no encontrada' });
    }
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}