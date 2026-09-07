import * as usersService from '../services/users.service.js';

export async function listUsers(req, res) {
  try {
    const users = await usersService.listUsers();
    res.json({ success: true, data: users });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function listClients(req, res) {
  try {
    const clients = await usersService.listClients();
    res.json({ success: true, data: clients });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

export async function getUser(req, res) {
  try {
    const { id } = req.params;
    const user = await usersService.getUserById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }
    res.json({ success: true, data: user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// PUT /api/users/me — el propio usuario actualiza su nombre y teléfono.
export async function updateMe(req, res) {
  try {
    const user = await usersService.updateOwnProfile(req.user.id, req.body);
    res.json({ success: true, data: user });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

export async function updatePoints(req, res) {
  try {
    const { id } = req.params;
    const { puntos } = req.body;

    if (typeof puntos !== 'number') {
      return res.status(400).json({ success: false, message: 'El campo "puntos" debe ser un número' });
    }

    const user = await usersService.updateUserPoints(id, puntos);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }
    res.json({ success: true, data: user });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

export async function update(req, res) {
  try {
    const { id } = req.params;
    const user = await usersService.updateUser(id, req.body);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }
    res.json({ success: true, data: user });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

export async function remove(req, res) {
  try {
    const { id } = req.params;
    if (String(id) === String(req.user?.perfil?.id)) {
      return res.status(400).json({ success: false, message: 'No puedes eliminar tu propia cuenta' });
    }
    const user = await usersService.deleteUser(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }
    res.json({ success: true, data: user });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}

// Lectura de ficha: solo el dueño de la cuenta o un admin.
export async function getFicha(req, res) {
  try {
    const { id } = req.params;
    const isAdmin = Number(req.user?.perfil?.rol) === 0;
    if (!isAdmin && String(id) !== String(req.user?.perfil?.id)) {
      return res.status(403).json({ success: false, message: 'No tienes permiso para ver esta ficha' });
    }
    const ficha = await usersService.getFicha(id);
    if (!ficha) {
      return res.json({ success: true, data: null });
    }
    res.json({ success: true, data: ficha });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// Escritura de ficha: solo admin. Reemplaza el contenido completo.
export async function updateFicha(req, res) {
  try {
    const { id } = req.params;
    const { contenido } = req.body;

    if (!contenido || typeof contenido !== 'object' || Array.isArray(contenido)) {
      return res.status(400).json({ success: false, message: 'El campo "contenido" debe ser un objeto' });
    }

    const user = await usersService.getUserById(id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado' });
    }

    const ficha = await usersService.upsertFicha(id, contenido);
    res.json({ success: true, data: ficha });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
}
