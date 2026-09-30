const prisma = require('../services/prisma');
const { AppError } = require('../middlewares/errorHandler');
const VentasLogica = require('../../public/js/ventas-logica');
const { planificarEdicion, planificarEliminacion, esDelDiaActual } = VentasLogica;

const MAX_PRECIO_CENTAVOS = 9999999999;

function validarPrecio(valor, nombre) {
  if (typeof valor !== 'number' || !Number.isFinite(valor) || valor <= 0) {
    throw new AppError(`El precio de "${nombre}" debe ser un número mayor a cero.`, 400);
  }

  const centavos = Math.round((valor + Number.EPSILON) * 100);
  if (centavos > MAX_PRECIO_CENTAVOS || Math.abs(valor * 100 - centavos) > 0.000001) {
    throw new AppError(`El precio de "${nombre}" debe tener hasta dos decimales y no ser demasiado grande.`, 400);
  }
  return centavos;
}

function validarCantidad(valor, nombre, unidadMedida) {
  try {
    return VentasLogica.validarCantidad(valor, nombre, unidadMedida);
  } catch (err) {
    throw new AppError(err.message, err.status || 400, err.codigo);
  }
}

// Zona horaria del negocio: define cuando empieza y termina "el dia" para decidir
// que ventas todavia se pueden modificar (el servidor puede estar en otra zona).
function zonaHorariaNegocio() {
  return process.env.APP_TIMEZONE || 'America/Managua';
}

// Formato unico de venta que devuelve la API (antes estaba repetido en cada funcion).
function formatearVenta(venta) {
  return {
    id: venta.id,
    fecha: venta.fecha,
    total: Number(venta.total),
    modificadaAt: venta.modificadaAt || null,
    items: venta.items.map((item) => ({
      productoId: item.productoId,
      nombre: item.nombre,
      cantidad: Number(item.cantidad),
      unidadMedida: VentasLogica.normalizarUnidadMedida(item.unidadMedida),
      precioUnitario: Number(item.precioUnitario),
      subtotal: Number(item.subtotal),
      esRapido: item.esRapido,
    })),
  };
}

function parsearIdVenta(valor) {
  const id = Number(valor);
  if (!Number.isInteger(id) || id <= 0) throw new AppError('Identificador de venta no válido.', 400);
  return id;
}

// Registro minimo de acciones sensibles en el log del servidor (quien, cuando, que).
function auditar(accion, req, datos) {
  console.log('[AUDITORIA]', JSON.stringify({ accion, fecha: new Date().toISOString(), ip: req.ip, ...datos }));
}

async function getVentas(req, res, next) {
  try {
    const ventas = await prisma.venta.findMany({
      orderBy: { fecha: 'desc' },
      include: { items: true },
    });

    const resultado = ventas.map(formatearVenta);

    res.json(resultado);
  } catch (err) {
    next(err);
  }
}

async function getVentaPorId(req, res, next) {
  try {
    const venta = await prisma.venta.findUnique({
      where: { id: Number(req.params.id) },
      include: { items: true },
    });

    if (!venta) throw new AppError('Venta no encontrada.', 404);

    res.json(formatearVenta(venta));
  } catch (err) {
    next(err);
  }
}

