/**
 * historial.js
 * Pantalla "Ventas": historial de ventas registradas, con busqueda, filtro por fecha y detalle.
 */

const Historial = (function () {
  let filtroTexto = '';
  let filtroFecha = 'todas'; // todas | hoy | semana

  function renderizar() {
    const cont = document.getElementById('pantalla-ventas');
    if (!cont) return;

    cont.innerHTML = `
      <div class="encabezado-pantalla">
        <h2>Ventas</h2>
      </div>

      <div class="buscador-venta">
        <span class="buscador-icono">🔍</span>
        <input type="search" id="input-buscar-venta" placeholder="Buscar venta por número o producto..." autocomplete="off">
      </div>

      <div class="chips-categoria" id="chips-filtro-fecha">
        <button class="chip chip-activo" data-fecha="todas">Todas</button>
        <button class="chip" data-fecha="hoy">Hoy</button>
        <button class="chip" data-fecha="semana">Últimos 7 días</button>
      </div>

      <div class="lista-ventas" id="lista-ventas"></div>
    `;

    document.getElementById('input-buscar-venta').addEventListener('input', (e) => {
      filtroTexto = e.target.value;
      renderizarLista();
    });
    cont.querySelectorAll('#chips-filtro-fecha .chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        filtroFecha = chip.dataset.fecha;
        cont.querySelectorAll('#chips-filtro-fecha .chip').forEach((c) => c.classList.remove('chip-activo'));
        chip.classList.add('chip-activo');
        renderizarLista();
      });
    });

    renderizarLista();
  }

  function normalizar(texto) {
    return texto
      .toString()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function coincideFiltroFecha(venta) {
    if (filtroFecha === 'todas') return true;
    const fecha = new Date(venta.fecha);
    const ahora = new Date();
    if (filtroFecha === 'hoy') {
      return (
        fecha.getFullYear() === ahora.getFullYear() &&
        fecha.getMonth() === ahora.getMonth() &&
        fecha.getDate() === ahora.getDate()
      );
    }
    if (filtroFecha === 'semana') {
      const haceUnaSemana = new Date();
      haceUnaSemana.setDate(ahora.getDate() - 7);
      return fecha >= haceUnaSemana;
    }
    return true;
  }

  function esHoy(venta) {
    return Storage.esVentaDeHoy(venta);
  }

  function tarjetaVenta(v) {
    const hoy = esHoy(v);
    return `
      <div class="fila-venta ${hoy ? 'fila-venta-hoy' : ''}" data-venta="${v.id}">
        <button class="fila-venta-info" data-ver-venta="${v.id}">
          <div>
            <span class="fila-venta-folio">Venta #${v.id}
              ${hoy ? '<span class="etiqueta etiqueta-hoy">HOY</span>' : ''}
              ${v.modificadaAt ? '<span class="etiqueta etiqueta-modificada">Modificada</span>' : ''}
            </span>
            <span class="fila-venta-fecha">${UI.formatoFechaCorta(v.fecha)}</span>
          </div>
          <span class="fila-venta-total">${UI.formatoMoneda(v.total)}</span>
        </button>
        <div class="fila-venta-acciones">
          <button class="btn-accion" data-ver-venta="${v.id}">Ver</button>
          ${hoy ? `<button class="btn-accion btn-accion-modificar" data-modificar-venta="${v.id}">Modificar venta</button>` : ''}
          <button class="btn-accion btn-accion-peligro" data-eliminar-venta="${v.id}">Eliminar</button>
        </div>
      </div>
    `;
  }

  function renderizarLista() {
    const cont = document.getElementById('lista-ventas');
    const ventas = Storage.getVentas().filter((v) => {
      if (!coincideFiltroFecha(v)) return false;
      if (!filtroTexto) return true;
      const texto = normalizar(filtroTexto);
      if (String(v.id).includes(texto)) return true;
      return v.items.some((it) => normalizar(it.nombre).includes(texto));
    });

    if (ventas.length === 0) {
      cont.innerHTML = '<p class="estado-vacio">No se encontraron ventas.</p>';
      return;
    }

    // Las ventas de hoy (modificables) se muestran separadas de las anteriores (solo consulta).
    const deHoy = ventas.filter(esHoy);
    const anteriores = ventas.filter((v) => !esHoy(v));
    const totalHoy = Storage.redondear(deHoy.reduce((suma, v) => suma + v.total, 0));

    let html = '';
    if (deHoy.length > 0) {
      html += `
        <div class="grupo-ventas-titulo grupo-ventas-hoy">
          <h3>Ventas de hoy</h3>
          <span class="grupo-ventas-resumen">${deHoy.length} venta${deHoy.length === 1 ? '' : 's'} · ${UI.formatoMoneda(totalHoy)}</span>
        </div>
        ${deHoy.map(tarjetaVenta).join('')}`;
    }
    if (anteriores.length > 0) {
      html += `
        <div class="grupo-ventas-titulo">
          <h3>Ventas anteriores</h3>
          <span class="grupo-ventas-resumen">No se pueden modificar</span>
        </div>
        ${anteriores.map(tarjetaVenta).join('')}`;
    }
    cont.innerHTML = html;

    cont.querySelectorAll('[data-ver-venta]').forEach((btn) => {
      btn.addEventListener('click', () => abrirDetalle(btn.dataset.verVenta));
    });
    cont.querySelectorAll('[data-modificar-venta]').forEach((btn) => {
      btn.addEventListener('click', () => iniciarModificacion(btn.dataset.modificarVenta));
    });
    cont.querySelectorAll('[data-eliminar-venta]').forEach((btn) => {
      btn.addEventListener('click', () => iniciarEliminacion(btn.dataset.eliminarVenta));
    });
  }

  // ---- modificar una venta del dia ---------------------------------------------------------------

  async function iniciarModificacion(id) {
    const venta = Storage.getVenta(id);
    if (!venta) {
      UI.mostrarToast('No se encontró esa venta.', 'error');
      return;
    }
    if (!esHoy(venta)) {
      UI.mostrarToast('Solo se pueden modificar las ventas del día actual.', 'error');
      return;
    }

    const autorizacion = await Security.solicitar('ventas_modificar', { ventaId: venta.id });
    if (!autorizacion) return;

    // Se vuelve a leer la venta: pudo cambiar (o cruzar la medianoche) mientras se escribia la contrasena.
    const ventaActual = Storage.getVenta(id);
    if (!ventaActual) {
      UI.mostrarToast('La venta ya no existe.', 'error');
      renderizarLista();
      return;
    }
    if (!esHoy(ventaActual)) {
      UI.mostrarToast('Solo se pueden modificar las ventas del día actual.', 'error');
      renderizarLista();
      return;
    }

    EditarVenta.abrir(ventaActual, autorizacion.token, renderizarLista);
  }

  // ---- eliminar una venta -----------------------------------------------------------------------------

  async function iniciarEliminacion(id) {
    const venta = Storage.getVenta(id);
    if (!venta) {
      UI.mostrarToast('No se encontró esa venta.', 'error');
      return;
    }

    // 1) contrasena propia de "eliminar ventas" (distinta a la de modificar)
    const autorizacion = await Security.solicitar('ventas_eliminar', { ventaId: venta.id });
    if (!autorizacion) return;

    // 2) segunda confirmacion, explicando el efecto
    const confirmado = await UI.confirmar({
      titulo: '¿Eliminar esta venta?',
      mensaje: 'Esta acción modificará el historial y el inventario. ¿Deseas continuar?',
      detalle: `Venta #${venta.id} · ${UI.formatoMoneda(venta.total)}`,
      textoAceptar: 'Eliminar venta',
      textoCancelar: 'Cancelar',
      peligro: true,
    });
    if (!confirmado) return;

    try {
      await Storage.eliminarVenta(venta.id, autorizacion.token);
      UI.mostrarToast(`Venta #${venta.id} eliminada. Inventario actualizado.`, 'exito');
    } catch (err) {
      if (err.codigo === 'AUTH_EXPIRADA' || err.codigo === 'AUTH_INVALIDA' || err.codigo === 'AUTH_REQUERIDA') {
        UI.mostrarToast('La autorización venció. Vuelve a presionar "Eliminar" e ingresa la contraseña.', 'aviso');
      } else {
        UI.mostrarToast(err.message || 'No se pudo eliminar la venta.', 'error');
      }
    }
    renderizarLista();
  }

  function abrirDetalle(id) {
    const venta = Storage.getVenta(id);
    if (!venta) {
      UI.mostrarToast('No se encontró esa venta.', 'error');
      return;
    }

    document.getElementById('detalle-venta-folio').textContent = `Venta #${venta.id}`;
    document.getElementById('detalle-venta-fecha').textContent =
      UI.formatoFechaCorta(venta.fecha) +
      (venta.modificadaAt ? ` · Modificada ${UI.formatoFechaCorta(venta.modificadaAt).toLowerCase()}` : '');
    document.getElementById('detalle-venta-total').textContent = UI.formatoMoneda(venta.total);
    document.getElementById('detalle-venta-items').innerHTML = venta.items
      .map(
        (it) => `
      <div class="detalle-venta-item">
        <span>${it.nombre} × ${it.cantidad} ${it.esRapido ? '<span class="etiqueta etiqueta-rapido-mini">rápido</span>' : ''}</span>
        <span>${UI.formatoMoneda(it.subtotal)}</span>
      </div>
    `
      )
      .join('');

    UI.abrirModal('modal-detalle-venta');
  }

  return { renderizar, abrirDetalle };
})();
