const express = require('express');
const router = express.Router();
const { AppError } = require('../middlewares/errorHandler');
const {
  getCategorias,
  crearCategoria,
  eliminarCategoria,
  getProductos,
  getProductoPorId,
  crearProducto,
  actualizarProducto,
  eliminarProducto,
} = require('../controllers/catalogoController');
const {
  getVentas,
  getVentaPorId,
  registrarVenta,
  actualizarVenta,
  eliminarVenta,
} = require('../controllers/ventasController');
const { verificar } = require('../controllers/authController');
const { requerirAutorizacion } = require('../middlewares/auth');

// Cada operacion sensible exige un token de su propio alcance (ver services/seguridad.js).
// Consultar (GET) sigue abierto porque "Nueva venta" necesita el catalogo y los precios.
const protegerInventario = requerirAutorizacion('inventario');
const protegerModificarVenta = requerirAutorizacion('ventas_modificar', { paramVenta: 'id' });
const protegerEliminarVenta = requerirAutorizacion('ventas_eliminar', { paramVenta: 'id' });

router.get('/health', (req, res) => {
  res.json({ ok: true, mensaje: 'Servidor de la distribuidora funcionando correctamente.' });
});

router.post('/auth/verificar', verificar);

router.get('/categorias', getCategorias);
router.post('/categorias', protegerInventario, crearCategoria);
router.delete('/categorias/:nombre', protegerInventario, eliminarCategoria);

router.get('/productos', getProductos);
router.get('/productos/:id', getProductoPorId);
router.post('/productos', protegerInventario, crearProducto);
router.put('/productos/:id', protegerInventario, actualizarProducto);
router.delete('/productos/:id', protegerInventario, eliminarProducto);

router.get('/ventas', getVentas);
router.get('/ventas/:id', getVentaPorId);
router.post('/ventas', registrarVenta);
router.put('/ventas/:id', protegerModificarVenta, actualizarVenta);
router.delete('/ventas/:id', protegerEliminarVenta, eliminarVenta);

router.use((req, res, next) => {
  next(new AppError('Ruta no encontrada.', 404));
});

module.exports = router;
