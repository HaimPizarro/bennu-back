import * as empleadosService from '../services/empleados.service.js';

export async function listEmpleados(req, res) {
  try {
    const includeInactive = req.query.include_inactive === 'true';
    const sucursalId = req.query.sucursal_id != null ? Number(req.query.sucursal_id) : null;
    const empleados = await empleadosService.listEmpleados(includeInactive, sucursalId);
    res.json({ success: true, data: empleados });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function getEmpleado(req, res) {
  try {
    const { id } = req.params;
    const empleado = await empleadosService.getEmpleado(id);
    if (!empleado) {
      return res.status(404).json({ success: false, message: 'Empleado no encontrado' });
    }
    res.json({ success: true, data: empleado });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function createEmpleado(req, res) {
  try {
    const empleado = await empleadosService.createEmpleado(req.body, req.token);
    res.status(201).json({ success: true, data: empleado });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

export async function updateEmpleado(req, res) {
  try {
    const { id } = req.params;
    const empleado = await empleadosService.updateEmpleado(id, req.body, req.token);
    if (!empleado) {
      return res.status(404).json({ success: false, message: 'Empleado no encontrado' });
    }
    res.json({ success: true, data: empleado });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

export async function deleteEmpleado(req, res) {
  try {
    const { id } = req.params;
    await empleadosService.deleteEmpleado(id, req.token);
    res.json({ success: true, data: { id: Number(id) } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function getServiciosEmpleado(req, res) {
  try {
    const { id } = req.params;
    const serviceIds = await empleadosService.listServiciosDeEmpleado(id);
    res.json({ success: true, data: serviceIds });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function setServiciosEmpleado(req, res) {
  try {
    const { id } = req.params;
    const serviceIds = await empleadosService.setServiciosDeEmpleado(id, req.body.service_ids, req.token);
    res.json({ success: true, data: serviceIds });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}
