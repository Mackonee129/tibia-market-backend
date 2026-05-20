require('dotenv').config();
const express = require('express');
const app     = express();
const PORT    = process.env.PORT || 3000;

app.use(express.json());

app.get('/',       (req, res) => res.json({ status: 'ok' }));
app.get('/health', (req, res) => res.json({ 
  status: 'ok', 
  service: 'Tibia Market API',
  port: PORT,
  db: process.env.DATABASE_URL ? 'configurada' : 'falta'
}));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`⚔️  Servidor corriendo en puerto ${PORT}`);
});

module.exports = app;
