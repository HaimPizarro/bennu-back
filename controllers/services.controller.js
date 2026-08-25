import * as servicesService from '../services/services.service.js';

export async function listServices(req, res) {
  try {
    const sucursalId = req.query.sucursal_id != null ? Number(req.query.sucursal_id) : null;
    const services = await servicesService.listServices(sucursalId);
    res.json({ success: true, data: services });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function getService(req, res) {
  try {
    const { id } = req.params;
    const service = await servicesService.getService(id);
    if (!service) {
      return res.status(404).json({ success: false, message: 'Servicio no encontrado' });
    }
    res.json({ success: true, data: service });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function createService(req, res) {
  try {
    const service = await servicesService.createService(req.body, req.token);
    res.status(201).json({ success: true, data: service });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

export async function updateService(req, res) {
  try {
    const { id } = req.params;
    const service = await servicesService.updateService(id, req.body, req.token);
    if (!service) {
      return res.status(404).json({ success: false, message: 'Servicio no encontrado' });
    }
    res.json({ success: true, data: service });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

export async function deleteService(req, res) {
  try {
    const { id } = req.params;
    await servicesService.deleteService(id);
    res.json({ success: true, data: null });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}
