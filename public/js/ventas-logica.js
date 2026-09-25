/**
 * ventas-logica.js
 * -----------------------------------------------------------------------
 * Reglas de negocio PURAS para modificar y eliminar ventas. No toca la base
 * de datos, ni localStorage, ni el DOM: solo recibe datos y devuelve el plan
 * de cambios (lineas normalizadas, total recalculado y ajustes de stock).
 *
 * Es el UNICO lugar donde viven estas reglas y lo usan los dos lados:
 *   - Backend (Node):   require('../../public/js/ventas-logica')
 *   - Frontend (modo local/offline): <script src="js/ventas-logica.js">
 * Asi el calculo del total, la validacion de stock y la devolucion de
 * inventario son identicos con o sin servidor.
 * -----------------------------------------------------------------------
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.VentasLogica = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  const MAX_CANTIDAD = 100000;

  class ErrorVenta extends Error {
    constructor(mensaje, status = 400, codigo = 'VENTA_INVALIDA') {
      super(mensaje);
      this.name = 'ErrorVenta';
      this.status = status;
      this.codigo = codigo;
    }
  }

  // Los precios de la app son cordobas enteros (sin centavos).
  function redondear(valor) {
    return Math.round(Number(valor) || 0);
  }

  // ---- "ventas del dia" ------------------------------------------------

  /**
   * Devuelve la fecha calendario (AAAA-MM-DD) de un instante.
   * Con `zonaHoraria` (ej. "America/Managua") usa esa zona; sin ella usa la
   * hora local del dispositivo (modo local del celular).
   */
  function claveDia(fecha, zonaHoraria) {
    const d = fecha instanceof Date ? fecha : new Date(fecha);
    if (Number.isNaN(d.getTime())) return null;

    if (zonaHoraria) {
      const partes = new Intl.DateTimeFormat('en-US', {
        timeZone: zonaHoraria,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(d);
      const valor = (tipo) => partes.find((p) => p.type === tipo).value;
      return `${valor('year')}-${valor('month')}-${valor('day')}`;
    }

    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const dia = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mes}-${dia}`;
  }

  function esDelDiaActual(fechaVenta, opciones = {}) {
    const ahora = opciones.ahora || new Date();
    const a = claveDia(fechaVenta, opciones.zonaHoraria);
    const b = claveDia(ahora, opciones.zonaHoraria);
    return a !== null && a === b;
  }

  // ---- utilidades internas -------------------------------------------------

  function esLineaRegistrada(item) {
    return !!item && !item.esRapido && !!item.productoId;
  }

  function sumarPorProducto(items) {
    const mapa = new Map();
    for (const item of items || []) {
      if (!esLineaRegistrada(item)) continue;
      mapa.set(item.productoId, (mapa.get(item.productoId) || 0) + Number(item.cantidad || 0));
    }
    return mapa;
  }

  function validarCantidad(valor, nombre) {
    const cantidad = Number(valor);
    if (!Number.isInteger(cantidad)) {
      throw new ErrorVenta(`La cantidad de "${nombre}" debe ser un número entero.`);
    }
    if (cantidad <= 0) {
      throw new ErrorVenta(`La cantidad de "${nombre}" debe ser mayor a cero.`);
    }
    if (cantidad > MAX_CANTIDAD) {
      throw new ErrorVenta(`La cantidad de "${nombre}" es demasiado grande.`);
    }
    return cantidad;
  }

  // ---- plan de modificacion ----------------------------------------------

  /**
   * Calcula TODO lo necesario para guardar una venta modificada, sin escribir nada.
   *
   * @param {object}   args
   * @param {object}   args.original         venta guardada ({ items: [...] })
   * @param {Array}    args.nuevos           lineas enviadas por el usuario
   *                                         ({ productoId, nombre, cantidad, precioUnitario, esRapido })
   * @param {Function} args.obtenerProducto  (id) => { id, nombre, precio, stock, activo } | null/undefined
   * @returns {{ items: Array, total: number, ajustesStock: Array }}
   *   ajustesStock[i].delta es el cambio a APLICAR al stock:
   *   positivo = devolver al inventario, negativo = descontar del inventario.
   *
   * Reglas:
   *  - El total y cada subtotal se recalculan aqui; cualquier subtotal/total enviado se ignora.
   *  - El precio de una linea registrada NO lo decide el cliente: se conserva el precio original
   *    de esa venta; si el producto es nuevo en la venta se usa su precio actual del inventario.
   *  - Cantidades: enteras y > 0. Nunca se permite stock negativo.
   */
  function planificarEdicion({ original, nuevos, obtenerProducto }) {
    if (!original || !Array.isArray(original.items)) {
      throw new ErrorVenta('Venta no encontrada.', 404, 'VENTA_NO_ENCONTRADA');
    }
    if (!Array.isArray(nuevos) || nuevos.length === 0) {
      throw new ErrorVenta('La venta debe tener al menos un producto. Para anularla, elimínala.');
    }

    const preciosOriginales = new Map();
    for (const it of original.items) {
      if (esLineaRegistrada(it) && !preciosOriginales.has(it.productoId)) {
        preciosOriginales.set(it.productoId, { precio: redondear(it.precioUnitario), nombre: it.nombre });
      }
    }

    const items = [];
    for (const crudo of nuevos) {
      const esRapido = !!(crudo && crudo.esRapido) || !(crudo && crudo.productoId);

      if (esRapido) {
        const nombre = String((crudo && crudo.nombre) || '').trim();
        if (!nombre) throw new ErrorVenta('Cada producto de la venta debe tener nombre.');
        const cantidad = validarCantidad(crudo.cantidad, nombre);
        const precio = redondear(crudo.precioUnitario);
        if (!Number.isFinite(precio) || precio <= 0) {
          throw new ErrorVenta(`El precio de "${nombre}" debe ser mayor a cero.`);
        }
        items.push({
          productoId: null,
          nombre,
          cantidad,
          precioUnitario: precio,
          subtotal: redondear(precio * cantidad),
          esRapido: true,
        });
        continue;
      }

      const productoId = crudo.productoId;
      const producto = obtenerProducto ? obtenerProducto(productoId) : null;
      const previo = preciosOriginales.get(productoId);
      if (!producto && !previo) {
        throw new ErrorVenta('Uno de los productos ya no existe en el inventario.', 404, 'PRODUCTO_NO_ENCONTRADO');
      }

      const nombre = previo ? previo.nombre : producto.nombre;
      const precio = previo ? previo.precio : redondear(producto.precio);
      const cantidad = validarCantidad(crudo.cantidad, nombre);

      items.push({
        productoId,
        nombre,
        cantidad,
        precioUnitario: precio,
        subtotal: redondear(precio * cantidad),
        esRapido: false,
      });
    }

    // ---- inventario: diferencia entre lo que se habia vendido y lo nuevo ----
    const antes = sumarPorProducto(original.items);
    const despues = sumarPorProducto(items);
    const ajustesStock = [];

    for (const productoId of new Set([...antes.keys(), ...despues.keys()])) {
      const diferencia = (despues.get(productoId) || 0) - (antes.get(productoId) || 0);
      if (diferencia === 0) continue;

      const producto = obtenerProducto ? obtenerProducto(productoId) : null;
      const nombre = (preciosOriginales.get(productoId) || {}).nombre || (producto && producto.nombre) || 'producto';

      if (diferencia > 0) {
        if (!producto) {
          throw new ErrorVenta(`El producto "${nombre}" ya no existe en el inventario.`, 404, 'PRODUCTO_NO_ENCONTRADO');
        }
        if (producto.activo === false) {
          throw new ErrorVenta(`El producto "${nombre}" ya no está disponible en el inventario.`);
        }
        if (Number(producto.stock) < diferencia) {
          throw new ErrorVenta(
            `No hay suficiente inventario disponible de "${nombre}". Disponible: ${Number(producto.stock)}, adicional requerido: ${diferencia}.`,
            400,
            'STOCK_INSUFICIENTE'
          );
        }
      }

      // diferencia > 0 => se vende mas => baja el stock; diferencia < 0 => se devuelve.
      ajustesStock.push({ productoId, nombre, delta: -diferencia });
    }

    const total = redondear(items.reduce((suma, it) => suma + it.subtotal, 0));
    return { items, total, ajustesStock };
  }

  // ---- plan de eliminacion -------------------------------------------------

  /** Al eliminar una venta, todo lo vendido de productos registrados vuelve al inventario. */
  function planificarEliminacion(original) {
    if (!original || !Array.isArray(original.items)) {
      throw new ErrorVenta('Venta no encontrada.', 404, 'VENTA_NO_ENCONTRADA');
    }
    const ajustesStock = [];
    for (const [productoId, cantidad] of sumarPorProducto(original.items)) {
      if (cantidad > 0) ajustesStock.push({ productoId, delta: cantidad });
    }
    return { ajustesStock };
  }

  return {
    ErrorVenta,
    claveDia,
    esDelDiaActual,
    planificarEdicion,
    planificarEliminacion,
  };
});
