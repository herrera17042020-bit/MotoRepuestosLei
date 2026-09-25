/**
 * seguridad.js
 * -----------------------------------------------------------------------
 * Autorizacion por contrasenas para las operaciones sensibles del negocio.
 *
 *  - Las contrasenas viven SOLO en variables de entorno del servidor (.env):
 *      INVENTARIO_PASSWORD, RESUMEN_PASSWORD, VENTAS_MODIFICAR_PASSWORD, VENTAS_ELIMINAR_PASSWORD
 *    Son cuatro contrasenas independientes: conocer una no da acceso a las otras.
 *  - Al verificar una contrasena correcta el servidor entrega un TOKEN firmado
 *    (HMAC-SHA256) con alcance (scope) y vencimiento. El frontend guarda el token,
 *    nunca la contrasena, y lo envia en la cabecera `X-Auth-Token`.
 *  - Los tokens de ventas ademas quedan ligados a UNA venta concreta: la
 *    autorizacion para modificar la venta #12 no sirve para la #13.
 *  - Se limita el numero de intentos fallidos por IP para frenar adivinanzas.
 * -----------------------------------------------------------------------
 */
const crypto = require('crypto');

const SCOPES = {
  inventario: { variable: 'INVENTARIO_PASSWORD', ligadoAVenta: false },
  resumen: { variable: 'RESUMEN_PASSWORD', ligadoAVenta: false },
  ventas_modificar: { variable: 'VENTAS_MODIFICAR_PASSWORD', ligadoAVenta: true },
  ventas_eliminar: { variable: 'VENTAS_ELIMINAR_PASSWORD', ligadoAVenta: true },
};

const MAX_INTENTOS = 5;
const VENTANA_INTENTOS_MS = 10 * 60 * 1000;
const BLOQUEO_MS = 5 * 60 * 1000;

let secretoGenerado = null;

function minutosDeEnv(nombre, porDefecto) {
  const valor = Number(process.env[nombre]);
  return Number.isFinite(valor) && valor > 0 ? valor : porDefecto;
}

function duracionTokenMs(scope) {
  if (scope === 'inventario') return minutosDeEnv('AUTH_TOKEN_INVENTARIO_MIN', 480) * 60 * 1000;
  if (scope === 'resumen') return minutosDeEnv('AUTH_TOKEN_RESUMEN_MIN', 60) * 60 * 1000;
  return minutosDeEnv('AUTH_TOKEN_VENTAS_MIN', 10) * 60 * 1000;
}

function obtenerSecreto() {
  const configurado = (process.env.AUTH_SECRET || '').trim();
  if (configurado) return configurado;
  // Sin AUTH_SECRET se genera uno al arrancar: funciona, pero las sesiones
  // se invalidan cada vez que el servidor se reinicia.
  if (!secretoGenerado) secretoGenerado = crypto.randomBytes(32).toString('hex');
  return secretoGenerado;
}

function scopeValido(scope) {
  return Object.prototype.hasOwnProperty.call(SCOPES, scope);
}

function passwordConfigurada(scope) {
  return scopeValido(scope) && (process.env[SCOPES[scope].variable] || '').length > 0;
}

function variablesFaltantes() {
  return Object.keys(SCOPES)
    .filter((scope) => !passwordConfigurada(scope))
    .map((scope) => SCOPES[scope].variable);
}

function hash(texto) {
  return crypto.createHash('sha256').update(String(texto), 'utf8').digest();
}

/** Comparacion en tiempo constante (no revela cuantos caracteres coinciden). */
function verificarPassword(scope, intento) {
  if (!passwordConfigurada(scope)) return false;
  const esperado = process.env[SCOPES[scope].variable];
  return crypto.timingSafeEqual(hash(esperado), hash(intento));
}

// ---- tokens firmados ---------------------------------------------------------

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function firmar(cuerpo) {
  return base64url(crypto.createHmac('sha256', obtenerSecreto()).update(cuerpo).digest());
}

function emitirToken(scope, ventaId = null, ahora = Date.now()) {
  const expiraEn = ahora + duracionTokenMs(scope);
  const payload = { s: scope, v: SCOPES[scope].ligadoAVenta ? Number(ventaId) : null, e: expiraEn };
  const cuerpo = base64url(JSON.stringify(payload));
  return { token: `${cuerpo}.${firmar(cuerpo)}`, expiraEn: new Date(expiraEn).toISOString() };
}

/** Devuelve { ok: true, payload } o { ok: false, codigo, mensaje }. */
function validarToken(token, scope, ventaId = null, ahora = Date.now()) {
  const invalido = { ok: false, codigo: 'AUTH_INVALIDA', mensaje: 'Autorización no válida. Ingresa la contraseña nuevamente.' };
  if (typeof token !== 'string' || !token.includes('.')) return invalido;

  const [cuerpo, firma] = token.split('.');
  const esperada = firmar(cuerpo);
  const a = Buffer.from(String(firma || ''));
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return invalido;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(cuerpo, 'base64url').toString('utf8'));
  } catch (err) {
    return invalido;
  }

  if (!payload || payload.s !== scope) return invalido;
  if (!Number.isFinite(payload.e) || payload.e <= ahora) {
    return { ok: false, codigo: 'AUTH_EXPIRADA', mensaje: 'La autorización venció. Ingresa la contraseña nuevamente.' };
  }
  if (SCOPES[scope].ligadoAVenta && Number(payload.v) !== Number(ventaId)) return invalido;

  return { ok: true, payload };
}

// ---- limite de intentos fallidos ----------------------------------------------

const intentos = new Map(); // clave -> { fallos, primero, bloqueadoHasta }

function claveIntentos(ip, scope) {
  return `${ip || 'desconocida'}|${scope}`;
}

/** Devuelve null si puede intentar, o los milisegundos restantes de bloqueo. */
function bloqueoRestante(ip, scope, ahora = Date.now()) {
  const registro = intentos.get(claveIntentos(ip, scope));
  if (registro && registro.bloqueadoHasta && registro.bloqueadoHasta > ahora) {
    return registro.bloqueadoHasta - ahora;
  }
  return null;
}

function registrarFallo(ip, scope, ahora = Date.now()) {
  const clave = claveIntentos(ip, scope);
  let registro = intentos.get(clave);
  if (!registro || ahora - registro.primero > VENTANA_INTENTOS_MS) {
    registro = { fallos: 0, primero: ahora, bloqueadoHasta: 0 };
  }
  registro.fallos += 1;
  if (registro.fallos >= MAX_INTENTOS) registro.bloqueadoHasta = ahora + BLOQUEO_MS;
  intentos.set(clave, registro);
}

function limpiarIntentos(ip, scope) {
  intentos.delete(claveIntentos(ip, scope));
}

function reiniciarLimitador() {
  intentos.clear();
}

module.exports = {
  SCOPES,
  scopeValido,
  passwordConfigurada,
  variablesFaltantes,
  verificarPassword,
  emitirToken,
  validarToken,
  bloqueoRestante,
  registrarFallo,
  limpiarIntentos,
  reiniciarLimitador,
};
