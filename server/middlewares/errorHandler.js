/**
 * Middleware centralizado de manejo de errores.
 * Cualquier error lanzado (o pasado con next(err)) en controladores/servicios
 * termina aqui, para no repetir try/catch de formato de respuesta en cada ruta.
 */
function errorHandler(err, req, res, next) {
  console.error('[ERROR]', err);

  // Errores de Prisma con codigo conocido (ej: registro no encontrado, FK invalida)
  if (err.code === 'P2025') {
    return res.status(404).json({ error: 'Recurso no encontrado.' });
  }
  if (err.code === 'P2003') {
    return res.status(400).json({ error: 'Referencia invalida (categoria o producto inexistente).' });
  }

  // Errores de validacion propios (lanzados con err.status)
  const status = err.status || 500;
  const message = status === 500
    ? 'Ocurrio un error interno en el servidor.'
    : err.message;

  const cuerpo = { error: message };
  if (err.codigo && status !== 500) cuerpo.codigo = err.codigo;
  res.status(status).json(cuerpo);
}

/**
 * Clase simple para lanzar errores con un codigo HTTP asociado
 * desde cualquier controlador o servicio.
 */
class AppError extends Error {
  constructor(message, status = 400, codigo) {
    super(message);
    this.status = status;
    if (codigo) this.codigo = codigo;
  }
}

module.exports = { errorHandler, AppError };
