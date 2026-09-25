-- Cambio de base de datos para "modificar ventas del dia" (auditoria), PostgreSQL.
-- Agrega UNA columna opcional; no toca ni borra datos existentes.
--
-- Forma recomendada (Prisma):   npx prisma db push
-- Forma manual (equivalente), si prefieres correr SQL tu mismo:
ALTER TABLE "venta" ADD COLUMN IF NOT EXISTS "modificadaAt" TIMESTAMP(3);
