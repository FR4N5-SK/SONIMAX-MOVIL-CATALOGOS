-- ============================================================
-- SONIMAX MÓVIL - SCRIPT SQL COMPLETO DE BASE DE DATOS
-- ============================================================
-- Versión compatible con importación de CSV sin restricciones de claves externas
-- ============================================================

-- Limpiar base de datos si ya existe
DROP TABLE IF EXISTS public.user_carts         CASCADE;
DROP TABLE IF EXISTS public.favorites          CASCADE;
DROP TABLE IF EXISTS public.inventory_config   CASCADE;
DROP TABLE IF EXISTS public.inventory_products CASCADE;
DROP TABLE IF EXISTS public.best_selling_products CASCADE;
DROP TABLE IF EXISTS public.product_sales      CASCADE;
DROP TABLE IF EXISTS public.products           CASCADE;
DROP TABLE IF EXISTS public.banners            CASCADE;
DROP TABLE IF EXISTS public.users              CASCADE;

DROP TRIGGER  IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.admin_change_user_password(UUID, TEXT) CASCADE;
DROP FUNCTION IF EXISTS public.set_updated_at() CASCADE;

-- ============================================================
-- 1. TABLA: users (Cargable desde users_rows (2).csv)
--    NOTA: Se retiró la restricción REFERENCES auth.users(id)
--          para permitir importar usuarios antiguos sin que existan aún en Auth.
-- ============================================================
CREATE TABLE public.users (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id        UUID        UNIQUE, -- Identificador de autenticación (UUID de auth.users)
  username       TEXT        UNIQUE NOT NULL,
  name           TEXT        NOT NULL,
  email          TEXT,
  role           TEXT        NOT NULL DEFAULT 'cliente' 
                 CHECK (role IN ('cliente', 'distribuidor', 'gestor', 'admin', 'inventario')),
  created_by     UUID,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  can_see_stock  BOOLEAN     DEFAULT TRUE
);

CREATE INDEX idx_users_auth_id  ON public.users(auth_id);
CREATE INDEX idx_users_username ON public.users(username);
CREATE INDEX idx_users_role     ON public.users(role);

-- ============================================================
-- 2. TABLA: products (Cargable desde products_rows (2).csv)
-- ============================================================
CREATE TABLE public.products (
  id             UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo         TEXT,
  nombre         TEXT           NOT NULL,
  descripcion    TEXT,
  departamento   TEXT           NOT NULL,
  precio_cliente DECIMAL(12, 2) NOT NULL DEFAULT 0,
  precio_mayor   DECIMAL(12, 2) NOT NULL DEFAULT 0,
  precio_gmayor  DECIMAL(12, 2) NOT NULL DEFAULT 0,
  stock          INTEGER        DEFAULT 0,
  imagen_url     TEXT,
  is_new         BOOLEAN        DEFAULT FALSE,
  created_at     TIMESTAMPTZ    DEFAULT NOW(),
  updated_at     TIMESTAMPTZ    DEFAULT NOW(),
  in_transit     BOOLEAN        DEFAULT FALSE,
  deleted_at     TIMESTAMPTZ,
  estado         TEXT
);

CREATE INDEX idx_products_codigo       ON public.products(codigo);
CREATE INDEX idx_products_departamento ON public.products(departamento);
CREATE INDEX idx_products_is_new       ON public.products(is_new);

-- ============================================================
-- 3. TABLA: inventory_products (Cargable desde inventory_products_rows.csv)
-- ============================================================
CREATE TABLE public.inventory_products (
  id                UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo            TEXT           UNIQUE NOT NULL,
  descripcion       TEXT,
  precio_detal      DECIMAL(12, 2) DEFAULT 0,
  precio_mayor      DECIMAL(12, 2) DEFAULT 0,
  precio_gmayor     DECIMAL(12, 2) DEFAULT 0,
  existencia_actual INTEGER        DEFAULT 0,
  departamento      TEXT,
  deposito          TEXT,
  cantidad_fisica   INTEGER        DEFAULT 0,
  created_at        TIMESTAMPTZ    DEFAULT NOW(),
  updated_at        TIMESTAMPTZ    DEFAULT NOW()
);

