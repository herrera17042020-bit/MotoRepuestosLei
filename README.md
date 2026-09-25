# MOTOREPUESTOS LEÍ · Sistema de ventas e inventario

Sistema de ventas e inventario para una distribuidora de productos basicos.
Frontend web movil (HTML/CSS/JS) + Backend Node.js/Express + Prisma + PostgreSQL.

## Estado actual

**Frontend: completo y funcional**, usando `localStorage` como almacenamiento temporal
(con datos de demostracion). Incluye Inicio, Nueva venta (con carrito y producto rapido),
Inventario, Ventas (historial) y Resumen.

**Backend (Node/Express/Prisma/PostgreSQL):** la API ya contiene las rutas de catalogo,
ventas y autorizacion. En produccion, PostgreSQL/Supabase debe ser la fuente de verdad;
`localStorage` queda solamente como cache y respaldo del modo local.

## Como probar el frontend AHORA (sin backend ni base de datos)

No necesitas `npm install` para esto. Solo un servidor estatico simple, por ejemplo:

```bash
cd public
python3 -m http.server 5500
```

Abre `http://localhost:5500` en el navegador (o desde el celular usando la IP de tu
computadora en la misma red, ej. `http://192.168.1.X:5500`). La app carga con productos
y ventas de ejemplo ya cargados.

## Cuando conectes el backend (Node/Express/Prisma/PostgreSQL)

## Requisitos

- Node.js 18 o superior
- PostgreSQL 14 o superior instalado localmente y administrado con pgAdmin 4

## Instalacion

```bash
npm install
cp .env.example .env
# Edita .env con las cadenas reales de PostgreSQL/Supabase
npm run dev
```

Con `npm run dev` corriendo, `http://localhost:3000` sirve la misma carpeta `public/`
(ya que Express sirve estaticos desde ahi), y `http://localhost:3000/api/health` confirma
que el servidor esta arriba.

## Seguridad con contraseñas (inventario, modificar y eliminar ventas)

Hay tres contraseñas independientes. Se definen SOLO en tu archivo `.env` (nunca en el código):

| Variable | Protege |
| --- | --- |
| `INVENTARIO_PASSWORD` | Entrar a Inventario y crear/editar/eliminar productos y categorías |
| `VENTAS_MODIFICAR_PASSWORD` | Modificar ventas **del día actual** |
| `VENTAS_ELIMINAR_PASSWORD` | Eliminar ventas (debe ser distinta a la anterior) |

Además: `AUTH_SECRET` (texto largo aleatorio para firmar las sesiones) y `APP_TIMEZONE` (por defecto `America/Managua`, define cuándo termina "el día").
Genera un `AUTH_SECRET` con: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### PostgreSQL local y pgAdmin 4 (una sola vez)

```bash
npm install
cp .env.example .env            # completa DATABASE_URL y las variables de arriba
npx prisma generate
npx prisma db push              # crea/actualiza las tablas PostgreSQL
npm run security:local          # SOLO para el modo local/offline y la app Android
npm run cap:copy                # solo si usas la app Android
npm run dev                     # o: npm start
```

Los comandos de Android usan el ejecutable local de Capacitor y deben ejecutarse
desde la carpeta que contiene `package.json`:

```bash
npm run cap:copy                # copia los archivos web a Android
npm run cap:sync                # sincroniza plugins y archivos web
npm run cap:open                # abre el proyecto en Android Studio
```

No uses `npm cap copy`; esa sintaxis no existe. Si prefieres ejecutar Capacitor
directamente, utiliza `npx cap copy android`.

### Supabase y Android con inventario compartido

La APK actual está configurada para trabajar de forma independiente en cada
dispositivo. En este modo no necesita API, Node.js ni conexión a Internet:
productos, ventas, inventario y configuración se guardan localmente en el
dispositivo mediante el almacenamiento de la aplicación. Los datos no se
comparten entre teléfonos. Para generar esta versión basta ejecutar
`npm run cap:copy` y compilar el APK desde Android Studio.

La sección siguiente solo aplica si más adelante deseas volver a compartir el
inventario mediante Supabase:

