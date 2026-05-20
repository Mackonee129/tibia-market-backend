require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL || '*', credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('combined'));
app.use(rateLimit({ windowMs: 15*60*1000, max: 100 }));

const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 15 });

app.use('/api/auth',       authLimiter, require('./auth'));
app.use('/api/characters',              require('./characters'));
app.use('/api/listings',               require('./listings'));
app.use('/api/tc',                     require('./tc'));
app.use('/api/messages',               require('./messages'));

app.get('/',       (req, res) => res.json({ status: 'ok' }));
app.get('/health', (req, res) => res.json({ status: 'ok', service: 'Tibia Market API', version: '1.0.0' }));

app.use((req, res) => res.status(404).json({ error: `Ruta no encontrada` }));
app.use((err, req, res, _next) => {
  console.error('Error:', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Error interno' });
});

// ← CLAVE: 0.0.0.0 para que funcione dentro de Docker
app.listen(PORT, '0.0.0.0', () => {
  console.log(`⚔️  Tibia Market corriendo en puerto ${PORT}`);
});

module.exports = app;
