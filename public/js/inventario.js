/**
 * inventario.js
 * Pantalla "Inventario": listar, buscar, filtrar, agregar/editar productos y sumar stock.
 */

const Inventario = (function () {
  let filtroTexto = '';
  let filtroEstado = 'todos';
  let idProductoEnEdicion = null;
  let idProductoParaStock = null;

  function normalizar(texto) {
    return texto
      .toString()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  // Pantalla mostrada mientras el inventario NO esta autorizado: no contiene ningun dato.
  function renderizarBloqueado() {
    const cont = document.getElementById('pantalla-inventario');
    if (!cont) return;

    cont.innerHTML = `
      <div class="inventario-bloqueado">
        <div class="inventario-bloqueado-icono" aria-hidden="true">🔒</div>
        <h2>Inventario protegido</h2>
        <p>Se necesita la contraseña para ver y modificar el inventario.</p>
        <button class="btn-primario btn-mayusculas" id="btn-desbloquear-inventario">Ingresar contraseña</button>
      </div>
    `;
    document.getElementById('btn-desbloquear-inventario').addEventListener('click', solicitarAcceso);
  }

  async function solicitarAcceso() {
    const autorizado = await Security.asegurarInventario();
    if (autorizado) renderizar();
  }

  function bloquear() {
    Security.cerrarSesion('inventario');
    renderizarBloqueado();
    UI.mostrarToast('Inventario bloqueado.', 'info');
  }

  function renderizar() {
    const cont = document.getElementById('pantalla-inventario');
    if (!cont) return;

    // Defensa adicional: sin autorizacion vigente nunca se dibuja el contenido.
    if (!Security.inventarioAutorizado()) {
      renderizarBloqueado();
      return;
    }

    cont.innerHTML = `
      <div class="encabezado-pantalla encabezado-con-boton">
        <h2>Inventario</h2>
        <div class="encabezado-acciones">
          <button class="btn-secundario btn-bloquear" id="btn-bloquear-inventario" title="Volver a bloquear el inventario">🔒 Bloquear</button>
          <button class="btn-primario" id="btn-nuevo-producto">+ Agregar producto</button>
        </div>
      </div>

      <section class="gestion-categorias">
        <div class="titulo-seccion-fila">
          <h3>Categorías</h3>
          <button class="btn-secundario btn-secundario-ajustado" id="btn-nueva-categoria">+ Agregar</button>
        </div>
        <div class="lista-categorias" id="lista-categorias"></div>
      </section>

      <div class="buscador-venta">
        <span class="buscador-icono">🔍</span>
        <input type="search" id="input-buscar-inventario" placeholder="Buscar producto..." autocomplete="off">
      </div>

      <div class="chips-categoria" id="chips-filtro-estado">
        <button class="chip chip-activo" data-estado="todos">Todos</button>
        <button class="chip" data-estado="disponible">Disponibles</button>
        <button class="chip" data-estado="poco_stock">Poco stock</button>
        <button class="chip" data-estado="agotado">Agotados</button>
      </div>

      <div class="lista-inventario" id="lista-inventario"></div>
    `;

    document.getElementById('btn-bloquear-inventario').addEventListener('click', bloquear);
    document.getElementById('btn-nuevo-producto').addEventListener('click', abrirModalNuevoProducto);
  document.getElementById('btn-nueva-categoria').addEventListener('click', agregarCategoria);
    document.getElementById('input-buscar-inventario').addEventListener('input', (e) => {
      filtroTexto = e.target.value;
      renderizarLista();
    });
    cont.querySelectorAll('#chips-filtro-estado .chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        filtroEstado = chip.dataset.estado;
        cont.querySelectorAll('#chips-filtro-estado .chip').forEach((c) => c.classList.remove('chip-activo'));
        chip.classList.add('chip-activo');
        renderizarLista();
      });
    });

    renderizarCategorias();
    renderizarLista();
  }

  function renderizarCategorias() {
    const cont = document.getElementById('lista-categorias');
    if (!cont) return;

    cont.innerHTML = Storage.getCategorias()
      .sort((a, b) => a.localeCompare(b, 'es'))
      .map((categoria) => `
        <div class="fila-categoria">
          <span>${categoria}</span>
          <button class="fila-categoria-eliminar" data-eliminar-categoria="${categoria}" aria-label="Eliminar categoría" title="Eliminar categoría">🗑</button>
        </div>
      `)
      .join('');

    cont.querySelectorAll('[data-eliminar-categoria]').forEach((btn) => {
      btn.addEventListener('click', () => eliminarCategoria(btn.dataset.eliminarCategoria));
    });
  }

  async function agregarCategoria() {
    const nombre = prompt('Nombre de la nueva categoría:');
    if (!nombre || !nombre.trim()) return;

    try {
      await Storage.agregarCategoria(nombre);
      UI.mostrarToast(`Categoría "${nombre.trim()}" agregada`, 'exito');
      renderizarCategorias();
    } catch (err) {
      UI.mostrarToast(err.message, 'error');
    }
  }

  async function eliminarCategoria(nombre) {
    const confirmado = confirm(`¿Eliminar la categoría "${nombre}"? Esta acción no se puede deshacer.`);
    if (!confirmado) return;

    try {
      await Storage.eliminarCategoria(nombre);
      UI.mostrarToast(`Categoría "${nombre}" eliminada`, 'exito');
      renderizarCategorias();
    } catch (err) {
      UI.mostrarToast(err.message, 'error');
    }
  }

  function etiquetaEstado(estado) {
    if (estado === 'agotado') return { texto: 'Agotado', clase: 'etiqueta-peligro' };
    if (estado === 'poco_stock') return { texto: 'Poco stock', clase: 'etiqueta-aviso' };
    return { texto: 'Disponible', clase: 'etiqueta-exito' };
  }

  function renderizarLista() {
    const cont = document.getElementById('lista-inventario');
    const productos = Storage.getProductos()
      .filter((p) => filtroEstado === 'todos' || p.estado === filtroEstado)
      .filter((p) => {
        const texto = normalizar(filtroTexto);
        return !texto || normalizar(p.nombre).includes(texto) || normalizar(p.categoria).includes(texto);
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

    if (productos.length === 0) {
      cont.innerHTML = '<p class="estado-vacio">No hay productos que coincidan con este filtro.</p>';
      return;
    }

    cont.innerHTML = productos
      .map((p) => {
        const estado = etiquetaEstado(p.estado);
        return `
        <div class="fila-inventario">
          <button class="fila-inventario-eliminar" data-eliminar-producto="${p.id}" aria-label="Eliminar producto" title="Eliminar producto">🗑</button>
          <div class="fila-inventario-principal">
            <div>
              <span class="fila-inventario-nombre">${p.nombre}</span>
              <span class="fila-inventario-categoria">${p.categoria}</span>
            </div>
            <span class="fila-inventario-precio">${UI.formatoMoneda(p.precio)}</span>
          </div>
          <div class="fila-inventario-secundaria">
            <span class="etiqueta ${estado.clase}">${estado.texto}</span>
            <span class="fila-inventario-stock">Stock: ${p.stock} unidades</span>
          </div>
          <div class="fila-inventario-acciones">
            <button class="btn-secundario" data-editar="${p.id}">Editar</button>
            <button class="btn-secundario" data-agregar-stock="${p.id}">+ Agregar stock</button>
          </div>
        </div>
      `;
      })
      .join('');

    cont.querySelectorAll('[data-editar]').forEach((btn) => {
      btn.addEventListener('click', () => abrirModalEditarProducto(btn.dataset.editar));
    });
    cont.querySelectorAll('[data-agregar-stock]').forEach((btn) => {
      btn.addEventListener('click', () => abrirModalAgregarStock(btn.dataset.agregarStock));
    });
    cont.querySelectorAll('[data-eliminar-producto]').forEach((btn) => {
      btn.addEventListener('click', () => eliminarProducto(btn.dataset.eliminarProducto));
    });
  }

  async function eliminarProducto(id) {
    const producto = Storage.getProducto(id);
    if (!producto) return;
    const confirmado = confirm(`¿Eliminar "${producto.nombre}" del inventario? Esta acción no se puede deshacer.`);
    if (!confirmado) return;

    try {
      await Storage.eliminarProducto(id);
      UI.mostrarToast(`"${producto.nombre}" fue eliminado del inventario`, 'exito');
      renderizarLista();
    } catch (err) {
      UI.mostrarToast(err.message, 'error');
    }
  }

  // ---- modal nuevo / editar producto -------------------------------------

  function abrirModalNuevoProducto() {
    idProductoEnEdicion = null;
    document.getElementById('titulo-modal-producto').textContent = 'Nuevo producto';
    document.getElementById('form-producto').reset();
    UI.llenarSelectCategorias(document.getElementById('producto-categoria'), '');
    UI.abrirModal('modal-producto');
  }

  function abrirModalEditarProducto(id) {
    const producto = Storage.getProducto(id);
    if (!producto) return;
    idProductoEnEdicion = id;

    document.getElementById('titulo-modal-producto').textContent = 'Editar producto';
    document.getElementById('producto-nombre').value = producto.nombre;
    document.getElementById('producto-precio').value = producto.precio;
    document.getElementById('producto-stock').value = producto.stock;
    UI.llenarSelectCategorias(document.getElementById('producto-categoria'), producto.categoria);
    UI.abrirModal('modal-producto');
  }

  async function manejarSubmitProducto(e) {
    e.preventDefault();
    const nombre = document.getElementById('producto-nombre').value.trim();
    const categoria = document.getElementById('producto-categoria').value;
    const precio = Math.round(Number(document.getElementById('producto-precio').value));
    const stock = Number(document.getElementById('producto-stock').value);

    if (!nombre) {
      UI.mostrarToast('Escribe el nombre del producto.', 'error');
      return;
    }
    if (!categoria || categoria === '__nueva__') {
      UI.mostrarToast('Selecciona una categoría.', 'error');
      return;
    }
    if (!Number.isFinite(precio) || precio <= 0) {
      UI.mostrarToast('El precio debe ser un número entero mayor a cero.', 'error');
      return;
    }
    if (!Number.isInteger(stock) || stock < 0) {
      UI.mostrarToast('El stock debe ser 0 o un número entero positivo.', 'error');
      return;
    }

    try {
      if (idProductoEnEdicion) {
        await Storage.actualizarProducto(idProductoEnEdicion, { nombre, categoria, precio, stock });
        UI.mostrarToast('Producto actualizado', 'exito');
      } else {
        await Storage.crearProducto({ nombre, categoria, precio, stock });
        UI.mostrarToast('Producto agregado al inventario', 'exito');
      }
    } catch (err) {
      UI.mostrarToast(err.message, 'error');
      return;
    }

    UI.cerrarModal('modal-producto');
    renderizarLista();
  }

  // ---- modal agregar stock --------------------------------------------

  function abrirModalAgregarStock(id) {
    const producto = Storage.getProducto(id);
    if (!producto) return;
    idProductoParaStock = id;

    document.getElementById('form-agregar-stock').reset();
    document.getElementById('agregar-stock-nombre').textContent = producto.nombre;
    document.getElementById('agregar-stock-actual').textContent = `Stock actual: ${producto.stock} unidades`;
    UI.abrirModal('modal-agregar-stock');
  }

  async function manejarSubmitAgregarStock(e) {
    e.preventDefault();
    if (!idProductoParaStock) return;

    const cantidad = Number(document.getElementById('agregar-stock-cantidad').value);
    if (!Number.isInteger(cantidad) || cantidad <= 0) {
      UI.mostrarToast('Ingresa una cantidad entera mayor a cero.', 'error');
      return;
    }

    try {
      const producto = await Storage.agregarStock(idProductoParaStock, cantidad);
      UI.cerrarModal('modal-agregar-stock');
      UI.mostrarToast(`Nuevo stock de "${producto.nombre}": ${producto.stock} unidades`, 'exito');
      renderizarLista();
    } catch (err) {
      UI.mostrarToast(err.message, 'error');
    }
    idProductoParaStock = null;
  }

  function inicializarEventosGlobales() {
    document.getElementById('form-producto').addEventListener('submit', manejarSubmitProducto);
    document.getElementById('form-agregar-stock').addEventListener('submit', manejarSubmitAgregarStock);
  }

  return { renderizar, renderizarBloqueado, inicializarEventosGlobales };
})();
