/**
 * editar-venta.js
 * -----------------------------------------------------------------------
 * Ventana para modificar una venta DEL DIA (se abre solo despues de que la contrasena
 * de "modificar ventas" fue verificada; ver Historial.iniciarModificacion).
 *
 * Lo que se puede hacer: cambiar cantidades, quitar lineas y agregar productos del inventario.
 * Lo que NO se puede hacer: escribir el total (siempre se calcula), usar cantidades negativas
 * o pasar del stock disponible. Estas mismas reglas las vuelve a aplicar el servidor
 * (o Storage en modo local) al guardar, asi que esta pantalla no es la unica defensa.
 * -----------------------------------------------------------------------
 */

const EditarVenta = (function () {
  const MAX_RESULTADOS = 6;

  let estado = null; // { venta, token, lineas, alGuardar, guardando }

  function el(id) {
    return document.getElementById(id);
  }

  function normalizar(texto) {
    return String(texto || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  // ---- calculo -----------------------------------------------------------------

  function stockDisponible(linea) {
    if (linea.esRapido) return Infinity;
    const producto = Storage.getProducto(linea.productoId);
    // Lo que ya se habia vendido en esta venta se puede conservar; a eso se suma lo que hay libre.
    return linea.cantidadOriginal + (producto ? producto.stock : 0);
  }

  function cantidadValida(linea) {
    return Number.isInteger(linea.cantidad) && linea.cantidad >= 1 && linea.cantidad <= stockDisponible(linea);
  }

  function subtotalDe(linea) {
    return cantidadValida(linea) ? Storage.redondear(linea.precioUnitario * linea.cantidad) : 0;
  }

  function totalCalculado() {
    return Storage.redondear(estado.lineas.reduce((suma, l) => suma + subtotalDe(l), 0));
  }

  function hayCambios() {
    const original = estado.venta.items;
    if (original.length !== estado.lineas.length) return true;
    return estado.lineas.some((l) => l.cantidad !== l.cantidadOriginal || l.esNueva);
  }

  // ---- dibujo ----------------------------------------------------------------------

  function mensajeDeLinea(linea) {
    if (linea.cantidad === null || Number.isNaN(linea.cantidad)) return 'Escribe una cantidad entera de 1 en adelante.';
    if (!Number.isInteger(linea.cantidad) || linea.cantidad < 1) return 'La cantidad debe ser un entero mayor a cero.';
    if (linea.cantidad > stockDisponible(linea)) return `No hay suficiente inventario. Máximo: ${stockDisponible(linea)}.`;
    return '';
  }

  function dibujarLineas() {
    const cont = el('editar-venta-lineas');

    if (estado.lineas.length === 0) {
      cont.innerHTML = '<p class="estado-vacio">La venta quedó sin productos. Agrega alguno o cancela; para anularla usa "Eliminar" en el historial.</p>';
      return;
    }

    cont.innerHTML = estado.lineas
      .map((l, i) => {
        const error = mensajeDeLinea(l);
        const maximo = stockDisponible(l);
        const puedeSubir = Number.isInteger(l.cantidad) && l.cantidad < maximo;
        const detalleStock = l.esRapido
          ? '<span class="etiqueta etiqueta-rapido-mini">rápido</span>'
          : `<span class="editar-linea-stock">Máx. ${maximo}</span>`;
        return `
        <div class="editar-linea ${error ? 'editar-linea-invalida' : ''}" data-indice="${i}">
          <div class="editar-linea-info">
            <span class="editar-linea-nombre">${UI.escapar(l.nombre)}</span>
            <span class="editar-linea-precio">${UI.formatoMoneda(l.precioUnitario)} c/u ${detalleStock}</span>
          </div>
          <div class="editar-linea-controles">
            <button type="button" class="btn-cantidad" data-delta="-1" aria-label="Disminuir cantidad" ${Number.isInteger(l.cantidad) && l.cantidad > 1 ? '' : 'disabled'}>−</button>
            <input class="editar-linea-cantidad" type="number" inputmode="numeric" min="1" max="${Number.isFinite(maximo) ? maximo : ''}" step="1" value="${l.cantidad === null ? '' : l.cantidad}" aria-label="Cantidad de ${UI.escapar(l.nombre)}">
            <button type="button" class="btn-cantidad" data-delta="1" aria-label="Aumentar cantidad" ${puedeSubir ? '' : 'disabled'}>+</button>
          </div>
          <span class="editar-linea-subtotal">${error ? '—' : UI.formatoMoneda(subtotalDe(l))}</span>
          <button type="button" class="editar-linea-quitar" data-quitar aria-label="Quitar producto" title="Quitar producto">🗑</button>
          ${error ? `<p class="editar-linea-error">${UI.escapar(error)}</p>` : ''}
        </div>`;
      })
      .join('');
  }

  function refrescarPie() {
    el('editar-venta-total').textContent = UI.formatoMoneda(totalCalculado());

    const hayInvalidas = estado.lineas.some((l) => !cantidadValida(l));
    let aviso = '';
    if (estado.lineas.length === 0) aviso = 'La venta debe tener al menos un producto.';
    else if (hayInvalidas) aviso = 'Corrige las cantidades marcadas antes de guardar.';
    else if (!hayCambios()) aviso = '';

    const caja = el('editar-venta-error');
    caja.textContent = aviso;
    caja.hidden = !aviso;

    el('editar-venta-guardar').disabled = estado.guardando || estado.lineas.length === 0 || hayInvalidas || !hayCambios();
  }

  function redibujar() {
    dibujarLineas();
    refrescarPie();
  }

  // ---- buscador para agregar productos -------------------------------------------------

  function dibujarResultados() {
    const cont = el('editar-venta-resultados');
    const texto = normalizar(el('editar-venta-buscar').value.trim());
    if (!texto) {
      cont.innerHTML = '';
      return;
    }

    const encontrados = Storage.getProductos()
      .filter((p) => normalizar(p.nombre).includes(texto) || normalizar(p.categoria).includes(texto))
      .slice(0, MAX_RESULTADOS);

    if (encontrados.length === 0) {
      cont.innerHTML = '<p class="estado-vacio">No se encontraron productos.</p>';
      return;
    }

    cont.innerHTML = encontrados
      .map((p) => {
        const enVenta = estado.lineas.find((l) => !l.esRapido && l.productoId === p.id);
        const cantidadPrevia = estado.venta.items
          .filter((it) => !it.esRapido && it.productoId === p.id)
          .reduce((suma, it) => suma + it.cantidad, 0);
        const sinStock = !enVenta && p.stock + cantidadPrevia <= 0;
        return `
        <button type="button" class="editar-resultado" data-agregar-producto="${UI.escapar(p.id)}" ${sinStock ? 'disabled' : ''}>
          <span>
            <span class="editar-resultado-nombre">${UI.escapar(p.nombre)}</span>
            <span class="editar-resultado-detalle">${sinStock ? 'Agotado' : `Stock: ${p.stock}`}${enVenta ? ' · ya está en la venta' : ''}</span>
          </span>
          <span class="editar-resultado-precio">${UI.formatoMoneda(enVenta ? enVenta.precioUnitario : p.precio)}</span>
        </button>`;
      })
      .join('');
  }

  function agregarProducto(productoId) {
    const producto = Storage.getProducto(productoId);
    if (!producto) return;

    const existente = estado.lineas.find((l) => !l.esRapido && l.productoId === productoId);
    if (existente) {
      if (Number.isInteger(existente.cantidad) && existente.cantidad < stockDisponible(existente)) {
        existente.cantidad += 1;
      } else {
        UI.mostrarToast(`No hay suficiente inventario disponible de "${producto.nombre}".`, 'error');
        return;
      }
    } else {
      const cantidadPrevia = estado.venta.items
        .filter((it) => !it.esRapido && it.productoId === producto.id)
        .reduce((suma, it) => suma + it.cantidad, 0);
      if (producto.stock + cantidadPrevia < 1) {
        UI.mostrarToast(`No hay suficiente inventario disponible de "${producto.nombre}".`, 'error');
        return;
      }
      // Si el producto ya estaba en la venta original y se quito, al volver a agregarlo
      // conserva su precio de esa venta y lo que ya se habia vendido cuenta como disponible.
      const previas = estado.venta.items.filter((it) => !it.esRapido && it.productoId === producto.id);
      const cantidadOriginal = previas.reduce((suma, it) => suma + it.cantidad, 0);
      estado.lineas.push({
        productoId: producto.id,
        nombre: previas.length ? previas[0].nombre : producto.nombre,
        precioUnitario: previas.length ? previas[0].precioUnitario : producto.precio,
        cantidad: 1,
        cantidadOriginal,
        esRapido: false,
        esNueva: cantidadOriginal === 0,
      });
    }

    el('editar-venta-buscar').value = '';
    dibujarResultados();
    redibujar();
  }

  // ---- eventos de las lineas ---------------------------------------------------------------

  function alHacerClickEnLineas(evento) {
    const fila = evento.target.closest('.editar-linea');
    if (!fila) return;
    const linea = estado.lineas[Number(fila.dataset.indice)];
    if (!linea) return;

    if (evento.target.closest('[data-quitar]')) {
      estado.lineas.splice(Number(fila.dataset.indice), 1);
      redibujar();
      return;
    }

    const boton = evento.target.closest('.btn-cantidad');
    if (boton && !boton.disabled) {
      const base = Number.isInteger(linea.cantidad) ? linea.cantidad : 0;
      linea.cantidad = Math.max(1, base + Number(boton.dataset.delta));
      redibujar();
    }
  }

  function alEscribirCantidad(evento) {
    const campo = evento.target.closest('.editar-linea-cantidad');
    if (!campo) return;
    const fila = campo.closest('.editar-linea');
    const linea = estado.lineas[Number(fila.dataset.indice)];
    if (!linea) return;

    const texto = campo.value.trim();
    // Number('') = 0 y Number('1e3') = 1000: se exige que sea un entero escrito con digitos.
    linea.cantidad = /^-?\d+$/.test(texto) ? Number(texto) : null;

    // Solo se actualizan los datos de esta linea para no perder el foco del campo mientras se escribe.
    const error = mensajeDeLinea(linea);
    fila.classList.toggle('editar-linea-invalida', !!error);
    fila.querySelector('.editar-linea-subtotal').textContent = error ? '—' : UI.formatoMoneda(subtotalDe(linea));

    let cajaError = fila.querySelector('.editar-linea-error');
    if (error) {
      if (!cajaError) {
        cajaError = document.createElement('p');
        cajaError.className = 'editar-linea-error';
        fila.appendChild(cajaError);
      }
      cajaError.textContent = error;
    } else if (cajaError) {
      cajaError.remove();
    }

    const maximo = stockDisponible(linea);
    const enteroValido = Number.isInteger(linea.cantidad);
    const botones = fila.querySelectorAll('.btn-cantidad');
    botones[0].disabled = !(enteroValido && linea.cantidad > 1);
    botones[1].disabled = !(enteroValido && linea.cantidad < maximo);

    refrescarPie();
  }

  // ---- guardar / cerrar ----------------------------------------------------------------------

  function cerrar() {
    UI.cerrarModal('modal-editar-venta');
  }

  async function guardar() {
    if (!estado || estado.guardando) return;
    if (estado.lineas.length === 0 || estado.lineas.some((l) => !cantidadValida(l)) || !hayCambios()) return;

    const total = totalCalculado();
    const confirmado = await UI.confirmar({
      titulo: '¿Deseas guardar los cambios de esta venta?',
      mensaje: 'Se recalculará el total y el inventario se ajustará con la diferencia.',
      detalle: `Venta #${estado.venta.id} · Nuevo total: ${UI.formatoMoneda(total)}`,
      textoAceptar: 'Guardar cambios',
      textoCancelar: 'Cancelar',
    });
    if (!confirmado || !estado) return;

    const actual = estado;
    actual.guardando = true;
    const botonGuardar = el('editar-venta-guardar');
    botonGuardar.disabled = true;
    botonGuardar.textContent = 'Guardando...';

    try {
      await Storage.modificarVenta(
        actual.venta.id,
        actual.lineas.map((l) => ({
          productoId: l.esRapido ? null : l.productoId,
          nombre: l.nombre,
          cantidad: l.cantidad,
          precioUnitario: l.precioUnitario,
          esRapido: l.esRapido,
        })),
        actual.token
      );
      cerrar();
      UI.mostrarToast(`Venta #${actual.venta.id} actualizada. Inventario ajustado.`, 'exito');
      if (typeof actual.alGuardar === 'function') actual.alGuardar();
    } catch (err) {
      if (err.codigo === 'AUTH_EXPIRADA' || err.codigo === 'AUTH_INVALIDA' || err.codigo === 'AUTH_REQUERIDA') {
        cerrar();
        UI.mostrarToast('La autorización venció. Vuelve a presionar "Modificar venta" e ingresa la contraseña.', 'aviso');
      } else if (err.codigo === 'VENTA_NO_ES_DE_HOY') {
        cerrar();
        UI.mostrarToast(err.message, 'error');
        if (typeof actual.alGuardar === 'function') actual.alGuardar();
      } else {
        UI.mostrarToast(err.message || 'No se pudo guardar la venta.', 'error');
        if (estado === actual) {
          // El stock pudo cambiar en otro celular: se refresca lo mostrado.
          dibujarResultados();
          redibujar();
        }
      }
    } finally {
      actual.guardando = false;
      botonGuardar.textContent = 'Guardar cambios';
      if (estado === actual) refrescarPie();
    }
  }

  // ---- API publica -----------------------------------------------------------------------------

  function abrir(venta, token, alGuardar) {
    estado = {
      venta,
      token,
      alGuardar,
      guardando: false,
      lineas: venta.items.map((it) => ({
        productoId: it.productoId,
        nombre: it.nombre,
        precioUnitario: it.precioUnitario,
        cantidad: it.cantidad,
        cantidadOriginal: it.cantidad,
        esRapido: !!it.esRapido,
        esNueva: false,
      })),
    };

    el('editar-venta-titulo').textContent = `Modificar venta #${venta.id}`;
    el('editar-venta-fecha').textContent = UI.formatoFechaCorta(venta.fecha);
    el('editar-venta-buscar').value = '';
    el('editar-venta-resultados').innerHTML = '';
    el('editar-venta-guardar').textContent = 'Guardar cambios';

    redibujar();
    UI.abrirModal('modal-editar-venta');
  }

  function inicializar() {
    el('editar-venta-lineas').addEventListener('click', alHacerClickEnLineas);
    el('editar-venta-lineas').addEventListener('input', alEscribirCantidad);
    el('editar-venta-buscar').addEventListener('input', dibujarResultados);
    el('editar-venta-resultados').addEventListener('click', (evento) => {
      const boton = evento.target.closest('[data-agregar-producto]');
      if (boton && !boton.disabled) agregarProducto(boton.dataset.agregarProducto);
    });
    el('editar-venta-guardar').addEventListener('click', guardar);
    el('editar-venta-cancelar').addEventListener('click', cerrar);
    el('editar-venta-cerrar').addEventListener('click', cerrar);
    el('modal-editar-venta').addEventListener('modal:cerrado', () => {
      // El token de autorizacion no se conserva: cada modificacion pide la contrasena.
      estado = null;
    });
  }

  return { abrir, inicializar };
})();
