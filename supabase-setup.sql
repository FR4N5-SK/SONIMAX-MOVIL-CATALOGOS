-- Script de Configuración LIMPIA para SONIMAx MÓVIL
-- Este script elimina todo lo existente y crea desde cero
-- Ejecutar en el SQL Editor de Supabase

-- ============================================
-- PASO 1: LIMPIAR TODO LO EXISTENTE
-- ============================================

-- Eliminar triggers
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS update_products_updated_at ON products;
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
DROP TRIGGER IF EXISTS update_metadata_updated_at ON metadata;

-- Eliminar funciones
DROP FUNCTION IF EXISTS public.handle_new_user();
DROP FUNCTION IF EXISTS update_updated_at_column();

-- Eliminar políticas RLS de products
DROP POLICY IF EXISTS "Todos pueden leer productos" ON products;
DROP POLICY IF EXISTS "Solo admin puede insertar productos" ON products;
DROP POLICY IF EXISTS "Solo admin puede actualizar productos" ON products;
DROP POLICY IF EXISTS "Solo admin puede eliminar productos" ON products;

-- Eliminar políticas RLS de users
DROP POLICY IF EXISTS "Los usuarios pueden leer su propia información" ON users;
DROP POLICY IF EXISTS "Admin puede leer todos los usuarios" ON users;
DROP POLICY IF EXISTS "Permitir inserción de nuevos usuarios" ON users;
DROP POLICY IF EXISTS "Los usuarios pueden actualizar su propia información" ON users;
DROP POLICY IF EXISTS "Solo admin puede cambiar roles" ON users;

-- Eliminar políticas RLS de metadata
DROP POLICY IF EXISTS "Todos pueden leer metadata" ON metadata;
DROP POLICY IF EXISTS "Solo admin puede modificar metadata" ON metadata;

-- Eliminar tablas (CASCADE elimina dependencias)
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS metadata CASCADE;

-- ============================================
-- PASO 2: CREAR TODO DESDE CERO
-- ============================================

-- 1. Crear tabla de productos
CREATE TABLE products (
    id BIGSERIAL PRIMARY KEY,
    nombre TEXT NOT NULL,
    descripcion TEXT,
    precio_cliente DECIMAL(10, 2) NOT NULL DEFAULT 0,
    precio_distribuidor DECIMAL(10, 2) NOT NULL DEFAULT 0,
    precio_gmayor DECIMAL(10, 2) NOT NULL DEFAULT 0,
    departamento TEXT,
    imagen_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Crear tabla de usuarios
CREATE TABLE users (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    name TEXT,
    role TEXT NOT NULL DEFAULT 'cliente' CHECK (role IN ('cliente', 'distribuidor', 'admin')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Crear tabla de metadata
CREATE TABLE metadata (
    id BIGSERIAL PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    value TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. Crear índices
CREATE INDEX idx_products_departamento ON products(departamento);
CREATE INDEX idx_products_nombre ON products(nombre);
CREATE INDEX idx_users_role ON users(role);

-- 5. Habilitar RLS
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE metadata ENABLE ROW LEVEL SECURITY;

-- 6. Políticas RLS para products
CREATE POLICY "Todos pueden leer productos"
    ON products FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Solo admin puede insertar productos"
    ON products FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role = 'admin'
        )
    );

CREATE POLICY "Solo admin puede actualizar productos"
    ON products FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role = 'admin'
        )
    );

CREATE POLICY "Solo admin puede eliminar productos"
    ON products FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role = 'admin'
        )
    );

-- 7. Políticas RLS para users
CREATE POLICY "Los usuarios pueden leer su propia información"
    ON users FOR SELECT
    TO authenticated
    USING (auth.uid() = id);

CREATE POLICY "Admin puede leer todos los usuarios"
    ON users FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role = 'admin'
        )
    );

CREATE POLICY "Permitir inserción de nuevos usuarios"
    ON users FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = id);

CREATE POLICY "Los usuarios pueden actualizar su propia información"
    ON users FOR UPDATE
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

CREATE POLICY "Solo admin puede cambiar roles"
    ON users FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role = 'admin'
        )
    );

-- 8. Políticas RLS para metadata
CREATE POLICY "Todos pueden leer metadata"
    ON metadata FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "Solo admin puede modificar metadata"
    ON metadata FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM users
            WHERE users.id = auth.uid()
            AND users.role = 'admin'
        )
    );

-- 9. Función para crear usuario automáticamente
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.users (id, email, name, role)
    VALUES (
        NEW.id, 
        NEW.email, 
        COALESCE(NEW.raw_user_meta_data->>'name', ''),
        'cliente'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 10. Trigger para nuevos usuarios
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- 11. Función para actualizar updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 12. Triggers para updated_at
CREATE TRIGGER update_products_updated_at
    BEFORE UPDATE ON products
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_metadata_updated_at
    BEFORE UPDATE ON metadata
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- LISTO! Ahora puedes:
-- 1. Registrarte en la aplicación
-- 2. Ejecutar: UPDATE users SET role = 'admin' WHERE email = 'tu-email@ejemplo.com';
-- 3. Recargar la página y tendrás acceso admin
-- ============================================
