const express = require('express');
const cors = require('cors');
const path = require('path');
const apiRouter = require('./routes');
const { errorHandler } = require('./middlewares/errorHandler');

const app = express();
app.set('trust proxy', 1);

const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions = corsOrigins.length > 0
  ? {
      origin: (origin, callback) => {
        if (!origin || corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error('Origen no permitido por CORS.')); 
      },
      credentials: true,
    }
  : {
      origin: true,
      credentials: true,
    };

app.use(cors(corsOptions));

// Parseo de JSON en el body de las peticiones
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Sirve el frontend (HTML/CSS/JS) desde /public
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/config', (req, res) => {
  res.json({
    ok: true,
    apiBase: process.env.API_BASE_URL || `https://${req.get('host')}/api`,
    mode: 'cloud-shared-inventory',
  });
});

// Todas las rutas de la API cuelgan de /api
app.use('/api', apiRouter);

// Manejador de errores centralizado (debe ir despues de las rutas)
app.use(errorHandler);

module.exports = app;
