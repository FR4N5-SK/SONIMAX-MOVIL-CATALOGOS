-- ============================================
-- SONIMAX MÓVIL - BASE DE DATOS SIMPLIFICADA
-- ============================================

-- Limpiar todo
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;

-- ============================================
-- TABLA: users
-- ============================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  username TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'cliente' CHECK (role IN ('cliente', 'distribuidor', 'gestor', 'admin')),
  created_by UUID REFERENCES users(auth_id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_auth_id ON users(auth_id);
CREATE INDEX idx_users_username ON users(username);

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
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_products_departamento ON products(departamento);

-- ============================================
-- FUNCIÓN: Crear usuario automáticamente
-- ============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (auth_id, username, name, email, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'username', 'user_' || substring(NEW.id::text, 1, 8)),
    COALESCE(NEW.raw_user_meta_data->>'name', 'Usuario'),
    NEW.email,
    'cliente'
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

-- Políticas RLS más permisivas para permitir todas las operaciones necesarias

-- USERS: Permitir todas las operaciones a usuarios autenticados
CREATE POLICY "allow_all_users" ON users
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- PRODUCTS: Permitir todas las operaciones a usuarios autenticados
CREATE POLICY "allow_all_products" ON products
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- ============================================
-- DATOS DE EJEMPLO
-- ============================================

INSERT INTO products (codigo, nombre, descripcion, departamento, precio_cliente, precio_mayor, precio_gmayor, stock, imagen_url) VALUES
('PROD001', 'Smartphone Samsung Galaxy A54', 'Celular de gama media con pantalla AMOLED', 'ELECTRONICA', 1200000, 1050000, 1000000, 15, 'https://i.ibb.co/placeholder1.jpg'),
('PROD002', 'Auriculares Bluetooth JBL', 'Auriculares inalámbricos con cancelación de ruido', 'ELECTRONICA', 150000, 130000, 120000, 30, 'https://i.ibb.co/placeholder2.jpg'),
('PROD003', 'Cargador Rápido USB-C 65W', 'Cargador rápido compatible con múltiples dispositivos', 'ACCESORIOS', 45000, 35000, 30000, 50, 'https://i.ibb.co/placeholder3.jpg'),
('PROD004', 'Funda Protectora Universal', 'Funda de silicona resistente', 'ACCESORIOS', 25000, 20000, 18000, 100, 'https://i.ibb.co/placeholder4.jpg'),
('PROD005', 'Tablet Lenovo Tab M10', 'Tablet 10 pulgadas con Android', 'ELECTRONICA', 800000, 700000, 650000, 10, 'https://i.ibb.co/placeholder5.jpg');

-- ============================================
-- VERIFICACIÓN
-- ============================================

SELECT 'Tablas creadas correctamente' as status;
SELECT COUNT(*) as total_products FROM products;

-- ============================================
-- INSTRUCCIONES
-- ============================================
-- 1. Ejecuta este script en Supabase SQL Editor
-- 2. Registra un usuario en la app
-- 3. Conviértelo en admin: UPDATE users SET role = 'admin' WHERE username = 'tu_usuario';
-- 4. Refresca la página
--
-- ESTRUCTURA DE PRECIOS:
-- precio_cliente = Precio DETAL (para clientes finales)
-- precio_mayor = Precio MAYOR (para distribuidores)
-- precio_gmayor = Precio GRAN MAYOR (para admins)
--
-- ROLES Y PERMISOS:
-- cliente: Ve solo precio_cliente (detal)
-- distribuidor: Ve precio_cliente (detal) Y precio_mayor (mayor)
-- gestor: Ve precio_cliente (detal) Y precio_mayor (mayor) + puede crear usuarios
-- admin: Ve precio_gmayor + puede subir CSV, exportar PDF y crear usuarios
