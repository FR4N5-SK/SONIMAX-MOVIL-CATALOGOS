-- ============================================
-- SONIMAX MÓVIL - ESTRUCTURA COMPLETA DE BASE DE DATOS
-- ============================================

-- Limpiar todo
DROP TABLE IF EXISTS product_sales CASCADE;
DROP TABLE IF EXISTS inventory_config CASCADE;
DROP TABLE IF EXISTS inventory_products CASCADE;
DROP TABLE IF EXISTS user_carts CASCADE;
DROP TABLE IF EXISTS favorites CASCADE;
DROP TABLE IF EXISTS banners CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;

-- ============================================
-- FUNCIÓN TRIGGER: Actualización automática de updated_at
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TABLA: users
-- ============================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  username TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'cliente' CHECK (role IN ('cliente', 'distribuidor', 'gestor', 'admin', 'inventario')),
  can_see_stock BOOLEAN DEFAULT TRUE,
  created_by UUID REFERENCES users(auth_id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_auth_id ON users(auth_id);
CREATE INDEX idx_users_username ON users(username);

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ============================================
-- TABLA: products
-- ============================================
CREATE TABLE products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT,
  nombre TEXT NOT NULL,
  descripcion TEXT,
  departamento TEXT NOT NULL,
  precio_cliente DECIMAL(10, 2) NOT NULL DEFAULT 0,
  precio_mayor DECIMAL(10, 2) NOT NULL DEFAULT 0,
  precio_gmayor DECIMAL(10, 2) NOT NULL DEFAULT 0,
  stock INTEGER DEFAULT 0,
  imagen_url TEXT,
  is_new BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_products_departamento ON products(departamento);
CREATE INDEX idx_products_codigo ON products(codigo);
CREATE INDEX idx_products_updated_at ON products(updated_at DESC);

CREATE TRIGGER update_products_updated_at BEFORE UPDATE ON products
FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();

-- ============================================
-- TABLA: banners
-- ============================================
CREATE TABLE banners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  titulo TEXT,
  imagen_url TEXT NOT NULL,
  activo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TABLA: favorites
-- ============================================
CREATE TABLE favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, product_id)
);

CREATE INDEX idx_favorites_user_id ON favorites(user_id);

-- ============================================
-- TABLA: user_carts
-- ============================================
CREATE TABLE user_carts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  items JSONB DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TABLA: inventory_products (Conteo por depósitos)
-- ============================================
CREATE TABLE inventory_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  codigo TEXT NOT NULL,
  deposito TEXT NOT NULL,
  cantidad_fisica INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(codigo, deposito)
);

CREATE INDEX idx_inventory_products_codigo ON inventory_products(codigo);

-- ============================================
-- TABLA: inventory_config
-- ============================================
CREATE TABLE inventory_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- TABLA: product_sales (Estadísticas y Más Vendidos)
-- ============================================
CREATE TABLE product_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES products(id) ON DELETE CASCADE,
  quantity INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Vista para productos más vendidos
CREATE OR REPLACE VIEW best_selling_products AS
SELECT product_id, SUM(quantity) as total_sold
FROM product_sales
GROUP BY product_id
ORDER BY total_sold DESC;

-- ============================================
-- FUNCIÓN: Crear usuario automáticamente desde Auth
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (auth_id, username, name, email, role, can_see_stock)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', 'user_' || substring(NEW.id::text, 1, 8)),
    COALESCE(NEW.raw_user_meta_data->>'name', 'Usuario'),
    NEW.email,
    'cliente',
    TRUE
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- ROW LEVEL SECURITY - POLÍTICAS PERMISIVAS
-- ============================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE banners ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_carts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "allow_all_users" ON users FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_products" ON products FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_banners" ON banners FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_favorites" ON favorites FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_user_carts" ON user_carts FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_inventory_products" ON inventory_products FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_inventory_config" ON inventory_config FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "allow_all_product_sales" ON product_sales FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================
-- DATOS DE EJEMPLO
-- ============================================

INSERT INTO products (codigo, nombre, descripcion, departamento, precio_cliente, precio_mayor, precio_gmayor, stock, imagen_url, is_new) VALUES
('PROD001', 'Smartphone Samsung Galaxy A54', 'Celular de gama media con pantalla AMOLED', 'ELECTRONICA', 1200000, 1050000, 1000000, 15, 'https://i.ibb.co/placeholder1.jpg', true),
('PROD002', 'Auriculares Bluetooth JBL', 'Auriculares inalámbricos con cancelación de ruido', 'ELECTRONICA', 150000, 130000, 120000, 30, 'https://i.ibb.co/placeholder2.jpg', false),
('PROD003', 'Cargador Rápido USB-C 65W', 'Cargador rápido compatible con múltiples dispositivos', 'ACCESORIOS', 45000, 35000, 30000, 50, 'https://i.ibb.co/placeholder3.jpg', false),
('PROD004', 'Funda Protectora Universal', 'Funda de silicona resistente', 'ACCESORIOS', 25000, 20000, 18000, 100, 'https://i.ibb.co/placeholder4.jpg', false),
('PROD005', 'Tablet Lenovo Tab M10', 'Tablet 10 pulgadas con Android', 'ELECTRONICA', 800000, 700000, 650000, 10, 'https://i.ibb.co/placeholder5.jpg', true);

-- ============================================
-- RPC: Cambiar contraseña de usuario (Panel Admin)
-- ============================================
CREATE OR REPLACE FUNCTION admin_change_user_password(target_auth_id UUID, new_password TEXT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE auth.users
  SET encrypted_password = crypt(new_password, gen_salt('bf'))
  WHERE id = target_auth_id;
END;
$$;

GRANT EXECUTE ON FUNCTION admin_change_user_password(UUID, TEXT) TO authenticated;

-- ============================================
-- VERIFICACIÓN
-- ============================================
SELECT 'Tablas e índices creados correctamente' as status;
SELECT COUNT(*) as total_products FROM products;