CREATE INDEX idx_inv_codigo      ON public.inventory_products(codigo);
CREATE INDEX idx_inv_deposito    ON public.inventory_products(deposito);

-- ============================================================
-- 4. TABLA: inventory_config (Cargable desde inventory_config_rows.csv)
-- ============================================================
CREATE TABLE public.inventory_config (
  id                 INTEGER      PRIMARY KEY DEFAULT 1,
  edit_enabled       BOOLEAN      DEFAULT FALSE,
  show_stock_enabled BOOLEAN      DEFAULT FALSE,
  role_visibility    JSONB        DEFAULT '{"admin": true, "gestor": true, "cliente": false, "inventario": true, "distribuidor": false}'::jsonb,
  created_at         TIMESTAMPTZ  DEFAULT NOW(),
  updated_at         TIMESTAMPTZ  DEFAULT NOW()
);

-- ============================================================
-- 5. TABLA: favorites (Cargable desde favorites_rows.csv)
--    NOTA: Se retiró REFERENCES auth.users(id) para facilitar la importación.
-- ============================================================
CREATE TABLE public.favorites (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL, -- Guarda el auth_id del usuario
  product_id UUID        NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, product_id)
);

CREATE INDEX idx_favorites_user_id    ON public.favorites(user_id);
CREATE INDEX idx_favorites_product_id ON public.favorites(product_id);

-- ============================================================
-- 6. TABLA: user_carts (Cargable desde user_carts_rows.csv)
--    NOTA: Se retiró REFERENCES auth.users(id) para facilitar la importación.
-- ============================================================
CREATE TABLE public.user_carts (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        UNIQUE NOT NULL, -- Guarda el auth_id del usuario
  items      JSONB       DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  cart_data  JSONB       DEFAULT '[]'::jsonb
);

CREATE INDEX idx_user_carts_user_id ON public.user_carts(user_id);

