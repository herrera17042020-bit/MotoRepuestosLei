/**
 * generar-seguridad-local.js
 * -----------------------------------------------------------------------
 * Modo LOCAL / OFFLINE (celular sin servidor): la app no puede consultar al backend,
 * asi que necesita algo con que comparar la contrasena escrita. Este script toma las
 * contrasenas del archivo .env y genera public/js/security-config.js con SOLO sus
 * hashes salados (PBKDF2-SHA256). Nunca escribe las contrasenas en texto plano.
 *
 * Uso:   npm run security:local
 * Luego, si usas Capacitor/Android:   npx cap copy android
 *
 * IMPORTANTE: en modo local la proteccion es una barrera de la interfaz (cualquiera con
 * acceso al dispositivo y conocimientos tecnicos podria saltarsela). La seguridad real
 * es la del servidor: con backend activo, las mismas contrasenas se validan alla.
 * -----------------------------------------------------------------------
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ITERACIONES = 60000;
const CREDENCIALES = [
  ['inventario', 'INVENTARIO_PASSWORD'],
  ['resumen', 'RESUMEN_PASSWORD'],
  ['ventas_modificar', 'VENTAS_MODIFICAR_PASSWORD'],
  ['ventas_eliminar', 'VENTAS_ELIMINAR_PASSWORD'],
];

const faltantes = CREDENCIALES.filter(([, variable]) => !(process.env[variable] || '').length).map(([, v]) => v);
if (faltantes.length > 0) {
  console.error(`Faltan estas variables en el archivo .env: ${faltantes.join(', ')}`);
  process.exit(1);
}

const valores = CREDENCIALES.map(([, variable]) => process.env[variable]);
if (new Set(valores).size !== valores.length) {
  console.error('Las cuatro contraseñas deben ser diferentes entre sí (inventario, resumen, modificar ventas y eliminar ventas).');
  process.exit(1);
}

const credenciales = {};
for (const [scope, variable] of CREDENCIALES) {
  const sal = crypto.randomBytes(16);
  const hash = crypto.pbkdf2Sync(process.env[variable], sal, ITERACIONES, 32, 'sha256');
  credenciales[scope] = { sal: sal.toString('base64'), hash: hash.toString('base64') };
}

const configuracion = { version: 1, algoritmo: 'PBKDF2-SHA256', iteraciones: ITERACIONES, credenciales };

const contenido = `/**
 * GENERADO AUTOMATICAMENTE por scripts/generar-seguridad-local.js  (no editar a mano).
 * Contiene solo hashes con sal para el modo local/offline; jamas contrasenas en texto plano.
 * Para cambiar una contrasena: edita el .env y vuelve a ejecutar:  npm run security:local
 */
window.SECURITY_CONFIG = ${JSON.stringify(configuracion, null, 2)};
`;

const destino = path.join(__dirname, '..', 'public', 'js', 'security-config.js');
fs.writeFileSync(destino, contenido, 'utf8');
console.log('Listo: se generó public/js/security-config.js (solo hashes, sin contraseñas).');
console.log('Si usas la app Android (Capacitor), ejecuta ahora:  npx cap copy android');
