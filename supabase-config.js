// =====================================================================
// SONIMAX MOVIL - CONFIGURACIÓN DE SUPABASE (PLAN PRO)
// =====================================================================

// Servidor Principal (Supabase con catálogo y productos al día - gvaitosnfotnkrpjojqn)
const SUPABASE_URL = "https://gvaitosnfotnkrpjojqn.supabase.co"
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2YWl0b3NuZm90bmtycGpvanFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2MjA2NzQsImV4cCI6MjEwMjE5NjY3NH0.QKToCRnPi4GqCOjas55Ihp64hHVjdFScpyZpfJmltrs"

// Servidor Secundario / Puente de Respaldo (Plan Pro - tuqwzrsgczhgmfnfmryw)
const SUPABASE_OLD_URL = "https://tuqwzrsgczhgmfnfmryw.supabase.co"
const SUPABASE_OLD_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1cXd6cnNnY3poZ21mbmZtcnl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxMTc4NTgsImV4cCI6MjA5NTY5Mzg1OH0.-mMR7gaq_TA_PvuZKSP4o_N2sCVaP0N7ihV2Bs94na0"

// Validar credenciales
if (SUPABASE_URL === "TU_SUPABASE_URL_AQUI" || SUPABASE_ANON_KEY === "TU_SUPABASE_ANON_KEY_AQUI") {
  console.error("❌ ERROR: Debes configurar tus credenciales de Supabase")
  alert("⚠️ ERROR: Configura tus credenciales de Supabase en supabase-config.js")
  throw new Error("Credenciales de Supabase no configuradas")
}

console.log("✅ Credenciales de Supabase validadas")
console.log("🔗 URL Principal (Catálogo al día):", SUPABASE_URL)
console.log("🔗 URL Respaldo (Plan Pro):", SUPABASE_OLD_URL)

// Inicializar cliente de Supabase desde el CDN
const { createClient } = window.supabase
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const supabaseOldClient = createClient(SUPABASE_OLD_URL, SUPABASE_OLD_ANON_KEY)

// Exportar para uso global
window.supabaseClient = supabaseClient
window.supabaseOldClient = supabaseOldClient

console.log("✅ Clientes de Supabase (Principal y Respaldo) inicializados correctamente")
