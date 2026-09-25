/**
 * Pruebas del MODO LOCAL / OFFLINE del frontend (sin servidor): se ejecuta el codigo real de
 * public/js (Storage, VentasLogica, Security) en un contexto aislado con un localStorage falso.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const RAIZ = path.join(__dirname, '..', 'public', 'js');

const PASSWORDS = { inventario: 'inv-local-1', resumen: 'res-local-2', ventas_modificar: 'mod-local-3', ventas_eliminar: 'del-local-4' };

function construirConfig() {
  const iteraciones = 2000; // bajo solo para que la prueba sea rapida
  const credenciales = {};
  for (const [scope, password] of Object.entries(PASSWORDS)) {
    const sal = crypto.randomBytes(16);
    credenciales[scope] = { sal: sal.toString('base64'), hash: crypto.pbkdf2Sync(password, sal, iteraciones, 32, 'sha256').toString('base64') };
  }
  return { version: 1, algoritmo: 'PBKDF2-SHA256', iteraciones, credenciales };
}

function crearEntorno({ servidorEstatico = true, config = construirConfig() } = {}) {
  const memoria = new Map();
  const almacen = () => ({
    getItem: (k) => (memoria.has(k) ? memoria.get(k) : null),
    setItem: (k, v) => memoria.set(k, String(v)),
    removeItem: (k) => memoria.delete(k),
  });
  const eventos = [];
  const ctx = {
    console, setTimeout, clearTimeout, Date, Math, JSON, Map, Set, Promise, Intl, Uint8Array, Uint32Array, DataView,
    TextEncoder, atob, btoa, AbortController, Error, Number, String, Array, Object, isNaN,
    window: { location: { origin: 'http://localhost:5511' }, SECURITY_CONFIG: config },
    localStorage: almacen(),
    sessionStorage: almacen(),
    document: { dispatchEvent: (e) => eventos.push(e.type) },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
    // un servidor estatico (python http.server, Live Server...) responde HTML 404 a /api/*
    fetch: async () => {
      if (!servidorEstatico) throw new TypeError('Failed to fetch');
      return { ok: false, status: 404, text: async () => '<html><body>404 Not Found</body></html>' };
    },
    crypto: undefined,
  };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  const cargar = (archivo) => vm.runInContext(fs.readFileSync(path.join(RAIZ, archivo), 'utf8'), ctx, { filename: archivo });
  ctx.VentasLogica = require(path.join(RAIZ, 'ventas-logica.js'));
  cargar('storage.js');
  cargar('security.js');
  return {
    Storage: vm.runInContext('Storage', ctx),
    Security: vm.runInContext('Security', ctx),
    ctx,
    eventos,
    leer: (k) => JSON.parse(memoria.get(k)),
  };
}

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

async function autorizar(env, scope, ventaId) {
  const r = await env.Security._interno.verificarLocal(scope, PASSWORDS[scope], ventaId);
  assert.equal(r.ok, true);
  return r.token;
}

test('local: con un servidor estatico los datos del dispositivo NO se borran al sincronizar', async () => {
  const env = crearEntorno();
  env.Storage.sembrarSiNecesario();
  await esperar(80);
  assert.ok(env.Storage.getProductos().length > 0, 'productos conservados');
  assert.ok(env.Storage.getVentas().length > 0, 'ventas conservadas');
  assert.equal(await env.Storage.detectarBackend(true), false);
});

test('local: detectarBackend es falso si no hay conexion', async () => {
  const env = crearEntorno({ servidorEstatico: false });
  assert.equal(await env.Storage.detectarBackend(true), false);
});

test('local: registrar venta guarda la venta y descuenta inventario', async () => {
  const env = crearEntorno();
  env.Storage.sembrarSiNecesario();
  const producto = env.Storage.getProductos().find((p) => p.nombre === 'Bujía');
  const stockAntes = producto.stock;
  const item = {
    productoId: producto.id,
    nombre: producto.nombre,
    cantidad: 2,
    precioUnitario: producto.precio,
    subtotal: producto.precio * 2,
    esRapido: false,
  };

  const venta = await env.Storage.registrarVenta([item]);

  assert.equal(venta.total, producto.precio * 2);
  assert.equal(env.Storage.getVenta(venta.id).items.length, 1);
  assert.equal(env.Storage.getProductos().find((p) => p.id === producto.id).stock, stockAntes - 2);
  assert.deepEqual(env.Storage.getCarrito(), []);
});

test('local: contrasena correcta autoriza, incorrecta no, y se bloquea tras 5 fallos', async () => {
  const env = crearEntorno();
  const { verificarLocal } = env.Security._interno;

  const mala = await verificarLocal('inventario', 'nope', null);
  assert.equal(mala.ok, false);
  assert.equal(mala.mensaje, 'Contraseña incorrecta.');
  assert.equal((await verificarLocal('inventario', PASSWORDS.ventas_eliminar, null)).ok, false);
  assert.equal((await verificarLocal('inventario', PASSWORDS.inventario, null)).ok, true);

  for (let i = 0; i < 5; i++) await verificarLocal('ventas_eliminar', 'x' + i, 1);
  const bloqueado = await verificarLocal('ventas_eliminar', PASSWORDS.ventas_eliminar, 1);
  assert.equal(bloqueado.ok, false);
  assert.equal(bloqueado.codigo, 'AUTH_BLOQUEADO');
});

test('local: sin configuracion generada, la seguridad queda bloqueada (no abre por defecto)', async () => {
  const env = crearEntorno({ config: null });
  const r = await env.Security._interno.verificarLocal('inventario', 'lo-que-sea', null);
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'AUTH_NO_CONFIGURADA');
});

test('local: el archivo de configuracion no contiene contrasenas, solo hashes con sal', () => {
  const config = construirConfig();
  const texto = JSON.stringify(config);
  for (const password of Object.values(PASSWORDS)) assert.equal(texto.includes(password), false);
  assert.equal(new Set(Object.values(config.credenciales).map((c) => c.hash)).size, 4);
  const enRepo = fs.readFileSync(path.join(RAIZ, 'security-config.js'), 'utf8');
  assert.match(enRepo, /window\.SECURITY_CONFIG\s*=\s*\{/);
  assert.doesNotMatch(enRepo, /\b(?:inventario|resumen|ventas_modificar|ventas_eliminar)\s*:\s*['\"]/);
});

test('local: el token de una venta no sirve para otra ni para otro alcance', async () => {
  const env = crearEntorno();
  const t = await autorizar(env, 'ventas_modificar', 1040);
  assert.equal(env.Security.validarTokenLocal('ventas_modificar', t, 1040), true);
  assert.equal(env.Security.validarTokenLocal('ventas_modificar', t, 1041), false);
  assert.equal(env.Security.validarTokenLocal('ventas_eliminar', t, 1040), false);
  assert.equal(env.Security.validarTokenLocal('ventas_modificar', 'inventado', 1040), false);
});

test('local: modificar una venta de hoy ajusta stock, recalcula total y marca modificadaAt', async () => {
  const env = crearEntorno();
  env.Storage.sembrarSiNecesario();
  const S = env.Storage;

  const venta = S.getVenta(1041); // Faro LED x4, Kit de limpieza x12
  const faro = S.getProductos().find((p) => p.nombre === 'Faro LED');
  const kit = S.getProductos().find((p) => p.nombre === 'Kit de limpieza');
  const stockFaro = faro.stock;
  const stockKit = kit.stock;

  const token = await autorizar(env, 'ventas_modificar', 1041);
  const items = venta.items.map((i) => ({ ...i }));
  items[0].cantidad = 10; // +6 faros
  items[1].cantidad = 2; // -10 kits
  const r = await S.modificarVenta(1041, items, token);

  assert.equal(r.total, 10 * 310 + 2 * 70);
  assert.ok(r.modificadaAt);
  assert.equal(S.getProductos().find((p) => p.nombre === 'Faro LED').stock, stockFaro - 6);
  assert.equal(S.getProductos().find((p) => p.nombre === 'Kit de limpieza').stock, stockKit + 10);
  assert.equal(S.getVenta(1041).total, 3240);
});

test('local: modificar rechaza sobrepasar el stock, cantidades invalidas, y no cambia nada', async () => {
  const env = crearEntorno();
  env.Storage.sembrarSiNecesario();
  const S = env.Storage;
  const antes = JSON.stringify(S.getProductos());
  const totalAntes = S.getVenta(1041).total;
  const token = await autorizar(env, 'ventas_modificar', 1041);

  const base = () => S.getVenta(1041).items.map((i) => ({ ...i }));
  let items = base();
  items[0].cantidad = 5000;
  await assert.rejects(() => S.modificarVenta(1041, items, token), /No hay suficiente inventario/);

  for (const cantidad of [0, -3, 2.5, 'x']) {
    items = base();
    items[0].cantidad = cantidad;
    await assert.rejects(() => S.modificarVenta(1041, items, token), Error, `cantidad ${cantidad}`);
  }
  await assert.rejects(() => S.modificarVenta(1041, [], token), /al menos un producto/);

  assert.equal(JSON.stringify(S.getProductos()), antes);
  assert.equal(S.getVenta(1041).total, totalAntes);
});

test('local: una venta de un dia anterior no se puede modificar', async () => {
  const env = crearEntorno();
  env.Storage.sembrarSiNecesario();
  const S = env.Storage;
  assert.equal(S.esVentaDeHoy(S.getVenta(1037)), false);
  assert.equal(S.esVentaDeHoy(S.getVenta(1042)), true);

  const token = await autorizar(env, 'ventas_modificar', 1037);
  await assert.rejects(() => S.modificarVenta(1037, S.getVenta(1037).items, token), /día actual/);
});

test('local: sin autorizacion valida no se modifica ni se elimina nada', async () => {
  const env = crearEntorno();
  env.Storage.sembrarSiNecesario();
  const S = env.Storage;
  await assert.rejects(() => S.modificarVenta(1041, S.getVenta(1041).items, 'token-falso'), /autorización/);
  await assert.rejects(() => S.eliminarVenta(1041, 'token-falso'), /autorización/);
  const tokenModificar = await autorizar(env, 'ventas_modificar', 1041);
  await assert.rejects(() => S.eliminarVenta(1041, tokenModificar), /autorización/); // la de modificar no elimina
  assert.ok(S.getVenta(1041));
});

test('local: eliminar devuelve al inventario lo vendido y saca la venta del historial', async () => {
  const env = crearEntorno();
  env.Storage.sembrarSiNecesario();
  const S = env.Storage;
  const venta = S.getVenta(1037); // una venta anterior tambien se puede eliminar
  const stockAntes = Object.fromEntries(S.getProductos().map((p) => [p.id, p.stock]));
  const cantidadVentas = S.getVentas().length;

  const token = await autorizar(env, 'ventas_eliminar', 1037);
  await S.eliminarVenta(1037, token);

  assert.equal(S.getVenta(1037), null);
  assert.equal(S.getVentas().length, cantidadVentas - 1);
  for (const item of venta.items) {
    assert.equal(S.getProducto(item.productoId).stock, stockAntes[item.productoId] + item.cantidad);
  }
});
