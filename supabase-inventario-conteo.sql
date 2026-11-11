-- ============================================================
-- SONIMAX MÓVIL - SCRIPT SQL PARA FILTROS Y AUDITORÍA DE INVENTARIO
-- ============================================================
-- IMPORTANTE:
-- En tu aplicación existen dos proyectos de Supabase configurados:
-- 1. Servidor Principal: https://supabase.com/dashboard/project/gvaitosnfotnkrpjojqn
-- 2. Servidor Plan Pro:  https://supabase.com/dashboard/project/tuqwzrsgczhgmfnfmryw
--
-- Por favor ejecuta este script en AMBOS proyectos (o en el que estés usando)
-- en: Supabase Dashboard -> SQL Editor -> New Query -> Run.
--
-- NOTA DE SEGURIDAD:
-- Este script es 100% SEGURO. NO borra productos, NO altera inventario físico,
-- NO elimina usuarios ni borra datos existentes.
-- ============================================================

-- 1. Asegurar columnas de configuración de filtros en inventory_config
ALTER TABLE public.inventory_config ADD COLUMN IF NOT EXISTS filter_active BOOLEAN DEFAULT FALSE;
ALTER TABLE public.inventory_config ADD COLUMN IF NOT EXISTS filter_min_price DECIMAL(12, 2) DEFAULT 0;
ALTER TABLE public.inventory_config ADD COLUMN IF NOT EXISTS filter_max_price DECIMAL(12, 2) DEFAULT NULL;
ALTER TABLE public.inventory_config ADD COLUMN IF NOT EXISTS filter_min_stock INTEGER DEFAULT 1;
ALTER TABLE public.inventory_config ADD COLUMN IF NOT EXISTS filter_max_stock INTEGER DEFAULT NULL;
ALTER TABLE public.inventory_config ADD COLUMN IF NOT EXISTS filter_min_total_value DECIMAL(12, 2) DEFAULT 0;
ALTER TABLE public.inventory_config ADD COLUMN IF NOT EXISTS filter_deposits JSONB DEFAULT '["A","B","C","D","E","PLANTA BAJA","PISO VENTA"]'::jsonb;
ALTER TABLE public.inventory_config ADD COLUMN IF NOT EXISTS filter_settings JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.inventory_config ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Configurar permisos de inventory_config (deshabilitar RLS para permitir guardar filtros entre dispositivos)
ALTER TABLE public.inventory_config DISABLE ROW LEVEL SECURITY;

-- 3. Crear tabla de sesiones / pedidos de conteo de inventario (auditoría oficial)
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

-- 4. Índices para búsqueda rápida y reportes por fecha, depósito, folio y usuario
CREATE INDEX IF NOT EXISTS idx_inv_sessions_folio      ON public.inventory_count_sessions(folio);
CREATE INDEX IF NOT EXISTS idx_inv_sessions_deposito   ON public.inventory_count_sessions(deposito);
CREATE INDEX IF NOT EXISTS idx_inv_sessions_fecha      ON public.inventory_count_sessions(fecha);
CREATE INDEX IF NOT EXISTS idx_inv_sessions_user_id    ON public.inventory_count_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_inv_sessions_created_at ON public.inventory_count_sessions(created_at);

-- 5. Habilitar Seguridad por Fila (RLS) permisiva en sesiones de conteo
ALTER TABLE public.inventory_count_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inv_sessions_all_policy" ON public.inventory_count_sessions;
CREATE POLICY "inv_sessions_all_policy" ON public.inventory_count_sessions 
  FOR ALL TO anon, authenticated, public USING (true) WITH CHECK (true);

-- 6. Otorgar permisos completos a anon, authenticated y service_role
GRANT ALL ON TABLE public.inventory_config TO anon, authenticated, service_role, postgres;
GRANT ALL ON TABLE public.inventory_count_sessions TO anon, authenticated, service_role, postgres;

-- 7. Asegurar fila id=1 en inventory_config si no existe
INSERT INTO public.inventory_config (id, edit_enabled, show_stock_enabled)
VALUES (1, true, true)
ON CONFLICT (id) DO NOTHING;

-- 8. Recargar caché de esquema de PostgREST
NOTIFY pgrst, 'reload schema';

SELECT '✅ Estructura de filtros y pedidos de inventario lista exitosamente en Supabase' AS resultado;
