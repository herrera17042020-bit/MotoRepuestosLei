/**
 * Pruebas de seguridad y de ventas SIN base de datos: usan una base en memoria (helpers/fakePrisma)
 * inyectada en lugar de Prisma. Cubren contrasenas, tokens, proteccion de rutas, modificar/eliminar
 * ventas del dia y ajuste de inventario.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const request = require('supertest');
const { crearFakePrisma } = require('./helpers/fakePrisma');

// Contrasenas SOLO para estas pruebas (no son las de la tienda)
process.env.INVENTARIO_PASSWORD = 'inv-prueba-1';
process.env.RESUMEN_PASSWORD = 'res-prueba-2';
process.env.VENTAS_MODIFICAR_PASSWORD = 'mod-prueba-3';
process.env.VENTAS_ELIMINAR_PASSWORD = 'del-prueba-4';
process.env.AUTH_SECRET = 'secreto-de-pruebas';
process.env.APP_TIMEZONE = 'America/Managua';

const fake = crearFakePrisma();
const rutaPrisma = require.resolve('../server/services/prisma');
require.cache[rutaPrisma] = { id: rutaPrisma, filename: rutaPrisma, loaded: true, exports: fake };

const app = require('../server/app');
const seguridad = require('../server/services/seguridad');

const haceDias = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

async function token(scope, ventaId) {
  const password = { inventario: 'inv-prueba-1', resumen: 'res-prueba-2', ventas_modificar: 'mod-prueba-3', ventas_eliminar: 'del-prueba-4' }[scope];
  const res = await request(app).post('/api/auth/verificar').send({ scope, password, ventaId });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.token;
}

const stock = (id) => fake.__estado().productos.find((p) => p.id === id).stock;

test.beforeEach(() => {
  fake.__reset();
  fake.__sembrarBasico();
  seguridad.reiniciarLimitador();
});

// ---------------------------------------------------------------------------
// AUTENTICACION
// ---------------------------------------------------------------------------

test('auth: contrasena correcta devuelve token; incorrecta se rechaza', async () => {
  const bien = await request(app).post('/api/auth/verificar').send({ scope: 'inventario', password: 'inv-prueba-1' });
  assert.equal(bien.status, 200);
  assert.ok(bien.body.token);
  assert.equal(bien.body.scope, 'inventario');
  assert.equal(JSON.stringify(bien.body).includes('inv-prueba-1'), false);

  const mal = await request(app).post('/api/auth/verificar').send({ scope: 'inventario', password: 'otra' });
  assert.equal(mal.status, 401);
  assert.equal(mal.body.codigo, 'AUTH_PASSWORD_INCORRECTA');
  assert.equal(mal.body.error, 'Contraseña incorrecta.');
});

test('auth: el resumen usa una contrasena y un alcance independientes', async () => {
  const resumen = await request(app).post('/api/auth/verificar').send({ scope: 'resumen', password: 'res-prueba-2' });
  assert.equal(resumen.status, 200);
  assert.equal(resumen.body.scope, 'resumen');

  const inventario = await request(app).post('/api/auth/verificar').send({ scope: 'resumen', password: 'inv-prueba-1' });
  assert.equal(inventario.status, 401);
});

test('auth: las tres contrasenas son independientes entre si', async () => {
  const cruzada = await request(app).post('/api/auth/verificar').send({ scope: 'ventas_eliminar', ventaId: 1, password: 'mod-prueba-2' });
  assert.equal(cruzada.status, 401);
  const cruzada2 = await request(app).post('/api/auth/verificar').send({ scope: 'ventas_modificar', ventaId: 1, password: 'inv-prueba-1' });
  assert.equal(cruzada2.status, 401);
});

test('auth: alcance invalido, contrasena vacia o de otro tipo, y venta faltante', async () => {
  assert.equal((await request(app).post('/api/auth/verificar').send({ scope: 'admin', password: 'x' })).status, 400);
  assert.equal((await request(app).post('/api/auth/verificar').send({ scope: 'inventario' })).status, 401);
  assert.equal((await request(app).post('/api/auth/verificar').send({ scope: 'inventario', password: { $ne: 1 } })).status, 401);
  const sinVenta = await request(app).post('/api/auth/verificar').send({ scope: 'ventas_modificar', password: 'mod-prueba-2' });
  assert.equal(sinVenta.status, 400);
  assert.equal(sinVenta.body.codigo, 'AUTH_VENTA_REQUERIDA');
});

test('auth: si la contrasena no esta configurada en el servidor, la accion queda bloqueada', async () => {
  const original = process.env.INVENTARIO_PASSWORD;
  process.env.INVENTARIO_PASSWORD = '';
  try {
    const res = await request(app).post('/api/auth/verificar').send({ scope: 'inventario', password: '' });
    assert.equal(res.status, 503);
    assert.equal(res.body.codigo, 'AUTH_NO_CONFIGURADA');
    assert.match(res.body.error, /INVENTARIO_PASSWORD/);
  } finally {
    process.env.INVENTARIO_PASSWORD = original;
  }
});

test('auth: tras 5 intentos fallidos se bloquea, incluso con la contrasena correcta', async () => {
  for (let i = 0; i < 5; i++) {
    const res = await request(app).post('/api/auth/verificar').send({ scope: 'inventario', password: `mala${i}` });
    assert.equal(res.status, 401);
  }
  const bloqueado = await request(app).post('/api/auth/verificar').send({ scope: 'inventario', password: 'inv-prueba-1' });
  assert.equal(bloqueado.status, 429);
  assert.equal(bloqueado.body.codigo, 'AUTH_BLOQUEADO');
});

test('tokens: firma alterada, alcance equivocado y vencimiento se rechazan', () => {
  const { token: t } = seguridad.emitirToken('inventario');
  assert.equal(seguridad.validarToken(t, 'inventario').ok, true);
  assert.equal(seguridad.validarToken(t, 'ventas_modificar', 1).ok, false);

  const [cuerpo, firma] = t.split('.');
  const alterado = `${cuerpo}.${firma.slice(0, -2)}xx`;
  assert.equal(seguridad.validarToken(alterado, 'inventario').ok, false);

  const otroCuerpo = Buffer.from(JSON.stringify({ s: 'inventario', v: null, e: Date.now() + 999999999 })).toString('base64url');
  assert.equal(seguridad.validarToken(`${otroCuerpo}.${firma}`, 'inventario').ok, false);

  const viejo = seguridad.emitirToken('inventario', null, Date.now() - 10 * 24 * 3600 * 1000).token;
  const r = seguridad.validarToken(viejo, 'inventario');
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'AUTH_EXPIRADA');
});

// ---------------------------------------------------------------------------
// INVENTARIO PROTEGIDO
// ---------------------------------------------------------------------------

test('inventario: consultar sigue abierto (Nueva venta lo necesita)', async () => {
  assert.equal((await request(app).get('/api/productos')).status, 200);
  assert.equal((await request(app).get('/api/categorias')).status, 200);
});

test('inventario: crear/editar/eliminar productos y categorias exige token de inventario', async () => {
  const nuevo = { nombre: 'Freno', categoria: 'Lubricantes', precio: 100, stock: 4 };

  const sin = await request(app).post('/api/productos').send(nuevo);
  assert.equal(sin.status, 401);
  assert.equal(sin.body.codigo, 'AUTH_REQUERIDA');

  const equivocado = await request(app).post('/api/productos').set('X-Auth-Token', await token('ventas_modificar', 1)).send(nuevo);
  assert.equal(equivocado.status, 401);

  const t = await token('inventario');
  const creado = await request(app).post('/api/productos').set('X-Auth-Token', t).send(nuevo);
  assert.equal(creado.status, 201);

  assert.equal((await request(app).put(`/api/productos/${creado.body.id}`).send({ precio: 1 })).status, 401);
  assert.equal((await request(app).put(`/api/productos/${creado.body.id}`).set('X-Auth-Token', t).send({ precio: 120 })).status, 200);
  assert.equal((await request(app).delete(`/api/productos/${creado.body.id}`)).status, 401);
  assert.equal((await request(app).delete(`/api/productos/${creado.body.id}`).set('X-Auth-Token', t)).status, 204);

  assert.equal((await request(app).post('/api/categorias').send({ nombre: 'Nueva' })).status, 401);
  assert.equal((await request(app).post('/api/categorias').set('X-Auth-Token', t).send({ nombre: 'Nueva' })).status, 201);
  assert.equal((await request(app).delete('/api/categorias/Nueva')).status, 401);
  assert.equal((await request(app).delete('/api/categorias/Nueva').set('X-Auth-Token', t)).status, 204);
});

// ---------------------------------------------------------------------------
// MODIFICAR VENTAS DEL DIA
// ---------------------------------------------------------------------------

const lineasOriginales = () => [
  { productoId: 'p-aceite', nombre: 'Aceite 20W50', cantidad: 2, precioUnitario: 250, esRapido: false },
  { productoId: 'p-cadena', nombre: 'Cadena 428', cantidad: 1, precioUnitario: 400, esRapido: false },
  { productoId: null, nombre: 'Tornillo suelto', cantidad: 3, precioUnitario: 20, esRapido: true },
];

test('modificar: sin token, con token de otra venta o de otro alcance se rechaza', async () => {
  const cuerpo = { items: lineasOriginales() };
  assert.equal((await request(app).put('/api/ventas/1').send(cuerpo)).status, 401);

  const deOtraVenta = await token('ventas_modificar', 2);
  assert.equal((await request(app).put('/api/ventas/1').set('X-Auth-Token', deOtraVenta).send(cuerpo)).status, 401);

  const deInventario = await token('inventario');
  assert.equal((await request(app).put('/api/ventas/1').set('X-Auth-Token', deInventario).send(cuerpo)).status, 401);

  const deEliminar = await token('ventas_eliminar', 1);
  assert.equal((await request(app).put('/api/ventas/1').set('X-Auth-Token', deEliminar).send(cuerpo)).status, 401);

  assert.equal(fake.__estado().ventas[0].total, 960); // nada cambio
});

test('modificar: aumentar cantidad descuenta inventario y recalcula el total (ignora total/subtotal enviados)', async () => {
  const t = await token('ventas_modificar', 1);
  const items = lineasOriginales();
  items[0].cantidad = 5; // +3 aceites
  const res = await request(app)
    .put('/api/ventas/1')
    .set('X-Auth-Token', t)
    .send({ items, total: 1, subtotal: 1 });

  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.total, 5 * 250 + 400 + 60);
  assert.ok(res.body.modificadaAt);
  assert.equal(stock('p-aceite'), 7);
  assert.equal(stock('p-cadena'), 3);
  assert.equal(res.body.items.find((i) => i.productoId === 'p-aceite').subtotal, 1250);
});

test('modificar: reducir o quitar productos devuelve el inventario', async () => {
  const t = await token('ventas_modificar', 1);
  const items = lineasOriginales();
  items[0].cantidad = 1; // -1 aceite
  items.splice(1, 1); // sin cadena (-1 cadena)
  const res = await request(app).put('/api/ventas/1').set('X-Auth-Token', t).send({ items });

  assert.equal(res.status, 200);
  assert.equal(res.body.total, 250 + 60);
  assert.equal(stock('p-aceite'), 11);
  assert.equal(stock('p-cadena'), 4);
  assert.equal(res.body.items.length, 2);
});

test('modificar: agregar un producto nuevo usa el precio real del inventario y descuenta stock', async () => {
  const t = await token('ventas_modificar', 1);
  const items = lineasOriginales();
  items.push({ productoId: 'p-bujia', nombre: 'lo que sea', cantidad: 4, precioUnitario: 1, esRapido: false });
  const res = await request(app).put('/api/ventas/1').set('X-Auth-Token', t).send({ items });

  assert.equal(res.status, 200);
  const bujia = res.body.items.find((i) => i.productoId === 'p-bujia');
  assert.equal(bujia.precioUnitario, 90);
  assert.equal(bujia.nombre, 'Bujía NGK');
  assert.equal(bujia.subtotal, 360);
  assert.equal(res.body.total, 960 + 360);
  assert.equal(stock('p-bujia'), 46);
});

test('modificar: el precio de una linea existente no se puede alterar desde el cliente', async () => {
  const t = await token('ventas_modificar', 1);
  const items = lineasOriginales();
  items[0].precioUnitario = 1;
  items[0].cantidad = 3;
  const res = await request(app).put('/api/ventas/1').set('X-Auth-Token', t).send({ items });
  assert.equal(res.status, 200);
  assert.equal(res.body.items.find((i) => i.productoId === 'p-aceite').precioUnitario, 250);
  assert.equal(res.body.total, 3 * 250 + 400 + 60);
});

test('modificar: no permite pasar del stock disponible y no cambia nada', async () => {
  const t = await token('ventas_modificar', 1);
  const items = lineasOriginales();
  items[1].cantidad = 5; // +4 cadenas pero solo hay 3
  const res = await request(app).put('/api/ventas/1').set('X-Auth-Token', t).send({ items });

  assert.equal(res.status, 400);
  assert.equal(res.body.codigo, 'STOCK_INSUFICIENTE');
  assert.match(res.body.error, /Cadena 428/);
  assert.equal(stock('p-cadena'), 3);
  assert.equal(fake.__estado().ventas[0].total, 960);
  assert.equal(fake.__estado().items.length, 3);
});

test('modificar: cantidades invalidas (cero, negativas, decimales, texto) y venta vacia se rechazan', async () => {
  const t = await token('ventas_modificar', 1);
  for (const cantidad of [0, -1, 1.5, 'abc', null, 1e9]) {
    const items = lineasOriginales();
    items[0].cantidad = cantidad;
    const res = await request(app).put('/api/ventas/1').set('X-Auth-Token', t).send({ items });
    assert.equal(res.status, 400, `cantidad ${cantidad}`);
  }
  assert.equal((await request(app).put('/api/ventas/1').set('X-Auth-Token', t).send({ items: [] })).status, 400);
  assert.equal((await request(app).put('/api/ventas/1').set('X-Auth-Token', t).send({})).status, 400);
  assert.equal(stock('p-aceite'), 10);
  assert.equal(fake.__estado().ventas[0].total, 960);
});

test('modificar: una venta de un dia anterior no se puede modificar (403)', async () => {
  fake.__reset();
  fake.__sembrarBasico({ fechaVenta: haceDias(2) });
  const t = await token('ventas_modificar', 1);
  const items = lineasOriginales();
  items[0].cantidad = 3;
  const res = await request(app).put('/api/ventas/1').set('X-Auth-Token', t).send({ items });
  assert.equal(res.status, 403);
  assert.equal(res.body.codigo, 'VENTA_NO_ES_DE_HOY');
  assert.equal(stock('p-aceite'), 10);
});

test('modificar: venta inexistente y id invalido', async () => {
  const t9 = await token('ventas_modificar', 99);
  assert.equal((await request(app).put('/api/ventas/99').set('X-Auth-Token', t9).send({ items: lineasOriginales() })).status, 404);
  assert.equal((await request(app).put('/api/ventas/abc').set('X-Auth-Token', t9).send({ items: lineasOriginales() })).status, 401);
});

test('modificar: si el stock cambia en medio de la operacion (otro celular), se revierte TODO', async () => {
  const t = await token('ventas_modificar', 1);
  // Simula una lectura desactualizada: el servidor "ve" mas stock del que realmente hay.
  const findManyReal = fake.producto.findMany;
  fake.producto.findMany = async (args) => (await findManyReal(args)).map((p) => ({ ...p, stock: p.stock + 100 }));
  try {
    const items = lineasOriginales();
    items[0].cantidad = 4; // +2 aceites: el plan cree que alcanza
    items[1].cantidad = 5; // +4 cadenas: el stock real (3) NO alcanza
    const res = await request(app).put('/api/ventas/1').set('X-Auth-Token', t).send({ items });
    assert.equal(res.status, 400);
  } finally {
    fake.producto.findMany = findManyReal;
  }
  assert.equal(stock('p-aceite'), 10, 'el descuento del aceite debe revertirse');
  assert.equal(stock('p-cadena'), 3);
  assert.equal(fake.__estado().ventas[0].total, 960);
  assert.equal(fake.__estado().items.length, 3);
});

// ---------------------------------------------------------------------------
// ELIMINAR VENTAS
// ---------------------------------------------------------------------------

test('eliminar: exige su propia contrasena (la de modificar no sirve)', async () => {
  assert.equal((await request(app).delete('/api/ventas/1')).status, 401);
  const conModificar = await token('ventas_modificar', 1);
  assert.equal((await request(app).delete('/api/ventas/1').set('X-Auth-Token', conModificar)).status, 401);
  const deOtraVenta = await token('ventas_eliminar', 2);
  assert.equal((await request(app).delete('/api/ventas/1').set('X-Auth-Token', deOtraVenta)).status, 401);
  assert.equal(fake.__estado().ventas.length, 1);
});

test('eliminar: borra la venta y devuelve al inventario lo vendido (sin tocar productos rapidos)', async () => {
  const t = await token('ventas_eliminar', 1);
  const res = await request(app).delete('/api/ventas/1').set('X-Auth-Token', t);
  assert.equal(res.status, 204);
  assert.equal(stock('p-aceite'), 12);
  assert.equal(stock('p-cadena'), 4);
  assert.equal(fake.__estado().ventas.length, 0);
  assert.equal(fake.__estado().items.length, 0);
  assert.equal((await request(app).get('/api/ventas/1')).status, 404);
});

test('eliminar: una venta de un dia anterior tambien se puede eliminar con su contrasena', async () => {
  fake.__reset();
  fake.__sembrarBasico({ fechaVenta: haceDias(5) });
  const t = await token('ventas_eliminar', 1);
  assert.equal((await request(app).delete('/api/ventas/1').set('X-Auth-Token', t)).status, 204);
  assert.equal(stock('p-aceite'), 12);
});

test('eliminar: venta inexistente responde 404', async () => {
  const t = await token('ventas_eliminar', 42);
  assert.equal((await request(app).delete('/api/ventas/42').set('X-Auth-Token', t)).status, 404);
});

test('historial: la API expone modificadaAt y el total ya corregido', async () => {
  const t = await token('ventas_modificar', 1);
  const items = lineasOriginales();
  items[0].cantidad = 3;
  await request(app).put('/api/ventas/1').set('X-Auth-Token', t).send({ items });

  const lista = await request(app).get('/api/ventas');
  assert.equal(lista.body[0].total, 3 * 250 + 400 + 60);
  assert.ok(lista.body[0].modificadaAt);
});
