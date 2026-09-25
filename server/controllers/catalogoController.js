const prisma = require('../services/prisma');
const { AppError } = require('../middlewares/errorHandler');

function normalizarDecimal(valor) {
  return Math.round(Number(valor) || 0);
}

async function getCategorias(req, res, next) {
  try {
    const categorias = await prisma.categoria.findMany({
      orderBy: { nombre: 'asc' },
    });
    res.json(categorias.map((categoria) => categoria.nombre));
  } catch (err) {
    next(err);
  }
}

async function crearCategoria(req, res, next) {
  try {
    const nombre = (req.body.nombre || '').trim();
    if (!nombre) throw new AppError('El nombre de la categoría es obligatorio.', 400);

    const categoria = await prisma.categoria.create({
      data: { nombre },
    });

    res.status(201).json(categoria.nombre);
  } catch (err) {
    next(err);
  }
}

async function eliminarCategoria(req, res, next) {
  try {
    const nombre = (req.params.nombre || '').trim();
    const categoria = await prisma.categoria.findUnique({
      where: { nombre },
      include: { _count: { select: { productos: true } } },
    });

    if (!categoria) throw new AppError('Categoría no encontrada.', 404);
    if (categoria._count.productos > 0) {
      throw new AppError('No se puede eliminar una categoría que tiene productos asociados.', 409);
    }

    await prisma.categoria.delete({ where: { id: categoria.id } });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

async function getProductos(req, res, next) {
  try {
    const productos = await prisma.producto.findMany({
      where: { activo: true },
      include: { categoria: true },
      orderBy: [{ categoria: { nombre: 'asc' } }, { nombre: 'asc' }],
    });

    const resultado = productos.map((producto) => ({
      id: producto.id,
      nombre: producto.nombre,
      categoria: producto.categoria.nombre,
      precio: normalizarDecimal(producto.precio),
      stock: producto.stock,
      estado: producto.stock <= 0 ? 'agotado' : producto.stock <= 10 ? 'poco_stock' : 'disponible',
      activo: producto.activo,
      createdAt: producto.createdAt,
      updatedAt: producto.updatedAt,
    }));

    res.json(resultado);
  } catch (err) {
    next(err);
  }
}

async function getProductoPorId(req, res, next) {
  try {
    const producto = await prisma.producto.findUnique({
      where: { id: req.params.id },
      include: { categoria: true },
    });

    if (!producto) throw new AppError('Producto no encontrado.', 404);

    res.json({
      id: producto.id,
      nombre: producto.nombre,
      categoria: producto.categoria.nombre,
      precio: normalizarDecimal(producto.precio),
      stock: producto.stock,
      estado: producto.stock <= 0 ? 'agotado' : producto.stock <= 10 ? 'poco_stock' : 'disponible',
    });
  } catch (err) {
    next(err);
  }
}

async function crearProducto(req, res, next) {
  try {
    const { nombre, categoria, precio, stock } = req.body;
    if (!nombre || !categoria) throw new AppError('Nombre y categoría son obligatorios.', 400);

    const nombreLimpio = nombre.trim();
    const stockNum = Math.max(0, Number(stock) || 0);
    const precioNum = Math.max(0, normalizarDecimal(precio));

    let categoriaDb = await prisma.categoria.findFirst({ where: { nombre: categoria } });
    if (!categoriaDb) {
      categoriaDb = await prisma.categoria.create({
        data: { nombre: categoria.trim() },
      });
    }

    const productoExistente = await prisma.producto.findFirst({
      where: {
        nombre: nombreLimpio,
        categoriaId: categoriaDb.id,
        activo: true,
      },
      include: { categoria: true },
    });

    if (productoExistente) {
      const stockNuevo = productoExistente.stock + (Number.isInteger(stockNum) ? stockNum : Math.round(stockNum));
      const productoActualizado = await prisma.producto.update({
        where: { id: productoExistente.id },
        data: {
          stock: stockNuevo,
          precio: precioNum,
        },
        include: { categoria: true },
      });

      return res.status(201).json({
        id: productoActualizado.id,
        nombre: productoActualizado.nombre,
        categoria: productoActualizado.categoria.nombre,
        precio: normalizarDecimal(productoActualizado.precio),
        stock: productoActualizado.stock,
        merged: true,
      });
    }

    const producto = await prisma.producto.create({
      data: {
        nombre: nombreLimpio,
        categoriaId: categoriaDb.id,
        precio: precioNum,
        stock: Number.isInteger(stockNum) ? stockNum : Math.round(stockNum),
      },
      include: { categoria: true },
    });

    res.status(201).json({
      id: producto.id,
      nombre: producto.nombre,
      categoria: producto.categoria.nombre,
      precio: normalizarDecimal(producto.precio),
      stock: producto.stock,
      merged: false,
    });
  } catch (err) {
    next(err);
  }
}

async function actualizarProducto(req, res, next) {
  try {
    const { nombre, categoria, precio, stock } = req.body;

    const productoActual = await prisma.producto.findUnique({ where: { id: req.params.id } });
    if (!productoActual) throw new AppError('Producto no encontrado.', 404);

    const data = {};
    if (nombre) data.nombre = nombre.trim();
    if (precio !== undefined) data.precio = normalizarDecimal(precio);
    if (stock !== undefined) data.stock = Math.max(0, Number(stock) || 0);

    if (categoria) {
      const categoriaDb = await prisma.categoria.findFirst({ where: { nombre: categoria } });
      if (!categoriaDb) throw new AppError('La categoría indicada no existe.', 404);
      data.categoriaId = categoriaDb.id;
    }

    const producto = await prisma.producto.update({
      where: { id: req.params.id },
      data,
      include: { categoria: true },
    });

    res.json({
      id: producto.id,
      nombre: producto.nombre,
      categoria: producto.categoria.nombre,
      precio: normalizarDecimal(producto.precio),
      stock: producto.stock,
    });
  } catch (err) {
    next(err);
  }
}

async function eliminarProducto(req, res, next) {
  try {
    await prisma.producto.update({
      where: { id: req.params.id },
      data: { activo: false },
    });
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getCategorias,
  crearCategoria,
  eliminarCategoria,
  getProductos,
  getProductoPorId,
  crearProducto,
  actualizarProducto,
  eliminarProducto,
};
