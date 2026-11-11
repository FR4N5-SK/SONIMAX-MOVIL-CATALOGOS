-- ============================================================
-- SONIMAX MÓVIL - SCRIPT SQL PARA FILTROS Y AUDITORÍA DE INVENTARIO
-- ============================================================
-- INSTRUCCIONES:
-- 1. Ve a tu panel de Supabase: https://supabase.com/dashboard/project/gvaitosnfotnkrpjojqn
-- 2. Entra en el menú izquierdo en "SQL Editor"
-- 3. Crea una "New query"
-- 4. Pega TODO este código y presiona "RUN"
--
-- NOTA DE SEGURIDAD:
-- Este script es 100% SEGURO. NO borra productos, NO altera inventario físico,
-- NO elimina usuarios ni borra configuraciones previas.
-- Solo agrega columnas nuevas si no existen y crea la tabla de pedidos de inventario.
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

-- 2. Crear tabla de sesiones / pedidos de conteo de inventario (auditoría oficial)
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

-- 3. Índices para búsqueda rápida y reportes por fecha, depósito, folio y usuario
CREATE INDEX IF NOT EXISTS idx_inv_sessions_folio      ON public.inventory_count_sessions(folio);
CREATE INDEX IF NOT EXISTS idx_inv_sessions_deposito   ON public.inventory_count_sessions(deposito);
CREATE INDEX IF NOT EXISTS idx_inv_sessions_fecha      ON public.inventory_count_sessions(fecha);
CREATE INDEX IF NOT EXISTS idx_inv_sessions_user_id    ON public.inventory_count_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_inv_sessions_created_at ON public.inventory_count_sessions(created_at);

-- 4. Habilitar Seguridad por Fila (RLS) y Políticas
ALTER TABLE public.inventory_count_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inv_sessions_select_all" ON public.inventory_count_sessions;
CREATE POLICY "inv_sessions_select_all" ON public.inventory_count_sessions 
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "inv_sessions_insert_all" ON public.inventory_count_sessions;
CREATE POLICY "inv_sessions_insert_all" ON public.inventory_count_sessions 
  FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "inv_sessions_update_all" ON public.inventory_count_sessions;
CREATE POLICY "inv_sessions_update_all" ON public.inventory_count_sessions 
  FOR UPDATE USING (true);

-- Otorgar permisos completos a anon y authenticated
GRANT ALL ON TABLE public.inventory_config TO anon, authenticated, service_role;
GRANT ALL ON TABLE public.inventory_count_sessions TO anon, authenticated, service_role;

-- 5. Asegurar fila id=1 en inventory_config
INSERT INTO public.inventory_config (id, edit_enabled, show_stock_enabled)
VALUES (1, true, true)
ON CONFLICT (id) DO NOTHING;

-- 6. Recargar caché de esquema de PostgREST para que detecte las nuevas columnas de inmediato
NOTIFY pgrst, 'reload schema';

SELECT '✅ Estructura de filtros y pedidos de inventario lista exitosamente en Supabase' AS resultado;