async function registrarVenta(req, res, next) {
  try {
    const crudos = req.body && req.body.items;
    if (!Array.isArray(crudos) || crudos.length === 0) throw new AppError('El carrito está vacío.', 400);
    if (crudos.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
      throw new AppError('Cada producto de la venta debe ser válido.', 400);
    }

    const venta = await prisma.$transaction(async (tx) => {
      const cantidadesMillesimas = new Map();
      const idsProductos = new Set();
      const items = crudos.map((item) => {
        const esRapido = item.esRapido === true;
        const productoId = item.productoId == null ? null : String(item.productoId).trim();
        if (esRapido && productoId) {
          throw new AppError('Un producto rápido no puede estar ligado al inventario.', 400);
        }
        if (!esRapido && !productoId) {
          throw new AppError('Selecciona un producto válido del inventario o márcalo como producto rápido.', 400);
        }

        const nombre = esRapido && typeof item.nombre === 'string' ? item.nombre.trim() : '';
        if (esRapido && !nombre) throw new AppError('Cada producto rápido debe tener un nombre o concepto.', 400);
        const unidadMedida = esRapido ? VentasLogica.normalizarUnidadMedida(item.unidadMedida) : 'Metro';
        const cantidadSolicitada = validarCantidad(item.cantidad, nombre || 'del inventario', unidadMedida);
        const precioCentavos = validarPrecio(item.precioUnitario, nombre || 'del inventario');
        const cantidadMillesimas = Math.round(cantidadSolicitada * 1000);
        const subtotalCentavos = Math.round((precioCentavos * cantidadMillesimas) / 1000);
        if (!Number.isSafeInteger(subtotalCentavos) || subtotalCentavos > MAX_PRECIO_CENTAVOS) {
          throw new AppError(`El subtotal de "${nombre || 'del inventario'}" es demasiado grande.`, 400);
        }

        if (!esRapido) {
          idsProductos.add(productoId);
          cantidadesMillesimas.set(productoId, (cantidadesMillesimas.get(productoId) || 0) + cantidadMillesimas);
        }

        return {
          productoId: esRapido ? null : productoId,
          nombre,
          unidadMedida: esRapido ? unidadMedida : null,
          cantidad: cantidadMillesimas / 1000,
          cantidadMillesimas,
          precioUnitario: precioCentavos / 100,
          subtotal: subtotalCentavos / 100,
          subtotalCentavos,
          esRapido,
        };
      });

      const productos = idsProductos.size
        ? await tx.producto.findMany({ where: { id: { in: Array.from(idsProductos) } } })
        : [];
      const productosPorId = new Map(productos.map((producto) => [producto.id, producto]));

      for (const item of items) {
        if (item.esRapido) continue;
        const producto = productosPorId.get(item.productoId);
        if (!producto || !producto.activo) {
          throw new AppError('Uno de los productos ya no está disponible en el inventario.', 400, 'PRODUCTO_NO_DISPONIBLE');
        }
        item.nombre = producto.nombre;
        item.unidadMedida = VentasLogica.normalizarUnidadMedida(producto.unidadMedida);
        validarCantidad(item.cantidad, item.nombre, item.unidadMedida);
      }

      for (const [productoId, cantidadMillesimas] of cantidadesMillesimas) {
        const cantidad = cantidadMillesimas / 1000;
        const resultado = await tx.producto.updateMany({
          where: { id: productoId, activo: true, stock: { gte: cantidad } },
          data: { stock: { decrement: cantidad } },
        });
        if (resultado.count !== 1) {
          const item = items.find((linea) => linea.productoId === productoId);
          throw new AppError(`No hay suficiente inventario disponible de "${item ? item.nombre : 'este producto'}".`, 400, 'STOCK_INSUFICIENTE');
        }
      }

      const totalCentavos = items.reduce((sum, item) => sum + item.subtotalCentavos, 0);
      if (!Number.isSafeInteger(totalCentavos) || totalCentavos > MAX_PRECIO_CENTAVOS) {
        throw new AppError('El total de la venta es demasiado grande.', 400);
      }

      const registro = await tx.venta.create({
        data: {
          total: totalCentavos / 100,
          items: {
            create: items.map((item) => ({
              productoId: item.productoId,
              nombre: item.nombre,
              cantidad: item.cantidad,
              unidadMedida: item.unidadMedida,
              precioUnitario: item.precioUnitario,
              subtotal: item.subtotal,
              esRapido: item.esRapido,
            })),
          },
        },
        include: { items: true },
      });

      return registro;
    });

    res.status(201).json(formatearVenta(venta));
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /api/ventas/:id   (requiere token 'ventas_modificar' ligado a esta venta)
 * Reemplaza las lineas de una venta DEL DIA ACTUAL. El total y los subtotales se
 * recalculan aqui; el stock se ajusta por diferencia (devuelve o descuenta) dentro
 * de la misma transaccion, y nunca puede quedar negativo.
 */
async function actualizarVenta(req, res, next) {
  try {
    const id = parsearIdVenta(req.params.id);

    const crudos = req.body && req.body.items;
    if (!Array.isArray(crudos) || crudos.some((it) => !it || typeof it !== 'object')) {
      throw new AppError('Debes enviar la lista de productos de la venta.', 400);
    }
    const nuevos = crudos.map((it) => ({
      productoId: it.productoId ? String(it.productoId) : null,
      nombre: it.nombre,
      cantidad: it.cantidad,
      precioUnitario: it.precioUnitario,
      esRapido: !!it.esRapido,
      unidadMedida: it.unidadMedida,
    }));

    let totalAnterior = 0;

    const actualizada = await prisma.$transaction(async (tx) => {
      const venta = await tx.venta.findUnique({ where: { id }, include: { items: true } });
      if (!venta) throw new AppError('Venta no encontrada.', 404);

      if (!esDelDiaActual(venta.fecha, { zonaHoraria: zonaHorariaNegocio() })) {
        throw new AppError('Solo se pueden modificar las ventas del día actual.', 403, 'VENTA_NO_ES_DE_HOY');
      }
      totalAnterior = Number(venta.total);

      const idsProductos = new Set();
      venta.items.forEach((it) => it.productoId && idsProductos.add(it.productoId));
      nuevos.forEach((it) => it.productoId && !it.esRapido && idsProductos.add(it.productoId));

      const productos = idsProductos.size
        ? await tx.producto.findMany({ where: { id: { in: Array.from(idsProductos) } } })
        : [];
      const porId = new Map(productos.map((p) => [p.id, { ...p, precio: Number(p.precio), stock: Number(p.stock) }]));

      const plan = planificarEdicion({
        original: venta,
        nuevos,
        obtenerProducto: (productoId) => porId.get(productoId),
      });

      for (const ajuste of plan.ajustesStock) {
        if (ajuste.delta < 0) {
          // Descuento condicional y atomico: si otro celular vendio mientras tanto y ya
          // no alcanza, no se actualiza ninguna fila y la transaccion completa se revierte.
          const resultado = await tx.producto.updateMany({
            where: { id: ajuste.productoId, stock: { gte: -ajuste.delta } },
            data: { stock: { decrement: -ajuste.delta } },
          });
          if (resultado.count !== 1) {
            throw new AppError(`No hay suficiente inventario disponible de "${ajuste.nombre}".`, 400, 'STOCK_INSUFICIENTE');
          }
        } else {
          await tx.producto.update({
            where: { id: ajuste.productoId },
            data: { stock: { increment: ajuste.delta } },
          });
        }
      }

      await tx.ventaItem.deleteMany({ where: { ventaId: id } });
      return tx.venta.update({
        where: { id },
        data: {
          total: plan.total,
          modificadaAt: new Date(),
          items: {
            create: plan.items.map((it) => ({
              productoId: it.productoId,
              nombre: it.nombre,
              cantidad: it.cantidad,
              precioUnitario: it.precioUnitario,
              subtotal: it.subtotal,
              esRapido: it.esRapido,
              unidadMedida: it.unidadMedida,
            })),
          },
        },
        include: { items: true },
      });
    });

    auditar('venta_modificada', req, { ventaId: id, totalAnterior, totalNuevo: Number(actualizada.total) });
    res.json(formatearVenta(actualizada));
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/ventas/:id   (requiere token 'ventas_eliminar' ligado a esta venta)
 * Elimina la venta y devuelve al inventario todo lo vendido de productos registrados,
 * en una sola transaccion (o se hace todo, o no se hace nada).
 */
async function eliminarVenta(req, res, next) {
  try {
    const id = parsearIdVenta(req.params.id);
    let resumen = null;

    await prisma.$transaction(async (tx) => {
      const venta = await tx.venta.findUnique({ where: { id }, include: { items: true } });
      if (!venta) throw new AppError('Venta no encontrada.', 404);

      const plan = planificarEliminacion(venta);
      for (const ajuste of plan.ajustesStock) {
        await tx.producto.updateMany({
          where: { id: ajuste.productoId },
          data: { stock: { increment: ajuste.delta } },
        });
      }

      await tx.venta.delete({ where: { id } }); // los items se eliminan en cascada
      resumen = { ventaId: id, total: Number(venta.total), fechaVenta: venta.fecha, lineas: venta.items.length };
    });

    auditar('venta_eliminada', req, resumen);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getVentas,
  getVentaPorId,
  registrarVenta,
  actualizarVenta,
  eliminarVenta,
};
