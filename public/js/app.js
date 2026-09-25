/**
 * app.js
 * Punto de entrada de la aplicacion. Inicializa los datos de demostracion,
 * la navegacion, y decide que modulo renderizar segun la pantalla activa.
 */

document.addEventListener('DOMContentLoaded', async () => {
  await Storage.inicializar();

  UI.inicializarNavegacion();
  UI.inicializarCierreGlobalModales();
  UI.inicializarConfirmacion();
  Security.inicializar();
  EditarVenta.inicializar();
  Ventas.inicializarEventosGlobales();
  Inventario.inicializarEventosGlobales();

  const renderizadoresPorPantalla = {
    inicio: Dashboard.renderizar,
    venta: Ventas.renderizar,
    inventario: Inventario.renderizar,
    ventas: Historial.renderizar,
    resumen: Resumen.renderizar,
  };

  let pantallaActual = null;
  let pantallaPrevia = 'venta';

  UI.onCambioPantalla((nombre) => {
    if (nombre !== pantallaActual) {
      if (pantallaActual && pantallaActual !== 'inventario') pantallaPrevia = pantallaActual;
      pantallaActual = nombre;
    }

    // Inventario: sin autorizacion vigente se pide la contrasena ANTES de mostrar nada.
    if (nombre === 'inventario' && !Security.inventarioAutorizado()) {
      Inventario.renderizarBloqueado();
      Security.solicitar('inventario').then((resultado) => {
        if (pantallaActual !== 'inventario') return;
        if (resultado && resultado.ok) Inventario.renderizar();
        else UI.irAPantalla(pantallaPrevia); // cancelo: vuelve a donde estaba
      });
      return;
    }

    // Resumen: sus cifras solo se muestran despues de autorizar este alcance.
    if (nombre === 'resumen' && !Security.resumenAutorizado()) {
      Resumen.renderizarBloqueado();
      Security.solicitar('resumen').then((resultado) => {
        if (pantallaActual !== 'resumen') return;
        if (resultado && resultado.ok) Resumen.renderizar();
        else UI.irAPantalla(pantallaPrevia);
      });
      return;
    }

    const renderizar = renderizadoresPorPantalla[nombre];
    if (renderizar) renderizar();
  });

  // El servidor rechazo una escritura del inventario (autorizacion vencida, servidor reiniciado...).
  document.addEventListener('storage:autorizacion-rechazada', () => {
    Security.cerrarSesion('inventario');
    UI.mostrarToast('La autorización del inventario venció. Ingresa la contraseña nuevamente.', 'aviso');
    if (pantallaActual === 'inventario') UI.irAPantalla('inventario');
  });

  // Pantalla inicial: "Nueva venta" es lo primero que necesita el vendedor
  UI.irAPantalla('venta');
});
