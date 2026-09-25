/**
 * auth.js
 * Middleware que protege endpoints sensibles: exige un token valido (emitido por
 * POST /api/auth/verificar) con el alcance correcto en la cabecera `X-Auth-Token`.
 * Esta es la proteccion REAL; ocultar botones en el frontend no reemplaza esto.
 */
const { AppError } = require('./errorHandler');
const seguridad = require('../services/seguridad');

/**
 * @param {string}  scope                   'inventario' | 'ventas_modificar' | 'ventas_eliminar'
 * @param {object}  [opciones]
 * @param {string}  [opciones.paramVenta]   nombre del parametro de ruta con el id de la venta.
 *                                          Si se indica, el token debe estar ligado a ESA venta.
 */
function requerirAutorizacion(scope, opciones = {}) {
  return function autorizar(req, res, next) {
    const token = req.get('X-Auth-Token');
    if (!token) {
      return next(new AppError('Se requiere autorización con contraseña para esta acción.', 401, 'AUTH_REQUERIDA'));
    }

    const ventaId = opciones.paramVenta ? Number(req.params[opciones.paramVenta]) : null;
    const resultado = seguridad.validarToken(token, scope, ventaId);
    if (!resultado.ok) {
      return next(new AppError(resultado.mensaje, 401, resultado.codigo));
    }
    next();
  };
}

module.exports = { requerirAutorizacion };
