const { AppError } = require('../middlewares/errorHandler');
const seguridad = require('../services/seguridad');

/**
 * POST /api/auth/verificar
 * body: { scope: 'inventario' | 'resumen' | 'ventas_modificar' | 'ventas_eliminar', password, ventaId? }
 * Respuesta correcta: { ok: true, token, scope, expiraEn }
 * La contrasena nunca se guarda ni se devuelve; solo se compara y se descarta.
 */
async function verificar(req, res, next) {
  try {
    const { scope, password } = req.body || {};

    if (!seguridad.scopeValido(scope)) {
      throw new AppError('Tipo de autorización no válido.', 400, 'AUTH_SCOPE_INVALIDO');
    }

    if (!seguridad.passwordConfigurada(scope)) {
      throw new AppError(
        `Seguridad no configurada en el servidor: falta definir ${seguridad.SCOPES[scope].variable} en el archivo .env.`,
        503,
        'AUTH_NO_CONFIGURADA'
      );
    }

    let ventaId = null;
    if (seguridad.SCOPES[scope].ligadoAVenta) {
      ventaId = Number(req.body.ventaId);
      if (!Number.isInteger(ventaId) || ventaId <= 0) {
        throw new AppError('Falta indicar la venta a autorizar.', 400, 'AUTH_VENTA_REQUERIDA');
      }
    }

    const bloqueo = seguridad.bloqueoRestante(req.ip, scope);
    if (bloqueo !== null) {
      const minutos = Math.max(1, Math.ceil(bloqueo / 60000));
      throw new AppError(
        `Demasiados intentos fallidos. Intenta de nuevo en ${minutos} minuto${minutos === 1 ? '' : 's'}.`,
        429,
        'AUTH_BLOQUEADO'
      );
    }

    if (typeof password !== 'string' || !seguridad.verificarPassword(scope, password)) {
      seguridad.registrarFallo(req.ip, scope);
      throw new AppError('Contraseña incorrecta.', 401, 'AUTH_PASSWORD_INCORRECTA');
    }

    seguridad.limpiarIntentos(req.ip, scope);
    const { token, expiraEn } = seguridad.emitirToken(scope, ventaId);
    res.json({ ok: true, token, scope, expiraEn });
  } catch (err) {
    next(err);
  }
}

module.exports = { verificar };