-- ============================================================
-- 7. TABLA: banners (Cargable desde banners_rows.csv)
-- ============================================================
CREATE TABLE public.banners (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo     TEXT,
  imagen_url TEXT        NOT NULL,
  posicion   INTEGER     DEFAULT 0,
  activo     BOOLEAN     DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_banners_activo ON public.banners(activo);

-- ============================================================
-- 8. TABLA: product_sales (Cargable desde product_sales_rows.csv)
--    NOTA: Se retiró REFERENCES auth.users(id) para facilitar la importación.
-- ============================================================
CREATE TABLE public.product_sales (
  id            UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID           REFERENCES public.products(id) ON DELETE CASCADE,
  cantidad      INTEGER        DEFAULT 1,
  fecha         TIMESTAMPTZ    DEFAULT NOW(),
  user_id       UUID, -- Guarda el auth_id del usuario
  quantity_sold INTEGER        DEFAULT 1,
  sale_price    DECIMAL(12, 2) DEFAULT 0,
  created_at    TIMESTAMPTZ    DEFAULT NOW()
);

CREATE INDEX idx_sales_product_id ON public.product_sales(product_id);
CREATE INDEX idx_sales_user_id    ON public.product_sales(user_id);

-- ============================================================
-- 9. TABLA: best_selling_products (Cargable desde best_selling_products_rows.csv)
-- ============================================================
CREATE TABLE public.best_selling_products (
  product_id         UUID           PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  nombre             TEXT,
  departamento       TEXT,
  precio_cliente     DECIMAL(12, 2),
  imagen_url         TEXT,
  total_sold         INTEGER        DEFAULT 0,
  total_transactions INTEGER        DEFAULT 0
);

-- ============================================================
-- FUNCIÓN: updated_at automático
-- ============================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers de updated_at
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_inv_products_updated_at
  BEFORE UPDATE ON public.inventory_products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_inv_config_updated_at
  BEFORE UPDATE ON public.inventory_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_user_carts_updated_at
  BEFORE UPDATE ON public.user_carts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- FUNCIÓN + TRIGGER: Crear perfil de usuario automáticamente
-- MEJORADO: Vincula cuentas existentes importadas por CSV al registrarse.
-- ============================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  target_username TEXT;
  target_name TEXT;
  existing_user_id UUID;
BEGIN
  target_username := COALESCE(NEW.raw_user_meta_data->>'username', 'user_' || substring(NEW.id::text, 1, 8));
  target_name := COALESCE(NEW.raw_user_meta_data->>'name', 'Usuario');

  -- Verificar si el usuario ya existe en public.users (importado desde CSV)
  SELECT id INTO existing_user_id FROM public.users WHERE username = target_username LIMIT 1;

  IF existing_user_id IS NOT NULL THEN
    -- Si el perfil existe en la tabla importada, actualizamos su auth_id para vincularlo al nuevo inicio de sesión
    UPDATE public.users 
    SET auth_id = NEW.id,
        email = NEW.email
    WHERE id = existing_user_id;
  ELSE
    -- Si es un usuario nuevo, insertamos su perfil normalmente
    INSERT INTO public.users (auth_id, username, name, email, role, can_see_stock)
    VALUES (
      NEW.id,
      target_username,
      target_name,
      NEW.email,
      'cliente',
      TRUE
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- FUNCIÓN RPC: Cambiar contraseña (solo admin)
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_change_user_password(
  target_auth_id UUID,
  new_password   TEXT
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE auth.users
  SET encrypted_password = crypt(new_password, gen_salt('bf'))
  WHERE id = target_auth_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_change_user_password(UUID, TEXT) TO authenticated;

-- ============================================================
-- ROW LEVEL SECURITY (RLS) - CONFIGURACIÓN DE POLÍTICAS
-- ============================================================
ALTER TABLE public.users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_config   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_carts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banners            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_sales      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.best_selling_products ENABLE ROW LEVEL SECURITY;

-- Politicas para USERS
CREATE POLICY "users_select_public" ON public.users FOR SELECT TO public USING (true);
CREATE POLICY "users_all_authenticated" ON public.users FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Politicas para PRODUCTS
CREATE POLICY "products_select_public" ON public.products FOR SELECT TO public USING (true);
CREATE POLICY "products_all_authenticated" ON public.products FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Politicas para INVENTORY_PRODUCTS
CREATE POLICY "inv_products_select_public" ON public.inventory_products FOR SELECT TO public USING (true);
CREATE POLICY "inv_products_all_authenticated" ON public.inventory_products FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Politicas para INVENTORY_CONFIG
CREATE POLICY "inv_config_select_public" ON public.inventory_config FOR SELECT TO public USING (true);
CREATE POLICY "inv_config_all_authenticated" ON public.inventory_config FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Politicas para BANNERS
CREATE POLICY "banners_select_public" ON public.banners FOR SELECT TO public USING (true);
CREATE POLICY "banners_all_authenticated" ON public.banners FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Politicas para PRODUCT_SALES
CREATE POLICY "sales_select_public" ON public.product_sales FOR SELECT TO public USING (true);
CREATE POLICY "sales_all_authenticated" ON public.product_sales FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Politicas para BEST_SELLING_PRODUCTS
CREATE POLICY "best_selling_select_public" ON public.best_selling_products FOR SELECT TO public USING (true);
CREATE POLICY "best_selling_all_authenticated" ON public.best_selling_products FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Politicas para FAVORITES (Solo lectura y escritura de sus propios registros)
CREATE POLICY "favorites_own_user" ON public.favorites
  FOR ALL TO authenticated
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Politicas para USER_CARTS (Solo lectura y escritura de sus propios registros)
CREATE POLICY "carts_own_user" ON public.user_carts
  FOR ALL TO authenticated
  USING      (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- REGISTRO INICIAL POR DEFECTO PARA CONFIGURACIÓN
-- ============================================================
INSERT INTO public.inventory_config (id, edit_enabled, show_stock_enabled)
VALUES (1, true, true)
ON CONFLICT (id) DO NOTHING;

-- Mensaje de verificación final
SELECT '✅ ¡Estructura de base de datos preparada exitosamente para importación!' AS estado;
