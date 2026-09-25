/**
 * ui.js
 * -----------------------------------------------------------------------
 * Utilidades de interfaz compartidas por toda la app:
 * formato de moneda/fecha, toasts, apertura/cierre de modales,
 * y el cambio entre pantallas (Inicio / Nueva venta / Inventario / Ventas / Resumen).
 * -----------------------------------------------------------------------
 */

const UI = (function () {
  // ---- formato ---------------------------------------------------------

  function formatoMoneda(valor) {
    const numero = Number(valor) || 0;
    return `C$${Math.round(numero).toLocaleString('es-NI')}`;
  }

  function formatoFechaRelativa(fechaISO) {
    const fecha = new Date(fechaISO);
    const ahora = new Date();
    const diffMs = ahora - fecha;
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return 'Justo ahora';
    if (diffMin < 60) return `Hace ${diffMin} minuto${diffMin === 1 ? '' : 's'}`;
    const diffHoras = Math.floor(diffMin / 60);
    if (diffHoras < 24 && esMismoDia(fecha, ahora)) {
      return `Hace ${diffHoras} hora${diffHoras === 1 ? '' : 's'}`;
    }
    return formatoFechaCorta(fechaISO);
  }

  function esMismoDia(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function formatoFechaCorta(fechaISO) {
    const fecha = new Date(fechaISO);
    const hoy = new Date();
    const ayer = new Date();
    ayer.setDate(hoy.getDate() - 1);

    const hora = fecha.toLocaleTimeString('es-NI', { hour: 'numeric', minute: '2-digit', hour12: true });

    if (esMismoDia(fecha, hoy)) return `Hoy — ${hora}`;
    if (esMismoDia(fecha, ayer)) return `Ayer — ${hora}`;
    const fechaCorta = fecha.toLocaleDateString('es-NI', { day: '2-digit', month: '2-digit' });
    return `${fechaCorta} — ${hora}`;
  }

  // ---- toasts ------------------------------------------------------------

  let contenedorToasts = null;

  function inicializarToasts() {
    contenedorToasts = document.getElementById('toast-container');
  }

  function mostrarToast(mensaje, tipo = 'info') {
    if (!contenedorToasts) inicializarToasts();
    if (!contenedorToasts) return;

    const iconos = { exito: '✓', error: '✕', aviso: '⚠' , info: 'ℹ' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${tipo}`;
    toast.innerHTML = `<span class="toast-icono">${iconos[tipo] || iconos.info}</span><span class="toast-texto"></span>`;
    toast.querySelector('.toast-texto').textContent = mensaje;

    contenedorToasts.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-visible'));

    setTimeout(() => {
      toast.classList.remove('toast-visible');
      setTimeout(() => toast.remove(), 250);
    }, 3000);
  }

  // ---- modales -----------------------------------------------------------

  function abrirModal(idModal) {
    const modal = document.getElementById(idModal);
    if (!modal) return;
    modal.classList.add('modal-abierto');
    document.body.classList.add('body-modal-abierto');
    const primerCampo = modal.querySelector('input, select, textarea, button.btn-primario');
    if (primerCampo) setTimeout(() => primerCampo.focus(), 50);
  }

  // Cada modal que se cierra avisa con el evento "modal:cerrado" (lo usan, por ejemplo,
  // los modales que devuelven una promesa para saber que la persona cancelo).
  function cerrarModal(idModal) {
    const modal = document.getElementById(idModal);
    if (!modal) return;
    const estabaAbierto = modal.classList.contains('modal-abierto');
    modal.classList.remove('modal-abierto');
    // Con dos modales apilados (ej. editar venta + confirmar) el scroll del fondo sigue
    // bloqueado hasta que se cierre el ultimo.
    if (!document.querySelector('.modal.modal-abierto')) document.body.classList.remove('body-modal-abierto');
    if (estabaAbierto) modal.dispatchEvent(new CustomEvent('modal:cerrado'));
  }

  function cerrarTodosLosModales() {
    const abiertos = Array.from(document.querySelectorAll('.modal.modal-abierto'));
    abiertos.forEach((m) => m.classList.remove('modal-abierto'));
    document.body.classList.remove('body-modal-abierto');
    abiertos.forEach((m) => m.dispatchEvent(new CustomEvent('modal:cerrado')));
  }

  // ---- utilidades de texto y confirmacion ------------------------------------

  function escapar(texto) {
    return String(texto == null ? '' : texto)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  let resolverConfirmacion = null;

  /**
   * Confirmacion con el estilo de la app (reemplaza al confirm() del navegador en los flujos nuevos).
   * Devuelve una promesa: true si se acepta, false si se cancela o se cierra el modal.
   */
  function confirmar({ titulo, mensaje = '', detalle = '', textoAceptar = 'Aceptar', textoCancelar = 'Cancelar', peligro = false }) {
    return new Promise((resolve) => {
      if (resolverConfirmacion) resolverConfirmacion(false);
      resolverConfirmacion = resolve;

      document.getElementById('confirmar-titulo').textContent = titulo;
      document.getElementById('confirmar-mensaje').textContent = mensaje;
      const cajaDetalle = document.getElementById('confirmar-detalle');
      cajaDetalle.textContent = detalle;
      cajaDetalle.hidden = !detalle;
      const aceptar = document.getElementById('confirmar-aceptar');
      aceptar.textContent = textoAceptar;
      aceptar.classList.toggle('btn-peligro', !!peligro);
      document.getElementById('confirmar-cancelar').textContent = textoCancelar;

      abrirModal('modal-confirmar');
      // El foco inicial va al boton "Cancelar": una accion destructiva no debe
      // confirmarse por accidente con Enter.
      setTimeout(() => document.getElementById('confirmar-cancelar').focus(), 60);
    });
  }

  function responderConfirmacion(valor) {
    const resolver = resolverConfirmacion;
    resolverConfirmacion = null;
    cerrarModal('modal-confirmar');
    if (resolver) resolver(valor);
  }

  function inicializarConfirmacion() {
    document.getElementById('confirmar-aceptar').addEventListener('click', () => responderConfirmacion(true));
    document.getElementById('confirmar-cancelar').addEventListener('click', () => responderConfirmacion(false));
    document.getElementById('modal-confirmar').addEventListener('modal:cerrado', () => {
      const resolver = resolverConfirmacion;
      resolverConfirmacion = null;
      if (resolver) resolver(false);
    });
  }

  // ---- navegacion entre pantallas -----------------------------------------

  const PANTALLAS = ['inicio', 'venta', 'inventario', 'ventas', 'resumen'];
  let alCambiarPantalla = null;

  function onCambioPantalla(callback) {
    alCambiarPantalla = callback;
  }

  function irAPantalla(nombre) {
    if (!PANTALLAS.includes(nombre)) return;

    document.querySelectorAll('.pantalla').forEach((s) => s.classList.remove('pantalla-activa'));
    const seccion = document.getElementById(`pantalla-${nombre}`);
    if (seccion) seccion.classList.add('pantalla-activa');

    document.querySelectorAll('[data-pantalla]').forEach((btn) => {
      btn.classList.toggle('nav-activo', btn.dataset.pantalla === nombre);
    });

    cerrarTodosLosModales();
    document.getElementById('hoja-mas')?.classList.remove('hoja-abierta');
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });

    if (typeof alCambiarPantalla === 'function') alCambiarPantalla(nombre);
  }

  function inicializarNavegacion() {
    // Delegacion de eventos: asi cualquier boton con data-pantalla funciona
    // aunque se haya creado dinamicamente despues (ej. "Ver inventario" en Inicio,
    // "Ver todas" en Actividad reciente, los accesos de la hoja "Mas", etc.)
    document.addEventListener('click', (e) => {
      const boton = e.target.closest('[data-pantalla]');
      if (boton) irAPantalla(boton.dataset.pantalla);
    });

    const botonMas = document.getElementById('boton-nav-mas');
    const hojaMas = document.getElementById('hoja-mas');
    if (botonMas && hojaMas) {
      botonMas.addEventListener('click', () => hojaMas.classList.toggle('hoja-abierta'));
      document.getElementById('hoja-mas-fondo')?.addEventListener('click', () => hojaMas.classList.remove('hoja-abierta'));
    }
  }

  // Cierra modales al hacer click en el fondo, y con la tecla Escape
  function inicializarCierreGlobalModales() {
    document.addEventListener('click', (e) => {
      if (e.target.classList && e.target.classList.contains('modal-fondo')) {
        cerrarTodosLosModales();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') cerrarTodosLosModales();
    });
  }

  // ---- selects de categoria (compartido por Inventario y Producto rapido) ----

  function llenarSelectCategorias(selectEl, seleccionActual) {
    const categorias = Storage.getCategorias();
    selectEl.innerHTML =
      `<option value="" disabled ${seleccionActual ? '' : 'selected'} hidden>Selecciona una categoría</option>` +
      categorias.map((c) => `<option value="${c}" ${c === seleccionActual ? 'selected' : ''}>${c}</option>`).join('') +
      '<option value="__nueva__">+ Agregar categoría...</option>';

    // Usamos onchange (no addEventListener) para no ir acumulando manejadores
    // cada vez que se vuelve a abrir el mismo modal.
    selectEl.onchange = async () => {
      if (selectEl.value !== '__nueva__') return;
      const nombre = prompt('Nombre de la nueva categoría:');
      if (!nombre || !nombre.trim()) {
        selectEl.value = seleccionActual || '';
        return;
      }
      try {
        await Storage.agregarCategoria(nombre);
        llenarSelectCategorias(selectEl, nombre.trim());
        mostrarToast(`Categoría "${nombre.trim()}" agregada`, 'exito');
      } catch (err) {
        mostrarToast(err.message, 'error');
        selectEl.value = seleccionActual || '';
      }
    };
  }

  return {
    formatoMoneda,
    formatoFechaRelativa,
    formatoFechaCorta,
    mostrarToast,
    abrirModal,
    cerrarModal,
    cerrarTodosLosModales,
    irAPantalla,
    onCambioPantalla,
    inicializarNavegacion,
    inicializarCierreGlobalModales,
    llenarSelectCategorias,
    escapar,
    confirmar,
    inicializarConfirmacion,
  };
})();
