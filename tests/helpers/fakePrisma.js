/**
 * fakePrisma.js
 * Base de datos EN MEMORIA que imita solo lo que usan los controladores (categoria, producto,
 * venta, ventaItem y $transaction con rollback). Sirve para probar rutas, autorizacion y reglas de
 * inventario sin necesitar PostgreSQL. NO reemplaza probar contra la base real (tests/api.test.js).
 */
let contador = 0;
const nuevoId = (prefijo) => `${prefijo}-${++contador}`;

function crearFakePrisma() {
  let estado = { categorias: [], productos: [], ventas: [], items: [], siguienteVenta: 1 };
  const copia = (x) => JSON.parse(JSON.stringify(x), (k, v) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT.*Z$/.test(v) ? new Date(v) : v));

  const conCategoria = (p, include) => (include && include.categoria ? { ...p, categoria: estado.categorias.find((c) => c.id === p.categoriaId) } : { ...p });
  const conItems = (v, include) => (include && include.items ? { ...v, items: estado.items.filter((i) => i.ventaId === v.id).map((i) => ({ ...i })) } : { ...v });

  function aplicarStock(producto, valor) {
    if (typeof valor === 'number') return valor;
    if (valor && valor.decrement !== undefined) return producto.stock - valor.decrement;
    if (valor && valor.increment !== undefined) return producto.stock + valor.increment;
    return producto.stock;
  }

  function actualizarProducto(p, data) {
    if (data.stock !== undefined) p.stock = aplicarStock(p, data.stock);
    for (const campo of ['nombre', 'precio', 'categoriaId', 'activo']) if (data[campo] !== undefined) p[campo] = data[campo];
    p.updatedAt = new Date();
  }

  function crearItems(ventaId, lista) {
    for (const it of lista) estado.items.push({ id: nuevoId('item'), ventaId, createdAt: new Date(), ...it });
  }

  const api = {
    categoria: {
      async findMany() { return copia(estado.categorias).sort((a, b) => a.nombre.localeCompare(b.nombre)); },
      async create({ data }) {
        if (estado.categorias.some((c) => c.nombre === data.nombre)) { const e = new Error('Unique'); e.code = 'P2002'; throw e; }
        const c = { id: nuevoId('cat'), nombre: data.nombre, createdAt: new Date(), updatedAt: new Date() };
        estado.categorias.push(c); return { ...c };
      },
      async findUnique({ where, include }) {
        const c = estado.categorias.find((x) => (where.id ? x.id === where.id : x.nombre === where.nombre));
        if (!c) return null;
        return include && include._count ? { ...c, _count: { productos: estado.productos.filter((p) => p.categoriaId === c.id).length } } : { ...c };
      },
      async findFirst({ where }) { const c = estado.categorias.find((x) => x.nombre === where.nombre); return c ? { ...c } : null; },
      async delete({ where }) { estado.categorias = estado.categorias.filter((c) => c.id !== where.id); return {}; },
    },
    producto: {
      async findMany({ where = {}, include } = {}) {
        let lista = estado.productos;
        if (where.activo !== undefined) lista = lista.filter((p) => p.activo === where.activo);
        if (where.id && where.id.in) lista = lista.filter((p) => where.id.in.includes(p.id));
        return lista.map((p) => conCategoria(p, include));
      },
      async findUnique({ where, include }) { const p = estado.productos.find((x) => x.id === where.id); return p ? conCategoria(p, include) : null; },
      async findFirst({ where, include }) {
        const p = estado.productos.find((x) => x.nombre === where.nombre && x.categoriaId === where.categoriaId && (where.activo === undefined || x.activo === where.activo));
        return p ? conCategoria(p, include) : null;
      },
      async create({ data, include }) {
        const p = { id: nuevoId('prod'), activo: true, createdAt: new Date(), updatedAt: new Date(), ...data };
        estado.productos.push(p); return conCategoria(p, include);
      },
      async update({ where, data, include }) {
        const p = estado.productos.find((x) => x.id === where.id);
        if (!p) { const e = new Error('No encontrado'); e.code = 'P2025'; throw e; }
        actualizarProducto(p, data); return conCategoria(p, include);
      },
      async updateMany({ where, data }) {
        const objetivo = estado.productos.filter((p) => p.id === where.id && (!where.stock || where.stock.gte === undefined || p.stock >= where.stock.gte));
        objetivo.forEach((p) => actualizarProducto(p, data));
        return { count: objetivo.length };
      },
    },
    venta: {
      async findMany({ include } = {}) { return [...estado.ventas].sort((a, b) => b.fecha - a.fecha).map((v) => conItems(v, include)); },
      async findUnique({ where, include }) { const v = estado.ventas.find((x) => x.id === where.id); return v ? conItems(v, include) : null; },
      async create({ data, include }) {
        const v = { id: estado.siguienteVenta++, fecha: data.fecha || new Date(), total: data.total, createdAt: new Date(), modificadaAt: null };
        estado.ventas.push(v);
        crearItems(v.id, (data.items && data.items.create) || []);
        return conItems(v, include);
      },
      async update({ where, data, include }) {
        const v = estado.ventas.find((x) => x.id === where.id);
        if (!v) { const e = new Error('No encontrada'); e.code = 'P2025'; throw e; }
        if (data.total !== undefined) v.total = data.total;
        if (data.modificadaAt !== undefined) v.modificadaAt = data.modificadaAt;
        if (data.items && data.items.create) crearItems(v.id, data.items.create);
        return conItems(v, include);
      },
      async delete({ where }) {
        estado.ventas = estado.ventas.filter((v) => v.id !== where.id);
        estado.items = estado.items.filter((i) => i.ventaId !== where.id); // cascada
        return {};
      },
    },
    ventaItem: {
      async deleteMany({ where }) {
        const antes = estado.items.length;
        estado.items = estado.items.filter((i) => i.ventaId !== where.ventaId);
        return { count: antes - estado.items.length };
      },
    },
    async $transaction(fn) {
      const respaldo = copia(estado);
      try { return await fn(api); } catch (err) { estado = respaldo; throw err; }
    },

    // ---- ayudas para pruebas ----
    __reset() { estado = { categorias: [], productos: [], ventas: [], items: [], siguienteVenta: 1 }; },
    __estado() { return estado; },
    __sembrarBasico({ fechaVenta } = {}) {
      const cat = { id: 'cat-x', nombre: 'Lubricantes', createdAt: new Date(), updatedAt: new Date() };
      estado.categorias = [cat];
      estado.productos = [
        { id: 'p-aceite', nombre: 'Aceite 20W50', categoriaId: cat.id, precio: 250, stock: 10, activo: true, createdAt: new Date(), updatedAt: new Date() },
        { id: 'p-cadena', nombre: 'Cadena 428', categoriaId: cat.id, precio: 400, stock: 3, activo: true, createdAt: new Date(), updatedAt: new Date() },
        { id: 'p-bujia', nombre: 'Bujía NGK', categoriaId: cat.id, precio: 90, stock: 50, activo: true, createdAt: new Date(), updatedAt: new Date() },
      ];
      // venta de ejemplo: 2 aceites + 1 cadena + 1 producto rapido = 500 + 400 + 60
      estado.ventas = [{ id: 1, fecha: fechaVenta || new Date(), total: 960, createdAt: new Date(), modificadaAt: null }];
      estado.items = [
        { id: 'i1', ventaId: 1, productoId: 'p-aceite', nombre: 'Aceite 20W50', cantidad: 2, precioUnitario: 250, subtotal: 500, esRapido: false, createdAt: new Date() },
        { id: 'i2', ventaId: 1, productoId: 'p-cadena', nombre: 'Cadena 428', cantidad: 1, precioUnitario: 400, subtotal: 400, esRapido: false, createdAt: new Date() },
        { id: 'i3', ventaId: 1, productoId: null, nombre: 'Tornillo suelto', cantidad: 3, precioUnitario: 20, subtotal: 60, esRapido: true, createdAt: new Date() },
      ];
      estado.siguienteVenta = 2;
      // el stock ya refleja lo vendido (10 y 3 quedaron DESPUES de la venta)
    },
  };
  return api;
}

module.exports = { crearFakePrisma };
