// Configuración de Supabase
const SUPABASE_URL = "https://tuqwzrsgczhgmfnfmryw.supabase.co"
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1cXd6cnNnY3poZ21mbmZtcnl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxMTc4NTgsImV4cCI6MjA5NTY5Mzg1OH0.-mMR7gaq_TA_PvuZKSP4o_N2sCVaP0N7ihV2Bs94na0"

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
