const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../public/js/ventas-logica');

const ZONA = 'America/Managua'; // UTC-6 todo el año

test('dia actual: respeta la zona horaria del negocio, no la del servidor', () => {
  const ahora = new Date('2026-09-21T06:01:00Z'); // 00:01 del 21 en Managua
  assert.equal(L.esDelDiaActual('2026-09-21T05:59:00Z', { ahora, zonaHoraria: ZONA }), false); // 23:59 del 20
  assert.equal(L.esDelDiaActual('2026-09-21T06:00:00Z', { ahora, zonaHoraria: ZONA }), true);
  assert.equal(L.esDelDiaActual('2026-09-22T05:00:00Z', { ahora, zonaHoraria: ZONA }), true); // 23:00 del 21
  assert.equal(L.esDelDiaActual('fecha-rota', { ahora, zonaHoraria: ZONA }), false);
});

test('planificarEdicion: reglas de precio, stock y total', () => {
  const original = {
    items: [
      { productoId: 'a', nombre: 'A', cantidad: 2, precioUnitario: 10, esRapido: false },
      { productoId: null, nombre: 'Rapido', cantidad: 1, precioUnitario: 5, esRapido: true },
    ],
  };
  const productos = { a: { id: 'a', nombre: 'A', precio: 99, stock: 3, activo: true }, b: { id: 'b', nombre: 'B', precio: 7, stock: 1, activo: true } };
  const obtener = (id) => productos[id];

  const plan = L.planificarEdicion({
    original,
    obtenerProducto: obtener,
    nuevos: [
      { productoId: 'a', cantidad: 5, precioUnitario: 1 }, // +3, hay 3 => alcanza justo
      { productoId: 'b', cantidad: 1 },
      { nombre: 'Rapido', cantidad: 2, precioUnitario: 5, esRapido: true },
    ],
  });
  assert.equal(plan.items[0].precioUnitario, 10); // conserva el precio original de la venta
  assert.equal(plan.items[1].precioUnitario, 7); // producto nuevo: precio del inventario
  assert.equal(plan.total, 50 + 7 + 10);
  assert.deepEqual(plan.ajustesStock.map((a) => [a.productoId, a.delta]).sort(), [['a', -3], ['b', -1]]);

  assert.throws(() => L.planificarEdicion({ original, obtenerProducto: obtener, nuevos: [{ productoId: 'a', cantidad: 6 }] }), /No hay suficiente inventario/);
  assert.throws(() => L.planificarEdicion({ original, obtenerProducto: obtener, nuevos: [{ productoId: 'b', cantidad: 2 }] }), /No hay suficiente inventario/);
  assert.throws(() => L.planificarEdicion({ original, obtenerProducto: obtener, nuevos: [{ productoId: 'a', cantidad: -1 }] }), /mayor a cero/);
  assert.throws(() => L.planificarEdicion({ original, obtenerProducto: obtener, nuevos: [{ productoId: 'a', cantidad: 1.2 }] }), /entero/);
  assert.throws(() => L.planificarEdicion({ original, obtenerProducto: obtener, nuevos: [] }), /al menos un producto/);
  assert.throws(() => L.planificarEdicion({ original, obtenerProducto: obtener, nuevos: [{ nombre: 'X', cantidad: 1, precioUnitario: 0, esRapido: true }] }), /precio/);
});

test('planificarEliminacion: devuelve solo productos registrados', () => {
  const plan = L.planificarEliminacion({
    items: [
      { productoId: 'a', cantidad: 2, esRapido: false },
      { productoId: 'a', cantidad: 3, esRapido: false },
      { productoId: null, cantidad: 9, esRapido: true },
    ],
  });
  assert.deepEqual(plan.ajustesStock, [{ productoId: 'a', delta: 5 }]);
});
