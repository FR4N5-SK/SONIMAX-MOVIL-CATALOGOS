// Configuración de Supabase
const SUPABASE_URL = "https://ebkmhvrffajaodsrmgfd.supabase.co"
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVia21odnJmZmFqYW9kc3JtZ2ZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAyNzcxMzAsImV4cCI6MjA3NTg1MzEzMH0.bCkXUogywYWQjDAjDZfKh-0QZ-0w_jKE93KNI-Fj3nU"

if (SUPABASE_URL === "TU_SUPABASE_URL_AQUI" || SUPABASE_ANON_KEY === "TU_SUPABASE_ANON_KEY_AQUI") {
  console.error("❌ ERROR: Debes configurar tus credenciales de Supabase")
  console.error("📝 Pasos para configurar:")
  console.error("1. Ve a https://supabase.com y crea un proyecto")
  console.error("2. Ve a Settings > API")
  console.error("3. Copia la 'Project URL' y la 'anon/public key'")
  console.error("4. Reemplaza los valores en supabase-config.js")

  alert(
    "⚠️ ERROR DE CONFIGURACIÓN\n\nDebes configurar tus credenciales de Supabase en el archivo 'supabase-config.js'\n\nPasos:\n1. Ve a https://supabase.com\n2. Crea un proyecto\n3. Ve a Settings > API\n4. Copia la URL y la anon key\n5. Reemplázalas en supabase-config.js",
  )

  throw new Error("Credenciales de Supabase no configuradas")
}

if (!SUPABASE_URL.startsWith("https://") || !SUPABASE_URL.includes(".supabase.co")) {
  console.error("❌ ERROR: La URL de Supabase no tiene el formato correcto")
  console.error("Debe ser algo como: https://tuproyecto.supabase.co")
  alert("⚠️ ERROR: La URL de Supabase no es válida\n\nDebe tener el formato:\nhttps://tuproyecto.supabase.co")
  throw new Error("URL de Supabase inválida")
}

if (!SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.length < 100) {
  console.error("❌ ERROR: La anon key de Supabase parece incorrecta")
  console.error("Debe ser un token JWT largo (más de 100 caracteres)")
  alert("⚠️ ERROR: La anon key de Supabase parece incorrecta\n\nDebe ser un token largo que empieza con 'eyJ...'")
  throw new Error("Anon key de Supabase inválida")
}

console.log("✅ Credenciales de Supabase validadas")
console.log("🔗 URL:", SUPABASE_URL)
console.log("🔑 Key:", SUPABASE_ANON_KEY.substring(0, 20) + "...")

// Inicializar cliente de Supabase
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Exportar para uso global
window.supabaseClient = supabase

console.log("✅ Cliente de Supabase inicializado correctamente")
