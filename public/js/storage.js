/**
 * storage.js
 * -----------------------------------------------------------------------
 * Capa de datos de la aplicacion. TODA la lectura/escritura de datos pasa
 * por las funciones de este archivo (objeto `Storage`).
 *
 * Con la API disponible, PostgreSQL/Supabase es la fuente de verdad y
 * localStorage solo conserva una copia para pintar la interfaz rápidamente.
 * Ningun otro archivo (ventas.js, inventario.js, dashboard.js, resumen.js)
 * deberia tocar `localStorage` directamente: todos hablan con `Storage`.
 * -----------------------------------------------------------------------
 */

const Storage = (function () {
  const CLAVES = {
    PRODUCTOS: 'distribuidora_productos',
    VENTAS: 'distribuidora_ventas',
    CONTADOR_FOLIO: 'distribuidora_contador_folio',
    CARRITO: 'distribuidora_carrito',
    CATEGORIAS: 'distribuidora_categorias',
    SEMILLA: 'distribuidora_semilla_v1',
  };

  const UMBRAL_POCO_STOCK = 10;
  const MARCA_ENTREGA_LIMPIA = 'entrega_limpia_v1';
  const DEMO_DATA_HABILITADA = window.DEMO_DATA_HABILITADA !== false;

  const CATEGORIAS_BASE = ['Motor', 'Frenos', 'Suspensión', 'Ruedas y neumáticos', 'Eléctrica', 'Accesorios'];
  function normalizarApiBase(base) {
    if (typeof base !== 'string') return '';
    const limpia = base.trim();
    if (!limpia) return '';
    const sinSlash = limpia.replace(/\/+$/, '');
    return /\/api$/i.test(sinSlash) ? sinSlash : `${sinSlash}/api`;
  }

  // En producción móvil, define la URL pública del backend en window.APP_API_BASE.
  // No uses localhost / 127.0.0.1 / 192.168.x.x como servidor de producción.
  // Ejemplo: window.APP_API_BASE = 'https://TU-API-EN-RENDER.onrender.com';
  const apiBaseConfigurada = typeof window.APP_API_BASE === 'string'
    ? window.APP_API_BASE.trim()
    : '';
  const API_BASE = normalizarApiBase(apiBaseConfigurada);
  const CLOUD_ONLY = Boolean(API_BASE);

  function errorSinConexion(mensaje = 'No hay conexión con el servidor. La operación no puede completarse hasta recuperar la conexión.') {
    return new Error(mensaje);
  }

  // ---- utilidades internas -----------------------------------------

  // Token de autorizacion vigente (lo guarda el modulo Security; aqui nunca se ve la contrasena).
  function tokenDe(scope) {
    return typeof Security !== 'undefined' ? Security.getToken(scope) : null;
  }

  /**
   * Llamada JSON a la API.
   *  - options.auth:    'inventario' => adjunta el token de autorizacion del inventario.
   *  - options.timeout: milisegundos antes de abortar la peticion.
   * Si el servidor responde con error, el Error lanzado trae `status` y `codigo`;
   * si no hay conexion (o no hay servidor) el Error NO trae `status`.
   */
  async function requestJson(url, options = {}) {
    const { auth, timeout, headers: encabezadosExtra, ...resto } = options;
    const headers = { 'Content-Type': 'application/json', ...(encabezadosExtra || {}) };
    if (auth) {
      const token = tokenDe(auth);
      if (token) headers['X-Auth-Token'] = token;
    }

    const controlador = timeout && typeof AbortController !== 'undefined' ? new AbortController() : null;
    const temporizador = controlador ? setTimeout(() => controlador.abort(), timeout) : null;

    let response;
    try {
      response = await fetch(url, { ...resto, headers, signal: controlador ? controlador.signal : undefined });
    } finally {
      if (temporizador) clearTimeout(temporizador);
    }

    const texto = await response.text();
    let data = null;
    if (texto) {
      try {
        data = JSON.parse(texto);
      } catch (err) {
        // Un servidor estatico responde HTML (404/index): eso NO es la API.
        if (response.ok) throw new Error('La respuesta del servidor no es válida.');
      }
    }

    if (!response.ok) {
      const error = new Error((data && data.error) || 'Error al consultar la API.');
      error.status = response.status;
      error.codigo = data && data.codigo;
      throw error;
    }

    return data;
  }

  // ---- deteccion del backend ------------------------------------------------
  // La app funciona con servidor (API + PostgreSQL) o sola en el dispositivo (localStorage).
  // Las acciones sensibles (autorizar, modificar/eliminar ventas) preguntan cual de los
  // dos modos esta activo, para no tratar un servidor caido como si fuera modo local.

  const VIGENCIA_ESTADO_BACKEND_MS = 20000;
  let estadoBackend = { activo: null, ts: 0 };
  let inicializacion = null;

  async function detectarBackend(forzar = false) {
    if (!API_BASE) return false;
    if (!forzar && estadoBackend.activo !== null && Date.now() - estadoBackend.ts < VIGENCIA_ESTADO_BACKEND_MS) {
      return estadoBackend.activo;
    }
    let activo = false;
    try {
      const respuesta = await requestJson(`${API_BASE}/health`, { timeout: 2500 });
      activo = !!(respuesta && respuesta.ok === true);
    } catch (err) {
      activo = false;
    }
    estadoBackend = { activo, ts: Date.now() };
    return activo;
  }

  /**
   * Trae los datos reales del servidor y los copia al cache local.
   * IMPORTANTE: solo se sobrescribe lo que el servidor SI devolvio. Si no hay servidor
   * (modo local/offline) se conservan los datos del dispositivo intactos.
   */
  function sincronizarDesdeApi() {
    if (!API_BASE) return Promise.resolve(false);
    return Promise.all([
      requestJson(`${API_BASE}/productos`, { timeout: 8000 }).catch(() => null),
      requestJson(`${API_BASE}/categorias`, { timeout: 8000 }).catch(() => null),
      requestJson(`${API_BASE}/ventas`, { timeout: 8000 }).catch(() => null),
    ])
      .then(([productos, categorias, ventas]) => {
        let alguno = false;
        if (Array.isArray(productos)) { escribir(CLAVES.PRODUCTOS, productos); alguno = true; }
        if (Array.isArray(categorias)) { escribir(CLAVES.CATEGORIAS, categorias); alguno = true; }
        if (Array.isArray(ventas)) { escribir(CLAVES.VENTAS, ventas); alguno = true; }
        if (alguno) escribir(CLAVES.SEMILLA, true);
        return alguno;
      })
      .catch(() => false);
  }

  async function inicializar() {
    if (!inicializacion) {
      inicializacion = (async () => {
        const backend = await detectarBackend(true);
        if (backend) {
          await sincronizarDesdeApi();
          escribir(CLAVES.SEMILLA, true);
          return true;
        }
        sembrarSiNecesarioLocal();
        return false;
      })();
    }
    return inicializacion;
  }

  // Si el servidor rechaza una escritura por autorización, se avisa a la interfaz
  // y se vuelve a traer el estado real para que el caché no quede desfasado.
  function manejarErrorSegundoPlano(err) {
    if (err && (err.status === 401 || err.status === 403)) {
      document.dispatchEvent(new CustomEvent('storage:autorizacion-rechazada', {
        detail: { codigo: err.codigo, mensaje: err.message },
      }));
      sincronizarDesdeApi();
    }
    // Sin servidor (modo local) los errores de red son esperados y se ignoran.
  }

  function leer(clave, porDefecto) {
    try {
      const crudo = localStorage.getItem(clave);
      return crudo ? JSON.parse(crudo) : porDefecto;
    } catch (err) {
      console.error(`No se pudo leer "${clave}" de localStorage:`, err);
      return porDefecto;
    }
  }

  function escribir(clave, valor) {
    try {
      localStorage.setItem(clave, JSON.stringify(valor));
    } catch (err) {
      console.error(`No se pudo guardar "${clave}" en localStorage:`, err);
    }
  }

  function generarId(prefijo) {
    return `${prefijo}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  }

  // Los precios se manejan como cordobas enteros, sin centavos.
  function redondear(valor) {
    return Math.round(Number(valor) || 0);
  }

  function calcularEstado(stock) {
    if (stock <= 0) return 'agotado';
    if (stock <= UMBRAL_POCO_STOCK) return 'poco_stock';
    return 'disponible';
  }

  // ---- semilla de datos de demostracion ------------------------------

  function fechaHace({ dias = 0, horas = 0, minutos = 0 }) {
    const f = new Date();
    f.setDate(f.getDate() - dias);
    f.setHours(f.getHours() - horas, f.getMinutes() - minutos, 0, 0);
    return f.toISOString();
  }

  function sembrarSiNecesarioLocal() {
    if (!DEMO_DATA_HABILITADA) {
      if (leer(CLAVES.SEMILLA, '') !== MARCA_ENTREGA_LIMPIA) {
        [CLAVES.PRODUCTOS, CLAVES.VENTAS, CLAVES.CONTADOR_FOLIO, CLAVES.CARRITO, CLAVES.CATEGORIAS].forEach((clave) => localStorage.removeItem(clave));
        escribir(CLAVES.SEMILLA, MARCA_ENTREGA_LIMPIA);
      }
      return;
    }

    if (leer(CLAVES.SEMILLA, false)) {
      return;
    }

    const productosBase = [
      { nombre: 'Filtro de aceite', categoria: 'Motor', precio: 220, stock: 42 },
      { nombre: 'Pastilla de freno', categoria: 'Frenos', precio: 180, stock: 16 },
      { nombre: 'Bujía', categoria: 'Motor', precio: 95, stock: 60 },
      { nombre: 'Cadena de moto', categoria: 'Motor', precio: 420, stock: 9 },
      { nombre: 'Neumático 17"', categoria: 'Ruedas y neumáticos', precio: 680, stock: 8 },
      { nombre: 'Kit de embrague', categoria: 'Motor', precio: 540, stock: 10 },
      { nombre: 'Amortiguador delantero', categoria: 'Suspensión', precio: 430, stock: 7 },
      { nombre: 'Manillar', categoria: 'Accesorios', precio: 220, stock: 18 },
      { nombre: 'Faro LED', categoria: 'Eléctrica', precio: 310, stock: 14 },
      { nombre: 'Aceite 10W40', categoria: 'Motor', precio: 180, stock: 30 },
      { nombre: 'Disco de freno', categoria: 'Frenos', precio: 260, stock: 21 },
      { nombre: 'Cable de acelerador', categoria: 'Accesorios', precio: 120, stock: 38 },
      { nombre: 'Lámpara de señal', categoria: 'Eléctrica', precio: 90, stock: 52 },
      { nombre: 'Kit de limpieza', categoria: 'Accesorios', precio: 70, stock: 24 },
    ];

    const productos = productosBase.map((p) => ({
      id: generarId('prod'),
      nombre: p.nombre,
      categoria: p.categoria,
      precio: p.precio,
      stock: p.stock,
      estado: calcularEstado(p.stock),
      activo: true,
      createdAt: fechaHace({ dias: 30 }),
      updatedAt: fechaHace({ dias: 30 }),
    }));

    const buscar = (nombre) => productos.find((p) => p.nombre === nombre);

    function crearVenta(folio, fechaISO, combinacion) {
      const items = combinacion.map(([nombre, cantidad]) => {
        const p = buscar(nombre);
        const subtotal = redondear(p.precio * cantidad);
        return {
          productoId: p.id,
          nombre: p.nombre,
          cantidad,
          precioUnitario: p.precio,
          subtotal,
          esRapido: false,
        };
      });
      const total = redondear(items.reduce((s, it) => s + it.subtotal, 0));
      return { id: folio, fecha: fechaISO, items, total };
    }

    const ventas = [
      // --- dias anteriores (para el grafico de 7 dias y "mas vendidos") ---
      crearVenta(1020, fechaHace({ dias: 6, horas: 3 }), [['Filtro de aceite', 6], ['Disco de freno', 2]]),
      crearVenta(1021, fechaHace({ dias: 6, horas: 1 }), [['Pastilla de freno', 4], ['Kit de limpieza', 5]]),
      crearVenta(1022, fechaHace({ dias: 6, horas: 0.5 }), [['Cable de acelerador', 8], ['Lámpara de señal', 3]]),

      crearVenta(1023, fechaHace({ dias: 5, horas: 4 }), [['Filtro de aceite', 10], ['Aceite 10W40', 3]]),
      crearVenta(1024, fechaHace({ dias: 5, horas: 2 }), [['Faro LED', 6], ['Kit de limpieza', 4]]),

      crearVenta(1025, fechaHace({ dias: 4, horas: 5 }), [['Filtro de aceite', 8], ['Disco de freno', 3], ['Pastilla de freno', 2]]),
      crearVenta(1026, fechaHace({ dias: 4, horas: 3 }), [['Manillar', 4], ['Cadena de moto', 5]]),
      crearVenta(1027, fechaHace({ dias: 4, horas: 1 }), [['Bujía', 3], ['Kit de embrague', 1]]),

      crearVenta(1028, fechaHace({ dias: 3, horas: 6 }), [['Filtro de aceite', 12], ['Disco de freno', 4]]),
      crearVenta(1029, fechaHace({ dias: 3, horas: 4 }), [['Pastilla de freno', 6], ['Aceite 10W40', 4]]),
      crearVenta(1030, fechaHace({ dias: 3, horas: 2 }), [['Cable de acelerador', 10], ['Faro LED', 5]]),

      crearVenta(1031, fechaHace({ dias: 2, horas: 5 }), [['Cadena de moto', 3], ['Disco de freno', 5]]),
      crearVenta(1032, fechaHace({ dias: 2, horas: 3 }), [['Kit de limpieza', 8], ['Bujía', 2]]),
      crearVenta(1033, fechaHace({ dias: 2, horas: 1 }), [['Filtro de aceite', 9], ['Pastilla de freno', 3]]),

      crearVenta(1034, fechaHace({ dias: 1, horas: 6 }), [['Filtro de aceite', 14], ['Disco de freno', 6]]),
      crearVenta(1035, fechaHace({ dias: 1, horas: 4 }), [['Manillar', 5], ['Kit de limpieza', 6]]),
      crearVenta(1036, fechaHace({ dias: 1, horas: 2 }), [['Lámpara de señal', 4], ['Cadena de moto', 3], ['Bujía', 2]]),
      crearVenta(1037, fechaHace({ dias: 1, horas: 1 }), [['Pastilla de freno', 5], ['Aceite 10W40', 2]]),

      // --- hoy ---
      crearVenta(1040, fechaHace({ minutos: 25 }), [['Cadena de moto', 10], ['Bujía', 5]]),
      crearVenta(1041, fechaHace({ minutos: 12 }), [['Faro LED', 4], ['Kit de limpieza', 12]]),
      crearVenta(1042, fechaHace({ minutos: 5 }), [['Manillar', 9], ['Cable de acelerador', 9]]),
    ];

    escribir(CLAVES.PRODUCTOS, productos);
    escribir(CLAVES.VENTAS, ventas);
    escribir(CLAVES.CONTADOR_FOLIO, 1043);
    escribir(CLAVES.CARRITO, []);
    escribir(CLAVES.CATEGORIAS, CATEGORIAS_BASE.slice());
    escribir(CLAVES.SEMILLA, true);
  }

  function sembrarSiNecesario() {
    // Mantiene compatibilidad con las pantallas y pruebas que usan el modo
    // offline de forma síncrona; la inicialización cloud sigue siendo asíncrona.
    sembrarSiNecesarioLocal();
    return inicializar();
  }

  // ---- API publica: CATEGORIAS ----------------------------------------

  function getCategorias() {
    return leer(CLAVES.CATEGORIAS, CATEGORIAS_BASE.slice());
  }

  async function agregarCategoria(nombre) {
    const limpio = (nombre || '').trim();
    if (!limpio) throw new Error('El nombre de la categoría no puede estar vacío.');

    const backend = await detectarBackend();
    if (backend) {
      const creada = await requestJson(`${API_BASE}/categorias`, {
        method: 'POST',
        auth: 'inventario',
        body: JSON.stringify({ nombre: limpio }),
      });
      await sincronizarDesdeApi();
      return getCategorias().length ? getCategorias() : [creada];
    }
    if (CLOUD_ONLY) throw errorSinConexion();

    const categorias = getCategorias();
    const yaExiste = categorias.some((c) => c.toLowerCase() === limpio.toLowerCase());
    if (yaExiste) throw new Error(`La categoría "${limpio}" ya existe.`);

    categorias.push(limpio);
    escribir(CLAVES.CATEGORIAS, categorias);

    return categorias;
  }

  async function eliminarCategoria(nombre) {
    if (await detectarBackend()) {
      await requestJson(`${API_BASE}/categorias/${encodeURIComponent(nombre)}`, { method: 'DELETE', auth: 'inventario' });
      await sincronizarDesdeApi();
      return nombre;
    }
    if (CLOUD_ONLY) throw errorSinConexion();

    const categorias = getCategorias();
    const categoria = categorias.find((c) => c.toLowerCase() === nombre.toLowerCase());
    if (!categoria) throw new Error('Categoría no encontrada.');

    const tieneProductos = getProductos().some((producto) => producto.categoria.toLowerCase() === categoria.toLowerCase());
    if (tieneProductos) throw new Error('No se puede eliminar una categoría que tiene productos asociados.');

    escribir(CLAVES.CATEGORIAS, categorias.filter((c) => c !== categoria));
    return categoria;
  }

  // ---- API publica: PRODUCTOS ----------------------------------------

  function getProductos() {
    return leer(CLAVES.PRODUCTOS, []);
  }

  function getProducto(id) {
    return getProductos().find((p) => p.id === id) || null;
  }

  async function crearProducto({ nombre, categoria, precio, stock }) {
    if (await detectarBackend()) {
      const creado = await requestJson(`${API_BASE}/productos`, {
        method: 'POST',
        auth: 'inventario',
        body: JSON.stringify({ nombre, categoria, precio, stock }),
      });
      await sincronizarDesdeApi();
      return creado;
    }
    if (CLOUD_ONLY) throw errorSinConexion();

    const productos = getProductos();
    const nombreLimpio = (nombre || '').trim();
    const categoriaLimpia = (categoria || '').trim();
    const stockNumerico = Math.max(0, Math.trunc(Number(stock) || 0));
    const precioNumerico = redondear(Number(precio) || 0);

    const productoExistente = productos.find((p) => {
      if (!p.activo) return false;
      return p.nombre.trim().toLowerCase() === nombreLimpio.toLowerCase() && p.categoria.trim().toLowerCase() === categoriaLimpia.toLowerCase();
    });

    if (productoExistente) {
      productoExistente.stock += stockNumerico;
      productoExistente.precio = precioNumerico > 0 ? precioNumerico : productoExistente.precio;
      productoExistente.estado = calcularEstado(productoExistente.stock);
      productoExistente.updatedAt = new Date().toISOString();
      escribir(CLAVES.PRODUCTOS, productos);

      return productoExistente;
    }

    const nuevo = {
      id: generarId('prod'),
      nombre: nombreLimpio,
      categoria: categoriaLimpia,
      precio: precioNumerico,
      stock: stockNumerico,
      estado: calcularEstado(stockNumerico),
      activo: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    productos.push(nuevo);
    escribir(CLAVES.PRODUCTOS, productos);

    return nuevo;
  }

  async function actualizarProducto(id, cambios) {
    if (await detectarBackend()) {
      const actualizado = await requestJson(`${API_BASE}/productos/${encodeURIComponent(id)}`, {
        method: 'PUT',
        auth: 'inventario',
        body: JSON.stringify(cambios),
      });
      await sincronizarDesdeApi();
      return actualizado;
    }
    if (CLOUD_ONLY) throw errorSinConexion();

    const productos = getProductos();
    const idx = productos.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error('Producto no encontrado.');

    const actualizado = { ...productos[idx], ...cambios, updatedAt: new Date().toISOString() };
    if (typeof cambios.precio === 'number') actualizado.precio = redondear(cambios.precio);
    if (typeof cambios.stock === 'number') {
      actualizado.stock = Math.max(0, Math.trunc(cambios.stock));
      actualizado.estado = calcularEstado(actualizado.stock);
    }
    productos[idx] = actualizado;
    escribir(CLAVES.PRODUCTOS, productos);

    return actualizado;
  }

  async function agregarStock(id, cantidad) {
    const producto = getProducto(id);
    if (!producto) throw new Error('Producto no encontrado.');
    const cantidadNumerica = Math.trunc(Number(cantidad));
    if (!Number.isFinite(cantidadNumerica) || cantidadNumerica <= 0) {
      throw new Error('La cantidad a agregar debe ser un numero positivo.');
    }
    return actualizarProducto(id, { stock: producto.stock + cantidadNumerica });
  }

  async function eliminarProducto(id) {
    if (await detectarBackend()) {
      await requestJson(`${API_BASE}/productos/${encodeURIComponent(id)}`, { method: 'DELETE', auth: 'inventario' });
      await sincronizarDesdeApi();
      return true;
    }
    if (CLOUD_ONLY) throw errorSinConexion();

    const productos = getProductos();
    const existe = productos.some((p) => p.id === id);
    if (!existe) throw new Error('Producto no encontrado.');
    escribir(CLAVES.PRODUCTOS, productos.filter((p) => p.id !== id));

    const carrito = getCarrito().filter((item) => item.productoId !== id);
    escribir(CLAVES.CARRITO, carrito);
  }

  // ---- API publica: CARRITO (venta en curso) --------------------------

  function getCarrito() {
    return leer(CLAVES.CARRITO, []);
  }

  function guardarCarrito(items) {
    escribir(CLAVES.CARRITO, items);
  }

  function vaciarCarrito() {
    escribir(CLAVES.CARRITO, []);
  }

  // ---- API publica: VENTAS --------------------------------------------

  function getVentas() {
    return leer(CLAVES.VENTAS, []).slice().sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
  }

  function getVenta(id) {
    return leer(CLAVES.VENTAS, []).find((v) => String(v.id) === String(id)) || null;
  }

  function siguienteFolio() {
    return leer(CLAVES.CONTADOR_FOLIO, 1000);
  }

  /**
   * Registra una venta a partir de los items del carrito.
   * Valida stock, descuenta inventario de productos registrados
   * (los "productos rapidos" con productoId === null NO descuentan stock)
   * y limpia el carrito. Lanza un Error con mensaje claro si algo falla,
   * para que la UI lo muestre igual que lo haria un error de servidor.
   */
  async function registrarVenta(itemsCarrito) {
    if (!itemsCarrito || itemsCarrito.length === 0) {
      throw new Error('El carrito esta vacio.');
    }

    if (await detectarBackend(true)) {
      const venta = await requestJson(`${API_BASE}/ventas`, {
        method: 'POST',
        body: JSON.stringify({ items: itemsCarrito }),
        timeout: 15000,
      });
      await sincronizarDesdeApi();
      vaciarCarrito();
      return venta;
    }
    if (CLOUD_ONLY) {
      throw errorSinConexion('No hay conexión con el servidor. La venta no puede registrarse hasta recuperar la conexión.');
    }

    const productos = getProductos();

    for (const item of itemsCarrito) {
      if (item.esRapido) continue;
      const producto = productos.find((p) => p.id === item.productoId);
      if (!producto) {
        throw new Error(`El producto "${item.nombre}" ya no existe en el inventario.`);
      }
      if (producto.stock < item.cantidad) {
        throw new Error(`No hay suficiente inventario disponible de "${producto.nombre}".`);
      }
    }

    const productosActualizados = productos.map((p) => ({ ...p }));
    for (const item of itemsCarrito) {
      if (item.esRapido) continue;
      const producto = productosActualizados.find((p) => p.id === item.productoId);
      producto.stock -= item.cantidad;
      producto.estado = calcularEstado(producto.stock);
      producto.updatedAt = new Date().toISOString();
    }
    escribir(CLAVES.PRODUCTOS, productosActualizados);

    const folio = siguienteFolio();
    const total = redondear(itemsCarrito.reduce((s, it) => s + it.subtotal, 0));
    const venta = {
      id: folio,
      fecha: new Date().toISOString(),
      items: itemsCarrito.map((it) => ({
        productoId: it.esRapido ? null : it.productoId,
        nombre: it.nombre,
        cantidad: it.cantidad,
        precioUnitario: it.precioUnitario,
        subtotal: it.subtotal,
        esRapido: !!it.esRapido,
      })),
      total,
    };

    const ventas = leer(CLAVES.VENTAS, []);
    ventas.push(venta);
    escribir(CLAVES.VENTAS, ventas);
    escribir(CLAVES.CONTADOR_FOLIO, folio + 1);

    vaciarCarrito();
    return venta;
  }

  // ---- API publica: AUTORIZACION, MODIFICAR Y ELIMINAR VENTAS ------------------

  /** "Ventas del dia": la fecha de la venta cae en el dia de hoy (hora local del dispositivo). */
  function esVentaDeHoy(venta) {
    return !!venta && VentasLogica.esDelDiaActual(venta.fecha);
  }

  /**
   * Pide al SERVIDOR que verifique una contrasena. Solo se usa con backend activo.
   * Devuelve { ok: true, token, expiraEn } o { ok: false, codigo, mensaje, status }.
   * Lanza Error (sin `status`) si no hay conexion.
   */
  async function autenticar(scope, password, ventaId) {
    try {
      const respuesta = await requestJson(`${API_BASE}/auth/verificar`, {
        method: 'POST',
        body: JSON.stringify({ scope, password, ventaId }),
        timeout: 8000,
      });
      return { ok: true, token: respuesta.token, expiraEn: respuesta.expiraEn };
    } catch (err) {
      if (err.status) return { ok: false, codigo: err.codigo, mensaje: err.message, status: err.status };
      throw new Error('No se pudo conectar con el servidor para verificar la contraseña.');
    }
  }

  function convertirErrorDeRed(err) {
    if (err && !err.status) return new Error('No se pudo conectar con el servidor. Revisa la conexión e inténtalo de nuevo.');
    return err;
  }

  function exigirAutorizacionLocal(scope, token, ventaId) {
    const valida = typeof Security !== 'undefined' && Security.validarTokenLocal(scope, token, ventaId);
    if (!valida) {
      const error = new Error('La autorización no es válida o venció. Ingresa la contraseña nuevamente.');
      error.codigo = 'AUTH_INVALIDA';
      throw error;
    }
  }

  function aplicarAjustesDeStock(ajustes) {
    const productos = getProductos().map((p) => ({ ...p }));
    for (const ajuste of ajustes) {
      const producto = productos.find((p) => p.id === ajuste.productoId);
      if (!producto) continue;
      const nuevoStock = producto.stock + ajuste.delta;
      if (nuevoStock < 0) throw new Error(`No hay suficiente inventario disponible de "${producto.nombre}".`);
      producto.stock = nuevoStock;
      producto.estado = calcularEstado(nuevoStock);
      producto.updatedAt = new Date().toISOString();
    }
    return productos;
  }

  /**
   * Modifica una venta DEL DIA. `items` = lineas nuevas ({ productoId, nombre, cantidad,
   * precioUnitario, esRapido }); el total y los subtotales SIEMPRE se recalculan
   * (VentasLogica) sin importar lo que envie la pantalla.
   *  - Con backend: lo hace el servidor (valida token, dia, stock) y aqui se refresca el cache.
   *  - Sin backend: se aplica sobre localStorage con exactamente las mismas reglas.
   */
  async function modificarVenta(id, items, token) {
    const backend = await detectarBackend(true);

    if (backend) {
      try {
        const cuerpo = items.map((it) => ({
          productoId: it.esRapido ? null : it.productoId,
          nombre: it.nombre,
          cantidad: it.cantidad,
          precioUnitario: it.precioUnitario,
          esRapido: !!it.esRapido,
        }));
        const respuesta = await requestJson(`${API_BASE}/ventas/${encodeURIComponent(id)}`, {
          method: 'PUT',
          headers: { 'X-Auth-Token': token || '' },
          body: JSON.stringify({ items: cuerpo }),
          timeout: 15000,
        });
        await sincronizarDesdeApi();
        return respuesta;
      } catch (err) {
        throw convertirErrorDeRed(err);
      }
    }
    if (CLOUD_ONLY) throw errorSinConexion();

    // ---- modo local ----
    exigirAutorizacionLocal('ventas_modificar', token, id);
    const ventas = leer(CLAVES.VENTAS, []);
    const indice = ventas.findIndex((v) => String(v.id) === String(id));
    if (indice === -1) throw new Error('Venta no encontrada.');
    const original = ventas[indice];
    if (!esVentaDeHoy(original)) throw new Error('Solo se pueden modificar las ventas del día actual.');

    const productos = getProductos();
    const plan = VentasLogica.planificarEdicion({
      original,
      nuevos: items,
      obtenerProducto: (productoId) => productos.find((p) => p.id === productoId),
    });

    const productosActualizados = aplicarAjustesDeStock(plan.ajustesStock);
    const actualizada = { ...original, items: plan.items, total: plan.total, modificadaAt: new Date().toISOString() };
    ventas[indice] = actualizada;

    escribir(CLAVES.PRODUCTOS, productosActualizados);
    escribir(CLAVES.VENTAS, ventas);
    return actualizada;
  }

  /**
   * Elimina una venta y devuelve al inventario lo vendido de productos registrados.
   * Con backend lo hace el servidor en una transaccion; sin backend, sobre localStorage.
   */
  async function eliminarVenta(id, token) {
    const backend = await detectarBackend(true);

    if (backend) {
      try {
        await requestJson(`${API_BASE}/ventas/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: { 'X-Auth-Token': token || '' },
          timeout: 15000,
        });
        await sincronizarDesdeApi();
        return true;
      } catch (err) {
        throw convertirErrorDeRed(err);
      }
    }
    if (CLOUD_ONLY) throw errorSinConexion();

    // ---- modo local ----
    exigirAutorizacionLocal('ventas_eliminar', token, id);
    const ventas = leer(CLAVES.VENTAS, []);
    const original = ventas.find((v) => String(v.id) === String(id));
    if (!original) throw new Error('Venta no encontrada.');

    const plan = VentasLogica.planificarEliminacion(original);
    const productosActualizados = aplicarAjustesDeStock(plan.ajustesStock);

    escribir(CLAVES.PRODUCTOS, productosActualizados);
    escribir(CLAVES.VENTAS, ventas.filter((v) => String(v.id) !== String(id)));
    return true;
  }

  // ---- API publica: ESTADISTICAS --------------------------------------

  function getVentasEntre(fechaInicio, fechaFin) {
    return getVentas().filter((v) => {
      const f = new Date(v.fecha);
      return f >= fechaInicio && f <= fechaFin;
    });
  }

  function getVentasDeHoy() {
    const inicio = new Date();
    inicio.setHours(0, 0, 0, 0);
    const fin = new Date();
    fin.setHours(23, 59, 59, 999);
    return getVentasEntre(inicio, fin);
  }

  return {
    UMBRAL_POCO_STOCK,
    sembrarSiNecesario,
    redondear,
    calcularEstado,
    // categorias
    getCategorias,
    agregarCategoria,
    eliminarCategoria,
    // productos
    getProductos,
    getProducto,
    crearProducto,
    actualizarProducto,
    agregarStock,
    eliminarProducto,
    // carrito
    getCarrito,
    guardarCarrito,
    vaciarCarrito,
    // ventas
    getVentas,
    getVenta,
    siguienteFolio,
    registrarVenta,
    esVentaDeHoy,
    modificarVenta,
    eliminarVenta,
    getVentasEntre,
    getVentasDeHoy,
    // conexion y autorizacion
    detectarBackend,
    sincronizar: sincronizarDesdeApi,
    inicializar,
    autenticar,
  };
})();
