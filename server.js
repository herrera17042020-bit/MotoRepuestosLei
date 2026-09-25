require('dotenv').config();
const app = require('./server/app');
const { seedDemoData } = require('./server/services/seed');
const seguridad = require('./server/services/seguridad');

const PORT = process.env.PORT || 3000;

(async () => {
  try {
    if (process.env.SEED_DEMO_DATA === 'true') {
      await seedDemoData();
      console.log('Datos base de demo verificados en PostgreSQL.');
    } else {
      console.log('Seed demo desactivado. La base inicia sin datos de ejemplo.');
    }
  } catch (error) {
    console.error('No se pudieron verificar los datos base:', error.message);
  }

  const faltantes = seguridad.variablesFaltantes();
  if (faltantes.length > 0) {
    console.warn(`[SEGURIDAD] Faltan variables en .env: ${faltantes.join(', ')}.`);
    console.warn('[SEGURIDAD] Sin ellas nadie podrá autorizar esas acciones (quedan bloqueadas). Ver .env.example.');
  }
  if (!(process.env.AUTH_SECRET || '').trim()) {
    console.warn('[SEGURIDAD] AUTH_SECRET no está definido: las sesiones autorizadas se cierran cada vez que se reinicia el servidor.');
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor de la distribuidora corriendo en el puerto ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
  });
})();
