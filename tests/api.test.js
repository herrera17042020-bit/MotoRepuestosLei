const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

// Estas pruebas usan la base de datos REAL (PostgreSQL). Como crear/modificar/eliminar
// productos y categorias exige autorizacion, primero se obtiene un token del inventario.
require('dotenv').config();
process.env.INVENTARIO_PASSWORD = process.env.INVENTARIO_PASSWORD || 'clave-de-prueba-inventario';
const app = require('../server/app');

let tokenInventario = null;
async function autorizado() {
  if (!tokenInventario) {
    const res = await request(app)
      .post('/api/auth/verificar')
      .send({ scope: 'inventario', password: process.env.INVENTARIO_PASSWORD });
    assert.equal(res.status, 200);
    tokenInventario = res.body.token;
  }
  return tokenInventario;
}

test('GET /api/health responds ok', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

test('GET /api/productos returns an array', async () => {
  const res = await request(app).get('/api/productos');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
});

test('GET /api/categorias returns an array', async () => {
  const res = await request(app).get('/api/categorias');
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
});

test('DELETE /api/categorias/:nombre removes an empty category', async () => {
  const nombre = `Categoría prueba ${Date.now()}`;
  const creada = await request(app).post('/api/categorias').set('X-Auth-Token', await autorizado()).send({ nombre });
  assert.equal(creada.status, 201);

  const eliminada = await request(app).delete(`/api/categorias/${encodeURIComponent(nombre)}`).set('X-Auth-Token', await autorizado());
  assert.equal(eliminada.status, 204);
});

test('DELETE /api/categorias/:nombre rejects categories with products', async () => {
  const categoria = `Categoría con producto ${Date.now()}`;
  const producto = await request(app)
    .post('/api/productos')
    .set('X-Auth-Token', await autorizado())
    .send({ nombre: `Producto categoría ${Date.now()}`, categoria, precio: 10, stock: 1 });

  assert.equal(producto.status, 201);
  const eliminada = await request(app).delete(`/api/categorias/${encodeURIComponent(categoria)}`).set('X-Auth-Token', await autorizado());
  assert.equal(eliminada.status, 409);
});

test('POST /api/productos adds stock to an existing product instead of duplicating it', async () => {
  const categoria = 'Limpieza';
  const nombre = `Jabón prueba ${Date.now()}`;

  const first = await request(app)
    .post('/api/productos')
    .set('X-Auth-Token', await autorizado())
    .send({ nombre, categoria, precio: 100, stock: 2 });

  const second = await request(app)
    .post('/api/productos')
    .set('X-Auth-Token', await autorizado())
    .send({ nombre, categoria, precio: 100, stock: 3 });

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);

  const listado = await request(app).get('/api/productos');
  const jabon = listado.body.filter((p) => p.nombre === nombre);

  assert.equal(jabon.length, 1);
  assert.equal(jabon[0].stock, 5);
});
