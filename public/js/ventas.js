/**
 * ventas.js
 * Pantalla "Nueva venta": el modulo mas importante de la app.
 * Busqueda + categorias + grid de productos + carrito + producto rapido + confirmar venta.
 */

const Ventas = (function () {
  let carrito = [];
  let filtroTexto = '';
  let categoriaActiva = 'Todos';
  let indiceRapidoAGuardar = null; // indice del item del carrito que se esta convirtiendo en producto de inventario
  let ventaReciente = null;
  let productosRapidosPendientes = [];

  function normalizar(texto) {
    return texto
      .toString()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  // ---- ciclo de vida ------------------------------------------------

  function renderizar() {
    carrito = Storage.getCarrito();
    const cont = document.getElementById('pantalla-venta');
    if (!cont) return;

    cont.innerHTML = `
      <div class="venta-layout">
        <div class="venta-panel-productos">
          <div class="encabezado-pantalla encabezado-venta">
            <h2>Nueva venta</h2>
            <button class="btn-producto-rapido" id="btn-abrir-producto-rapido">
              <span>+</span> Producto rápido
            </button>
          </div>

          <div class="buscador-venta">
            <span class="buscador-icono">🔍</span>
            <input type="search" id="input-buscar-producto" placeholder="Buscar producto..." autocomplete="off">
          </div>

          <div class="chips-categoria" id="chips-categoria"></div>

          <div class="grid-productos" id="grid-productos"></div>
        </div>

        <aside class="venta-carrito" id="panel-carrito">
          <button class="carrito-peek" id="carrito-peek">
            <span class="carrito-icono" aria-hidden="true">🛒</span>
            <span class="carrito-badge" id="carrito-badge">0</span>
            <div class="carrito-peek-info">
              <span class="carrito-peek-cantidad" id="carrito-peek-cantidad">0 productos</span>
              <span class="carrito-peek-total" id="carrito-peek-total">C$0.00</span>
            </div>
            <span class="carrito-peek-flecha">▲</span>
          </button>

          <div class="carrito-cuerpo">
            <div class="carrito-titulo-fila">
              <h3>Venta actual</h3>
              <button class="enlace-boton enlace-peligro" id="btn-vaciar-carrito">Vaciar</button>
            </div>
            <div class="carrito-items" id="carrito-items"></div>
            <div class="carrito-total-fila">
              <span>TOTAL</span>
              <span id="carrito-total">C$0.00</span>
            </div>
            <button class="btn-confirmar-venta" id="btn-confirmar-venta">Confirmar venta</button>
          </div>
        </aside>
      </div>
    `;

    renderizarChips();
    renderizarProductos();
    renderizarCarrito();
    adjuntarEventos();
  }

  function adjuntarEventos() {
    document.getElementById('input-buscar-producto').addEventListener('input', (e) => {
      filtroTexto = e.target.value;
      renderizarProductos();
    });

    document.getElementById('btn-abrir-producto-rapido').addEventListener('click', abrirModalProductoRapido);
    document.getElementById('btn-vaciar-carrito').addEventListener('click', confirmarVaciarCarrito);
    document.getElementById('btn-confirmar-venta').addEventListener('click', abrirConfirmacionVenta);
    document.getElementById('carrito-peek').addEventListener('click', () => {
      if (arrastreCarritoActivo) return;
      document.getElementById('panel-carrito').classList.toggle('carrito-expandido');
    });
    inicializarCarritoMovible();
  }

  let arrastreCarritoActivo = false;

  function inicializarCarritoMovible() {
    const panel = document.getElementById('panel-carrito');
    const asa = document.getElementById('carrito-peek');
    if (!panel || !asa) return;

    let punteroInicial = null;
    let posicionInicial = null;
    let seMovio = false;

    asa.addEventListener('pointerdown', (evento) => {
      if (evento.button !== 0 && evento.pointerType !== 'touch') return;
      const rect = panel.getBoundingClientRect();
      punteroInicial = { x: evento.clientX, y: evento.clientY };
      posicionInicial = { x: rect.left, y: rect.top };
      seMovio = false;
      try {
        asa.setPointerCapture(evento.pointerId);
      } catch (error) {
      }
      panel.classList.add('carrito-arrastrando');
    });

    asa.addEventListener('pointermove', (evento) => {
      if (!punteroInicial || !posicionInicial) return;
      const desplazamientoX = evento.clientX - punteroInicial.x;
      const desplazamientoY = evento.clientY - punteroInicial.y;
      if (Math.abs(desplazamientoX) > 4 || Math.abs(desplazamientoY) > 4) seMovio = true;
      if (!seMovio) return;

      const margen = 8;
      const ancho = panel.offsetWidth;
      const alto = panel.offsetHeight;
      const izquierda = Math.max(margen, Math.min(window.innerWidth - ancho - margen, posicionInicial.x + desplazamientoX));
      const arriba = Math.max(margen, Math.min(window.innerHeight - alto - margen, posicionInicial.y + desplazamientoY));
      panel.style.left = `${izquierda}px`;
      panel.style.top = `${arriba}px`;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
    });

    const terminarArrastre = (evento) => {
      if (!punteroInicial) return;
      arrastreCarritoActivo = seMovio;
      punteroInicial = null;
      posicionInicial = null;
      panel.classList.remove('carrito-arrastrando');
      if (asa.hasPointerCapture && asa.hasPointerCapture(evento.pointerId)) {
        asa.releasePointerCapture(evento.pointerId);
      }
      if (arrastreCarritoActivo) setTimeout(() => { arrastreCarritoActivo = false; }, 0);
    };

    asa.addEventListener('pointerup', terminarArrastre);
    asa.addEventListener('pointercancel', terminarArrastre);
  }

  // ---- categorias -----------------------------------------------------

  function renderizarChips() {
    const cont = document.getElementById('chips-categoria');
    const chipsCategoria = ['Todos', ...Storage.getCategorias()];
    cont.innerHTML = chipsCategoria.map(
      (cat) => `<button class="chip ${cat === categoriaActiva ? 'chip-activo' : ''}" data-categoria="${cat}">${cat}</button>`
    ).join('');

    cont.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        categoriaActiva = chip.dataset.categoria;
        renderizarChips();
        renderizarProductos();
      });
    });
  }

  // ---- grid de productos -----------------------------------------------

  function renderizarProductos() {
    const cont = document.getElementById('grid-productos');
    const productos = Storage.getProductos().filter((p) => {
      const texto = normalizar(filtroTexto);
      const coincideTexto = !texto || normalizar(p.nombre).includes(texto) || normalizar(p.categoria).includes(texto);
      const coincideCategoria = categoriaActiva === 'Todos' || p.categoria === categoriaActiva;
      return coincideTexto && coincideCategoria;
    });

    if (productos.length === 0) {
      cont.innerHTML = `<p class="estado-vacio estado-vacio-grid">No se encontraron productos. Puedes agregarlo con "+ Producto rápido".</p>`;
      return;
    }

    cont.innerHTML = productos
      .map((p) => {
        const agotado = p.estado === 'agotado';
        const pocoStock = p.estado === 'poco_stock';
        return `
        <div class="tarjeta-producto ${agotado ? 'tarjeta-producto-agotada' : ''} ${carrito.some((item) => item.productoId === p.id) ? 'tarjeta-producto-en-carrito' : ''}" data-producto-id="${p.id}">
          ${pocoStock ? '<span class="tarjeta-producto-badge">Poco stock</span>' : ''}
          ${agotado ? '<span class="tarjeta-producto-badge tarjeta-producto-badge-agotado">Agotado</span>' : ''}
          ${carrito.some((item) => item.productoId === p.id) ? `<span class="tarjeta-producto-badge tarjeta-producto-badge-carrito">En carrito: ${carrito.find((item) => item.productoId === p.id).cantidad}</span>` : ''}
          <span class="tarjeta-producto-nombre">${p.nombre}</span>
          <span class="tarjeta-producto-precio">${UI.formatoMoneda(p.precio)}</span>
          <span class="tarjeta-producto-stock">Stock: ${p.stock}</span>
          <button class="tarjeta-producto-boton" data-agregar="${p.id}" ${agotado ? 'disabled' : ''}>+</button>
        </div>
      `;
      })
      .join('');

    cont.querySelectorAll('[data-agregar]').forEach((btn) => {
      btn.addEventListener('click', () => agregarProductoRegistrado(btn.dataset.agregar));
    });
  }

  // ---- carrito ----------------------------------------------------------

  function persistirCarrito() {
    Storage.guardarCarrito(carrito);
  }

  function recalcularSubtotal(item) {
    item.subtotal = Storage.redondear(item.precioUnitario * item.cantidad);
  }

  function agregarProductoRegistrado(productoId) {
    const producto = Storage.getProducto(productoId);
    if (!producto) return;

    const existente = carrito.find((i) => i.productoId === productoId);
    const cantidadActual = existente ? existente.cantidad : 0;

    if (cantidadActual + 1 > producto.stock) {
      UI.mostrarToast(`No hay suficiente inventario disponible de "${producto.nombre}".`, 'error');
      return;
    }

    if (existente) {
      existente.cantidad += 1;
      recalcularSubtotal(existente);
    } else {
      carrito.push({
        productoId: producto.id,
        nombre: producto.nombre,
        precioUnitario: producto.precio,
        cantidad: 1,
        subtotal: producto.precio,
        esRapido: false,
      });
    }

    persistirCarrito();
    renderizarProductos();
    renderizarCarrito();
    const tarjeta = document.querySelector(`[data-producto-id="${producto.id}"]`);
    if (tarjeta) {
      tarjeta.classList.add('tarjeta-producto-agregada');
      setTimeout(() => tarjeta.classList.remove('tarjeta-producto-agregada'), 650);
    }
    UI.mostrarToast(`${producto.nombre} agregado`, 'exito');
  }

  function cambiarCantidad(indice, delta) {
    const item = carrito[indice];
    if (!item) return;

    if (!item.esRapido) {
      const producto = Storage.getProducto(item.productoId);
      const stockDisponible = producto ? producto.stock : 0;
      if (delta > 0 && item.cantidad + delta > stockDisponible) {
        UI.mostrarToast(`No hay suficiente inventario disponible de "${item.nombre}".`, 'error');
        return;
      }
    }

    item.cantidad += delta;
    if (item.cantidad <= 0) {
      carrito.splice(indice, 1);
    } else {
      recalcularSubtotal(item);
    }
    persistirCarrito();
    renderizarProductos();
    renderizarCarrito();
  }

  function eliminarDelCarrito(indice) {
    carrito.splice(indice, 1);
    persistirCarrito();
    renderizarProductos();
    renderizarCarrito();
  }

  function confirmarVaciarCarrito() {
    if (carrito.length === 0) return;
    if (confirm('¿Vaciar todos los productos de la venta actual?')) {
      carrito = [];
      persistirCarrito();
      renderizarProductos();
      renderizarCarrito();
    }
  }

  function renderizarCarrito() {
    const contItems = document.getElementById('carrito-items');
    const total = Storage.redondear(carrito.reduce((s, i) => s + i.subtotal, 0));
    const cantidadTotal = carrito.reduce((s, i) => s + i.cantidad, 0);

    document.getElementById('carrito-peek-cantidad').textContent = `${cantidadTotal} producto${cantidadTotal === 1 ? '' : 's'}`;
    document.getElementById('carrito-badge').textContent = cantidadTotal > 99 ? '99+' : cantidadTotal;
    document.getElementById('carrito-peek-total').textContent = UI.formatoMoneda(total);
    document.getElementById('carrito-total').textContent = UI.formatoMoneda(total);
    document.getElementById('btn-confirmar-venta').disabled = carrito.length === 0;
    renderizarProductos();

    if (carrito.length === 0) {
      contItems.innerHTML = '<p class="estado-vacio">Agrega productos para iniciar la venta.</p>';
      return;
    }

    contItems.innerHTML = carrito
      .map(
        (item, indice) => `
      <div class="item-carrito">
        <div class="item-carrito-info">
          <span class="item-carrito-nombre">${item.nombre}</span>
          ${item.esRapido ? '<span class="etiqueta etiqueta-rapido">Producto rápido</span>' : ''}
        </div>
        <div class="item-carrito-controles">
          <button class="btn-cantidad" data-cantidad="${indice}" data-delta="-1">−</button>
          <span class="item-carrito-cantidad">${item.cantidad}</span>
          <button class="btn-cantidad" data-cantidad="${indice}" data-delta="1">+</button>
        </div>
        <div class="item-carrito-precios">
          <span class="item-carrito-preciounit">${UI.formatoMoneda(item.precioUnitario)} c/u</span>
          <span class="item-carrito-subtotal">${UI.formatoMoneda(item.subtotal)}</span>
        </div>
        <button class="item-carrito-eliminar" data-eliminar="${indice}" aria-label="Eliminar">🗑</button>
      </div>
    `
      )
      .join('');

    contItems.querySelectorAll('[data-cantidad]').forEach((btn) => {
      btn.addEventListener('click', () => cambiarCantidad(Number(btn.dataset.cantidad), Number(btn.dataset.delta)));
    });
    contItems.querySelectorAll('[data-eliminar]').forEach((btn) => {
      btn.addEventListener('click', () => eliminarDelCarrito(Number(btn.dataset.eliminar)));
    });
  }

  // ---- producto rapido --------------------------------------------------

  function abrirModalProductoRapido() {
    const form = document.getElementById('form-producto-rapido');
    form.reset();
    UI.abrirModal('modal-producto-rapido');
  }

  function manejarSubmitProductoRapido(e) {
    e.preventDefault();
    const nombre = document.getElementById('rapido-nombre').value.trim();
    const precio = Math.round(Number(document.getElementById('rapido-precio').value));
    const cantidad = Number(document.getElementById('rapido-cantidad').value);

    if (!nombre) {
      UI.mostrarToast('Escribe el nombre del producto.', 'error');
      return;
    }
    if (!Number.isFinite(precio) || precio <= 0) {
      UI.mostrarToast('El precio debe ser un número entero mayor a cero.', 'error');
      return;
    }
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      UI.mostrarToast('La cantidad debe ser un número entero mayor a cero.', 'error');
      return;
    }

    carrito.push({
      productoId: null,
      nombre,
      precioUnitario: Storage.redondear(precio),
      cantidad,
      subtotal: Storage.redondear(precio * cantidad),
      esRapido: true,
    });
    persistirCarrito();
    renderizarCarrito();
    UI.cerrarModal('modal-producto-rapido');
    UI.mostrarToast(`${nombre} agregado a la venta`, 'exito');
  }

  // ---- guardar producto rapido en inventario -----------------------------

  function abrirModalGuardarInventario(indice) {
    const item = carrito[indice];
    if (!item) return;
    indiceRapidoAGuardar = indice;

    const form = document.getElementById('form-guardar-inventario');
    form.reset();
    document.getElementById('guardar-inv-nombre').value = item.nombre;
    document.getElementById('guardar-inv-precio').value = item.precioUnitario;
    UI.llenarSelectCategorias(document.getElementById('guardar-inv-categoria'), '');
    UI.abrirModal('modal-guardar-inventario');
  }

  async function manejarSubmitGuardarInventario(e) {
    e.preventDefault();
    if (indiceRapidoAGuardar === null) return;

    const item = carrito[indiceRapidoAGuardar];
    if (!item) return;

    const categoria = document.getElementById('guardar-inv-categoria').value;
    const stockInicial = Number(document.getElementById('guardar-inv-stock').value);
    const precio = Math.round(Number(document.getElementById('guardar-inv-precio').value));

    if (!categoria || categoria === '__nueva__') {
      UI.mostrarToast('Selecciona una categoría.', 'error');
      return;
    }
    if (!Number.isInteger(stockInicial) || stockInicial < 0) {
      UI.mostrarToast('El stock inicial debe ser 0 o un número entero positivo.', 'error');
      return;
    }

    let nuevoProducto;
    try {
      nuevoProducto = await Storage.crearProducto({
        nombre: item.nombre,
        categoria,
        precio,
        stock: stockInicial,
      });
    } catch (err) {
      UI.mostrarToast(err.message, 'error');
      return;
    }

    item.productoId = nuevoProducto.id;
    item.esRapido = false;
    persistirCarrito();
    renderizarCarrito();
    UI.cerrarModal('modal-guardar-inventario');
    UI.mostrarToast(`"${nuevoProducto.nombre}" ahora está en tu inventario`, 'exito');
    indiceRapidoAGuardar = null;
  }

  // ---- confirmar venta ----------------------------------------------------

  function abrirConfirmacionVenta() {
    if (carrito.length === 0) return;
    const total = Storage.redondear(carrito.reduce((s, i) => s + i.subtotal, 0));
    const cantidadProductos = carrito.reduce((s, i) => s + i.cantidad, 0);

    document.getElementById('confirmar-venta-cantidad').textContent = cantidadProductos;
    document.getElementById('confirmar-venta-total').textContent = UI.formatoMoneda(total);
    UI.abrirModal('modal-confirmar-venta');
  }

  async function guardarProductosRapidosEnInventario(productosRapidos) {
    if (!productosRapidos || productosRapidos.length === 0) return;

    const guardados = [];

    for (const item of productosRapidos) {
      const nombre = item.nombre.trim();
      const precio = Number(item.precioUnitario) || 0;
      const cantidad = Number(item.cantidad) || 0;

      if (!nombre || precio <= 0 || cantidad <= 0) return;

      const producto = Storage.getProductos().find((p) => {
        if (!p.activo) return false;
        return p.nombre.trim().toLowerCase() === nombre.toLowerCase() && p.categoria.trim().toLowerCase() === 'otros';
      });

      if (producto) {
        await Storage.actualizarProducto(producto.id, { stock: producto.stock + cantidad, precio });
        guardados.push(nombre);
        return;
      }

      await Storage.crearProducto({ nombre, categoria: 'Otros', precio, stock: cantidad });
      guardados.push(nombre);
    }

    if (guardados.length > 0) {
      UI.mostrarToast(`Se guardaron ${guardados.length} producto${guardados.length === 1 ? '' : 's'} rápido${guardados.length === 1 ? '' : 's'} en inventario.`, 'exito');
    }
  }

  function abrirModalGuardarProductosRapidos() {
    const texto = document.getElementById('texto-guardar-productos-rapidos');
    if (!texto) return;

    const total = productosRapidosPendientes.length;
    texto.textContent = `Hay ${total} producto${total === 1 ? '' : 's'} rápido${total === 1 ? '' : 's'} sin inventario. ¿Quieres guardarlos para futuras ventas?`;
    UI.abrirModal('modal-guardar-productos-rapidos');
  }

  async function confirmarGuardarProductosRapidos() {
    if (productosRapidosPendientes.length > 0) {
      // Los productos rápidos forman parte del flujo permitido para atender la venta.
      try {
        await guardarProductosRapidosEnInventario(productosRapidosPendientes);
      } catch (err) {
        UI.mostrarToast(err.message, 'error');
        return;
      }
    }

    productosRapidosPendientes = [];
    UI.cerrarModal('modal-guardar-productos-rapidos');
    mostrarPantallaExito(ventaReciente);
  }

  function rechazarGuardarProductosRapidos() {
    productosRapidosPendientes = [];
    UI.cerrarModal('modal-guardar-productos-rapidos');
    mostrarPantallaExito(ventaReciente);
  }

  async function confirmarVentaFinal() {
    const productosRapidos = carrito.filter((item) => item.esRapido);

    try {
      const venta = await Storage.registrarVenta(carrito);
      carrito = [];
      ventaReciente = venta;
      UI.cerrarModal('modal-confirmar-venta');

      if (productosRapidos.length > 0) {
        productosRapidosPendientes = productosRapidos.slice();
        abrirModalGuardarProductosRapidos();
        return;
      }

      mostrarPantallaExito(venta);
    } catch (err) {
      UI.cerrarModal('modal-confirmar-venta');
      UI.mostrarToast(err.message || 'No se pudo registrar la venta.', 'error');
      renderizarProductos();
      renderizarCarrito();
    }
  }

  function mostrarPantallaExito(venta) {
    document.getElementById('exito-venta-folio').textContent = `Venta #${venta.id}`;
    document.getElementById('exito-venta-total').textContent = UI.formatoMoneda(venta.total);
    document.getElementById('modal-exito-venta').dataset.ventaId = venta.id;
    UI.abrirModal('modal-exito-venta');
  }

  function iniciarNuevaVentaDesdeExito() {
    UI.cerrarModal('modal-exito-venta');
    renderizarProductos();
    renderizarCarrito();
  }

  function verVentaDesdeExito() {
    const idVenta = document.getElementById('modal-exito-venta').dataset.ventaId;
    UI.cerrarModal('modal-exito-venta');
    UI.irAPantalla('ventas');
    Historial.abrirDetalle(idVenta);
  }

  function inicializarEventosGlobales() {
    document.getElementById('form-producto-rapido').addEventListener('submit', manejarSubmitProductoRapido);
    document.getElementById('form-guardar-inventario').addEventListener('submit', manejarSubmitGuardarInventario);
    document.getElementById('btn-cancelar-confirmar-venta').addEventListener('click', () => UI.cerrarModal('modal-confirmar-venta'));
    document.getElementById('btn-aceptar-confirmar-venta').addEventListener('click', confirmarVentaFinal);
    document.getElementById('btn-si-guardar-productos-rapidos').addEventListener('click', confirmarGuardarProductosRapidos);
    document.getElementById('btn-no-guardar-productos-rapidos').addEventListener('click', rechazarGuardarProductosRapidos);
    document.getElementById('btn-exito-nueva-venta').addEventListener('click', iniciarNuevaVentaDesdeExito);
    document.getElementById('btn-exito-ver-venta').addEventListener('click', verVentaDesdeExito);
  }

  return { renderizar, inicializarEventosGlobales };
})();
