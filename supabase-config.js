const SUPABASE_URL = "https://gvaitosnfotnkrpjojqn.supabase.co"
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2YWl0b3NuZm90bmtycGpvanFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2MjA2NzQsImV4cCI6MjEwMjE5NjY3NH0.QKToCRnPi4GqCOjas55Ihp64hHVjdFScpyZpfJmltrs"

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
