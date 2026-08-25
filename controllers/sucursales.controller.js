import * as sucursalesService from '../services/sucursales.service.js';

export async function list(req, res) {
  try {
    const sucursales = await sucursalesService.listSucursales(req.query.inactivas === 'true');
    res.json({ success: true, data: sucursales });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function getOne(req, res) {
  try {
    const sucursal = await sucursalesService.getSucursal(req.params.id);
    if (!sucursal) {
      return res.status(404).json({ success: false, message: 'Sucursal no encontrada' });
    }
    res.json({ success: true, data: sucursal });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function create(req, res) {
  try {
    const sucursal = await sucursalesService.createSucursal(req.body, req.token);
    res.status(201).json({ success: true, data: sucursal });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

export async function update(req, res) {
  try {
    const sucursal = await sucursalesService.updateSucursal(req.params.id, req.body, req.token);
    if (!sucursal) {
      return res.status(404).json({ success: false, message: 'Sucursal no encontrada' });
    }
    res.json({ success: true, data: sucursal });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

export async function remove(req, res) {
  try {
    await sucursalesService.deleteSucursal(req.params.id, req.token);
    res.json({ success: true, data: { id: Number(req.params.id) } });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}
