import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import servicesRoutes from './routes/services.routes.js';
import usersRoutes from './routes/users.routes.js';
import appointmentsRoutes from './routes/appointments.routes.js';
import authRoutes from './routes/auth.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import availabilityRoutes from './routes/availability.routes.js';
import bookingsRoutes from './routes/bookings.routes.js';
import combosRoutes from './routes/combos.routes.js';
import empleadosRoutes from './routes/empleados.routes.js';
import horariosRoutes from './routes/horarios.routes.js';
import eventosRoutes from './routes/eventos.routes.js';
import notificacionesRoutes from './routes/notificaciones.routes.js';
import googleRoutes from './routes/google.routes.js';
import sucursalesRoutes from './routes/sucursales.routes.js';
import pagosRoutes from './routes/pagos.routes.js';
import suscripcionesRoutes from './routes/suscripciones.routes.js';
import contenidoRoutes from './routes/contenido.routes.js';
import { procesarReservasOnline } from './services/appointments.service.js';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/services', servicesRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/appointments', appointmentsRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/availability', availabilityRoutes);
app.use('/api/bookings', bookingsRoutes);
app.use('/api/combos', combosRoutes);
app.use('/api/empleados', empleadosRoutes);
app.use('/api/horarios', horariosRoutes);
app.use('/api/eventos', eventosRoutes);
app.use('/api/notificaciones', notificacionesRoutes);
app.use('/api/google', googleRoutes);
app.use('/api/sucursales', sucursalesRoutes);
app.use('/api/pagos', pagosRoutes);
app.use('/api/suscripciones', suscripcionesRoutes);
app.use('/api/contenido', contenidoRoutes);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Reservas online: envía recordatorios de pago (T+20) y cancela los turnos
// con pago vencido (T+60), avisando por email en ambos casos.
const LIMPIAR_MS = 5 * 60 * 1000;
procesarReservasOnline().catch((e) => console.error('[procesarReservas]', e.message));
setInterval(() => {
  procesarReservasOnline().catch((e) => console.error('[procesarReservas]', e.message));
}, LIMPIAR_MS);
