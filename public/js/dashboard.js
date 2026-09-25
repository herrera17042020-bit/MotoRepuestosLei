/**
 * dashboard.js
 * Pantalla "Inicio": resumen del dia, actividad reciente, poco stock.
 */

const Dashboard = (function () {
  function saludo() {
    const hora = new Date().getHours();
    if (hora < 12) return 'Buenos días';
    if (hora < 19) return 'Buenas tardes';
    return 'Buenas noches';
  }

  function renderizar() {
    const cont = document.getElementById('pantalla-inicio');
    if (!cont) return;

    const ventasHoy = Storage.getVentasDeHoy();
    const totalHoy = Storage.redondear(ventasHoy.reduce((s, v) => s + v.total, 0));
    const unidadesHoy = ventasHoy.reduce(
      (s, v) => s + v.items.reduce((si, it) => si + it.cantidad, 0),
      0
    );
    const productos = Storage.getProductos();
    const pocoStock = productos.filter((p) => p.estado === 'poco_stock');

    const ultimasVentas = Storage.getVentas().slice(0, 5);

    cont.innerHTML = `
      <div class="encabezado-pantalla">
        <p class="texto-saludo">${saludo()}</p>
        <h2>Resumen del negocio</h2>
      </div>

      <div class="grid-stats">
        <div class="tarjeta-stat">
          <span class="stat-etiqueta">Ventas de hoy</span>
          <span class="stat-valor stat-valor-dinero">${UI.formatoMoneda(totalHoy)}</span>
        </div>
        <div class="tarjeta-stat">
          <span class="stat-etiqueta">Ventas</span>
          <span class="stat-valor">${ventasHoy.length}</span>
        </div>
        <div class="tarjeta-stat">
          <span class="stat-etiqueta">Productos vendidos</span>
          <span class="stat-valor">${unidadesHoy}</span>
        </div>
        <div class="tarjeta-stat ${pocoStock.length > 0 ? 'tarjeta-stat-aviso' : ''}">
          <span class="stat-etiqueta">Poco stock</span>
          <span class="stat-valor">${pocoStock.length}</span>
        </div>
      </div>

      <section class="seccion-bloque">
        <div class="titulo-seccion-fila">
          <h3>Actividad reciente</h3>
          <button class="enlace-boton" data-pantalla="ventas">Ver todas</button>
        </div>
        <div class="lista-actividad">
          ${
            ultimasVentas.length === 0
              ? '<p class="estado-vacio">Todavía no hay ventas registradas.</p>'
              : ultimasVentas
                  .map(
                    (v) => `
                <button class="fila-actividad" data-abrir-venta="${v.id}">
                  <div>
                    <span class="fila-actividad-titulo">Venta #${v.id}</span>
                    <span class="fila-actividad-fecha">${UI.formatoFechaRelativa(v.fecha)}</span>
                  </div>
                  <span class="fila-actividad-monto">${UI.formatoMoneda(v.total)}</span>
                </button>
              `
                  )
                  .join('')
          }
        </div>
      </section>

      <section class="seccion-bloque">
        <div class="titulo-seccion-fila">
          <h3>Productos con poco stock</h3>
          <button class="enlace-boton" data-pantalla="inventario">Ver inventario</button>
        </div>
        <div class="lista-poco-stock">
          ${
            pocoStock.length === 0
              ? '<p class="estado-vacio">Todo el inventario está en buen nivel.</p>'
              : pocoStock
                  .map(
                    (p) => `
                <div class="fila-poco-stock">
                  <span>${p.nombre}</span>
                  <span class="etiqueta etiqueta-aviso">${p.stock} unidad${p.stock === 1 ? '' : 'es'}</span>
                </div>
              `
                  )
                  .join('')
          }
        </div>
      </section>
    `;

    cont.querySelectorAll('[data-abrir-venta]').forEach((btn) => {
      btn.addEventListener('click', () => {
        UI.irAPantalla('ventas');
        Historial.abrirDetalle(btn.dataset.abrirVenta);
      });
    });
  }

  return { renderizar };
})();
