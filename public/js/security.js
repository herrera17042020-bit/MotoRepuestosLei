/**
 * security.js
 * -----------------------------------------------------------------------
 * Autorizacion por contrasena en la interfaz (inventario, modificar y eliminar ventas).
 *
 *  - NINGUNA contrasena esta escrita en el codigo del frontend.
 *  - Con backend activo: la contrasena se envia al servidor (POST /api/auth/verificar), que
 *    la compara con su .env y devuelve un token firmado. Aqui solo se guarda ese token.
 *  - Sin backend (modo local/offline): se compara contra HASHES con sal generados a partir del
 *    .env (public/js/security-config.js, ver `npm run security:local`). Es una barrera de la
 *    interfaz; la proteccion real es la del servidor.
 *  - Inventario: la autorizacion dura mientras la sesion de la app (sessionStorage) siga abierta.
 *    Modificar/eliminar ventas: el token se usa una sola vez, vive en memoria y es de UNA venta.
 *  - Nada de esto usa localStorage.
 * -----------------------------------------------------------------------
 */

const Security = (function () {
  const CLAVE_SESION = 'moto_autorizacion_v1';
  const DURACION_LOCAL_MS = {
    inventario: 8 * 60 * 60 * 1000,
    resumen: 60 * 60 * 1000,
    ventas_modificar: 10 * 60 * 1000,
    ventas_eliminar: 10 * 60 * 1000,
  };

  const TEXTOS = {
    inventario: {
      titulo: 'Acceso al inventario',
      subtitulo: 'Ingrese la contraseña para continuar',
      boton: 'Ingresar',
      etiqueta: 'Contraseña',
    },
    resumen: {
      titulo: 'Acceso al resumen',
      subtitulo: 'Este panel contiene información sensible del negocio.',
      boton: 'Ingresar',
      etiqueta: 'Contraseña',
    },
    ventas_modificar: {
      titulo: 'Autorización requerida',
      subtitulo: 'Se necesita autorización para modificar esta venta.',
      boton: 'Autorizar',
      etiqueta: 'Ingrese la contraseña para modificar ventas del día.',
    },
    ventas_eliminar: {
      titulo: 'Eliminar venta',
      subtitulo: 'Esta acción requiere autorización.',
      boton: 'Autorizar',
      etiqueta: 'Ingrese la contraseña para eliminar ventas.',
    },
  };

  // ---- criptografia para el modo local (PBKDF2-SHA256) ------------------------
  // Usa WebCrypto cuando existe (https / localhost). En http por IP (ej. celular en la red
  // local) el navegador no ofrece WebCrypto, por eso hay una implementacion de respaldo
  // en JavaScript puro que da exactamente el mismo resultado.

  const K256 = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const IV256 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];

  function rotr(x, n) {
    return (x >>> n) | (x << (32 - n));
  }

  // Procesa UN bloque de 64 bytes ya cargado como 16 palabras en `w` (Uint32Array de 64).
  function comprimir(estado, w) {
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
    }
    let a = estado[0], b = estado[1], c = estado[2], d = estado[3];
    let e = estado[4], f = estado[5], g = estado[6], h = estado[7];
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K256[t] + w[t]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    estado[0] = (estado[0] + a) | 0; estado[1] = (estado[1] + b) | 0;
    estado[2] = (estado[2] + c) | 0; estado[3] = (estado[3] + d) | 0;
    estado[4] = (estado[4] + e) | 0; estado[5] = (estado[5] + f) | 0;
    estado[6] = (estado[6] + g) | 0; estado[7] = (estado[7] + h) | 0;
  }

  function cargarBloque(w, bytes, desde) {
    for (let i = 0; i < 16; i++) {
      const j = desde + i * 4;
      w[i] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3];
    }
  }

  function estadoABytes(estado) {
    const salida = new Uint8Array(32);
    for (let i = 0; i < 8; i++) {
      salida[i * 4] = estado[i] >>> 24;
      salida[i * 4 + 1] = (estado[i] >>> 16) & 255;
      salida[i * 4 + 2] = (estado[i] >>> 8) & 255;
      salida[i * 4 + 3] = estado[i] & 255;
    }
    return salida;
  }

  function sha256(mensaje) {
    const estado = Uint32Array.from(IV256);
    const relleno = new Uint8Array(Math.ceil((mensaje.length + 9) / 64) * 64);
    relleno.set(mensaje);
    relleno[mensaje.length] = 0x80;
    const bits = mensaje.length * 8;
    const vista = new DataView(relleno.buffer);
    vista.setUint32(relleno.length - 8, Math.floor(bits / 4294967296));
    vista.setUint32(relleno.length - 4, bits >>> 0);

    const w = new Uint32Array(64);
    for (let desde = 0; desde < relleno.length; desde += 64) {
      cargarBloque(w, relleno, desde);
      comprimir(estado, w);
    }
    return estadoABytes(estado);
  }

  function hmacSha256(clave, mensaje) {
    let k = clave.length > 64 ? sha256(clave) : clave;
    const relleno = new Uint8Array(64);
    relleno.set(k);
    const ipad = new Uint8Array(64 + mensaje.length);
    const opad = new Uint8Array(64 + 32);
    for (let i = 0; i < 64; i++) {
      ipad[i] = relleno[i] ^ 0x36;
      opad[i] = relleno[i] ^ 0x5c;
    }
    ipad.set(mensaje, 64);
    opad.set(sha256(ipad), 64);
    return sha256(opad);
  }

  /** PBKDF2-HMAC-SHA256 de 32 bytes (un solo bloque), optimizado con estados precalculados. */
  function pbkdf2SinWebCrypto(passwordBytes, sal, iteraciones) {
    const salMasIndice = new Uint8Array(sal.length + 4);
    salMasIndice.set(sal);
    salMasIndice[sal.length + 3] = 1;

    let u = hmacSha256(passwordBytes, salMasIndice);
    const resultado = Uint8Array.from(u);

    // Estados internos tras procesar los bloques ipad/opad (se calculan una sola vez).
    const clave = passwordBytes.length > 64 ? sha256(passwordBytes) : passwordBytes;
    const relleno = new Uint8Array(64);
    relleno.set(clave);
    const ipad = new Uint8Array(64);
    const opad = new Uint8Array(64);
    for (let i = 0; i < 64; i++) {
      ipad[i] = relleno[i] ^ 0x36;
      opad[i] = relleno[i] ^ 0x5c;
    }
    const w = new Uint32Array(64);
    const estadoInterno = Uint32Array.from(IV256);
    cargarBloque(w, ipad, 0);
    comprimir(estadoInterno, w);
    const estadoExterno = Uint32Array.from(IV256);
    cargarBloque(w, opad, 0);
    comprimir(estadoExterno, w);

    const bloque = new Uint8Array(64);
    const vista = new DataView(bloque.buffer);
    bloque[32] = 0x80;
    vista.setUint32(60, (64 + 32) * 8);

    for (let n = 1; n < iteraciones; n++) {
      // interno: H(ipad || u)
      bloque.set(u, 0);
      cargarBloque(w, bloque, 0);
      const e1 = Uint32Array.from(estadoInterno);
      comprimir(e1, w);
      // externo: H(opad || interno)
      bloque.set(estadoABytes(e1), 0);
      cargarBloque(w, bloque, 0);
      const e2 = Uint32Array.from(estadoExterno);
      comprimir(e2, w);
      u = estadoABytes(e2);
      for (let i = 0; i < 32; i++) resultado[i] ^= u[i];
    }
    return resultado;
  }

  async function derivarClave(password, sal, iteraciones) {
    const bytes = new TextEncoder().encode(password);
    const cripto = typeof crypto !== 'undefined' ? crypto : null;
    if (cripto && cripto.subtle && cripto.subtle.importKey) {
      try {
        const clave = await cripto.subtle.importKey('raw', bytes, 'PBKDF2', false, ['deriveBits']);
        const bits = await cripto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: sal, iterations: iteraciones }, clave, 256);
        return new Uint8Array(bits);
      } catch (err) {
        // cae al respaldo en JavaScript
      }
    }
    return pbkdf2SinWebCrypto(bytes, sal, iteraciones);
  }

  function base64ABytes(texto) {
    const binario = atob(texto);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    return bytes;
  }

  function bytesABase64(bytes) {
    let binario = '';
    for (let i = 0; i < bytes.length; i++) binario += String.fromCharCode(bytes[i]);
    return btoa(binario);
  }

  function igualesEnTiempoConstante(a, b) {
    if (a.length !== b.length) return false;
    let diferencia = 0;
    for (let i = 0; i < a.length; i++) diferencia |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diferencia === 0;
  }

  function aleatorioHex(bytes) {
    const datos = new Uint8Array(bytes);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(datos);
    else for (let i = 0; i < bytes; i++) datos[i] = Math.floor(Math.random() * 256);
    return Array.from(datos, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  // ---- sesion (sessionStorage) --------------------------------------------------
  // Solo se guarda el TOKEN de autorizacion del inventario y su vencimiento, nunca la contrasena.

  let sesionEnMemoria = {}; // respaldo si el navegador no permite sessionStorage

  function leerSesion() {
    try {
      const crudo = sessionStorage.getItem(CLAVE_SESION);
      return crudo ? JSON.parse(crudo) : {};
    } catch (err) {
      return sesionEnMemoria;
    }
  }

  function escribirSesion(datos) {
    sesionEnMemoria = datos;
    try {
      sessionStorage.setItem(CLAVE_SESION, JSON.stringify(datos));
    } catch (err) {
      // se queda en memoria
    }
  }

  function getToken(scope) {
    const entrada = leerSesion()[scope];
    if (!entrada || !entrada.token) return null;
    if (!(entrada.exp > Date.now())) {
      cerrarSesion(scope);
      return null;
    }
    return entrada.token;
  }

  function inventarioAutorizado() {
    return !!getToken('inventario');
  }

  function resumenAutorizado() {
    return !!getToken('resumen');
  }

  function cerrarSesion(scope = 'inventario') {
    const datos = { ...leerSesion() };
    delete datos[scope];
    escribirSesion(datos);
  }

  // ---- tokens del modo local (viven solo en memoria) -------------------------------

  const tokensLocales = new Map();

  function emitirTokenLocal(scope, ventaId) {
    const token = `local.${scope}.${ventaId == null ? 0 : ventaId}.${aleatorioHex(12)}`;
    const exp = Date.now() + DURACION_LOCAL_MS[scope];
    tokensLocales.set(token, { scope, ventaId: ventaId == null ? null : String(ventaId), exp });
    return { token, exp };
  }

  function validarTokenLocal(scope, token, ventaId) {
    const registro = tokensLocales.get(token);
    if (!registro || registro.scope !== scope || !(registro.exp > Date.now())) return false;
    return registro.ventaId === null || registro.ventaId === String(ventaId);
  }

  // ---- verificacion -------------------------------------------------------------------

  const MAX_FALLOS_LOCALES = 5;
  const BLOQUEO_LOCAL_MS = 30 * 1000;
  let fallosLocales = 0;
  let bloqueadoLocalHasta = 0;

  async function verificarLocal(scope, password, ventaId) {
    const config = typeof window !== 'undefined' ? window.SECURITY_CONFIG : null;
    const credencial = config && config.credenciales && config.credenciales[scope];
    if (!credencial) {
      return {
        ok: false,
        codigo: 'AUTH_NO_CONFIGURADA',
        mensaje: 'La seguridad no está configurada en este dispositivo. Ejecuta "npm run security:local" y vuelve a cargar la app.',
      };
    }

    const espera = bloqueadoLocalHasta - Date.now();
    if (espera > 0) {
      return { ok: false, codigo: 'AUTH_BLOQUEADO', mensaje: `Demasiados intentos fallidos. Espera ${Math.ceil(espera / 1000)} segundos.` };
    }

    const derivada = await derivarClave(password, base64ABytes(credencial.sal), config.iteraciones);
    if (!igualesEnTiempoConstante(bytesABase64(derivada), credencial.hash)) {
      fallosLocales += 1;
      if (fallosLocales >= MAX_FALLOS_LOCALES) {
        fallosLocales = 0;
        bloqueadoLocalHasta = Date.now() + BLOQUEO_LOCAL_MS;
      }
      return { ok: false, codigo: 'AUTH_PASSWORD_INCORRECTA', mensaje: 'Contraseña incorrecta.' };
    }

    fallosLocales = 0;
    const { token, exp } = emitirTokenLocal(scope, ventaId);
    return { ok: true, token, exp, modo: 'local' };
  }

  async function verificar(scope, password, ventaId) {
    const conBackend = await Storage.detectarBackend(true);
    if (!conBackend) return verificarLocal(scope, password, ventaId);

    const respuesta = await Storage.autenticar(scope, password, ventaId);
    if (!respuesta.ok) return { ok: false, codigo: respuesta.codigo, mensaje: respuesta.mensaje };
    return { ok: true, token: respuesta.token, exp: Date.parse(respuesta.expiraEn), modo: 'api' };
  }

  // ---- modal de contrasena ----------------------------------------------------------------

  let pendiente = null; // { resolve, scope, ventaId, ocupado }

  function elemento(id) {
    return document.getElementById(id);
  }

  function mostrarError(mensaje) {
    const caja = elemento('password-error');
    caja.textContent = mensaje || '';
    caja.hidden = !mensaje;
    elemento('password-input').classList.toggle('campo-invalido', !!mensaje);
  }

  function establecerVisibilidad(visible) {
    const campo = elemento('password-input');
    const boton = elemento('password-ver');
    campo.type = visible ? 'text' : 'password';
    boton.setAttribute('aria-pressed', visible ? 'true' : 'false');
    boton.setAttribute('aria-label', visible ? 'Ocultar contraseña' : 'Mostrar contraseña');
    boton.textContent = visible ? '🙈' : '👁';
  }

  function liberarPendiente(resultado) {
    const actual = pendiente;
    pendiente = null;
    if (actual) actual.resolve(resultado);
  }

  /**
   * Abre el modal y devuelve una promesa:
   *   { ok: true, token, exp, modo }  si la contrasena fue correcta
   *   null                            si la persona cancela (boton, fondo o Escape)
   */
  function solicitar(scope, opciones = {}) {
    return new Promise((resolve) => {
      if (pendiente) liberarPendiente(null);

      const textos = TEXTOS[scope];
      pendiente = { resolve, scope, ventaId: opciones.ventaId == null ? null : opciones.ventaId, ocupado: false };

      elemento('password-titulo').textContent = textos.titulo;
      elemento('password-subtitulo').textContent = textos.subtitulo;
      elemento('password-etiqueta').textContent = textos.etiqueta;
      elemento('password-enviar').textContent = textos.boton;
      elemento('password-enviar').disabled = false;
      elemento('password-input').value = '';
      mostrarError('');
      establecerVisibilidad(false);

      UI.abrirModal('modal-password');
    });
  }

  async function enviarFormulario(evento) {
    evento.preventDefault();
    if (!pendiente || pendiente.ocupado) return;

    const actual = pendiente;
    const password = elemento('password-input').value;
    if (!password) {
      mostrarError('Ingresa la contraseña.');
      return;
    }

    actual.ocupado = true;
    const boton = elemento('password-enviar');
    const textoBoton = boton.textContent;
    boton.disabled = true;
    boton.textContent = 'Verificando...';
    mostrarError('');

    try {
      const resultado = await verificar(actual.scope, password, actual.ventaId);
      if (pendiente !== actual) return; // se cancelo mientras se verificaba

      if (resultado.ok) {
        if (actual.scope === 'inventario' || actual.scope === 'resumen') {
          escribirSesion({ ...leerSesion(), [actual.scope]: { token: resultado.token, exp: resultado.exp } });
        }
        elemento('password-input').value = '';
        pendiente = null;
        UI.cerrarModal('modal-password');
        actual.resolve(resultado);
        return;
      }

      mostrarError(resultado.mensaje || 'Contraseña incorrecta.');
      elemento('password-input').select();
    } catch (err) {
      if (pendiente === actual) mostrarError(err.message || 'No se pudo verificar la contraseña.');
    } finally {
      actual.ocupado = false;
      if (pendiente === actual) {
        boton.disabled = false;
        boton.textContent = textoBoton;
      }
    }
  }

  function inicializar() {
    elemento('form-password').addEventListener('submit', enviarFormulario);
    elemento('password-ver').addEventListener('click', () => {
      establecerVisibilidad(elemento('password-input').type === 'password');
      elemento('password-input').focus();
    });
    elemento('password-cancelar').addEventListener('click', () => UI.cerrarModal('modal-password'));
    elemento('password-input').addEventListener('input', () => mostrarError(''));

    // Cerrar por fondo / Escape / boton equivale a cancelar.
    elemento('modal-password').addEventListener('modal:cerrado', () => {
      elemento('password-input').value = '';
      liberarPendiente(null);
    });
  }

  /** Atajo: devuelve true si el inventario ya esta autorizado o si la persona acaba de autorizarlo. */
  async function asegurarInventario() {
    if (inventarioAutorizado()) return true;
    const resultado = await solicitar('inventario');
    return !!(resultado && resultado.ok);
  }

  async function asegurarResumen() {
    if (resumenAutorizado()) return true;
    const resultado = await solicitar('resumen');
    return !!(resultado && resultado.ok);
  }

  return {
    inicializar,
    solicitar,
    asegurarInventario,
    inventarioAutorizado,
    asegurarResumen,
    resumenAutorizado,
    getToken,
    cerrarSesion,
    validarTokenLocal,
    // expuesto solo para pruebas automaticas
    _interno: { pbkdf2SinWebCrypto, derivarClave, sha256, hmacSha256, verificarLocal },
  };
})();