Para que todos los teléfonos trabajen sobre un único inventario:

1. En Supabase crea un proyecto nuevo y guarda la contraseña de la base. En
   **Project Settings > Database > Connect** copia la cadena de **Session pooler**
   (recomendada para servidores con muchas conexiones) o la conexión directa. Sustituye
   `DATABASE_URL` en las variables privadas del servidor. No pongas esa URL en JavaScript
   ni en el APK.
2. En el servidor instala Node.js 18+, copia el proyecto y ejecuta `npm install`.
   Define como variables privadas `DATABASE_URL`, `AUTH_SECRET`, las tres contraseñas,
   `APP_TIMEZONE`, `API_BASE_URL` y `CORS_ORIGINS`. Usa valores distintos a los del
   archivo `.env` de desarrollo.
3. Desde el servidor ejecuta `npx prisma generate` y `npm run prisma:deploy`. Esto crea
   las tablas de Prisma en la base PostgreSQL de Supabase. Si ya tienes datos importantes,
   haz un respaldo y revisa el esquema antes de ejecutar cambios.
4. Despliega `npm start` detrás de HTTPS (Render, Railway, Fly.io, VPS con Nginx u otro
   proveedor). Configura el puerto usando la variable `PORT`. Comprueba:
   `GET https://tu-api-publica.example/api/health`.
5. En `CORS_ORIGINS` permite solo los orígenes que realmente usarás, separados por comas:
   `capacitor://localhost,http://localhost` y el dominio web público, si existe.
6. Edita `public/js/app-config.js` y coloca **la misma URL pública** en
   `window.APP_API_BASE`, sin `/api` al final:

   ```js
   window.APP_API_BASE = 'https://tu-api-publica.example';
   ```

7. En el equipo de compilación ejecuta `npm run cap:sync` y abre Android Studio con
   `npm run cap:open`. Todas las APK construidas desde esa copia usarán la misma API y, por tanto, la misma
   base de datos e inventario.

Con `window.APP_API_BASE` vacío la APK usa el modo local descrito arriba. La app
Android necesita permiso de Internet únicamente cuando se conecta a una API
compartida; el permiso ya está incluido en
`android/app/src/main/AndroidManifest.xml`.
Después de cambiar esa URL debes repetir `npm run cap:copy` o `npm run cap:sync`.

La aplicación consulta y escribe productos, categorías, ventas y stock mediante la API.
`localStorage` solo conserva el carrito y una copia temporal para mejorar el arranque;
cuando la API está disponible, las escrituras esperan la confirmación de PostgreSQL y las
ventas descuentan stock dentro de una transacción atómica.

En PostgreSQL local usa `localhost:5432` en `DATABASE_URL` y crea la base
`MotorepuestosLei` desde pgAdmin 4. El usuario y la contraseña deben coincidir con tu
instalación local de PostgreSQL.

`npx prisma db push` crea o actualiza las tablas PostgreSQL. No convierte ni copia los datos
de una base MySQL anterior. Para una base PostgreSQL local nueva es el flujo recomendado.
El SQL manual equivalente está en `prisma/sql/001_venta_modificadaAt.sql`.

### Cómo funciona

- **Con servidor:** el backend valida las contraseñas y entrega una autorización firmada que el celular guarda en la sesión (nunca la contraseña). Las rutas sensibles del servidor rechazan cualquier petición sin ella.
- **Sin servidor (localStorage):** se compara contra hashes con sal generados por `npm run security:local` (`public/js/security-config.js`, no se sube a git). Es una barrera de la interfaz: la seguridad real es la del servidor.
- Modificar/eliminar pide la contraseña **cada vez** y la autorización sirve solo para esa venta.
- Al modificar o eliminar una venta, el inventario se ajusta automáticamente; el stock nunca queda negativo.
- El servidor deja un registro `[AUDITORIA]` en consola de cada venta modificada o eliminada.

### Pruebas

```bash
npm test    # incluye pruebas sin base de datos; tests/api.test.js necesita PostgreSQL disponible
```
