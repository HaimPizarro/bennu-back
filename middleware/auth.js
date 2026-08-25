import { getUserFromToken, getUserProfile } from '../services/auth.service.js';

// Extract "Bearer <jwt>" from the Authorization header
function extractToken(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  return header.slice('Bearer '.length).trim();
}

// Require a valid Supabase Auth session; attaches req.user (db profile) and req.token
export async function requireAuth(req, res, next) {
  try {
    const token = extractToken(req);
    const authUser = await getUserFromToken(token);
    if (!authUser) {
      return res.status(401).json({ success: false, message: 'No autorizado' });
    }
    const profile = await getUserProfile(authUser.id);
    if (!profile) {
      return res.status(401).json({ success: false, message: 'Perfil no encontrado' });
    }
    req.user = { ...authUser, perfil: profile };
    req.token = token;
    next();
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
}

// Require an admin user (rol === 0). MUST run after requireAuth.
export function requireAdmin(req, res, next) {
  const rol = Number(req.user?.perfil?.rol);
  if (!req.user || rol !== 0) {
    return res.status(403).json({ success: false, message: 'Acceso restringido a administradores' });
  }
  next();
}