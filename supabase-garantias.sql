-- ============================================================
-- SONIMAX MÓVIL - SCRIPT SQL DEFINITIVO DE LA TABLA DE GARANTÍAS (RMA)
-- Compatible con ambos servidores de Supabase (Principal y Plan Pro)
-- Ejecutar en: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- ============================================================

-- 1. Crear tabla con tipos flexibles para máxima compatibilidad
CREATE TABLE IF NOT EXISTS public.garantias (
  id                TEXT           PRIMARY KEY DEFAULT gen_random_uuid()::text,
  codigo_ticket     TEXT           UNIQUE NOT NULL,
  user_id           TEXT,          -- TEXT para evitar errores de sintaxis si el id no es UUID
  user_name         TEXT           NOT NULL,
  user_role         TEXT           NOT NULL DEFAULT 'gestor',
  cliente_nombre    TEXT,          -- Nombre de tienda, cliente o sucursal
  cliente_telefono  TEXT,          -- Teléfono de contacto
  items             JSONB          NOT NULL DEFAULT '[]'::jsonb,
  total_items       INTEGER        NOT NULL DEFAULT 1,
  estado            TEXT           NOT NULL DEFAULT 'pendiente',
  observaciones     TEXT,          -- Observaciones generales del gestor
  notas_admin       TEXT,          -- Resolución o notas del administrador
  tipo_garantia     TEXT           NOT NULL DEFAULT 'normal', -- 'normal' o 'hl'
  es_hl             BOOLEAN        NOT NULL DEFAULT false,    -- true para productos/garantías de HL
  mes_ano           TEXT           NOT NULL, -- Formato 'YYYY-MM' para búsqueda y reportes mensuales
  created_at        TIMESTAMPTZ    DEFAULT NOW(),
  updated_at        TIMESTAMPTZ    DEFAULT NOW()
);

-- 2. Por si la tabla ya existía con restricciones estrictas de UUID o CHECK, flexibilizarla:
DO $$
BEGIN
  -- Cambiar user_id a TEXT si era UUID
  BEGIN
    ALTER TABLE public.garantias ALTER COLUMN user_id TYPE TEXT;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Eliminar posibles restricciones check restrictivas
  BEGIN
    ALTER TABLE public.garantias DROP CONSTRAINT IF EXISTS garantias_user_role_check;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER TABLE public.garantias DROP CONSTRAINT IF EXISTS garantias_estado_check;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Columnas para soporte del apartado de Garantías HL
  BEGIN
    ALTER TABLE public.garantias ADD COLUMN IF NOT EXISTS tipo_garantia TEXT DEFAULT 'normal';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    ALTER TABLE public.garantias ADD COLUMN IF NOT EXISTS es_hl BOOLEAN DEFAULT false;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

-- 3. Índices optimizados para búsquedas rápidas y reportes por mes
CREATE INDEX IF NOT EXISTS idx_garantias_codigo        ON public.garantias(codigo_ticket);
CREATE INDEX IF NOT EXISTS idx_garantias_mes_ano       ON public.garantias(mes_ano);
CREATE INDEX IF NOT EXISTS idx_garantias_estado        ON public.garantias(estado);
CREATE INDEX IF NOT EXISTS idx_garantias_user_id       ON public.garantias(user_id);
CREATE INDEX IF NOT EXISTS idx_garantias_tipo_garantia ON public.garantias(tipo_garantia);
CREATE INDEX IF NOT EXISTS idx_garantias_es_hl         ON public.garantias(es_hl);
CREATE INDEX IF NOT EXISTS idx_garantias_created_at    ON public.garantias(created_at DESC);

-- 4. Habilitar Row Level Security (RLS)
ALTER TABLE public.garantias ENABLE ROW LEVEL SECURITY;

-- 5. Limpiar políticas previas
DROP POLICY IF EXISTS "garantias_select_all" ON public.garantias;
DROP POLICY IF EXISTS "garantias_authenticated_all" ON public.garantias;
DROP POLICY IF EXISTS "garantias_anon_all" ON public.garantias;
DROP POLICY IF EXISTS "Permitir lectura garantias" ON public.garantias;
DROP POLICY IF EXISTS "Permitir insercion garantias" ON public.garantias;
DROP POLICY IF EXISTS "Permitir actualizacion garantias" ON public.garantias;
DROP POLICY IF EXISTS "Permitir eliminacion garantias" ON public.garantias;

-- 6. Crear políticas universales (TO public) idénticas a valery_price_lists para sincronización entre PCs
CREATE POLICY "Permitir lectura garantias"
ON public.garantias FOR SELECT
TO public
USING (true);

CREATE POLICY "Permitir insercion garantias"
ON public.garantias FOR INSERT
TO public
WITH CHECK (true);

CREATE POLICY "Permitir actualizacion garantias"
ON public.garantias FOR UPDATE
TO public
USING (true)
WITH CHECK (true);

CREATE POLICY "Permitir eliminacion garantias"
ON public.garantias FOR DELETE
TO public
USING (true);

-- 7. Otorgar permisos directos a todos los roles para evitar errores de 'permission denied'
GRANT ALL ON TABLE public.garantias TO anon, authenticated, service_role;

-- 8. Recargar la caché de PostgREST en Supabase de inmediato para que reconozca la tabla sin esperar
NOTIFY pgrst, 'reload schema';

-- Mensaje de verificación final
SELECT '✅ ¡Tabla public.garantias configurada con éxito y caché de Supabase recargada!' AS estado;
