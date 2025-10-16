// Configuración de Supabase
const SUPABASE_URL = "https://ebkmhvrffajaodsrmgfd.supabase.co"
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVia21odnJmZmFqYW9kc3JtZ2ZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAyNzcxMzAsImV4cCI6MjA3NTg1MzEzMH0.bCkXUogywYWQjDAjDZfKh-0QZ-0w_jKE93KNI-Fj3nU"

// Validar credenciales
if (SUPABASE_URL === "TU_SUPABASE_URL_AQUI" || SUPABASE_ANON_KEY === "TU_SUPABASE_ANON_KEY_AQUI") {
  console.error("❌ ERROR: Debes configurar tus credenciales de Supabase")
  alert("⚠️ ERROR: Configura tus credenciales de Supabase en supabase-config.js")
  throw new Error("Credenciales de Supabase no configuradas")
}

console.log("✅ Credenciales de Supabase validadas")
console.log("🔗 URL:", SUPABASE_URL)

// Inicializar cliente de Supabase desde el CDN
const { createClient } = window.supabase
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Exportar para uso global
window.supabaseClient = supabaseClient

console.log("✅ Cliente de Supabase inicializado correctamente")
