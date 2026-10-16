-- ============================================================
-- SONIMAX MÓVIL - TABLA PARA SINCRONIZAR LISTAS DE PRECIOS VALERY
-- Ejecutar este script en: Supabase Dashboard -> SQL Editor -> New Query
-- ============================================================

-- 1. Crear tabla para almacenar las listas de etiquetas
CREATE TABLE IF NOT EXISTS valery_price_lists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Habilitar Seguridad por Fila (Row Level Security)
ALTER TABLE valery_price_lists ENABLE ROW LEVEL SECURITY;

-- 3. Crear políticas para lectura, inserción, actualización y eliminación
DROP POLICY IF EXISTS "Permitir lectura valery_price_lists" ON valery_price_lists;
CREATE POLICY "Permitir lectura valery_price_lists"
ON valery_price_lists FOR SELECT
TO public
USING (true);

DROP POLICY IF EXISTS "Permitir inserción valery_price_lists" ON valery_price_lists;
CREATE POLICY "Permitir inserción valery_price_lists"
ON valery_price_lists FOR INSERT
TO public
WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir actualización valery_price_lists" ON valery_price_lists;
CREATE POLICY "Permitir actualización valery_price_lists"
ON valery_price_lists FOR UPDATE
TO public
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS "Permitir eliminación valery_price_lists" ON valery_price_lists;
CREATE POLICY "Permitir eliminación valery_price_lists"
ON valery_price_lists FOR DELETE
TO public
USING (true);

-- 4. Índice para agilizar el ordenamiento por fecha de creación
CREATE INDEX IF NOT EXISTS idx_valery_price_lists_created_at ON valery_price_lists(created_at);

-- 5. Recargar la caché de la API de Supabase para que reconozca la tabla de inmediato
NOTIFY pgrst, 'reload schema';
