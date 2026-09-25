const prisma = require('./prisma');

function calcularEstado(stock) {
  if (stock <= 0) return 'agotado';
  if (stock <= 10) return 'poco_stock';
  return 'disponible';
}

async function seedDemoData() {
  const categoriasBase = ['Motor', 'Frenos', 'Suspensión', 'Ruedas y neumáticos', 'Eléctrica', 'Accesorios'];

  const existentes = await prisma.categoria.findMany();
  if (existentes.length > 0) return;

  const categorias = await Promise.all(
    categoriasBase.map((nombre) => prisma.categoria.create({ data: { nombre } }))
  );

  const categoriaMap = Object.fromEntries(categorias.map((categoria) => [categoria.nombre, categoria.id]));

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

  await Promise.all(
    productosBase.map((producto) =>
      prisma.producto.create({
        data: {
          nombre: producto.nombre,
          categoriaId: categoriaMap[producto.categoria],
          precio: producto.precio,
          stock: producto.stock,
          activo: true,
        },
      })
    )
  );

  const ventasBase = [
    {
      total: 650,
      items: [
        { nombre: 'Filtro de aceite', cantidad: 2, precioUnitario: 220, subtotal: 440, esRapido: false },
        { nombre: 'Kit de limpieza', cantidad: 3, precioUnitario: 70, subtotal: 210, esRapido: false },
      ],
    },
    {
      total: 540,
      items: [
        { nombre: 'Pastilla de freno', cantidad: 3, precioUnitario: 180, subtotal: 540, esRapido: false },
      ],
    },
  ];

  for (const venta of ventasBase) {
    await prisma.venta.create({
      data: {
        total: venta.total,
        items: {
          create: venta.items.map((item) => ({
            nombre: item.nombre,
            cantidad: item.cantidad,
            precioUnitario: item.precioUnitario,
            subtotal: item.subtotal,
            esRapido: item.esRapido,
          })),
        },
      },
    });
  }
}

module.exports = { seedDemoData, calcularEstado };
