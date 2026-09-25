/**
 * resumen.js
 * Pantalla "Resumen": estadisticas del negocio, grafico de ventas de los ultimos 7 dias
 * y ranking de productos mas vendidos. El grafico se dibuja con barras CSS simples
 * (sin depender de ninguna libreria externa).
 */

const Resumen = (function () {
  function inicioDelDia(fecha) {
    const f = new Date(fecha);
    f.setHours(0, 0, 0, 0);
    return f;
  }

  function renderizar() {
    const cont = document.getElementById('pantalla-resumen');
    if (!cont) return;

    const ventas = Storage.getVentas();
    const ventasHoy = Storage.getVentasDeHoy();
    const totalHoy = Storage.redondear(ventasHoy.reduce((s, v) => s + v.total, 0));

    const haceUnaSemana = new Date();
    haceUnaSemana.setDate(haceUnaSemana.getDate() - 6);
    haceUnaSemana.setHours(0, 0, 0, 0);
    const ventasSemana = ventas.filter((v) => new Date(v.fecha) >= haceUnaSemana);
    const totalSemana = Storage.redondear(ventasSemana.reduce((s, v) => s + v.total, 0));

    const unidadesVendidasSemana = ventasSemana.reduce(
      (s, v) => s + v.items.reduce((si, it) => si + it.cantidad, 0),
      0
    );
    const ticketPromedio = ventasSemana.length > 0 ? Storage.redondear(totalSemana / ventasSemana.length) : 0;

    const datosGrafico = construirDatosUltimos7Dias(ventas);
    const maxDia = Math.max(1, ...datosGrafico.map((d) => d.total));

    const productosMasVendidos = construirRankingProductos(ventasSemana);

    cont.innerHTML = `
      <div class="encabezado-pantalla">
        <h2>Resumen</h2>
      </div>

      <div class="grid-stats">
        <div class="tarjeta-stat">
          <span class="stat-etiqueta">Ventas de hoy</span>
          <span class="stat-valor stat-valor-dinero">${UI.formatoMoneda(totalHoy)}</span>
        </div>
        <div class="tarjeta-stat">
          <span class="stat-etiqueta">Ventas de esta semana</span>
          <span class="stat-valor stat-valor-dinero">${UI.formatoMoneda(totalSemana)}</span>
        </div>
        <div class="tarjeta-stat">
          <span class="stat-etiqueta">Productos vendidos</span>
          <span class="stat-valor">${unidadesVendidasSemana}</span>
        </div>
        <div class="tarjeta-stat">
          <span class="stat-etiqueta">Ticket promedio</span>
          <span class="stat-valor stat-valor-dinero">${UI.formatoMoneda(ticketPromedio)}</span>
        </div>
      </div>

      <section class="seccion-bloque">
        <h3>Ventas de los últimos 7 días</h3>
        <div class="grafico-barras">
          ${datosGrafico
            .map((d) => {
              const alturaPorc = Math.max(4, Math.round((d.total / maxDia) * 100));
              return `
              <div class="grafico-barra-col">
                <span class="grafico-barra-valor">${d.total > 0 ? UI.formatoMoneda(d.total) : ''}</span>
                <div class="grafico-barra" style="height: ${alturaPorc}%"></div>
                <span class="grafico-barra-etiqueta">${d.etiqueta}</span>
              </div>
            `;
            })
            .join('')}
        </div>
      </section>

      <section class="seccion-bloque">
        <h3>Productos más vendidos</h3>
        <div class="lista-ranking">
          ${
            productosMasVendidos.length === 0
              ? '<p class="estado-vacio">Todavía no hay suficientes ventas esta semana.</p>'
              : productosMasVendidos
                  .map((p, i) => {
                    const anchoPorc = Math.max(6, Math.round((p.unidades / productosMasVendidos[0].unidades) * 100));
                    return `
                <div class="fila-ranking">
                  <span class="fila-ranking-puesto fila-ranking-puesto-${i + 1}">${i + 1}</span>
                  <div class="fila-ranking-detalle">
                    <div class="fila-ranking-cabecera">
                      <span class="fila-ranking-nombre">${p.nombre}</span>
                      <span class="fila-ranking-unidades">${p.unidades} unid.</span>
                    </div>
                    <div class="fila-ranking-barra-fondo">
                      <div class="fila-ranking-barra-relleno" style="width: ${anchoPorc}%"></div>
                    </div>
                  </div>
                </div>
              `;
                  })
                  .join('')
          }
        </div>
      </section>
    `;
  }

  function renderizarBloqueado() {
    const cont = document.getElementById('pantalla-resumen');
    if (!cont) return;
    cont.innerHTML = `
      <div class="encabezado-pantalla">
        <h2>Resumen</h2>
      </div>
      <div class="bloqueo-pantalla">
        <div class="bloqueo-pantalla-icono">🔒</div>
        <h3>Resumen protegido</h3>
        <p>Ingresa la contraseña para consultar las cifras y el rendimiento del negocio.</p>
        <button class="btn-primario btn-mayusculas" id="btn-desbloquear-resumen">Ingresar contraseña</button>
      </div>
    `;
    document.getElementById('btn-desbloquear-resumen').addEventListener('click', async () => {
      const autorizado = await Security.asegurarResumen();
      if (autorizado) renderizar();
    });
  }

  function construirDatosUltimos7Dias(ventas) {
    const dias = [];
    for (let i = 6; i >= 0; i--) {
      const fecha = new Date();
      fecha.setDate(fecha.getDate() - i);
      const inicio = inicioDelDia(fecha);
      const fin = new Date(inicio);
      fin.setDate(fin.getDate() + 1);

      const totalDia = Storage.redondear(
        ventas
          .filter((v) => {
            const f = new Date(v.fecha);
            return f >= inicio && f < fin;
          })
          .reduce((s, v) => s + v.total, 0)
      );

      dias.push({
        etiqueta: i === 0 ? 'Hoy' : fecha.toLocaleDateString('es-NI', { weekday: 'short' }).replace('.', ''),
        total: totalDia,
      });
    }
    return dias;
  }

  function construirRankingProductos(ventas) {
    const conteo = new Map();
    ventas.forEach((v) => {
      v.items.forEach((it) => {
        const previo = conteo.get(it.nombre) || 0;
        conteo.set(it.nombre, previo + it.cantidad);
      });
    });
    return Array.from(conteo.entries())
      .map(([nombre, unidades]) => ({ nombre, unidades }))
      .sort((a, b) => b.unidades - a.unidades)
      .slice(0, 5);
  }

  return { renderizar, renderizarBloqueado };
})();
