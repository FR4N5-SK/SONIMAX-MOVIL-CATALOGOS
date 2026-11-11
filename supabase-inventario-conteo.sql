-- ============================================================
-- SONIMAX MÓVIL - SCRIPT SQL PARA FILTROS Y AUDITORÍA DE INVENTARIO
-- ============================================================
-- Ejecutar en: Supabase Dashboard -> SQL Editor -> New Query -> Run
-- ============================================================

-- 1. Asegurar columnas de configuración de filtros en inventory_config
DO $$
BEGIN
  -- Columna para activar/desactivar filtros restrictivos de inventario
  BEGIN
    ALTER TABLE public.inventory_config ADD COLUMN IF NOT EXISTS filter_active BOOLEAN DEFAULT FALSE;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Columna para precio mínimo de GMayor
  BEGIN
    ALTER TABLE public.inventory_config ADD COLUMN IF NOT EXISTS filter_min_price DECIMAL(12, 2) DEFAULT 0;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Columna para precio máximo de GMayor (opcional)
  BEGIN
    ALTER TABLE public.inventory_config ADD COLUMN IF NOT EXISTS filter_max_price DECIMAL(12, 2) DEFAULT NULL;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Columna para stock mínimo
  BEGIN
    ALTER TABLE public.inventory_config ADD COLUMN IF NOT EXISTS filter_min_stock INTEGER DEFAULT 1;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Columna para stock máximo
  BEGIN
    ALTER TABLE public.inventory_config ADD COLUMN IF NOT EXISTS filter_max_stock INTEGER DEFAULT NULL;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Columna para depósitos activos (JSONB array de nombres de depósito)
  BEGIN
    ALTER TABLE public.inventory_config ADD COLUMN IF NOT EXISTS filter_deposits JSONB DEFAULT '["A","B","C","D","E","PLANTA BAJA","PISO VENTA"]'::jsonb;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Columna JSONB genérica para configuraciones adicionales
  BEGIN
    ALTER TABLE public.inventory_config ADD COLUMN IF NOT EXISTS filter_settings JSONB DEFAULT '{}'::jsonb;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Columna opcional updated_at
  BEGIN
    ALTER TABLE public.inventory_config ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

-- 2. Crear tabla de sesiones / pedidos de conteo de inventario
CREATE TABLE IF NOT EXISTS public.inventory_count_sessions (
  id                  UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  folio               TEXT           UNIQUE NOT NULL,
  user_id             TEXT,
  user_name           TEXT           NOT NULL,
  user_username       TEXT,
  deposito            TEXT           NOT NULL,
  total_items         INTEGER        NOT NULL DEFAULT 0,
  total_piezas        INTEGER        NOT NULL DEFAULT 0,
  total_valor_gmayor  DECIMAL(12, 2) DEFAULT 0,
  diferencia_total    INTEGER        DEFAULT 0,
  items               JSONB          NOT NULL DEFAULT '[]'::jsonb,
  notas               TEXT,
  estado              TEXT           NOT NULL DEFAULT 'enviado',
  fecha               DATE           DEFAULT CURRENT_DATE,
  hora                TEXT,
  created_at          TIMESTAMPTZ    DEFAULT NOW(),
  updated_at          TIMESTAMPTZ    DEFAULT NOW()
);

-- 3. Índices para búsqueda rápida y reportes
CREATE INDEX IF NOT EXISTS idx_inv_sessions_folio      ON public.inventory_count_sessions(folio);
CREATE INDEX IF NOT EXISTS idx_inv_sessions_deposito   ON public.inventory_count_sessions(deposito);
CREATE INDEX IF NOT EXISTS idx_inv_sessions_fecha      ON public.inventory_count_sessions(fecha);
CREATE INDEX IF NOT EXISTS idx_inv_sessions_user_id    ON public.inventory_count_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_inv_sessions_created_at ON public.inventory_count_sessions(created_at);

-- 4. Habilitar RLS y políticas
ALTER TABLE public.inventory_count_sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- Política para SELECT público / autenticado
  DROP POLICY IF EXISTS "inv_sessions_select_public" ON public.inventory_count_sessions;
  CREATE POLICY "inv_sessions_select_public" ON public.inventory_count_sessions 
    FOR SELECT TO public USING (true);

  -- Política para INSERT, UPDATE, DELETE para autenticados
  DROP POLICY IF EXISTS "inv_sessions_all_authenticated" ON public.inventory_count_sessions;
  CREATE POLICY "inv_sessions_all_authenticated" ON public.inventory_count_sessions 
    FOR ALL TO authenticated USING (true) WITH CHECK (true);

  -- Política para anon INSERT por si el cliente usa anon key
  DROP POLICY IF EXISTS "inv_sessions_insert_anon" ON public.inventory_count_sessions;
  CREATE POLICY "inv_sessions_insert_anon" ON public.inventory_count_sessions 
    FOR INSERT TO anon WITH CHECK (true);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 5. Asegurar fila por defecto en inventory_config si no existe
INSERT INTO public.inventory_config (id, edit_enabled, show_stock_enabled)
VALUES (1, true, true)
ON CONFLICT (id) DO NOTHING;

SELECT '✅ Estructura de filtros y pedidos de inventario lista exitosamente' AS resultado;
