/**
 * SONIMAX MÓVIL - Módulo de Gestión de Garantías y Devoluciones (RMA)
 * ====================================================================
 * Diseñado exclusivamente para roles: Gestor y Admin.
 * 
 * Características principales:
 * 1. Acceso con clave / PIN de seguridad personalizable.
 * 2. Formulario de pedido de garantía con buscador en tiempo real del catálogo,
 *    selección de cantidad, botones de fallas frecuentes y descripción detallada.
 * 3. Lista acumulada para Admin y Gestores con identificación de usuario, rol, fecha y hora.
 * 4. Actualización de estados por parte del Administrador (Pendiente, En Revisión, Aprobada, Rechazada).
 * 5. Exportación a Excel (.xlsx) por mes o general con SheetJS (XLSX).
 * 6. Sincronización multi-servidor automática: Se comunica simultáneamente con
 *    el servidor Principal y el servidor Secundario (Plan Pro), garantizando
 *    visibilidad instantánea entre diferentes PCs y dispositivos.
 * 7. Envío formateado por WhatsApp del ticket y generación de comprobante de entrega imprimible.
 */

(function () {
  'use strict';

  // ============================================================
  // CONSTANTES Y CONFIGURACIÓN
  // ============================================================
  const STORAGE_PIN_KEY = 'sonimax_garantias_pin';
  const STORAGE_CACHE_KEY = 'sonimax_garantias_cache_v1';
  const STORAGE_SESSION_UNLOCKED = 'sonimax_garantias_unlocked_session';
  const STORAGE_DRAFT_KEY = 'sonimax_garantias_form_draft_v1';

  // Claves predeterminadas aceptadas inicialmente (se pueden cambiar por el admin)
  const DEFAULT_PINS = ['1234', 'sonimax2026', 'admin2026'];

  const MONTH_NAMES = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ];

  const STATUS_CONFIG = {
    pendiente: {
      label: 'Pendiente',
      icon: '⏳',
      badgeClass: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/50 dark:text-amber-300 dark:border-amber-700'
    },
    en_revision: {
      label: 'En Revisión',
      icon: '🔍',
      badgeClass: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/50 dark:text-blue-300 dark:border-blue-700'
    },
    aprobada: {
      label: 'Aprobada',
      icon: '✅',
      badgeClass: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-900/50 dark:text-emerald-300 dark:border-emerald-700'
    },
    rechazada: {
      label: 'Rechazada',
      icon: '❌',
      badgeClass: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-900/50 dark:text-red-300 dark:border-red-700'
    },
    completada: {
      label: 'Completada / Entregada',
      icon: '📦',
      badgeClass: 'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-900/50 dark:text-purple-300 dark:border-purple-700'
    }
  };

  const QUICK_FAILURES = [
    '⚠️ No enciende',
    '🔌 No carga / Pin dañado',
    '📱 Pantalla sin imagen / Táctil',
    '🔊 Falla de sonido / Parlante',
    '⚙️ Defecto de fábrica',
    '📦 Incompleto / Falta pieza',
    '💥 Daño físico / Golpe',
    '📶 Falla Bluetooth / WiFi'
  ];

  // ============================================================
  // ESTADO LOCAL DEL MÓDULO
  // ============================================================
  let currentActiveTab = 'form'; // 'form', 'normal', 'hl', 'config'
  let currentWarrantySection = 'normal'; // 'normal' (Apartado Garantías Normales) o 'hl' (Apartado Garantías HL)
  let currentWarrantyItems = []; // [{ id, codigo, nombre, departamento, cantidad, falla, imagen_url, es_hl }]
  let selectedCatalogProduct = null;
  let allGarantias = [];
  let isSessionUnlocked = sessionStorage.getItem(STORAGE_SESSION_UNLOCKED) === 'true';

  // Filtros de la lista acumulada (por defecto 'all' para ver todo lo recibido entre PCs)
  const currentDate = new Date();
  let filterMonth = 'all'; // Todos los meses por defecto para ver todos los acumulados
  let filterYear = String(currentDate.getFullYear()); // ej: "2026"
  let filterStatus = 'all';
  let filterUser = 'all';
  let searchQuery = '';

  // Filtro rápido de período para juntar / confirmar y exportar
  let filterPeriod = 'all'; // 'all', 'today', 'week', 'month', 'custom_date'
  let filterCustomDate = ''; // 'YYYY-MM-DD'
  let selectedTickets = new Set(); // Set de códigos de ticket seleccionados manualmente

  // ============================================================
  // HELPERS GENERALES
  // ============================================================
  function getCurrentUser() {
    return window.currentUser || {
      name: 'Usuario',
      role: window.currentUserRole || 'gestor',
      id: null,
      auth_id: null
    };
  }

  function getActiveRole() {
    return window.currentUserRole || (window.currentUser ? window.currentUser.role : 'cliente');
  }

  function isAuthorized() {
    const role = (getActiveRole() || '').toLowerCase();
    return role === 'admin' || role === 'gestor';
  }

  function formatDateTime(isoString) {
    if (!isoString) return 'Fecha desconocida';
    try {
      const d = new Date(isoString);
      return d.toLocaleString('es-VE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch {
      return isoString;
    }
  }

  function formatDateOnly(isoString) {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString('es-VE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    } catch {
      return isoString;
    }
  }

  function generateTicketCode(isHL = false) {
    const d = new Date();
    const yy = String(d.getFullYear()).slice(-2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    return isHL ? `GAR-HL-${yy}${mm}-${randomNum}` : `GAR-${yy}${mm}-${randomNum}`;
  }

  // ============================================================
  // HELPERS DE CLASIFICACIÓN (NORMAL VS HL)
  // ============================================================
  function isHLGarantia(g) {
    if (!g) return false;
    if (g.tipo_garantia === 'hl' || g.es_hl === true || g.es_hl === 'true') return true;
    if (typeof g.codigo_ticket === 'string' && g.codigo_ticket.includes('-HL-')) return true;
    if (Array.isArray(g.items) && g.items.some(it => it && (it.es_hl === true || it.es_hl === 'true' || it.tipo === 'HL'))) return true;
    return false;
  }

  function isNormalGarantia(g) {
    return !isHLGarantia(g);
  }

  // ============================================================
  // HELPERS DE FECHAS (DÍA, SEMANA, MES)
  // ============================================================
  function getLocalDateStr(dateInput) {
    if (!dateInput) return '';
    try {
      const d = new Date(dateInput);
      if (isNaN(d.getTime())) return '';
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    } catch {
      return '';
    }
  }

  function isDateToday(dateInput) {
    const target = getLocalDateStr(dateInput);
    const today = getLocalDateStr(new Date());
    return target === today && target !== '';
  }

  function isDateInCurrentWeek(dateInput) {
    if (!dateInput) return false;
    try {
      const d = new Date(dateInput);
      if (isNaN(d.getTime())) return false;
      const now = new Date();
      const currentDay = now.getDay() === 0 ? 7 : now.getDay(); // 1 = Lunes, 7 = Domingo

      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - currentDay + 1);
      startOfWeek.setHours(0, 0, 0, 0);

      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      endOfWeek.setHours(23, 59, 59, 999);

      return d >= startOfWeek && d <= endOfWeek;
    } catch {
      return false;
    }
  }

  function isDateInMonth(dateInput, targetMonth, targetYear) {
    if (!dateInput) return false;
    try {
      const d = new Date(dateInput);
      if (isNaN(d.getTime())) return false;
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const y = String(d.getFullYear());
      if (targetMonth && targetMonth !== 'all' && m !== targetMonth) return false;
      if (targetYear && targetYear !== 'all' && y !== targetYear) return false;
      return true;
    } catch {
      return false;
    }
  }

  function getStoredPIN() {
    return localStorage.getItem(STORAGE_PIN_KEY) || 'sonimax2026';
  }

  function validatePIN(inputPin) {
    if (!inputPin) return false;
    const cleanInput = inputPin.trim().toLowerCase();
    const currentPin = getStoredPIN().trim().toLowerCase();

    // Acepta el PIN configurado y los predeterminados
    if (cleanInput === currentPin) return true;
    return DEFAULT_PINS.some(p => p.toLowerCase() === cleanInput);
  }

  // ============================================================
  // SERVIDORES SUPABASE (MULTI-CLIENTE AUTOMÁTICO)
  // Permite sincronizar sin importar en qué servidor se corrió el SQL
  // ============================================================
  function getAllSupabaseClients() {
    const clients = [];

    // 1. Servidor Secundario / Puente de Respaldo (Plan Pro - tuqwzrsgczhgmfnfmryw)
    if (window.supabaseOldClient) {
      clients.push({
        id: 'old',
        name: 'Supabase Plan Pro (tuqwzrsgczhgmfnfmryw)',
        client: window.supabaseOldClient
      });
    }

    // 2. Servidor Principal (Catálogo al día - gvaitosnfotnkrpjojqn)
    if (window.supabaseClient) {
      clients.push({
        id: 'main',
        name: 'Supabase Principal (gvaitosnfotnkrpjojqn)',
        client: window.supabaseClient
      });
    }

    return clients;
  }

  // ============================================================
  // PERSISTENCIA: LOCALSTORAGE + SUPABASE MULTI-CLIENTE
  // ============================================================
  function loadLocalCache() {
    try {
      const data = localStorage.getItem(STORAGE_CACHE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.warn('[GARANTIAS] Error cargando caché local:', e);
      return [];
    }
  }

  function saveLocalCache(list) {
    try {
      localStorage.setItem(STORAGE_CACHE_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn('[GARANTIAS] Error guardando en caché local:', e);
    }
  }

  /**
   * Consulta ambos servidores de Supabase para obtener todas las solicitudes
   * registradas desde cualquier PC y las fusiona con la caché local.
   */
  async function fetchGarantiasFromDatabase() {
    const clients = getAllSupabaseClients();
    const map = new Map();
    let anySuccess = false;

    for (const c of clients) {
      try {
        const { data, error } = await c.client
          .from('garantias')
          .select('*')
          .order('created_at', { ascending: false });

        if (!error && Array.isArray(data)) {
          anySuccess = true;
          data.forEach(item => {
            if (item && item.codigo_ticket) {
              map.set(item.codigo_ticket, item);
            }
          });
          console.log(`[GARANTIAS] 📥 Recibidas ${data.length} garantías desde ${c.name}`);
        } else if (error) {
          console.warn(`[GARANTIAS] No se pudo leer de ${c.name}:`, error.message);
        }
      } catch (err) {
        console.warn(`[GARANTIAS] Excepción leyendo de ${c.name}:`, err);
      }
    }

    if (anySuccess) {
      // También incluir cualquier garantía guardada localmente que aún no esté en la nube
      const localList = loadLocalCache();
      localList.forEach(localItem => {
        if (!map.has(localItem.codigo_ticket)) {
          map.set(localItem.codigo_ticket, localItem);
        }
      });

      allGarantias = Array.from(map.values()).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      saveLocalCache(allGarantias);
    } else {
      allGarantias = loadLocalCache();
    }

    return allGarantias;
  }

  /**
   * Guarda la garantía en TODOS los servidores de Supabase configurados
   * para que cualquier PC conectada la reciba de inmediato.
   */
  async function saveGarantiaToDatabase(garantia) {
    const clients = getAllSupabaseClients();
    const savedInServers = [];
    const errors = [];

    for (const c of clients) {
      try {
        let { error } = await c.client
          .from('garantias')
          .insert([garantia]);

        // Si la tabla remota no tiene las columnas tipo_garantia o es_hl, reintentar sin ellas
        if (error && (error.message.includes('tipo_garantia') || error.message.includes('es_hl'))) {
          console.warn(`[GARANTIAS] Columnas tipo_garantia/es_hl ausentes en ${c.name}. Reintentando compatible...`);
          const fallback = { ...garantia };
          delete fallback.tipo_garantia;
          delete fallback.es_hl;
          const retryRes = await c.client.from('garantias').insert([fallback]);
          error = retryRes.error;
        }

        if (!error) {
          savedInServers.push(c.name);
          console.log(`[GARANTIAS] ✅ Guardado exitoso en ${c.name}`);
        } else {
          errors.push(`${c.name}: ${error.message}`);
          console.warn(`[GARANTIAS] Error en ${c.name}:`, error.message);
        }
      } catch (err) {
        errors.push(`${c.name}: ${err.message}`);
        console.warn(`[GARANTIAS] Excepción guardando en ${c.name}:`, err);
      }
    }

    // 1. Guardar siempre en caché local de esta máquina
    const list = loadLocalCache();
    const existingIdx = list.findIndex(g => g.codigo_ticket === garantia.codigo_ticket);
    if (existingIdx !== -1) {
      list[existingIdx] = garantia;
    } else {
      list.unshift(garantia);
    }
    saveLocalCache(list);
    allGarantias = list;

    // 2. Si no se pudo guardar en ningún servidor remoto, avisar claramente
    if (savedInServers.length === 0) {
      const msg = `⚠️ ATENCIÓN: La garantía se guardó en esta PC, pero NO se pudo sincronizar con la nube de Supabase.\n\nMotivo:\n${errors.join('\n')}\n\n👉 Ejecuta el archivo "supabase-garantias.sql" en tu panel de Supabase para que la otra PC (Admin) pueda ver esta solicitud.`;
      console.error(msg);
      alert(msg);
    } else {
      console.log(`[GARANTIAS] 🚀 Sincronizado en línea con: ${savedInServers.join(' Y ')}`);
    }

    return garantia;
  }

  async function updateGarantiaStatusInDB(ticketCode, newStatus, adminNote) {
    // Actualizar en memoria local
    const list = loadLocalCache();
    const item = list.find(g => g.codigo_ticket === ticketCode);
    if (item) {
      item.estado = newStatus;
      if (adminNote !== undefined) item.notas_admin = adminNote;
      item.updated_at = new Date().toISOString();
      saveLocalCache(list);
      allGarantias = list;
    }

    // Actualizar en servidores Supabase
    const clients = getAllSupabaseClients();
    for (const c of clients) {
      try {
        const updates = {
          estado: newStatus,
          updated_at: new Date().toISOString()
        };
        if (adminNote !== undefined) updates.notas_admin = adminNote;

        await c.client
          .from('garantias')
          .update(updates)
          .eq('codigo_ticket', ticketCode);
      } catch (e) {
        console.warn(`[GARANTIAS] Error actualizando estado en ${c.name}:`, e);
      }
    }
  }

  /**
   * Actualización en lote (Batch) de múltiples garantías a la vez
   * Usado por Administrador para confirmar garantías de un día, semana o mes.
   */
  async function batchUpdateGarantiasStatusInDB(ticketCodes, newStatus, adminNote) {
    if (!ticketCodes || ticketCodes.length === 0) return;
    const now = new Date().toISOString();

    // Actualizar en memoria local
    const list = loadLocalCache();
    list.forEach(g => {
      if (ticketCodes.includes(g.codigo_ticket)) {
        g.estado = newStatus;
        if (adminNote !== undefined) g.notas_admin = adminNote;
        g.updated_at = now;
      }
    });
    saveLocalCache(list);
    allGarantias = list;

    // Actualizar en servidores Supabase
    const clients = getAllSupabaseClients();
    for (const c of clients) {
      try {
        const updates = {
          estado: newStatus,
          updated_at: now
        };
        if (adminNote !== undefined) updates.notas_admin = adminNote;

        await c.client
          .from('garantias')
          .update(updates)
          .in('codigo_ticket', ticketCodes);
      } catch (e) {
        console.warn(`[GARANTIAS] Error batch actualizando estado en ${c.name}:`, e);
      }
    }
  }

  async function deleteGarantiaFromDB(ticketCode) {
    const list = loadLocalCache().filter(g => g.codigo_ticket !== ticketCode);
    saveLocalCache(list);
    allGarantias = list;

    const clients = getAllSupabaseClients();
    for (const c of clients) {
      try {
        await c.client
          .from('garantias')
          .delete()
          .eq('codigo_ticket', ticketCode);
      } catch (e) {
        console.warn(`[GARANTIAS] Error eliminando en ${c.name}:`, e);
      }
    }
  }

  // ============================================================
  // ESTILOS DINÁMICOS CSS
  // ============================================================
  function injectStyles() {
    if (document.getElementById('garantias-custom-styles')) return;

    const style = document.createElement('style');
    style.id = 'garantias-custom-styles';
    style.textContent = `
      @keyframes gFadeIn {
        from { opacity: 0; transform: scale(0.97); }
        to { opacity: 1; transform: scale(1); }
      }
      @keyframes gShake {
        0%, 100% { transform: translateX(0); }
        20%, 60% { transform: translateX(-8px); }
        40%, 80% { transform: translateX(8px); }
      }
      .animate-g-fade { animation: gFadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
      .animate-g-shake { animation: gShake 0.4s ease-in-out; }

      .garantia-scroll::-webkit-scrollbar { width: 6px; height: 6px; }
      .garantia-scroll::-webkit-scrollbar-track { background: transparent; }
      .garantia-scroll::-webkit-scrollbar-thumb { background: rgba(156, 163, 175, 0.5); border-radius: 9999px; }
      .garantia-scroll::-webkit-scrollbar-thumb:hover { background: rgba(107, 114, 128, 0.8); }

      .garantia-tab-btn.active {
        background: linear-gradient(135deg, #059669, #0d9488);
        color: #ffffff !important;
        box-shadow: 0 4px 12px rgba(5, 150, 105, 0.35);
      }
      .garantia-tab-btn.active-hl {
        background: linear-gradient(135deg, #7c3aed, #4f46e5) !important;
        color: #ffffff !important;
        box-shadow: 0 4px 14px rgba(124, 58, 237, 0.4) !important;
      }
      .quick-period-btn.active {
        background: linear-gradient(135deg, #059669, #0d9488) !important;
        color: #ffffff !important;
        border-color: transparent !important;
        box-shadow: 0 2px 8px rgba(5, 150, 105, 0.3) !important;
      }
      .quick-period-btn.active-hl {
        background: linear-gradient(135deg, #7c3aed, #4f46e5) !important;
        color: #ffffff !important;
        border-color: transparent !important;
        box-shadow: 0 2px 8px rgba(124, 58, 237, 0.3) !important;
      }

      /* Modal de impresión limpio para comprobantes */
      @media print {
        body * { visibility: hidden; }
        #garantia-receipt-printable, #garantia-receipt-printable * { visibility: visible; }
        #garantia-receipt-printable {
          position: absolute;
          left: 0;
          top: 0;
          width: 100%;
          background: white;
          color: black;
          padding: 20px;
        }
      }
    `;
    document.head.appendChild(style);
  }

  // ============================================================
  // MODAL DE CLAVE / PIN DE AUTORIZACIÓN
  // ============================================================
  function createPinModal() {
    if (document.getElementById('garantias-pin-modal')) return;

    injectStyles();

    const pinModal = document.createElement('div');
    pinModal.id = 'garantias-pin-modal';
    pinModal.className = 'hidden fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4';

    pinModal.innerHTML = `
      <div id="garantias-pin-card" class="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl max-w-sm w-full p-6 sm:p-7 border border-gray-200 dark:border-gray-800 animate-g-fade">
        <div class="text-center mb-5">
          <div class="w-16 h-16 mx-auto mb-3 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center text-3xl shadow-lg shadow-emerald-500/30">
            🛡️
          </div>
          <h3 class="text-xl font-black text-gray-800 dark:text-white">Acceso a Garantías</h3>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Módulo restringido para Gestores y Administradores. Ingrese la clave para abrir el formulario.
          </p>
        </div>

        <form id="garantias-pin-form" onsubmit="return false;" class="space-y-4">
          <div class="relative">
            <input type="password" id="garantias-pin-input" 
              class="w-full text-center text-xl font-bold tracking-widest px-4 py-3 rounded-2xl border-2 border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500 transition-all placeholder:tracking-normal placeholder:font-normal placeholder:text-sm"
              placeholder="Ingrese clave..." autocomplete="off" />
            <button type="button" id="garantias-pin-toggle-visibility" class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-emerald-500 p-1">
              👁️
            </button>
          </div>

          <div id="garantias-pin-error" class="hidden text-xs text-center font-bold text-red-500 bg-red-50 dark:bg-red-950/40 py-2 px-3 rounded-xl border border-red-200 dark:border-red-900/50">
            Clave incorrecta. Intente de nuevo.
          </div>

          <!-- Teclado numérico táctil para móviles -->
          <div class="grid grid-cols-3 gap-2 pt-1">
            <button type="button" class="pin-key h-12 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-800 dark:text-white font-bold text-lg rounded-xl transition-all" data-val="1">1</button>
            <button type="button" class="pin-key h-12 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-800 dark:text-white font-bold text-lg rounded-xl transition-all" data-val="2">2</button>
            <button type="button" class="pin-key h-12 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-800 dark:text-white font-bold text-lg rounded-xl transition-all" data-val="3">3</button>
            <button type="button" class="pin-key h-12 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-800 dark:text-white font-bold text-lg rounded-xl transition-all" data-val="4">4</button>
            <button type="button" class="pin-key h-12 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-800 dark:text-white font-bold text-lg rounded-xl transition-all" data-val="5">5</button>
            <button type="button" class="pin-key h-12 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-800 dark:text-white font-bold text-lg rounded-xl transition-all" data-val="6">6</button>
            <button type="button" class="pin-key h-12 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-800 dark:text-white font-bold text-lg rounded-xl transition-all" data-val="7">7</button>
            <button type="button" class="pin-key h-12 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-800 dark:text-white font-bold text-lg rounded-xl transition-all" data-val="8">8</button>
            <button type="button" class="pin-key h-12 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-800 dark:text-white font-bold text-lg rounded-xl transition-all" data-val="9">9</button>
            <button type="button" class="pin-key h-12 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 font-bold text-sm rounded-xl transition-all" data-val="clear">Limpiar</button>
            <button type="button" class="pin-key h-12 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-800 dark:text-white font-bold text-lg rounded-xl transition-all" data-val="0">0</button>
            <button type="button" class="pin-key h-12 bg-red-50 hover:bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-400 font-bold text-sm rounded-xl transition-all" data-val="backspace">⌫</button>
          </div>

          <div class="flex items-center gap-2 pt-2">
            <button type="button" id="garantias-pin-cancel-btn" class="flex-1 py-3 px-4 rounded-xl font-bold text-sm bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-all">
              Cancelar
            </button>
            <button type="submit" id="garantias-pin-submit-btn" class="flex-1 py-3 px-4 rounded-xl font-bold text-sm bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-lg shadow-emerald-600/30 transition-all">
              🔓 Desbloquear
            </button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(pinModal);

    // Eventos del modal PIN
    const input = document.getElementById('garantias-pin-input');
    const errorEl = document.getElementById('garantias-pin-error');
    const cardEl = document.getElementById('garantias-pin-card');
    const toggleBtn = document.getElementById('garantias-pin-toggle-visibility');
    const cancelBtn = document.getElementById('garantias-pin-cancel-btn');
    const submitBtn = document.getElementById('garantias-pin-submit-btn');

    toggleBtn.onclick = () => {
      input.type = input.type === 'password' ? 'text' : 'password';
    };

    cancelBtn.onclick = () => {
      pinModal.classList.add('hidden');
      input.value = '';
      errorEl.classList.add('hidden');
    };

    // Teclas táctiles
    pinModal.querySelectorAll('.pin-key').forEach(btn => {
      btn.onclick = () => {
        const val = btn.dataset.val;
        if (val === 'clear') {
          input.value = '';
        } else if (val === 'backspace') {
          input.value = input.value.slice(0, -1);
        } else {
          input.value += val;
        }
        errorEl.classList.add('hidden');
      };
    });

    const verifyPIN = () => {
      const pin = input.value;
      if (validatePIN(pin)) {
        isSessionUnlocked = true;
        sessionStorage.setItem(STORAGE_SESSION_UNLOCKED, 'true');
        pinModal.classList.add('hidden');
        input.value = '';
        errorEl.classList.add('hidden');
        showGarantiasMainModal();
      } else {
        errorEl.classList.remove('hidden');
        cardEl.classList.add('animate-g-shake');
        setTimeout(() => cardEl.classList.remove('animate-g-shake'), 400);
        input.focus();
        input.select();
      }
    };

    submitBtn.onclick = verifyPIN;
    document.getElementById('garantias-pin-form').onsubmit = (e) => {
      e.preventDefault();
      verifyPIN();
    };
  }

  function promptPinOrOpen() {
    if (!isAuthorized()) {
      alert('⚠️ Esta función está disponible exclusivamente para los roles de Gestor y Administrador.');
      return;
    }

    if (isSessionUnlocked) {
      showGarantiasMainModal();
    } else {
      createPinModal();
      const pinModal = document.getElementById('garantias-pin-modal');
      const input = document.getElementById('garantias-pin-input');
      const errorEl = document.getElementById('garantias-pin-error');
      if (errorEl) errorEl.classList.add('hidden');
      if (input) input.value = '';
      pinModal?.classList.remove('hidden');
      setTimeout(() => input?.focus(), 150);
    }
  }

  // ============================================================
  // CONSTRUCCIÓN DEL MODAL PRINCIPAL DE GARANTÍAS
  // ============================================================
  function createMainModal() {
    if (document.getElementById('garantias-main-modal')) return;

    injectStyles();

    const modal = document.createElement('div');
    modal.id = 'garantias-main-modal';
    modal.className = 'hidden fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 overflow-y-auto';

    modal.innerHTML = `
      <div class="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl max-w-6xl w-full max-h-[96vh] flex flex-col overflow-hidden border border-gray-200 dark:border-gray-800 animate-g-fade">
        
        <!-- HEADER SUPERIOR -->
        <div class="bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-700 p-4 text-white flex items-center justify-between shadow-md flex-shrink-0">
          <div class="flex items-center gap-3">
            <div class="w-11 h-11 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center text-2xl shadow-inner border border-white/20">
              🛡️
            </div>
            <div>
              <h2 class="text-base sm:text-xl font-black leading-tight flex items-center gap-2">
                Módulo de Garantías y Devoluciones
                <span id="garantias-user-badge" class="bg-white/25 text-white text-xs px-2.5 py-0.5 rounded-full font-bold"></span>
              </h2>
              <p class="text-xs text-emerald-100 flex items-center gap-1.5 mt-0.5">
                <span>Registro de productos defectuosos, pedidos a admin y exportación en Excel</span>
                <span class="hidden sm:inline font-mono opacity-80" id="garantias-clock"></span>
              </p>
            </div>
          </div>
          
          <div class="flex items-center gap-2">
            <button id="garantias-lock-btn" class="p-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1" title="Bloquear sesión con clave">
              <span>🔒</span>
              <span class="hidden sm:inline">Bloquear</span>
            </button>
            <button id="garantias-close-modal-btn" class="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-xl transition-all" title="Cerrar modal">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>
        </div>

        <!-- TABS DE NAVEGACIÓN -->
        <div class="bg-gray-50 dark:bg-gray-800/80 px-4 py-2 border-b border-gray-200 dark:border-gray-700 flex flex-wrap gap-2 flex-shrink-0 items-center justify-between">
          <div class="flex flex-wrap gap-2 items-center">
            <button id="garantias-tab-form-btn" class="garantia-tab-btn px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-2 text-gray-700 dark:text-gray-300">
              <span>📝</span>
              <span>Nueva Garantía</span>
            </button>
            <button id="garantias-tab-history-btn" class="garantia-tab-btn active px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-2 text-gray-700 dark:text-gray-300">
              <span>🛡️</span>
              <span>Garantías Normales</span>
              <span id="garantias-history-count" class="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs px-2 py-0.5 rounded-full font-bold">0</span>
            </button>
            <button id="garantias-tab-hl-btn" class="garantia-tab-btn px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-2 text-gray-700 dark:text-gray-300">
              <span class="px-1.5 py-0.5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded text-[10px] font-black shadow-sm">HL</span>
              <span>Garantías HL</span>
              <span id="garantias-hl-count" class="bg-purple-500/20 text-purple-700 dark:text-purple-300 text-xs px-2 py-0.5 rounded-full font-bold">0</span>
            </button>
            <button id="garantias-tab-config-btn" class="garantia-tab-btn px-3 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-1.5 text-gray-700 dark:text-gray-300">
              <span>⚙️</span>
              <span class="hidden sm:inline">Configuración y Diagnóstico</span>
            </button>
          </div>

          <!-- Botón de Exportar a Excel rápido -->
          <button id="garantias-quick-excel-btn" class="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-1.5">
            <span>📊</span>
            <span>Exportar Excel</span>
          </button>
        </div>

        <!-- CUERPO PRINCIPAL DEL MODAL (Pestañas) -->
        <div class="flex-1 overflow-y-auto garantia-scroll p-3 sm:p-6 space-y-6">
          
          <!-- ========================================== -->
          <!-- PESTAÑA 1: FORMULARIO DE NUEVA GARANTÍA -->
          <!-- ========================================== -->
          <div id="garantias-tab-form" class="hidden space-y-6">
            
            <!-- Banner informativo con Ticket y Solicitante -->
            <div class="bg-gradient-to-r from-emerald-50 to-teal-50 dark:from-emerald-950/30 dark:to-teal-950/30 p-4 rounded-2xl border border-emerald-200 dark:border-emerald-800/50 flex flex-wrap items-center justify-between gap-3">
              <div class="flex items-center gap-3">
                <span class="text-2xl">🎫</span>
                <div>
                  <span class="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Número de Ticket Generado</span>
                  <div id="garantias-preview-ticket" class="text-lg font-black font-mono text-gray-900 dark:text-white">GAR-XXXX</div>
                </div>
              </div>
              <div class="flex flex-wrap items-center gap-4 text-xs text-gray-600 dark:text-gray-300">
                <div>
                  <span class="text-gray-400 block text-[10px] font-bold uppercase">Registrado Por</span>
                  <span id="garantias-preview-user" class="font-bold text-gray-800 dark:text-gray-100">Cargando...</span>
                </div>
                <div>
                  <span class="text-gray-400 block text-[10px] font-bold uppercase">Fecha y Hora</span>
                  <span id="garantias-preview-time" class="font-bold text-gray-800 dark:text-gray-100">Hoy</span>
                </div>
              </div>
            </div>

            <!-- Fila: Datos del Cliente / Tienda (Opcional pero muy útil) -->
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-gray-50 dark:bg-gray-800/40 p-4 rounded-2xl border border-gray-200 dark:border-gray-700/60">
              <div>
                <label class="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  Nombre del Cliente / Tienda / Sucursal <span class="text-gray-400 font-normal">(Opcional)</span>
                </label>
                <input type="text" id="garantia-input-cliente" 
                  class="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-emerald-500" 
                  placeholder="Ej. Tienda Centro / Cliente Pedro" />
              </div>
              <div>
                <label class="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                  Teléfono / WhatsApp de Contacto <span class="text-gray-400 font-normal">(Opcional)</span>
                </label>
                <input type="tel" id="garantia-input-telefono" 
                  class="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-emerald-500" 
                  placeholder="Ej. 0414-1234567" />
              </div>
            </div>

            <!-- SECCIÓN: AGREGAR PRODUCTO DEL CATÁLOGO -->
            <div class="bg-white dark:bg-gray-800 rounded-2xl p-4 sm:p-5 border-2 border-emerald-500/20 shadow-sm space-y-4">
              <div class="flex items-center justify-between">
                <h3 class="text-base font-black text-gray-900 dark:text-white flex items-center gap-2">
                  <span class="w-7 h-7 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-sm font-bold">1</span>
                  Seleccionar Producto del Catálogo
                </h3>
                <span class="text-xs text-gray-500">Cualquiera de los productos disponibles</span>
              </div>

              <!-- Buscador con Autocomplete -->
              <div class="relative">
                <div class="relative">
                  <input type="text" id="garantia-product-search-input" 
                    class="w-full pl-10 pr-4 py-3 rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-white text-sm focus:outline-none focus:border-emerald-500 transition-all" 
                    placeholder="Escriba código o nombre del producto..." autocomplete="off" />
                  <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-base">🔍</span>
                </div>

                <!-- Dropdown de resultados -->
                <div id="garantia-search-dropdown" class="hidden absolute top-full left-0 right-0 z-30 mt-1 max-h-64 overflow-y-auto garantia-scroll bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-2 space-y-1">
                  <!-- Llenado dinámico -->
                </div>
              </div>

              <!-- Tarjeta de Producto Seleccionado -->
              <div id="garantia-selected-product-card" class="hidden bg-emerald-50/70 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/50 rounded-2xl p-3.5 flex flex-col sm:flex-row items-center justify-between gap-3 animate-g-fade">
                <div class="flex items-center gap-3 min-w-0">
                  <img id="garantia-selected-img" src="" alt="Producto" class="w-14 h-14 object-contain rounded-xl bg-white p-1 border border-gray-200 flex-shrink-0" />
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <span id="garantia-selected-code" class="px-2 py-0.5 bg-emerald-600 text-white rounded font-mono font-bold text-xs"></span>
                      <span id="garantia-selected-dept" class="text-xs text-gray-500 font-medium truncate"></span>
                    </div>
                    <h4 id="garantia-selected-name" class="font-bold text-sm text-gray-900 dark:text-white truncate"></h4>
                    <span id="garantia-selected-stock" class="text-xs text-emerald-700 dark:text-emerald-300 font-semibold"></span>
                  </div>
                </div>
                <button type="button" id="garantia-clear-product-btn" class="text-xs text-red-500 hover:text-red-700 font-bold px-3 py-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40 transition-all">
                  ✕ Cambiar
                </button>
              </div>

              <!-- Fila: Cantidad y Falla Presentada -->
              <div class="grid grid-cols-1 lg:grid-cols-3 gap-4 pt-2">
                
                <!-- Selector de Cantidad -->
                <div class="lg:col-span-1 bg-gray-50 dark:bg-gray-900 p-3.5 rounded-2xl border border-gray-200 dark:border-gray-700">
                  <label class="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-2">
                    Cantidad Defectuosa
                  </label>
                  <div class="flex items-center gap-2">
                    <button type="button" id="garantia-qty-minus" class="w-10 h-10 rounded-xl bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 font-black text-gray-700 dark:text-gray-200 transition-all flex items-center justify-center text-lg">-</button>
                    <input type="number" id="garantia-qty-input" min="1" max="999" value="1" 
                      class="flex-1 text-center font-bold text-lg py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500" />
                    <button type="button" id="garantia-qty-plus" class="w-10 h-10 rounded-xl bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 font-black text-gray-700 dark:text-gray-200 transition-all flex items-center justify-center text-lg">+</button>
                  </div>
                </div>

                <!-- Falla Presentada con Tags Rápidos -->
                <div class="lg:col-span-2 space-y-2">
                  <label class="block text-xs font-bold text-gray-700 dark:text-gray-300">
                    Falla Presentada <span class="text-red-500">*</span>
                  </label>
                  
                  <!-- Tags rápidos de 1 tap -->
                  <div class="flex flex-wrap gap-1.5" id="garantia-quick-failure-tags">
                    <!-- Botones de fallas frecuentes -->
                  </div>

                  <textarea id="garantia-failure-desc-input" rows="2" 
                    class="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-xs sm:text-sm focus:outline-none focus:border-emerald-500 transition-all resize-none" 
                    placeholder="Describa el problema presentado por el producto..."></textarea>
                </div>
              </div>

              <!-- Apartado / Checkbox para Marcar como Producto HL -->
              <div class="pt-1">
                <label for="garantia-item-is-hl" class="flex items-start sm:items-center gap-3 p-3 rounded-2xl border-2 border-indigo-200 dark:border-indigo-800/80 bg-gradient-to-r from-indigo-50/80 via-purple-50/70 to-indigo-50/80 dark:from-indigo-950/40 dark:via-purple-950/30 dark:to-indigo-950/40 hover:border-indigo-400 dark:hover:border-indigo-600 transition-all cursor-pointer select-none">
                  <input type="checkbox" id="garantia-item-is-hl" class="w-5 h-5 mt-0.5 sm:mt-0 text-indigo-600 rounded-lg focus:ring-indigo-500 cursor-pointer accent-indigo-600" />
                  <div class="flex-1">
                    <div class="flex items-center gap-2">
                      <span class="px-2 py-0.5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-md text-[10px] font-black tracking-wider uppercase shadow-sm">HL</span>
                      <span class="text-xs sm:text-sm font-black text-indigo-950 dark:text-indigo-100">¿Este producto es de HL? (Marcar mercancía HL)</span>
                    </div>
                    <p class="text-[11px] text-indigo-700 dark:text-indigo-300 mt-0.5 leading-tight">
                      Marque esta opción para clasificar el producto como mercancía de HL. Se guardará de manera independiente en el <b>apartado de Garantías HL</b> (separado de las normales).
                    </p>
                  </div>
                </label>
              </div>

              <!-- Botón Agregar a la Solicitud -->
              <div class="pt-2 flex justify-end">
                <button type="button" id="garantia-add-item-btn" class="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl font-bold text-xs sm:text-sm shadow-md flex items-center gap-2 transition-all">
                  <span>➕</span>
                  <span>Agregar Producto a la Solicitud</span>
                </button>
              </div>
            </div>

            <!-- SECCIÓN: PRODUCTOS AGREGADOS A LA SOLICITUD (Como un pedido para admin) -->
            <div class="bg-white dark:bg-gray-800 rounded-2xl p-4 sm:p-5 border border-gray-200 dark:border-gray-700 space-y-3">
              <div class="flex items-center justify-between">
                <h3 class="text-base font-black text-gray-900 dark:text-white flex items-center gap-2">
                  <span class="w-7 h-7 rounded-lg bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-sm font-bold">2</span>
                  Productos en este Pedido de Garantía
                </h3>
                <span id="garantia-items-badge" class="px-3 py-1 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 rounded-full font-bold text-xs">
                  0 artículos (0 unidades)
                </span>
              </div>

              <div id="garantia-items-empty" class="text-center py-8 text-gray-400 dark:text-gray-500 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl">
                <span class="text-3xl block mb-2">📦</span>
                <p class="text-sm font-semibold">No has agregado productos a esta garantía aún.</p>
                <p class="text-xs">Busca y selecciona un producto arriba para agregarlo.</p>
              </div>

              <div id="garantia-items-list" class="space-y-2 max-h-72 overflow-y-auto garantia-scroll">
                <!-- Se llena dinámicamente con las tarjetas de productos -->
              </div>
            </div>

            <!-- Observaciones Generales del Pedido de Garantía -->
            <div>
              <label class="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
                Observaciones Generales de la Solicitud <span class="text-gray-400 font-normal">(Opcional)</span>
              </label>
              <textarea id="garantia-input-observaciones" rows="2" 
                class="w-full px-3.5 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-xs sm:text-sm focus:outline-none focus:border-emerald-500" 
                placeholder="Notas adicionales para el Administrador (ej. Cliente trae empaque completo y factura)..."></textarea>
            </div>

            <!-- BOTÓN FINAL DE ENVÍO -->
            <div class="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-gray-200 dark:border-gray-700">
              <button type="button" id="garantia-reset-form-btn" class="w-full sm:w-auto px-4 py-2.5 rounded-xl font-bold text-xs text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-white transition-all">
                🗑️ Limpiar Formulario
              </button>
              
              <button type="button" id="garantia-submit-order-btn" class="w-full sm:w-auto px-7 py-3.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-700 hover:from-emerald-700 hover:to-teal-700 text-white rounded-2xl font-black text-sm sm:text-base shadow-xl shadow-emerald-600/30 transition-all flex items-center justify-center gap-2">
                <span>🚀</span>
                <span>Enviar Solicitud de Garantía a Admin</span>
              </button>
            </div>
          </div>

          <!-- ========================================== -->
          <!-- PESTAÑA 2: LISTA ACUMULADA Y GESTIÓN -->
          <!-- ========================================== -->
          <div id="garantias-tab-history" class="space-y-6">
            
            <!-- ENCABEZADO DINÁMICO DE APARTADO (NORMAL O HL) -->
            <div id="garantias-section-header"></div>

            <!-- TARJETAS DE ESTADÍSTICAS (KPIs) -->
            <div class="grid grid-cols-2 sm:grid-cols-5 gap-2.5 sm:gap-3">
              <div class="bg-gray-50 dark:bg-gray-800/80 p-3 sm:p-4 rounded-2xl border border-gray-200 dark:border-gray-700 text-center">
                <span class="text-xs text-gray-500 block font-bold">Total Garantías</span>
                <span id="stat-total" class="text-xl sm:text-2xl font-black text-gray-900 dark:text-white">0</span>
              </div>
              <div class="bg-amber-50 dark:bg-amber-950/30 p-3 sm:p-4 rounded-2xl border border-amber-200 dark:border-amber-800/40 text-center">
                <span class="text-xs text-amber-700 dark:text-amber-400 block font-bold">⏳ Pendientes</span>
                <span id="stat-pendientes" class="text-xl sm:text-2xl font-black text-amber-800 dark:text-amber-300">0</span>
              </div>
              <div class="bg-blue-50 dark:bg-blue-950/30 p-3 sm:p-4 rounded-2xl border border-blue-200 dark:border-blue-800/40 text-center">
                <span class="text-xs text-blue-700 dark:text-blue-400 block font-bold">🔍 En Revisión</span>
                <span id="stat-revision" class="text-xl sm:text-2xl font-black text-blue-800 dark:text-blue-300">0</span>
              </div>
              <div class="bg-emerald-50 dark:bg-emerald-950/30 p-3 sm:p-4 rounded-2xl border border-emerald-200 dark:border-emerald-800/40 text-center">
                <span class="text-xs text-emerald-700 dark:text-emerald-400 block font-bold">✅ Aprobadas</span>
                <span id="stat-aprobadas" class="text-xl sm:text-2xl font-black text-emerald-800 dark:text-emerald-300">0</span>
              </div>
              <div class="col-span-2 sm:col-span-1 bg-red-50 dark:bg-red-950/30 p-3 sm:p-4 rounded-2xl border border-red-200 dark:border-red-800/40 text-center">
                <span class="text-xs text-red-700 dark:text-red-400 block font-bold">❌ Rechazadas</span>
                <span id="stat-rechazadas" class="text-xl sm:text-2xl font-black text-red-800 dark:text-red-300">0</span>
              </div>
            </div>

            <!-- BARRA DE FILTROS Y BÚSQUEDA -->
            <div class="bg-gray-50 dark:bg-gray-800/60 p-4 rounded-2xl border border-gray-200 dark:border-gray-700 space-y-3">
              
              <!-- FILTRO RÁPIDO POR PERÍODO (DÍA / SEMANA / MES) + BOTÓN ADMIN DE CONSOLIDAR -->
              <div class="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 dark:border-gray-700 pb-3">
                <div class="flex flex-wrap items-center gap-1.5" id="garantias-quick-period-group">
                  <span class="text-[11px] font-black uppercase text-gray-500 mr-1 flex items-center gap-1">
                    <span>⏱️</span>
                    <span>Período:</span>
                  </span>
                  <button type="button" class="quick-period-btn active px-2.5 py-1 rounded-xl text-xs font-bold transition-all bg-emerald-600 text-white shadow-sm" data-period="all">
                    🌐 Todo
                  </button>
                  <button type="button" class="quick-period-btn px-2.5 py-1 rounded-xl text-xs font-bold transition-all bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700" data-period="today">
                    📅 Hoy
                  </button>
                  <button type="button" class="quick-period-btn px-2.5 py-1 rounded-xl text-xs font-bold transition-all bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700" data-period="week">
                    📆 Esta Semana
                  </button>
                  <button type="button" class="quick-period-btn px-2.5 py-1 rounded-xl text-xs font-bold transition-all bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-700" data-period="month">
                    🗓️ Este Mes
                  </button>
                  <div class="flex items-center gap-1 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-xl px-2 py-0.5" title="Filtrar por día específico">
                    <span class="text-[11px] text-gray-400 font-bold">Día:</span>
                    <input type="date" id="garantias-custom-date-filter" class="text-xs bg-transparent text-gray-800 dark:text-white font-bold focus:outline-none" />
                  </div>
                </div>

                <!-- Botón Admin: Juntar / Confirmar y Exportar por Período -->
                <div id="garantias-admin-period-actions" class="flex items-center gap-2">
                  <button type="button" id="garantias-batch-admin-btn" class="px-3.5 py-1.5 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 hover:from-amber-600 hover:to-orange-600 text-white rounded-xl font-black text-xs shadow-md transition-all flex items-center gap-1.5 cursor-pointer" title="Juntar o confirmar todas las garantías de un día, semana o mes y exportar">
                    <span>⚡</span>
                    <span>Juntar / Confirmar por Período</span>
                  </button>
                </div>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                
                <!-- Filtro por Mes -->
                <div>
                  <label class="block text-[11px] font-bold uppercase text-gray-500 mb-1">📅 Mes</label>
                  <select id="garantias-filter-month" class="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs font-bold text-gray-800 dark:text-white focus:outline-none focus:border-emerald-500">
                    <option value="all" selected>Todos los Meses</option>
                    <option value="01">Enero</option>
                    <option value="02">Febrero</option>
                    <option value="03">Marzo</option>
                    <option value="04">Abril</option>
                    <option value="05">Mayo</option>
                    <option value="06">Junio</option>
                    <option value="07">Julio</option>
                    <option value="08">Agosto</option>
                    <option value="09">Septiembre</option>
                    <option value="10">Octubre</option>
                    <option value="11">Noviembre</option>
                    <option value="12">Diciembre</option>
                  </select>
                </div>

                <!-- Filtro por Año -->
                <div>
                  <label class="block text-[11px] font-bold uppercase text-gray-500 mb-1">📆 Año</label>
                  <select id="garantias-filter-year" class="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs font-bold text-gray-800 dark:text-white focus:outline-none focus:border-emerald-500">
                    <option value="all">Todos los Años</option>
                    <option value="2025">2025</option>
                    <option value="2026" selected>2026</option>
                    <option value="2027">2027</option>
                  </select>
                </div>

                <!-- Filtro por Estado -->
                <div>
                  <label class="block text-[11px] font-bold uppercase text-gray-500 mb-1">🏷️ Estado</label>
                  <select id="garantias-filter-status" class="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs font-bold text-gray-800 dark:text-white focus:outline-none focus:border-emerald-500">
                    <option value="all">Todos los Estados</option>
                    <option value="pendiente">⏳ Pendiente</option>
                    <option value="en_revision">🔍 En Revisión</option>
                    <option value="aprobada">✅ Aprobada</option>
                    <option value="rechazada">❌ Rechazada</option>
                    <option value="completada">📦 Completada</option>
                  </select>
                </div>

                <!-- Filtro por Usuario / Gestor -->
                <div>
                  <label class="block text-[11px] font-bold uppercase text-gray-500 mb-1">👤 Registrado Por</label>
                  <select id="garantias-filter-user" class="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs font-bold text-gray-800 dark:text-white focus:outline-none focus:border-emerald-500">
                    <option value="all">Todos los Gestores / Admin</option>
                  </select>
                </div>
              </div>

              <!-- Fila: Buscador en vivo + Botón Excel por Mes -->
              <div class="flex flex-col sm:flex-row items-center gap-3 pt-1">
                <div class="relative flex-1 w-full">
                  <input type="text" id="garantias-search-history-input" 
                    class="w-full pl-9 pr-4 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500" 
                    placeholder="Buscar por Ticket, producto, código, cliente o falla..." />
                  <span class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs">🔍</span>
                </div>

                <div class="flex items-center gap-2 w-full sm:w-auto justify-end">
                  <button type="button" id="garantias-export-excel-btn" class="flex-1 sm:flex-initial px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white rounded-xl font-bold text-xs shadow-md transition-all flex items-center justify-center gap-1.5 whitespace-nowrap">
                    <span>📊</span>
                    <span id="garantias-export-label">Exportar a Excel</span>
                  </button>
                  <button type="button" id="garantias-refresh-btn" class="p-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-xl text-xs font-bold transition-all" title="Recargar lista de Supabase">
                    🔄
                  </button>
                </div>
              </div>
            </div>

            <!-- LISTA DE TARJETAS DE GARANTÍAS -->
            <div id="garantias-history-list" class="space-y-4">
              <!-- Se llena dinámicamente -->
            </div>

            <!-- Estado Vacío -->
            <div id="garantias-history-empty" class="hidden text-center py-12 bg-gray-50 dark:bg-gray-800/40 rounded-3xl border border-dashed border-gray-300 dark:border-gray-700">
              <span class="text-4xl block mb-2">🔍</span>
              <p class="font-bold text-gray-800 dark:text-white text-base">No se encontraron garantías registradas</p>
              <p class="text-xs text-gray-500 mt-1">Prueba cambiando el mes o los filtros de búsqueda.</p>
              <button type="button" id="empty-reset-filters-btn" class="mt-3 px-4 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-xl hover:bg-emerald-700 transition-all">
                Ver Todas las Garantías
              </button>
            </div>

            <!-- BARRA FLOTANTE DE ACCIONES POR SELECCIÓN MÚLTIPLE (ADMIN) -->
            <div id="garantias-selection-bar" class="hidden sticky bottom-2 z-20 bg-gray-900/95 dark:bg-gray-950/95 text-white p-3 rounded-2xl shadow-2xl border border-gray-700 backdrop-blur-md flex flex-wrap items-center justify-between gap-3 animate-g-fade">
              <div class="flex items-center gap-2">
                <span class="w-8 h-8 rounded-xl bg-amber-500/30 text-amber-300 flex items-center justify-center font-black text-sm">⚡</span>
                <div>
                  <span id="selection-bar-count" class="font-bold text-xs sm:text-sm">0 garantías seleccionadas</span>
                  <span class="block text-[10px] text-gray-400">Acciones en lote para administración</span>
                </div>
              </div>
              <div class="flex items-center gap-2 flex-wrap">
                <button type="button" id="selection-confirm-all-btn" class="px-3 py-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-bold text-xs rounded-xl shadow transition-all flex items-center gap-1 cursor-pointer">
                  <span>✅</span>
                  <span>Confirmar Seleccionadas</span>
                </button>
                <button type="button" id="selection-export-btn" class="px-3 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-bold text-xs rounded-xl shadow transition-all flex items-center gap-1 cursor-pointer">
                  <span>📊</span>
                  <span>Exportar Seleccionadas</span>
                </button>
                <button type="button" id="selection-clear-btn" class="px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 text-gray-300 font-bold text-xs rounded-xl transition-all cursor-pointer">
                  ✕ Cancelar
                </button>
              </div>
            </div>
          </div>

          <!-- ========================================== -->
          <!-- PESTAÑA 3: CONFIGURACIÓN Y DIAGNÓSTICO -->
          <!-- ========================================== -->
          <div id="garantias-tab-config" class="hidden space-y-6">
            <div class="bg-gray-50 dark:bg-gray-800/50 p-6 rounded-3xl border border-gray-200 dark:border-gray-700 space-y-6 max-w-xl mx-auto">
              
              <div>
                <h3 class="text-lg font-black text-gray-900 dark:text-white flex items-center gap-2">
                  <span>🔐</span>
                  <span>Clave de Acceso al Módulo</span>
                </h3>
                <p class="text-xs text-gray-500 mt-1">
                  Esta clave será solicitada a Gestores y Administradores para abrir el formulario de Garantías.
                </p>
              </div>

              <div class="space-y-3">
                <div>
                  <label class="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">Nueva Clave</label>
                  <input type="text" id="config-new-pin-input" 
                    class="w-full px-4 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white text-sm font-mono font-bold focus:outline-none focus:border-emerald-500" 
                    placeholder="Mínimo 4 caracteres..." />
                </div>
                
                <button type="button" id="config-save-pin-btn" class="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-sm shadow-md transition-all">
                  💾 Guardar Nueva Clave
                </button>
                <div id="config-pin-status" class="hidden text-xs text-center font-bold py-2 px-3 rounded-xl"></div>
              </div>

              <hr class="border-gray-200 dark:border-gray-700" />

              <div>
                <h4 class="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                  <span>🗄️</span>
                  <span>Diagnóstico y Sincronización Multi-PC (Supabase)</span>
                </h4>
                <p class="text-xs text-gray-500 mt-1">
                  Comprueba si la tabla <code class="font-mono text-emerald-600 dark:text-emerald-400 font-bold">public.garantias</code> está respondiendo en tus servidores Supabase para que las solicitudes viajen entre PCs en tiempo real.
                </p>
              </div>

              <div class="flex flex-col sm:flex-row gap-2">
                <button type="button" id="config-test-db-btn" class="flex-1 py-2.5 px-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white text-xs font-bold rounded-xl shadow-md transition-all">
                  🔍 Probar Conexión en Ambos Supabase
                </button>
                <button type="button" id="config-sync-cache-btn" class="flex-1 py-2.5 px-3 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-xl shadow-md transition-all">
                  🔄 Subir Registros Locales a la Nube
                </button>
              </div>

              <div id="config-db-status" class="hidden text-xs py-3 px-4 rounded-2xl border space-y-1"></div>
            </div>
          </div>

        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Inicializar eventos del modal principal
    setupModalEvents();
  }

  // ============================================================
  // EVENTOS DEL MODAL PRINCIPAL
  // ============================================================
  function setupModalEvents() {
    const modal = document.getElementById('garantias-main-modal');
    if (!modal) return;

    // Reloj en tiempo real
    setInterval(() => {
      const clockEl = document.getElementById('garantias-clock');
      if (clockEl) {
        clockEl.textContent = '· ' + new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
      }
    }, 1000);

    // Botones de cabecera
    document.getElementById('garantias-close-modal-btn').onclick = closeGarantiasModal;
    document.getElementById('garantias-lock-btn').onclick = () => {
      isSessionUnlocked = false;
      sessionStorage.removeItem(STORAGE_SESSION_UNLOCKED);
      closeGarantiasModal();
      promptPinOrOpen();
    };

    // Navegación de Pestañas
    const tabFormBtn = document.getElementById('garantias-tab-form-btn');
    const tabHistoryBtn = document.getElementById('garantias-tab-history-btn');
    const tabHlBtn = document.getElementById('garantias-tab-hl-btn');
    const tabConfigBtn = document.getElementById('garantias-tab-config-btn');

    const tabForm = document.getElementById('garantias-tab-form');
    const tabHistory = document.getElementById('garantias-tab-history');
    const tabConfig = document.getElementById('garantias-tab-config');

    const switchTab = (tab) => {
      [tabFormBtn, tabHistoryBtn, tabHlBtn, tabConfigBtn].forEach(b => {
        b?.classList.remove('active');
        b?.classList.remove('active-hl');
      });
      [tabForm, tabHistory, tabConfig].forEach(t => t?.classList.add('hidden'));

      if (tab === 'form') {
        currentActiveTab = 'form';
        tabFormBtn?.classList.add('active');
        tabForm?.classList.remove('hidden');
      } else if (tab === 'normal' || tab === 'history') {
        currentActiveTab = 'normal';
        currentWarrantySection = 'normal';
        tabHistoryBtn?.classList.add('active');
        tabHistory?.classList.remove('hidden');
        selectedTickets.clear();
        updateSelectionBar();
        fetchGarantiasFromDatabase().then(() => renderHistoryList());
      } else if (tab === 'hl') {
        currentActiveTab = 'hl';
        currentWarrantySection = 'hl';
        tabHlBtn?.classList.add('active-hl');
        tabHistory?.classList.remove('hidden');
        selectedTickets.clear();
        updateSelectionBar();
        fetchGarantiasFromDatabase().then(() => renderHistoryList());
      } else if (tab === 'config') {
        currentActiveTab = 'config';
        tabConfigBtn?.classList.add('active');
        tabConfig?.classList.remove('hidden');
        const pinInput = document.getElementById('config-new-pin-input');
        if (pinInput) pinInput.value = getStoredPIN();
      }
    };

    tabFormBtn.onclick = () => switchTab('form');
    tabHistoryBtn.onclick = () => switchTab('normal');
    if (tabHlBtn) tabHlBtn.onclick = () => switchTab('hl');
    tabConfigBtn.onclick = () => switchTab('config');

    // Botones de filtro rápido de período (Hoy, Semana, Mes, Todo)
    const periodButtons = modal.querySelectorAll('.quick-period-btn');
    periodButtons.forEach(btn => {
      btn.onclick = () => {
        periodButtons.forEach(b => {
          b.classList.remove('active');
          b.classList.remove('active-hl');
        });
        if (currentWarrantySection === 'hl') {
          btn.classList.add('active-hl');
        } else {
          btn.classList.add('active');
        }

        filterPeriod = btn.dataset.period || 'all';
        const customDateInput = document.getElementById('garantias-custom-date-filter');
        if (filterPeriod !== 'custom_date' && customDateInput) {
          customDateInput.value = '';
        }
        renderHistoryList();
      };
    });

    const customDateInput = document.getElementById('garantias-custom-date-filter');
    if (customDateInput) {
      customDateInput.onchange = () => {
        if (customDateInput.value) {
          filterPeriod = 'custom_date';
          filterCustomDate = customDateInput.value;
          periodButtons.forEach(b => {
            b.classList.remove('active');
            b.classList.remove('active-hl');
          });
          renderHistoryList();
        }
      };
    }

    // Botón Admin: Juntar / Confirmar y Exportar por Período
    const batchAdminBtn = document.getElementById('garantias-batch-admin-btn');
    if (batchAdminBtn) {
      batchAdminBtn.onclick = openBatchPeriodModal;
    }

    // Botones de la barra flotante de selección múltiple (Admin)
    const selConfirmBtn = document.getElementById('selection-confirm-all-btn');
    if (selConfirmBtn) {
      selConfirmBtn.onclick = async () => {
        if (selectedTickets.size === 0) return;
        const count = selectedTickets.size;
        if (!confirm(`¿Deseas confirmar y aprobar las ${count} garantías seleccionadas?`)) return;

        selConfirmBtn.disabled = true;
        selConfirmBtn.textContent = 'Confirmando...';
        await batchUpdateGarantiasStatusInDB(Array.from(selectedTickets), 'aprobada', 'Confirmado por Administración en selección');
        selectedTickets.clear();
        updateSelectionBar();
        renderHistoryList();
        selConfirmBtn.disabled = false;
        selConfirmBtn.innerHTML = '<span>✅</span><span>Confirmar Seleccionadas</span>';
        alert(`✅ ¡${count} garantías fueron aprobadas y confirmadas con éxito!`);
      };
    }

    const selExportBtn = document.getElementById('selection-export-btn');
    if (selExportBtn) {
      selExportBtn.onclick = () => {
        if (selectedTickets.size === 0) return;
        const listToExport = allGarantias.filter(g => selectedTickets.has(g.codigo_ticket));
        const periodText = `Seleccion_${listToExport.length}_Garantias`;
        exportBatchConsolidatedToExcel(listToExport, periodText, currentWarrantySection);
      };
    }

    const selClearBtn = document.getElementById('selection-clear-btn');
    if (selClearBtn) {
      selClearBtn.onclick = () => {
        selectedTickets.clear();
        updateSelectionBar();
        renderHistoryList();
      };
    }

    // Botón exportar excel en cabecera de tabs
    document.getElementById('garantias-quick-excel-btn').onclick = exportFilteredGarantiasToExcel;

    // Auto-guardar borrador cuando el usuario escribe en los campos del formulario
    ['garantia-input-cliente', 'garantia-input-telefono', 'garantia-input-observaciones', 'garantia-failure-desc-input'].forEach(inputId => {
      const el = document.getElementById(inputId);
      if (el) {
        el.addEventListener('input', () => {
          // Debounce: guardar 500ms después de dejar de escribir
          clearTimeout(el._draftTimer);
          el._draftTimer = setTimeout(saveFormDraft, 500);
        });
      }
    });

    // Renderizar tags rápidos de fallas
    const tagsContainer = document.getElementById('garantia-quick-failure-tags');
    if (tagsContainer) {
      tagsContainer.innerHTML = QUICK_FAILURES.map(tag => `
        <button type="button" class="quick-fail-btn text-[11px] px-2.5 py-1 rounded-lg bg-gray-100 hover:bg-emerald-100 text-gray-700 hover:text-emerald-800 dark:bg-gray-800 dark:hover:bg-emerald-950 dark:text-gray-300 dark:hover:text-emerald-300 transition-all font-medium border border-gray-200 dark:border-gray-700">
          ${tag}
        </button>
      `).join('');

      tagsContainer.querySelectorAll('.quick-fail-btn').forEach(btn => {
        btn.onclick = () => {
          const descInput = document.getElementById('garantia-failure-desc-input');
          const text = btn.textContent.trim();
          if (descInput) {
            if (descInput.value.trim() === '') {
              descInput.value = text;
            } else if (!descInput.value.includes(text)) {
              descInput.value += '; ' + text;
            }
            descInput.focus();
          }
        };
      });
    }

    // Buscador de productos del catálogo
    const searchInput = document.getElementById('garantia-product-search-input');
    const searchDropdown = document.getElementById('garantia-search-dropdown');

    searchInput.oninput = () => {
      const q = searchInput.value.trim().toLowerCase();
      if (q.length < 1) {
        searchDropdown.classList.add('hidden');
        return;
      }

      const products = (window.allProducts && Array.isArray(window.allProducts)) ? window.allProducts : [];
      const matches = products.filter(p => {
        const codigo = (p.codigo || '').toLowerCase();
        const nombre = (p.nombre || '').toLowerCase();
        const depto = (p.departamento || '').toLowerCase();
        return codigo.includes(q) || nombre.includes(q) || depto.includes(q);
      }).slice(0, 20);

      if (matches.length === 0) {
        searchDropdown.innerHTML = '<div class="p-3 text-xs text-gray-400 text-center">No se encontraron productos coincidentes</div>';
        searchDropdown.classList.remove('hidden');
        return;
      }

      searchDropdown.innerHTML = matches.map(p => `
        <div class="product-search-item flex items-center justify-between p-2 rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-950/40 cursor-pointer transition-all border-b border-gray-100 dark:border-gray-800 last:border-0" data-id="${p.id}">
          <div class="flex items-center gap-2.5 min-w-0">
            <img src="${p.imagen_url || 'https://i.ibb.co/RkyBVXBP/LOGO-SONIMAX-PNG-2.png'}" class="w-9 h-9 object-contain rounded-lg bg-white p-0.5 border border-gray-200 flex-shrink-0" />
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <span class="px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded font-mono font-bold text-[10px]">${p.codigo || 'S/C'}</span>
                <span class="text-[10px] text-gray-400 truncate">${p.departamento || ''}</span>
              </div>
              <p class="font-bold text-xs text-gray-800 dark:text-white truncate">${p.nombre}</p>
            </div>
          </div>
          <div class="text-right flex-shrink-0 ml-2">
            <span class="text-[11px] font-bold ${p.stock > 0 ? 'text-emerald-600' : 'text-red-500'}">Stock: ${p.stock ?? 0}</span>
          </div>
        </div>
      `).join('');

      searchDropdown.classList.remove('hidden');

      searchDropdown.querySelectorAll('.product-search-item').forEach(item => {
        item.onclick = () => {
          const prodId = item.dataset.id;
          const found = products.find(p => String(p.id) === String(prodId));
          if (found) {
            selectCatalogProduct(found);
            searchDropdown.classList.add('hidden');
            searchInput.value = '';
          }
        };
      });
    };

    // Cerrar dropdown al hacer click fuera
    document.addEventListener('click', (e) => {
      if (!searchInput.contains(e.target) && !searchDropdown.contains(e.target)) {
        searchDropdown.classList.add('hidden');
      }
    });

    // Botón cambiar producto seleccionado
    document.getElementById('garantia-clear-product-btn').onclick = () => {
      selectedCatalogProduct = null;
      document.getElementById('garantia-selected-product-card').classList.add('hidden');
      searchInput.focus();
    };

    // Cantidad más / menos
    const qtyInput = document.getElementById('garantia-qty-input');
    document.getElementById('garantia-qty-minus').onclick = () => {
      let val = parseInt(qtyInput.value) || 1;
      if (val > 1) qtyInput.value = val - 1;
    };
    document.getElementById('garantia-qty-plus').onclick = () => {
      let val = parseInt(qtyInput.value) || 1;
      qtyInput.value = val + 1;
    };

    // Botón agregar producto a la solicitud
    document.getElementById('garantia-add-item-btn').onclick = () => {
      if (!selectedCatalogProduct) {
        alert('⚠️ Por favor busca y selecciona un producto del catálogo primero.');
        searchInput.focus();
        return;
      }

      const qty = parseInt(qtyInput.value) || 1;
      if (qty < 1) {
        alert('⚠️ La cantidad debe ser al menos 1.');
        return;
      }

      const descInput = document.getElementById('garantia-failure-desc-input');
      const falla = descInput.value.trim();
      if (!falla) {
        alert('⚠️ Por favor indica la falla presentada por el producto.');
        descInput.focus();
        return;
      }

      const isHL = document.getElementById('garantia-item-is-hl')?.checked || false;

      // Agregar a la lista de items
      currentWarrantyItems.push({
        id: selectedCatalogProduct.id,
        codigo: selectedCatalogProduct.codigo || 'S/C',
        nombre: selectedCatalogProduct.nombre,
        departamento: selectedCatalogProduct.departamento || '',
        cantidad: qty,
        falla: falla,
        imagen_url: selectedCatalogProduct.imagen_url || '',
        es_hl: isHL
      });

      // Limpiar selección actual
      selectedCatalogProduct = null;
      document.getElementById('garantia-selected-product-card').classList.add('hidden');
      descInput.value = '';
      qtyInput.value = '1';
      const hlChk = document.getElementById('garantia-item-is-hl');
      if (hlChk) hlChk.checked = false;

      renderCurrentWarrantyItems();
      saveFormDraft(); // Auto-guardar borrador al agregar producto
    };

    // Limpiar formulario completo
    document.getElementById('garantia-reset-form-btn').onclick = () => {
      if (currentWarrantyItems.length > 0 && !confirm('¿Deseas vaciar todos los productos agregados a este formulario?')) {
        return;
      }
      resetForm();
    };

    // Enviar formulario de Garantía
    document.getElementById('garantia-submit-order-btn').onclick = submitWarrantyOrder;

    // Filtros de Historial
    const filterMonthEl = document.getElementById('garantias-filter-month');
    const filterYearEl = document.getElementById('garantias-filter-year');
    const filterStatusEl = document.getElementById('garantias-filter-status');
    const filterUserEl = document.getElementById('garantias-filter-user');
    const searchHistoryEl = document.getElementById('garantias-search-history-input');

    if (filterMonthEl) filterMonthEl.value = filterMonth;
    if (filterYearEl) filterYearEl.value = filterYear;

    const onFilterChange = () => {
      filterMonth = filterMonthEl.value;
      filterYear = filterYearEl.value;
      filterStatus = filterStatusEl.value;
      filterUser = filterUserEl.value;
      searchQuery = searchHistoryEl.value.trim().toLowerCase();

      // Actualizar label de exportar excel
      const label = document.getElementById('garantias-export-label');
      if (label) {
        if (filterMonth === 'all') {
          label.textContent = `Exportar Todo a Excel`;
        } else {
          const mIndex = parseInt(filterMonth) - 1;
          label.textContent = `Exportar ${MONTH_NAMES[mIndex]} a Excel`;
        }
      }

      renderHistoryList();
    };

    filterMonthEl.onchange = onFilterChange;
    filterYearEl.onchange = onFilterChange;
    filterStatusEl.onchange = onFilterChange;
    filterUserEl.onchange = onFilterChange;
    searchHistoryEl.oninput = onFilterChange;

    const resetFilterBtn = document.getElementById('empty-reset-filters-btn');
    if (resetFilterBtn) {
      resetFilterBtn.onclick = () => {
        filterMonthEl.value = 'all';
        filterStatusEl.value = 'all';
        filterUserEl.value = 'all';
        searchHistoryEl.value = '';
        onFilterChange();
      };
    }

    // Botón refrescar
    document.getElementById('garantias-refresh-btn').onclick = async () => {
      const btn = document.getElementById('garantias-refresh-btn');
      btn.classList.add('animate-spin');
      await fetchGarantiasFromDatabase();
      renderHistoryList();
      setTimeout(() => btn.classList.remove('animate-spin'), 600);
    };

    document.getElementById('garantias-export-excel-btn').onclick = exportFilteredGarantiasToExcel;

    // Pestaña Configuración: Guardar PIN
    document.getElementById('config-save-pin-btn').onclick = () => {
      const newPin = document.getElementById('config-new-pin-input')?.value?.trim();
      const statusEl = document.getElementById('config-pin-status');
      if (!newPin || newPin.length < 3) {
        statusEl.className = 'text-xs text-center font-bold py-2 px-3 rounded-xl bg-red-100 text-red-700';
        statusEl.textContent = 'La clave debe tener al menos 3 caracteres.';
        statusEl.classList.remove('hidden');
        return;
      }
      localStorage.setItem(STORAGE_PIN_KEY, newPin);
      statusEl.className = 'text-xs text-center font-bold py-2 px-3 rounded-xl bg-emerald-100 text-emerald-800';
      statusEl.textContent = `✅ ¡Clave actualizada exitosamente a: "${newPin}"!`;
      statusEl.classList.remove('hidden');
    };

    // Diagnóstico exhaustivo de ambos servidores Supabase
    document.getElementById('config-test-db-btn').onclick = async () => {
      const statusEl = document.getElementById('config-db-status');
      statusEl.className = 'text-xs py-3 px-4 rounded-2xl bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 border border-blue-200 dark:border-blue-800 space-y-2 text-left';
      statusEl.innerHTML = '<b>🔍 Probando conexión en ambos servidores Supabase...</b>';
      statusEl.classList.remove('hidden');

      const clients = getAllSupabaseClients();
      if (clients.length === 0) {
        statusEl.innerHTML = '<span class="text-red-500 font-bold">❌ No hay clientes de Supabase configurados en supabase-config.js</span>';
        return;
      }

      let resultsHtml = '';
      let anyWorking = false;

      for (const c of clients) {
        try {
          const { data, error } = await c.client.from('garantias').select('id, codigo_ticket, created_at').limit(5);
          if (error) {
            resultsHtml += `
              <div class="p-2.5 rounded-xl bg-amber-100/70 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 space-y-1">
                <div class="font-bold flex items-center gap-1.5">
                  <span>⚠️</span>
                  <span>${c.name}</span>
                </div>
                <div class="text-[11px] font-mono text-red-700 dark:text-red-300">Error: ${error.message}</div>
                <div class="text-[11px] opacity-90">
                  👉 <b>Solución:</b> Ve a Supabase de este servidor y ejecuta el script <code>supabase-garantias.sql</code>.
                </div>
              </div>
            `;
          } else {
            anyWorking = true;
            resultsHtml += `
              <div class="p-2.5 rounded-xl bg-emerald-100/70 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200">
                <div class="font-bold flex items-center gap-1.5">
                  <span>✅</span>
                  <span>${c.name}</span>
                </div>
                <div class="text-[11px] mt-0.5">
                  ¡Tabla <code>public.garantias</code> conectada y lista! (${data.length} registros de prueba consultados).
                </div>
              </div>
            `;
          }
        } catch (e) {
          resultsHtml += `
            <div class="p-2.5 rounded-xl bg-red-100/70 dark:bg-red-950/50 text-red-900 dark:text-red-200">
              <span class="font-bold">❌ ${c.name}:</span> Error de conexión (${e.message}).
            </div>
          `;
        }
      }

      statusEl.innerHTML = `
        <div class="font-bold text-sm mb-1">${anyWorking ? '✅ Diagnóstico Multi-PC Finalizado' : '⚠️ Atención: Se requiere ejecutar el SQL en Supabase'}</div>
        ${resultsHtml}
      `;
    };

    // Subir registros locales a la nube
    document.getElementById('config-sync-cache-btn').onclick = async () => {
      const statusEl = document.getElementById('config-db-status');
      statusEl.className = 'text-xs text-center font-bold py-2 px-3 rounded-xl bg-blue-100 text-blue-800';
      statusEl.textContent = 'Sincronizando registros con Supabase...';
      statusEl.classList.remove('hidden');

      const localList = loadLocalCache();
      const clients = getAllSupabaseClients();

      if (clients.length === 0 || localList.length === 0) {
        statusEl.textContent = `No hay registros en caché o Supabase no está conectado. (${localList.length} en caché local)`;
        return;
      }

      try {
        let synced = 0;
        for (const item of localList) {
          for (const c of clients) {
            try {
              const { error } = await c.client.from('garantias').upsert([item]);
              if (!error) synced++;
            } catch (err) {}
          }
        }
        statusEl.className = 'text-xs text-center font-bold py-2 px-3 rounded-xl bg-emerald-100 text-emerald-800';
        statusEl.textContent = `✅ ¡Sincronización completada! Registros actualizados en la nube. Ya la otra PC puede verlos.`;
        await fetchGarantiasFromDatabase();
        renderHistoryList();
      } catch (e) {
        statusEl.className = 'text-xs text-center font-bold py-2 px-3 rounded-xl bg-red-100 text-red-800';
        statusEl.textContent = `Error en sincronización: ${e.message}`;
      }
    };
  }

  function selectCatalogProduct(product) {
    selectedCatalogProduct = product;
    const card = document.getElementById('garantia-selected-product-card');
    document.getElementById('garantia-selected-img').src = product.imagen_url || 'https://i.ibb.co/RkyBVXBP/LOGO-SONIMAX-PNG-2.png';
    document.getElementById('garantia-selected-code').textContent = product.codigo || 'S/C';
    document.getElementById('garantia-selected-dept').textContent = product.departamento ? `· ${product.departamento}` : '';
    document.getElementById('garantia-selected-name').textContent = product.nombre;
    document.getElementById('garantia-selected-stock').textContent = `Stock actual: ${product.stock ?? 0} uds`;

    card.classList.remove('hidden');
    document.getElementById('garantia-qty-input')?.focus();
  }

  function renderCurrentWarrantyItems() {
    const listEl = document.getElementById('garantia-items-list');
    const emptyEl = document.getElementById('garantia-items-empty');
    const badgeEl = document.getElementById('garantia-items-badge');

    const totalCount = currentWarrantyItems.length;
    const totalUnits = currentWarrantyItems.reduce((acc, it) => acc + (it.cantidad || 0), 0);
    const hlCount = currentWarrantyItems.filter(it => it.es_hl).length;
    const normalCount = totalCount - hlCount;

    if (badgeEl) {
      let badgeExtra = '';
      if (hlCount > 0 && normalCount > 0) {
        badgeExtra = ` · ${normalCount} Normales + ${hlCount} HL`;
      } else if (hlCount > 0) {
        badgeExtra = ` · Todo HL`;
      }
      badgeEl.textContent = `${totalCount} producto${totalCount === 1 ? '' : 's'} (${totalUnits} ud${totalUnits === 1 ? '' : 's'}${badgeExtra})`;
    }

    if (totalCount === 0) {
      emptyEl?.classList.remove('hidden');
      listEl.innerHTML = '';
      return;
    }

    emptyEl?.classList.add('hidden');

    const itemsHtml = currentWarrantyItems.map((item, index) => `
      <div class="flex items-center justify-between p-3 rounded-2xl bg-gray-50 dark:bg-gray-900 border ${item.es_hl ? 'border-purple-300 dark:border-purple-800/80 bg-purple-50/20' : 'border-gray-200 dark:border-gray-700/80'} animate-g-fade">
        <div class="flex items-center gap-3 min-w-0">
          <img src="${item.imagen_url || 'https://i.ibb.co/RkyBVXBP/LOGO-SONIMAX-PNG-2.png'}" class="w-12 h-12 object-contain rounded-xl bg-white p-1 border border-gray-200 flex-shrink-0" />
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="px-2 py-0.5 bg-emerald-600 text-white rounded font-mono font-bold text-xs">${item.codigo}</span>
              <span class="px-2 py-0.5 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded font-bold text-xs">${item.cantidad} ud${item.cantidad > 1 ? 's' : ''}</span>
              ${item.es_hl ? `
                <span class="px-2 py-0.5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-black rounded text-[10px] shadow-sm flex items-center gap-1">
                  <span>🏷️</span>
                  <span>PRODUCTO HL</span>
                </span>
              ` : `
                <span class="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 rounded font-bold text-[10px] border border-emerald-300 dark:border-emerald-800">
                  🛡️ Normal
                </span>
              `}
            </div>
            <p class="font-bold text-xs sm:text-sm text-gray-900 dark:text-white truncate mt-0.5">${item.nombre}</p>
            <p class="text-xs text-amber-700 dark:text-amber-400 font-medium truncate mt-0.5">
              <span class="font-bold">Falla:</span> ${item.falla}
            </p>
          </div>
        </div>

        <button type="button" class="remove-warranty-item-btn p-2 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-xl transition-all" data-index="${index}" title="Quitar de la solicitud">
          🗑️
        </button>
      </div>
    `).join('');

    let noticeHtml = '';
    if (hlCount > 0 && normalCount > 0) {
      noticeHtml = `
        <div class="p-2.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-800 text-[11px] text-amber-900 dark:text-amber-200 flex items-center gap-2">
          <span>⚡</span>
          <span><b>Aviso de separación:</b> Esta solicitud tiene productos Normales y de HL. Al enviarla, el sistema creará automáticamente <b>2 solicitudes separadas</b> para mantenerlas en sus respectivos apartados.</span>
        </div>
      `;
    } else if (hlCount > 0) {
      noticeHtml = `
        <div class="p-2.5 rounded-xl bg-purple-50 dark:bg-purple-950/30 border border-purple-300 dark:border-purple-800 text-[11px] text-purple-900 dark:text-purple-200 flex items-center gap-2">
          <span>🏷️</span>
          <span>Esta solicitud se registrará directamente en el <b>apartado exclusivo de Garantías HL</b>.</span>
        </div>
      `;
    }

    listEl.innerHTML = itemsHtml + noticeHtml;

    listEl.querySelectorAll('.remove-warranty-item-btn').forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.index);
        currentWarrantyItems.splice(idx, 1);
        renderCurrentWarrantyItems();
        saveFormDraft(); // Auto-guardar borrador al quitar producto
      };
    });
  }

  function resetForm() {
    currentWarrantyItems = [];
    selectedCatalogProduct = null;
    document.getElementById('garantia-selected-product-card')?.classList.add('hidden');
    const searchInput = document.getElementById('garantia-product-search-input');
    if (searchInput) searchInput.value = '';
    const descInput = document.getElementById('garantia-failure-desc-input');
    if (descInput) descInput.value = '';
    const obsInput = document.getElementById('garantia-input-observaciones');
    if (obsInput) obsInput.value = '';
    const clienteInput = document.getElementById('garantia-input-cliente');
    if (clienteInput) clienteInput.value = '';
    const telInput = document.getElementById('garantia-input-telefono');
    if (telInput) telInput.value = '';
    const hlCheckbox = document.getElementById('garantia-item-is-hl');
    if (hlCheckbox) hlCheckbox.checked = false;

    renderCurrentWarrantyItems();

    // Actualizar preview de ticket nuevo
    const previewTicket = document.getElementById('garantias-preview-ticket');
    if (previewTicket) previewTicket.textContent = generateTicketCode();

    // Limpiar borrador guardado
    clearFormDraft();
  }

  // ============================================================
  // BORRADOR AUTO-PERSISTIDO EN LOCALSTORAGE
  // Evita la pérdida de datos si el usuario recarga la página
  // antes de enviar la solicitud de garantía.
  // ============================================================
  function saveFormDraft() {
    try {
      const draft = {
        items: currentWarrantyItems,
        ticketCode: document.getElementById('garantias-preview-ticket')?.textContent || '',
        cliente: document.getElementById('garantia-input-cliente')?.value || '',
        telefono: document.getElementById('garantia-input-telefono')?.value || '',
        observaciones: document.getElementById('garantia-input-observaciones')?.value || '',
        fallaDesc: document.getElementById('garantia-failure-desc-input')?.value || '',
        savedAt: new Date().toISOString()
      };

      // Solo guardar si hay algún dato real
      const hasData = draft.items.length > 0 ||
        draft.cliente.trim() !== '' ||
        draft.telefono.trim() !== '' ||
        draft.observaciones.trim() !== '' ||
        draft.fallaDesc.trim() !== '';

      if (hasData) {
        localStorage.setItem(STORAGE_DRAFT_KEY, JSON.stringify(draft));
        console.log(`[GARANTIAS-DRAFT] 💾 Borrador guardado: ${draft.items.length} producto(s)`);
      } else {
        localStorage.removeItem(STORAGE_DRAFT_KEY);
      }
    } catch (e) {
      console.warn('[GARANTIAS-DRAFT] Error guardando borrador:', e);
    }
  }

  function clearFormDraft() {
    try {
      localStorage.removeItem(STORAGE_DRAFT_KEY);
      // Ocultar aviso de borrador restaurado si existe
      const notice = document.getElementById('garantia-draft-notice');
      if (notice) notice.remove();
      console.log('[GARANTIAS-DRAFT] 🗑️ Borrador eliminado');
    } catch (e) {
      console.warn('[GARANTIAS-DRAFT] Error limpiando borrador:', e);
    }
  }

  function restoreFormDraft() {
    try {
      const raw = localStorage.getItem(STORAGE_DRAFT_KEY);
      if (!raw) return false;

      const draft = JSON.parse(raw);
      if (!draft || typeof draft !== 'object') return false;

      // Restaurar items
      if (Array.isArray(draft.items) && draft.items.length > 0) {
        currentWarrantyItems = draft.items;
      }

      // Restaurar ticket code si existe
      if (draft.ticketCode && draft.ticketCode.startsWith('GAR-')) {
        const previewTicket = document.getElementById('garantias-preview-ticket');
        if (previewTicket) previewTicket.textContent = draft.ticketCode;
      }

      // Restaurar campos de texto
      const clienteInput = document.getElementById('garantia-input-cliente');
      if (clienteInput && draft.cliente) clienteInput.value = draft.cliente;

      const telInput = document.getElementById('garantia-input-telefono');
      if (telInput && draft.telefono) telInput.value = draft.telefono;

      const obsInput = document.getElementById('garantia-input-observaciones');
      if (obsInput && draft.observaciones) obsInput.value = draft.observaciones;

      const descInput = document.getElementById('garantia-failure-desc-input');
      if (descInput && draft.fallaDesc) descInput.value = draft.fallaDesc;

      // Renderizar items restaurados
      renderCurrentWarrantyItems();

      // Mostrar aviso de borrador restaurado
      const hasRealData = currentWarrantyItems.length > 0 ||
        (draft.cliente || '').trim() !== '' ||
        (draft.telefono || '').trim() !== '' ||
        (draft.observaciones || '').trim() !== '';

      if (hasRealData) {
        showDraftRestoredNotice(draft.savedAt);
        console.log(`[GARANTIAS-DRAFT] ✅ Borrador restaurado: ${currentWarrantyItems.length} producto(s)`);
      }

      return hasRealData;
    } catch (e) {
      console.warn('[GARANTIAS-DRAFT] Error restaurando borrador:', e);
      return false;
    }
  }

  function showDraftRestoredNotice(savedAt) {
    // Eliminar aviso anterior si existe
    const existing = document.getElementById('garantia-draft-notice');
    if (existing) existing.remove();

    const timeStr = savedAt ? formatDateTime(savedAt) : 'hace poco';
    const notice = document.createElement('div');
    notice.id = 'garantia-draft-notice';
    notice.className = 'bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/60 rounded-2xl p-3 flex items-center justify-between gap-3 animate-g-fade';
    notice.innerHTML = `
      <div class="flex items-center gap-2 min-w-0">
        <span class="text-lg flex-shrink-0">📝</span>
        <div class="min-w-0">
          <span class="font-bold text-xs text-amber-800 dark:text-amber-300">Borrador restaurado automáticamente</span>
          <p class="text-[11px] text-amber-700 dark:text-amber-400 truncate">Se recuperaron ${currentWarrantyItems.length} producto(s) · Guardado: ${timeStr}</p>
        </div>
      </div>
      <button type="button" id="garantia-discard-draft-btn" class="flex-shrink-0 px-3 py-1.5 bg-amber-200 hover:bg-amber-300 dark:bg-amber-800/60 dark:hover:bg-amber-700/80 text-amber-900 dark:text-amber-200 rounded-xl text-xs font-bold transition-all">
        🗑️ Descartar
      </button>
    `;

    // Insertar justo debajo del banner de ticket
    const formTab = document.getElementById('garantias-tab-form');
    if (formTab && formTab.firstChild) {
      formTab.insertBefore(notice, formTab.children[1] || null);
    }

    // Botón descartar borrador
    document.getElementById('garantia-discard-draft-btn')?.addEventListener('click', () => {
      if (confirm('¿Deseas descartar el borrador guardado y empezar de cero?')) {
        resetForm();
        notice.remove();
      }
    });
  }

  // ============================================================
  // ENVÍO DE LA SOLICITUD DE GARANTÍA
  // ============================================================
  async function submitWarrantyOrder() {
    if (currentWarrantyItems.length === 0) {
      alert('⚠️ No has agregado ningún producto a la solicitud de garantía. Por favor agrega al menos uno.');
      return;
    }

    const submitBtn = document.getElementById('garantia-submit-order-btn');
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>⏳</span><span>Guardando solicitud en la nube...</span>';

    try {
      const currentUser = getCurrentUser();
      const role = getActiveRole();
      const now = new Date();
      const mesAno = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      const cliente = document.getElementById('garantia-input-cliente')?.value?.trim() || '';
      const telefono = document.getElementById('garantia-input-telefono')?.value?.trim() || '';
      const observaciones = document.getElementById('garantia-input-observaciones')?.value?.trim() || '';

      // Limpiar user_id para evitar problemas de tipos si no es UUID
      let cleanUserId = null;
      if (currentUser && currentUser.auth_id && typeof currentUser.auth_id === 'string' && currentUser.auth_id.trim() !== '') {
        cleanUserId = currentUser.auth_id.trim();
      } else if (currentUser && currentUser.id && typeof currentUser.id === 'string' && currentUser.id.trim() !== '') {
        cleanUserId = currentUser.id.trim();
      }

      const normalItems = currentWarrantyItems.filter(it => !it.es_hl);
      const hlItems = currentWarrantyItems.filter(it => it.es_hl);
      const createdGarantias = [];

      // CASO 1: Solo productos normales
      if (normalItems.length > 0 && hlItems.length === 0) {
        const ticketCode = generateTicketCode(false);
        const totalItems = normalItems.reduce((acc, it) => acc + (it.cantidad || 0), 0);
        const payload = {
          codigo_ticket: ticketCode,
          user_id: cleanUserId,
          user_name: (currentUser && currentUser.name) ? currentUser.name : 'Gestor',
          user_role: (role || 'gestor').toLowerCase().trim(),
          cliente_nombre: cliente,
          cliente_telefono: telefono,
          items: normalItems,
          total_items: totalItems,
          estado: 'pendiente',
          observaciones: observaciones,
          notas_admin: '',
          mes_ano: mesAno,
          tipo_garantia: 'normal',
          es_hl: false,
          created_at: now.toISOString(),
          updated_at: now.toISOString()
        };
        await saveGarantiaToDatabase(payload);
        createdGarantias.push(payload);
      }
      // CASO 2: Solo productos HL
      else if (hlItems.length > 0 && normalItems.length === 0) {
        const ticketCode = generateTicketCode(true);
        const totalItems = hlItems.reduce((acc, it) => acc + (it.cantidad || 0), 0);
        const payload = {
          codigo_ticket: ticketCode,
          user_id: cleanUserId,
          user_name: (currentUser && currentUser.name) ? currentUser.name : 'Gestor',
          user_role: (role || 'gestor').toLowerCase().trim(),
          cliente_nombre: cliente,
          cliente_telefono: telefono,
          items: hlItems,
          total_items: totalItems,
          estado: 'pendiente',
          observaciones: observaciones,
          notas_admin: '',
          mes_ano: mesAno,
          tipo_garantia: 'hl',
          es_hl: true,
          created_at: now.toISOString(),
          updated_at: now.toISOString()
        };
        await saveGarantiaToDatabase(payload);
        createdGarantias.push(payload);
      }
      // CASO 3: Mixto (Separación automática en 2 tickets para cumplir con apartados independientes)
      else if (normalItems.length > 0 && hlItems.length > 0) {
        // Solicitud Normal
        const ticketNormal = generateTicketCode(false);
        const totalNormal = normalItems.reduce((acc, it) => acc + (it.cantidad || 0), 0);
        const payloadNormal = {
          codigo_ticket: ticketNormal,
          user_id: cleanUserId,
          user_name: (currentUser && currentUser.name) ? currentUser.name : 'Gestor',
          user_role: (role || 'gestor').toLowerCase().trim(),
          cliente_nombre: cliente,
          cliente_telefono: telefono,
          items: normalItems,
          total_items: totalNormal,
          estado: 'pendiente',
          observaciones: observaciones ? `${observaciones} (Parte Normal)` : '',
          notas_admin: '',
          mes_ano: mesAno,
          tipo_garantia: 'normal',
          es_hl: false,
          created_at: now.toISOString(),
          updated_at: now.toISOString()
        };
        await saveGarantiaToDatabase(payloadNormal);
        createdGarantias.push(payloadNormal);

        // Solicitud HL (con 1 segundo de diferencia para orden estricto)
        const ticketHL = generateTicketCode(true);
        const totalHL = hlItems.reduce((acc, it) => acc + (it.cantidad || 0), 0);
        const payloadHL = {
          codigo_ticket: ticketHL,
          user_id: cleanUserId,
          user_name: (currentUser && currentUser.name) ? currentUser.name : 'Gestor',
          user_role: (role || 'gestor').toLowerCase().trim(),
          cliente_nombre: cliente,
          cliente_telefono: telefono,
          items: hlItems,
          total_items: totalHL,
          estado: 'pendiente',
          observaciones: observaciones ? `${observaciones} (Parte HL)` : '',
          notas_admin: '',
          mes_ano: mesAno,
          tipo_garantia: 'hl',
          es_hl: true,
          created_at: new Date(now.getTime() + 1000).toISOString(),
          updated_at: new Date(now.getTime() + 1000).toISOString()
        };
        await saveGarantiaToDatabase(payloadHL);
        createdGarantias.push(payloadHL);
      }

      // Mostrar pantalla de éxito con los tickets creados
      showSuccessModal(createdGarantias);

      // Limpiar formulario y regenerar ticket
      resetForm();
      fetchGarantiasFromDatabase().then(() => renderHistoryList());

    } catch (e) {
      console.error('[GARANTIAS] Error enviando garantía:', e);
      alert('Ocurrió un error al guardar la garantía: ' + e.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>🚀</span><span>Enviar Solicitud de Garantía a Admin</span>';
    }
  }

  // ============================================================
  // MODAL DE ÉXITO Y ACCIONES (WhatsApp, Imprimir Comprobante)
  // ============================================================
  function showSuccessModal(garantiaOrList) {
    const list = Array.isArray(garantiaOrList) ? garantiaOrList : [garantiaOrList];
    const isMultiple = list.length > 1;

    const successDiv = document.createElement('div');
    successDiv.id = 'garantia-success-modal';
    successDiv.className = 'fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-g-fade';

    const ticketsHtml = list.map((g, idx) => {
      const isHL = isHLGarantia(g);
      const itemsListHtml = (g.items || []).map(it => `
        <li class="flex items-center justify-between py-1 border-b border-gray-100 dark:border-gray-800 text-xs">
          <span class="font-bold text-gray-800 dark:text-gray-200">${it.cantidad}x ${it.codigo} - ${it.nombre}</span>
          <span class="text-amber-600 dark:text-amber-400 italic">(${it.falla})</span>
        </li>
      `).join('');

      return `
        <div class="bg-gray-50 dark:bg-gray-800/80 p-3.5 rounded-2xl text-left border ${isHL ? 'border-purple-300 dark:border-purple-800' : 'border-emerald-300 dark:border-emerald-800'} space-y-2">
          <div class="flex items-center justify-between">
            <span class="text-sm font-black font-mono ${isHL ? 'text-purple-600 dark:text-purple-400' : 'text-emerald-700 dark:text-emerald-400'}">${g.codigo_ticket}</span>
            <span class="px-2 py-0.5 rounded-md text-[10px] font-black uppercase ${isHL ? 'bg-purple-600 text-white' : 'bg-emerald-600 text-white'}">
              ${isHL ? '🏷️ Apartado Garantías HL' : '🛡️ Apartado Garantías Normales'}
            </span>
          </div>
          <div class="flex justify-between text-[11px] text-gray-500 dark:text-gray-400">
            <span>Fecha: <b>${formatDateTime(g.created_at)}</b></span>
            <span>Registrado por: <b>${g.user_name}</b></span>
          </div>
          ${g.cliente_nombre ? `<div class="text-[11px] text-gray-700 dark:text-gray-300">Cliente/Tienda: <b>${g.cliente_nombre}</b></div>` : ''}
          <ul class="space-y-1 mt-1">
            ${itemsListHtml}
          </ul>
          <div class="flex gap-2 pt-1 border-t border-gray-200 dark:border-gray-700">
            <button type="button" class="success-ticket-wa-btn flex-1 py-1.5 px-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1" data-ticket="${g.codigo_ticket}">
              <span>📲</span> WhatsApp
            </button>
            <button type="button" class="success-ticket-print-btn flex-1 py-1.5 px-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-1" data-ticket="${g.codigo_ticket}">
              <span>🖨️</span> Imprimir
            </button>
          </div>
        </div>
      `;
    }).join('');

    successDiv.innerHTML = `
      <div class="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl max-w-lg w-full p-6 sm:p-7 border border-emerald-500/30 text-center space-y-4 max-h-[92vh] overflow-y-auto garantia-scroll">
        
        <div class="w-16 h-16 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-300 flex items-center justify-center text-3xl shadow-lg shadow-emerald-500/20">
          ✅
        </div>

        <div>
          <span class="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
            ${isMultiple ? '¡Garantías Registradas y Separadas con Éxito!' : '¡Garantía Registrada con Éxito!'}
          </span>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
            ${isMultiple 
              ? 'Se generaron 2 solicitudes independientes (1 Normal y 1 HL) para conservarlas en sus apartados correspondientes.' 
              : 'Se ha guardado en la base de datos y acumulado para revisión del Administrador.'}
          </p>
        </div>

        <!-- Tarjetas de Tickets Creados -->
        <div class="space-y-3">
          ${ticketsHtml}
        </div>

        <!-- Botones de Cierre / Continuar -->
        <div class="flex gap-2 pt-2">
          <button id="success-view-list-btn" class="flex-1 py-2.5 px-3 bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 rounded-xl text-xs font-bold hover:bg-teal-100 transition-all">
            📋 Ver Apartado en Lista
          </button>
          <button id="success-new-btn" class="flex-1 py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all">
            ➕ Crear Otra
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(successDiv);

    // Eventos WhatsApp / Imprimir por cada ticket
    successDiv.querySelectorAll('.success-ticket-wa-btn').forEach(btn => {
      btn.onclick = () => {
        const ticket = btn.dataset.ticket;
        const g = list.find(it => it.codigo_ticket === ticket);
        if (g) shareGarantiaWhatsApp(g);
      };
    });

    successDiv.querySelectorAll('.success-ticket-print-btn').forEach(btn => {
      btn.onclick = () => {
        const ticket = btn.dataset.ticket;
        const g = list.find(it => it.codigo_ticket === ticket);
        if (g) printGarantiaReceipt(g);
      };
    });

    document.getElementById('success-view-list-btn').onclick = () => {
      successDiv.remove();
      // Si el primer ticket era HL, abrir en apartado HL; sino en Normal
      if (list.length > 0 && isHLGarantia(list[0])) {
        document.getElementById('garantias-tab-hl-btn')?.click();
      } else {
        document.getElementById('garantias-tab-history-btn')?.click();
      }
    };

    document.getElementById('success-new-btn').onclick = () => {
      successDiv.remove();
      document.getElementById('garantias-tab-form-btn')?.click();
    };
  }

  // ============================================================
  // WHATSAPP SHARE FORMATTER
  // ============================================================
  function shareGarantiaWhatsApp(g) {
    let msg = `🛡️ *SOLICITUD DE GARANTÍA SONIMAX* 🛡️\n\n`;
    msg += `*Ticket:* ${g.codigo_ticket}\n`;
    msg += `*Fecha:* ${formatDateTime(g.created_at)}\n`;
    msg += `*Registrado por:* ${g.user_name} (${(g.user_role || '').toUpperCase()})\n`;
    if (g.cliente_nombre) msg += `*Cliente/Tienda:* ${g.cliente_nombre}\n`;
    if (g.cliente_telefono) msg += `*Teléfono:* ${g.cliente_telefono}\n`;
    msg += `*Estado:* ${STATUS_CONFIG[g.estado]?.label || g.estado}\n\n`;

    msg += `*PRODUCTOS EN GARANTÍA:*\n`;
    (g.items || []).forEach((item, index) => {
      msg += `${index + 1}. *[${item.codigo}]* ${item.nombre}\n`;
      msg += `   • *Cantidad:* ${item.cantidad} unidad(es)\n`;
      msg += `   • *Falla:* ${item.falla}\n\n`;
    });

    if (g.observaciones) {
      msg += `📝 *Observaciones:* ${g.observaciones}\n`;
    }

    if (g.notas_admin) {
      msg += `\n📌 *Nota Admin:* ${g.notas_admin}\n`;
    }

    const url = `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank');
  }

  // ============================================================
  // COMPROBANTE IMPRIMIBLE DE GARANTÍA
  // ============================================================
  function printGarantiaReceipt(g) {
    let printableContainer = document.getElementById('garantia-receipt-printable');
    if (!printableContainer) {
      printableContainer = document.createElement('div');
      printableContainer.id = 'garantia-receipt-printable';
      document.body.appendChild(printableContainer);
    }

    printableContainer.innerHTML = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #111;">
        <div style="text-align: center; border-bottom: 2px solid #059669; padding-bottom: 10px; margin-bottom: 15px;">
          <h2 style="margin: 0; color: #059669;">SONIMAX MÓVIL</h2>
          <p style="margin: 2px 0; font-size: 14px; font-weight: bold;">COMPROBANTE DE RECEPCIÓN DE GARANTÍA</p>
          <p style="margin: 2px 0; font-size: 12px; color: #666;">Ticket: <b>${g.codigo_ticket}</b></p>
        </div>

        <table style="width: 100%; font-size: 12px; margin-bottom: 15px; border-collapse: collapse;">
          <tr>
            <td style="padding: 4px 0;"><b>Fecha y Hora:</b> ${formatDateTime(g.created_at)}</td>
            <td style="padding: 4px 0;"><b>Registrado por:</b> ${g.user_name} (${g.user_role})</td>
          </tr>
          ${g.cliente_nombre ? `<tr><td style="padding: 4px 0;"><b>Cliente / Tienda:</b> ${g.cliente_nombre}</td><td style="padding: 4px 0;"><b>Contacto:</b> ${g.cliente_telefono || 'N/A'}</td></tr>` : ''}
          <tr>
            <td style="padding: 4px 0;"><b>Estado inicial:</b> ${STATUS_CONFIG[g.estado]?.label || g.estado}</td>
            <td style="padding: 4px 0;"><b>Total Artículos:</b> ${g.total_items} unidades</td>
          </tr>
        </table>

        <h4 style="margin: 10px 0 5px 0; font-size: 13px; border-bottom: 1px solid #ccc; padding-bottom: 3px;">DETALLE DE PRODUCTOS</h4>
        <table style="width: 100%; font-size: 11px; border-collapse: collapse; margin-bottom: 15px;">
          <thead>
            <tr style="background: #f1f5f9; text-align: left;">
              <th style="padding: 6px; border: 1px solid #ddd;">Cant</th>
              <th style="padding: 6px; border: 1px solid #ddd;">Código</th>
              <th style="padding: 6px; border: 1px solid #ddd;">Producto</th>
              <th style="padding: 6px; border: 1px solid #ddd;">Falla Presentada</th>
            </tr>
          </thead>
          <tbody>
            ${(g.items || []).map(it => `
              <tr>
                <td style="padding: 6px; border: 1px solid #ddd; text-align: center; font-weight: bold;">${it.cantidad}</td>
                <td style="padding: 6px; border: 1px solid #ddd; font-family: monospace;">${it.codigo}</td>
                <td style="padding: 6px; border: 1px solid #ddd;">${it.nombre}</td>
                <td style="padding: 6px; border: 1px solid #ddd; color: #b45309;">${it.falla}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>

        ${g.observaciones ? `<p style="font-size: 11px; margin-bottom: 20px;"><b>Observaciones:</b> ${g.observaciones}</p>` : ''}

        <div style="margin-top: 40px; display: flex; justify-content: space-between; font-size: 11px; text-align: center;">
          <div style="width: 45%; border-top: 1px solid #444; padding-top: 5px;">
            Firma del Gestor / Receptor
          </div>
          <div style="width: 45%; border-top: 1px solid #444; padding-top: 5px;">
            Firma del Cliente / Entregado
          </div>
        </div>
      </div>
    `;

    window.print();
  }

  // ============================================================
  // PESTAÑA HISTORIAL Y ACUMULADOS
  // ============================================================
  function populateUserFilterDropdown() {
    const filterUserEl = document.getElementById('garantias-filter-user');
    if (!filterUserEl) return;

    const users = [...new Set(allGarantias.map(g => g.user_name).filter(Boolean))];
    const currentVal = filterUserEl.value;

    let html = '<option value="all">Todos los Gestores / Admin</option>';
    users.forEach(u => {
      html += `<option value="${u}">${u}</option>`;
    });
    filterUserEl.innerHTML = html;
    filterUserEl.value = currentVal;
  }

  function updateSelectionBar() {
    const bar = document.getElementById('garantias-selection-bar');
    const countEl = document.getElementById('selection-bar-count');
    if (!bar || !countEl) return;

    const isAdmin = (getActiveRole() || '').toLowerCase() === 'admin';
    if (!isAdmin || selectedTickets.size === 0) {
      bar.classList.add('hidden');
    } else {
      countEl.textContent = `${selectedTickets.size} garantía${selectedTickets.size === 1 ? '' : 's'} seleccionada${selectedTickets.size === 1 ? '' : 's'}`;
      bar.classList.remove('hidden');
    }
  }

  function renderHistoryList() {
    const listEl = document.getElementById('garantias-history-list');
    const emptyEl = document.getElementById('garantias-history-empty');
    if (!listEl) return;

    populateUserFilterDropdown();

    const isAdmin = (getActiveRole() || '').toLowerCase() === 'admin';
    const isHLSection = currentWarrantySection === 'hl';

    // 1. Actualizar encabezado del apartado activo (Normal vs HL)
    const headerEl = document.getElementById('garantias-section-header');
    const totalSectionCount = allGarantias.filter(g => isHLSection ? isHLGarantia(g) : isNormalGarantia(g)).length;

    if (headerEl) {
      if (isHLSection) {
        headerEl.innerHTML = `
          <div class="p-3.5 bg-gradient-to-r from-purple-50 via-indigo-50 to-purple-50 dark:from-purple-950/40 dark:via-indigo-950/30 dark:to-purple-950/40 rounded-2xl border-2 border-purple-300 dark:border-purple-800/80 flex flex-wrap items-center justify-between gap-3 shadow-sm animate-g-fade">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 text-white flex items-center justify-center text-xl font-bold shadow-md shadow-purple-500/20">
                🏷️
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <h3 class="text-sm sm:text-base font-black text-purple-950 dark:text-purple-100">
                    Apartado Exclusivo: Garantías HL
                  </h3>
                  <span class="px-2 py-0.5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-md text-[10px] font-black uppercase tracking-wider">HL</span>
                </div>
                <p class="text-xs text-purple-700 dark:text-purple-300 mt-0.5">
                  Reclamos y devoluciones de productos pertenecientes a HL (Gestor y Admin)
                </p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span class="px-3 py-1 bg-purple-100 dark:bg-purple-900/60 text-purple-800 dark:text-purple-200 rounded-full font-black text-xs">
                ${totalSectionCount} solicitudes HL
              </span>
            </div>
          </div>
        `;
      } else {
        headerEl.innerHTML = `
          <div class="p-3.5 bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50 dark:from-emerald-950/40 dark:via-teal-950/30 dark:to-emerald-950/40 rounded-2xl border-2 border-emerald-300 dark:border-emerald-800/80 flex flex-wrap items-center justify-between gap-3 shadow-sm animate-g-fade">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-600 text-white flex items-center justify-center text-xl font-bold shadow-md shadow-emerald-500/20">
                🛡️
              </div>
              <div>
                <h3 class="text-sm sm:text-base font-black text-emerald-950 dark:text-emerald-100">
                  Apartado de Garantías Normales
                </h3>
                <p class="text-xs text-emerald-700 dark:text-emerald-300 mt-0.5">
                  Productos defectuosos y reclamos estándar del catálogo Sonimax
                </p>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <span class="px-3 py-1 bg-emerald-100 dark:bg-emerald-900/60 text-emerald-800 dark:text-emerald-200 rounded-full font-black text-xs">
                ${totalSectionCount} solicitudes Normales
              </span>
            </div>
          </div>
        `;
      }
    }

    // 2. Actualizar contadores de las pestañas superiores
    const normalCount = allGarantias.filter(g => isNormalGarantia(g)).length;
    const hlCount = allGarantias.filter(g => isHLGarantia(g)).length;

    const normalBadge = document.getElementById('garantias-history-count');
    if (normalBadge) normalBadge.textContent = normalCount;

    const hlBadge = document.getElementById('garantias-hl-count');
    if (hlBadge) hlBadge.textContent = hlCount;

    // 3. Mostrar/ocultar botones de administración según el rol
    const adminPeriodActions = document.getElementById('garantias-admin-period-actions');
    if (adminPeriodActions) {
      if (isAdmin) {
        adminPeriodActions.classList.remove('hidden');
      } else {
        adminPeriodActions.classList.add('hidden');
      }
    }

    // 4. Filtrar lista por apartado (Normal vs HL)
    let filtered = allGarantias.filter(g => isHLSection ? isHLGarantia(g) : isNormalGarantia(g));

    // 5. Filtro rápido de Período (Hoy, Semana, Mes, Día específico)
    if (filterPeriod === 'today') {
      filtered = filtered.filter(g => isDateToday(g.created_at));
    } else if (filterPeriod === 'week') {
      filtered = filtered.filter(g => isDateInCurrentWeek(g.created_at));
    } else if (filterPeriod === 'month') {
      const nowM = String(new Date().getMonth() + 1).padStart(2, '0');
      const nowY = String(new Date().getFullYear());
      filtered = filtered.filter(g => isDateInMonth(g.created_at, nowM, nowY));
    } else if (filterPeriod === 'custom_date' && filterCustomDate) {
      filtered = filtered.filter(g => getLocalDateStr(g.created_at) === filterCustomDate);
    }

    // 6. Filtro por Mes
    if (filterMonth !== 'all') {
      filtered = filtered.filter(g => {
        const itemMonth = (g.mes_ano || '').split('-')[1] || (g.created_at ? String(new Date(g.created_at).getMonth() + 1).padStart(2, '0') : '');
        return itemMonth === filterMonth;
      });
    }

    // 7. Filtro por Año
    if (filterYear !== 'all') {
      filtered = filtered.filter(g => {
        const itemYear = (g.mes_ano || '').split('-')[0] || (g.created_at ? String(new Date(g.created_at).getFullYear()) : '');
        return itemYear === filterYear;
      });
    }

    // 8. Filtro por Estado
    if (filterStatus !== 'all') {
      filtered = filtered.filter(g => g.estado === filterStatus);
    }

    // 9. Filtro por Usuario
    if (filterUser !== 'all') {
      filtered = filtered.filter(g => g.user_name === filterUser);
    }

    // 10. Búsqueda de texto
    if (searchQuery) {
      filtered = filtered.filter(g => {
        const ticket = (g.codigo_ticket || '').toLowerCase();
        const userName = (g.user_name || '').toLowerCase();
        const cliente = (g.cliente_nombre || '').toLowerCase();
        const obs = (g.observaciones || '').toLowerCase();
        const itemsText = (g.items || []).map(i => `${i.codigo} ${i.nombre} ${i.falla}`).join(' ').toLowerCase();

        return ticket.includes(searchQuery) ||
          userName.includes(searchQuery) ||
          cliente.includes(searchQuery) ||
          obs.includes(searchQuery) ||
          itemsText.includes(searchQuery);
      });
    }

    // 11. Actualizar Estadísticas (KPIs)
    updateStatsCounters(filtered);

    // 12. Actualizar barra flotante
    updateSelectionBar();

    if (filtered.length === 0) {
      emptyEl?.classList.remove('hidden');
      listEl.innerHTML = '';
      return;
    }

    emptyEl?.classList.add('hidden');

    listEl.innerHTML = filtered.map(g => {
      const statusInfo = STATUS_CONFIG[g.estado] || { label: g.estado, icon: '🏷️', badgeClass: 'bg-gray-100 text-gray-800' };
      const isHLTicket = isHLGarantia(g);

      const itemsHtml = (g.items || []).map(it => `
        <div class="flex items-center gap-2 text-xs py-1 border-b border-gray-100 dark:border-gray-800/80 last:border-0">
          <span class="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 font-bold rounded font-mono text-[10px]">${it.cantidad}x ${it.codigo}</span>
          ${it.es_hl ? `<span class="px-1.5 py-0.2 bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 text-[9px] font-black rounded border border-purple-300">HL</span>` : ''}
          <span class="font-bold text-gray-800 dark:text-gray-200 truncate flex-1">${it.nombre}</span>
          <span class="text-amber-700 dark:text-amber-400 font-medium text-[11px] truncate max-w-[200px]" title="${it.falla}">⚠️ ${it.falla}</span>
        </div>
      `).join('');

      return `
        <div class="bg-white dark:bg-gray-800/90 rounded-2xl p-4 sm:p-5 border ${isHLTicket ? 'border-purple-200 dark:border-purple-900/60' : 'border-gray-200 dark:border-gray-700'} shadow-sm hover:shadow-md transition-all space-y-3">
          
          <!-- Encabezado de la Tarjeta -->
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 dark:border-gray-700/80 pb-3">
            <div class="flex items-center gap-2.5">
              ${isAdmin ? `
                <input type="checkbox" class="ticket-select-chk w-4 h-4 text-emerald-600 rounded cursor-pointer accent-emerald-600" data-ticket="${g.codigo_ticket}" ${selectedTickets.has(g.codigo_ticket) ? 'checked' : ''} />
              ` : ''}
              <span class="font-black font-mono text-base sm:text-lg ${isHLTicket ? 'text-purple-700 dark:text-purple-400' : 'text-emerald-700 dark:text-emerald-400'}">${g.codigo_ticket}</span>
              ${isHLTicket ? `
                <span class="px-2 py-0.5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded text-[10px] font-black uppercase shadow-sm">🏷️ HL</span>
              ` : `
                <span class="px-2 py-0.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 rounded text-[10px] font-bold">🛡️ Normal</span>
              `}
              <span class="px-2.5 py-1 rounded-full text-xs font-bold border ${statusInfo.badgeClass} flex items-center gap-1">
                <span>${statusInfo.icon}</span>
                <span>${statusInfo.label}</span>
              </span>
            </div>
            
            <div class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
              <span>🕒 ${formatDateTime(g.created_at)}</span>
            </div>
          </div>

          <!-- Información del Usuario y Cliente -->
          <div class="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div class="flex items-center gap-3">
              <span class="flex items-center gap-1.5 font-bold text-gray-800 dark:text-gray-200">
                <span>👤</span>
                <span>${g.user_name}</span>
                <span class="px-1.5 py-0.2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded text-[10px] uppercase font-semibold">${g.user_role}</span>
              </span>
              ${g.cliente_nombre ? `
                <span class="text-gray-400">|</span>
                <span class="text-gray-700 dark:text-gray-300">
                  <span class="text-gray-400">Cliente/Tienda:</span> <b>${g.cliente_nombre}</b>
                </span>
              ` : ''}
              ${g.cliente_telefono ? `
                <span class="text-gray-500">(${g.cliente_telefono})</span>
              ` : ''}
            </div>

            <span class="text-gray-400 text-xs font-semibold">
              ${(g.items || []).length} producto${(g.items || []).length === 1 ? '' : 's'} (${g.total_items || 1} uds)
            </span>
          </div>

          <!-- Lista de Productos en la Solicitud -->
          <div class="bg-gray-50 dark:bg-gray-900/60 p-3 rounded-xl border border-gray-200 dark:border-gray-700/60 space-y-1">
            ${itemsHtml}
          </div>

          <!-- Observaciones / Nota de Admin -->
          ${g.observaciones ? `
            <div class="text-xs text-gray-600 dark:text-gray-300 bg-amber-50/50 dark:bg-amber-950/20 p-2.5 rounded-xl border border-amber-200/50 dark:border-amber-900/30">
              <span class="font-bold text-amber-800 dark:text-amber-400">Observaciones del Gestor:</span> ${g.observaciones}
            </div>
          ` : ''}

          ${g.notas_admin ? `
            <div class="text-xs text-blue-900 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 p-2.5 rounded-xl border border-blue-200 dark:border-blue-800/50">
              <span class="font-bold text-blue-800 dark:text-blue-400">Resolución de Admin:</span> ${g.notas_admin}
            </div>
          ` : ''}

          <!-- Botones de Acción -->
          <div class="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-100 dark:border-gray-700/60">
            <div class="flex items-center gap-1.5">
              <button type="button" class="action-whatsapp-btn px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 rounded-xl text-xs font-bold transition-all flex items-center gap-1" data-ticket="${g.codigo_ticket}">
                <span>📲</span>
                <span>WhatsApp</span>
              </button>
              <button type="button" class="action-print-btn px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-xl text-xs font-bold transition-all flex items-center gap-1" data-ticket="${g.codigo_ticket}">
                <span>🖨️</span>
                <span>Comprobante</span>
              </button>
            </div>

            <div class="flex items-center gap-2">
              ${isAdmin ? `
                <button type="button" class="action-manage-status-btn px-3.5 py-1.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl text-xs font-bold shadow-md transition-all flex items-center gap-1" data-ticket="${g.codigo_ticket}">
                  <span>✏️</span>
                  <span>Gestionar Estado</span>
                </button>
                <button type="button" class="action-delete-btn p-1.5 text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-all" data-ticket="${g.codigo_ticket}" title="Eliminar registro">
                  🗑️
                </button>
              ` : `
                <button type="button" class="action-view-details-btn px-3 py-1.5 bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 rounded-xl text-xs font-bold hover:bg-teal-100 transition-all" data-ticket="${g.codigo_ticket}">
                  👁️ Ver Detalle
                </button>
              `}
            </div>
          </div>
        </div>
      `;
    }).join('');

    // Eventos de checkboxes de selección de tarjeta
    listEl.querySelectorAll('.ticket-select-chk').forEach(chk => {
      chk.onchange = (e) => {
        e.stopPropagation();
        const ticket = chk.dataset.ticket;
        if (chk.checked) {
          selectedTickets.add(ticket);
        } else {
          selectedTickets.delete(ticket);
        }
        updateSelectionBar();
      };
    });

    // Eventos de los botones en las tarjetas
    listEl.querySelectorAll('.action-whatsapp-btn').forEach(btn => {
      btn.onclick = () => {
        const ticket = btn.dataset.ticket;
        const g = allGarantias.find(item => item.codigo_ticket === ticket);
        if (g) shareGarantiaWhatsApp(g);
      };
    });

    listEl.querySelectorAll('.action-print-btn').forEach(btn => {
      btn.onclick = () => {
        const ticket = btn.dataset.ticket;
        const g = allGarantias.find(item => item.codigo_ticket === ticket);
        if (g) printGarantiaReceipt(g);
      };
    });

    listEl.querySelectorAll('.action-manage-status-btn').forEach(btn => {
      btn.onclick = () => {
        const ticket = btn.dataset.ticket;
        const g = allGarantias.find(item => item.codigo_ticket === ticket);
        if (g) openAdminStatusModal(g);
      };
    });

    listEl.querySelectorAll('.action-delete-btn').forEach(btn => {
      btn.onclick = async () => {
        const ticket = btn.dataset.ticket;
        if (confirm(`¿Estás seguro de que deseas eliminar permanentemente la garantía "${ticket}"? Esta acción no se puede deshacer.`)) {
          await deleteGarantiaFromDB(ticket);
          renderHistoryList();
        }
      };
    });

    listEl.querySelectorAll('.action-view-details-btn').forEach(btn => {
      btn.onclick = () => {
        const ticket = btn.dataset.ticket;
        const g = allGarantias.find(item => item.codigo_ticket === ticket);
        if (g) showSuccessModal(g);
      };
    });
  }

  function updateStatsCounters(list) {
    const total = list.length;
    const pendientes = list.filter(g => g.estado === 'pendiente').length;
    const revision = list.filter(g => g.estado === 'en_revision').length;
    const aprobadas = list.filter(g => g.estado === 'aprobada' || g.estado === 'completada').length;
    const rechazadas = list.filter(g => g.estado === 'rechazada').length;

    const elTotal = document.getElementById('stat-total');
    const elPend = document.getElementById('stat-pendientes');
    const elRev = document.getElementById('stat-revision');
    const elApr = document.getElementById('stat-aprobadas');
    const elRech = document.getElementById('stat-rechazadas');

    if (elTotal) elTotal.textContent = total;
    if (elPend) elPend.textContent = pendientes;
    if (elRev) elRev.textContent = revision;
    if (elApr) elApr.textContent = aprobadas;
    if (elRech) elRech.textContent = rechazadas;
  }

  // ============================================================
  // MODAL ADMIN: GESTIONAR ESTADO Y RESOLUCIÓN DE LA GARANTÍA
  // ============================================================
  function openAdminStatusModal(g) {
    let modal = document.getElementById('garantias-status-modal');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'garantias-status-modal';
    modal.className = 'fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-g-fade';

    modal.innerHTML = `
      <div class="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl max-w-md w-full p-6 border border-gray-200 dark:border-gray-800 space-y-4">
        
        <div class="flex items-center justify-between border-b border-gray-100 dark:border-gray-800 pb-3">
          <div>
            <h3 class="font-black text-lg text-gray-900 dark:text-white flex items-center gap-2">
              <span>✏️</span>
              <span>Gestionar Garantía</span>
            </h3>
            <span class="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400">${g.codigo_ticket}</span>
          </div>
          <button id="close-status-modal-btn" class="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-white rounded-lg">✕</button>
        </div>

        <div class="space-y-3">
          <div>
            <label class="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">Nuevo Estado</label>
            <select id="modal-status-select" class="w-full px-3 py-2.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm font-bold text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500">
              <option value="pendiente" ${g.estado === 'pendiente' ? 'selected' : ''}>⏳ Pendiente</option>
              <option value="en_revision" ${g.estado === 'en_revision' ? 'selected' : ''}>🔍 En Revisión Técnica</option>
              <option value="aprobada" ${g.estado === 'aprobada' ? 'selected' : ''}>✅ Aprobada (Cambio o Reparación)</option>
              <option value="rechazada" ${g.estado === 'rechazada' ? 'selected' : ''}>❌ Rechazada (No Aplica Garantía)</option>
              <option value="completada" ${g.estado === 'completada' ? 'selected' : ''}>📦 Completada / Entregada al Cliente</option>
            </select>
          </div>

          <div>
            <label class="block text-xs font-bold text-gray-700 dark:text-gray-300 mb-1">
              Nota o Resolución de Administración
            </label>
            <textarea id="modal-status-note" rows="3" 
              class="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs sm:text-sm text-gray-900 dark:text-white focus:outline-none focus:border-emerald-500" 
              placeholder="Ej. Se autoriza cambio por equipo nuevo. Entregado en tienda...">${g.notas_admin || ''}</textarea>
          </div>
        </div>

        <div class="flex gap-2 pt-2">
          <button type="button" id="modal-status-cancel-btn" class="flex-1 py-2.5 px-3 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl text-xs font-bold transition-all">
            Cancelar
          </button>
          <button type="button" id="modal-status-save-btn" class="flex-1 py-2.5 px-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white rounded-xl text-xs font-bold shadow-md transition-all">
            💾 Guardar Estado
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('close-status-modal-btn').onclick = () => modal.remove();
    document.getElementById('modal-status-cancel-btn').onclick = () => modal.remove();

    document.getElementById('modal-status-save-btn').onclick = async () => {
      const newStatus = document.getElementById('modal-status-select').value;
      const newNote = document.getElementById('modal-status-note').value.trim();

      const saveBtn = document.getElementById('modal-status-save-btn');
      saveBtn.disabled = true;
      saveBtn.textContent = 'Guardando...';

      await updateGarantiaStatusInDB(g.codigo_ticket, newStatus, newNote);
      modal.remove();
      renderHistoryList();
    };
  }

  // ============================================================
  // EXPORTACIÓN A EXCEL POR APARTADO / PERÍODO (SheetJS / XLSX)
  // ============================================================
  function exportFilteredGarantiasToExcel() {
    if (!window.XLSX) {
      alert('⚠️ La librería de Excel (XLSX) no está cargada. Por favor recarga la página.');
      return;
    }

    const isHLSection = currentWarrantySection === 'hl';
    const sectionName = isHLSection ? 'Garantías HL' : 'Garantías Normales';

    // Filtrar garantias según el apartado activo (Normal o HL)
    let listToExport = allGarantias.filter(g => isHLSection ? isHLGarantia(g) : isNormalGarantia(g));

    // Filtrar por período rápido si está activo
    if (filterPeriod === 'today') {
      listToExport = listToExport.filter(g => isDateToday(g.created_at));
    } else if (filterPeriod === 'week') {
      listToExport = listToExport.filter(g => isDateInCurrentWeek(g.created_at));
    } else if (filterPeriod === 'month') {
      const nowM = String(new Date().getMonth() + 1).padStart(2, '0');
      const nowY = String(new Date().getFullYear());
      listToExport = listToExport.filter(g => isDateInMonth(g.created_at, nowM, nowY));
    } else if (filterPeriod === 'custom_date' && filterCustomDate) {
      listToExport = listToExport.filter(g => getLocalDateStr(g.created_at) === filterCustomDate);
    }

    // Filtrar según mes y año seleccionados
    if (filterMonth !== 'all') {
      listToExport = listToExport.filter(g => {
        const itemMonth = (g.mes_ano || '').split('-')[1] || (g.created_at ? String(new Date(g.created_at).getMonth() + 1).padStart(2, '0') : '');
        return itemMonth === filterMonth;
      });
    }
    if (filterYear !== 'all') {
      listToExport = listToExport.filter(g => {
        const itemYear = (g.mes_ano || '').split('-')[0] || (g.created_at ? String(new Date(g.created_at).getFullYear()) : '');
        return itemYear === filterYear;
      });
    }

    if (listToExport.length === 0) {
      alert(`⚠️ No hay ${sectionName} registradas para exportar en el período seleccionado.`);
      return;
    }

    let periodLabel = filterMonth === 'all' ? `General_${filterYear}` : `${MONTH_NAMES[parseInt(filterMonth) - 1]}_${filterYear}`;
    if (filterPeriod === 'today') periodLabel = `Hoy_${getLocalDateStr(new Date())}`;
    else if (filterPeriod === 'week') periodLabel = `Esta_Semana`;
    else if (filterPeriod === 'custom_date') periodLabel = `Dia_${filterCustomDate}`;

    exportBatchConsolidatedToExcel(listToExport, `${sectionName}_${periodLabel}`, isHLSection ? 'hl' : 'normal');
  }

  /**
   * Exporta a Excel reporte consolidado completo (soporta Normales, HL o Ambas)
   */
  function exportBatchConsolidatedToExcel(ticketsList, periodLabel, sectionChoice = 'all') {
    if (!window.XLSX) {
      alert('⚠️ La librería de Excel (XLSX) no está cargada. Por favor recarga la página.');
      return;
    }

    if (!ticketsList || ticketsList.length === 0) {
      alert('⚠️ No hay garantías registradas para exportar.');
      return;
    }

    const wb = window.XLSX.utils.book_new();

    function generateRows(list, subtitle) {
      const rows = [];
      const totalUnits = list.reduce((acc, g) => acc + (g.total_items || (g.items ? g.items.reduce((s, it) => s + (it.cantidad || 0), 0) : 1)), 0);

      // Metadatos y Encabezado
      rows.push(['SONIMAX MÓVIL - REPORTE DE GARANTÍAS Y DEVOLUCIONES']);
      rows.push([`Período: ${periodLabel}`, '', `Apartado: ${subtitle}`, '', `Total Tickets: ${list.length}`, '', `Total Unidades: ${totalUnits}`, '', `Generado: ${new Date().toLocaleDateString('es-VE')} ${new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}`]);
      rows.push([]); // Renglón vacío

      // Encabezados
      rows.push([
        'N° TICKET',
        'APARTADO / TIPO',
        'FECHA',
        'HORA',
        'REGISTRADO POR',
        'ROL',
        'CLIENTE / TIENDA',
        'TELÉFONO CONTACTO',
        'CÓDIGO PRODUCTO',
        'DESCRIPCIÓN DEL PRODUCTO',
        'ES PRODUCTO HL',
        'CANTIDAD DEFECTUOSA',
        'FALLA PRESENTADA',
        'ESTADO ACTUAL',
        'OBSERVACIONES GESTOR',
        'RESOLUCIÓN / NOTA ADMIN'
      ]);

      list.forEach(g => {
        const fecha = formatDateOnly(g.created_at);
        const hora = g.created_at ? new Date(g.created_at).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }) : '';
        const estadoLabel = STATUS_CONFIG[g.estado]?.label || g.estado;
        const isHLTicket = isHLGarantia(g);
        const tipoLabel = isHLTicket ? 'GARANTÍA HL' : 'GARANTÍA NORMAL';

        if (g.items && g.items.length > 0) {
          g.items.forEach(it => {
            const itIsHL = (it.es_hl === true || it.es_hl === 'true' || isHLTicket) ? 'SÍ (HL)' : 'NO (Normal)';
            rows.push([
              g.codigo_ticket,
              tipoLabel,
              fecha,
              hora,
              g.user_name || '',
              (g.user_role || '').toUpperCase(),
              g.cliente_nombre || 'N/A',
              g.cliente_telefono || 'N/A',
              it.codigo || 'S/C',
              it.nombre || '',
              itIsHL,
              it.cantidad || 1,
              it.falla || '',
              estadoLabel,
              g.observaciones || '',
              g.notas_admin || ''
            ]);
          });
        } else {
          rows.push([
            g.codigo_ticket,
            tipoLabel,
            fecha,
            hora,
            g.user_name || '',
            (g.user_role || '').toUpperCase(),
            g.cliente_nombre || 'N/A',
            g.cliente_telefono || 'N/A',
            'S/C',
            'Sin productos desglosados',
            isHLTicket ? 'SÍ (HL)' : 'NO',
            1,
            'N/A',
            estadoLabel,
            g.observaciones || '',
            g.notas_admin || ''
          ]);
        }
      });

      return rows;
    }

    const colWidths = [
      { wch: 18 }, // Ticket
      { wch: 18 }, // Apartado
      { wch: 12 }, // Fecha
      { wch: 10 }, // Hora
      { wch: 22 }, // Registrado Por
      { wch: 10 }, // Rol
      { wch: 25 }, // Cliente
      { wch: 18 }, // Teléfono
      { wch: 16 }, // Código
      { wch: 38 }, // Descripción
      { wch: 16 }, // Es HL
      { wch: 14 }, // Cantidad
      { wch: 35 }, // Falla
      { wch: 18 }, // Estado
      { wch: 30 }, // Observaciones Gestor
      { wch: 30 }  // Resolución Admin
    ];

    if (sectionChoice === 'all' || sectionChoice === 'ambas') {
      // 1. Hoja Consolidada General
      const rowsAll = generateRows(ticketsList, 'Consolidado General (Normales + HL)');
      const wsAll = window.XLSX.utils.aoa_to_sheet(rowsAll);
      wsAll['!cols'] = colWidths;
      window.XLSX.utils.book_append_sheet(wb, wsAll, 'Consolidado_Todo');

      // 2. Hoja Normales
      const normalList = ticketsList.filter(g => isNormalGarantia(g));
      if (normalList.length > 0) {
        const rowsNorm = generateRows(normalList, 'Garantías Normales');
        const wsNorm = window.XLSX.utils.aoa_to_sheet(rowsNorm);
        wsNorm['!cols'] = colWidths;
        window.XLSX.utils.book_append_sheet(wb, wsNorm, 'Garantias_Normales');
      }

      // 3. Hoja HL
      const hlList = ticketsList.filter(g => isHLGarantia(g));
      if (hlList.length > 0) {
        const rowsHL = generateRows(hlList, 'Garantías HL');
        const wsHL = window.XLSX.utils.aoa_to_sheet(rowsHL);
        wsHL['!cols'] = colWidths;
        window.XLSX.utils.book_append_sheet(wb, wsHL, 'Garantias_HL');
      }
    } else if (sectionChoice === 'hl') {
      const hlList = ticketsList.filter(g => isHLGarantia(g));
      const targetList = hlList.length > 0 ? hlList : ticketsList;
      const rowsHL = generateRows(targetList, 'Garantías HL');
      const wsHL = window.XLSX.utils.aoa_to_sheet(rowsHL);
      wsHL['!cols'] = colWidths;
      window.XLSX.utils.book_append_sheet(wb, wsHL, 'Garantias_HL');
    } else {
      const normalList = ticketsList.filter(g => isNormalGarantia(g));
      const targetList = normalList.length > 0 ? normalList : ticketsList;
      const rowsNorm = generateRows(targetList, 'Garantías Normales');
      const wsNorm = window.XLSX.utils.aoa_to_sheet(rowsNorm);
      wsNorm['!cols'] = colWidths;
      window.XLSX.utils.book_append_sheet(wb, wsNorm, 'Garantias_Normales');
    }

    const cleanPeriodStr = String(periodLabel).replace(/[\/\s:]+/g, '_');
    const fileName = `Garantias_Consolidado_${cleanPeriodStr}.xlsx`;
    window.XLSX.writeFile(wb, fileName);
    console.log(`[GARANTIAS] ✅ Reporte consolidado exportado: ${fileName}`);
  }

  // ============================================================
  // MODAL ADMIN: JUNTAR / CONFIRMAR Y EXPORTAR POR PERÍODO
  // Permite agrupar por Día, Semana o Mes, confirmar en lote y exportar
  // ============================================================
  function openBatchPeriodModal() {
    let modal = document.getElementById('garantias-batch-period-modal');
    if (modal) modal.remove();

    modal = document.createElement('div');
    modal.id = 'garantias-batch-period-modal';
    modal.className = 'fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 overflow-y-auto animate-g-fade';

    // Estado del modal de consolidación
    let batchPeriodMode = 'day'; // 'day', 'week', 'month'
    let batchTargetDate = getLocalDateStr(new Date());
    let batchTargetMonth = String(new Date().getMonth() + 1).padStart(2, '0');
    let batchTargetYear = String(new Date().getFullYear());
    let batchSectionChoice = currentWarrantySection === 'hl' ? 'hl' : 'all'; // 'all', 'normal', 'hl'
    let batchSelectedTickets = new Set();

    modal.innerHTML = `
      <div class="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl max-w-4xl w-full max-h-[94vh] flex flex-col overflow-hidden border border-gray-200 dark:border-gray-800 animate-g-fade">
        
        <!-- HEADER DEL MODAL BATCH -->
        <div class="bg-gradient-to-r from-amber-600 via-orange-600 to-amber-700 p-4 text-white flex items-center justify-between shadow-md flex-shrink-0">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center text-xl shadow-inner border border-white/20">
              ⚡
            </div>
            <div>
              <h3 class="text-base sm:text-lg font-black leading-tight flex items-center gap-2">
                Consolidar, Confirmar y Exportar por Período
                <span class="bg-white/25 text-white text-[10px] uppercase px-2 py-0.5 rounded-full font-bold">Admin</span>
              </h3>
              <p class="text-xs text-amber-100 mt-0.5">
                Junte todas las garantías de un día, semana o mes para confirmar en lote y exportar todo junto.
              </p>
            </div>
          </div>
          <button id="close-batch-modal-btn" class="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-xl transition-all" title="Cerrar">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        <!-- CONTENIDO Y SELECTORES -->
        <div class="flex-1 overflow-y-auto garantia-scroll p-4 sm:p-6 space-y-4">
          
          <!-- FILA 1: SELECTOR DE PERÍODO + SELECTOR DE APARTADO -->
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3 bg-gray-50 dark:bg-gray-800/60 p-4 rounded-2xl border border-gray-200 dark:border-gray-700">
            
            <!-- Selector de Período (Día / Semana / Mes) -->
            <div class="space-y-2">
              <label class="block text-xs font-black uppercase text-gray-700 dark:text-gray-300">
                1. Seleccionar Período a Juntar
              </label>
              <div class="grid grid-cols-3 gap-1.5" id="batch-period-pills">
                <button type="button" class="batch-p-btn active py-2 px-2 rounded-xl text-xs font-bold transition-all bg-amber-600 text-white shadow-sm flex items-center justify-center gap-1" data-mode="day">
                  <span>📅</span>
                  <span>Por Día</span>
                </button>
                <button type="button" class="batch-p-btn py-2 px-2 rounded-xl text-xs font-bold transition-all bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 flex items-center justify-center gap-1" data-mode="week">
                  <span>📆</span>
                  <span>Semana</span>
                </button>
                <button type="button" class="batch-p-btn py-2 px-2 rounded-xl text-xs font-bold transition-all bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 flex items-center justify-center gap-1" data-mode="month">
                  <span>🗓️</span>
                  <span>Por Mes</span>
                </button>
              </div>

              <!-- Sub-control dinámico según el modo -->
              <div id="batch-subcontrol-container" class="pt-1">
                <!-- Se inyecta dinámicamente -->
              </div>
            </div>

            <!-- Selector de Apartado (Normales / HL / Ambas) -->
            <div class="space-y-2">
              <label class="block text-xs font-black uppercase text-gray-700 dark:text-gray-300">
                2. Apartado a Incluir
              </label>
              <div class="grid grid-cols-3 gap-1.5" id="batch-section-pills">
                <button type="button" class="batch-s-btn ${batchSectionChoice === 'all' ? 'active bg-orange-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700'} py-2 px-2 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1" data-sec="all">
                  <span>✨</span>
                  <span>Ambas</span>
                </button>
                <button type="button" class="batch-s-btn ${batchSectionChoice === 'normal' ? 'active bg-emerald-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700'} py-2 px-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1" data-sec="normal">
                  <span>🛡️</span>
                  <span>Normales</span>
                </button>
                <button type="button" class="batch-s-btn ${batchSectionChoice === 'hl' ? 'active bg-purple-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700'} py-2 px-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1" data-sec="hl">
                  <span class="px-1 bg-white/30 rounded text-[9px] font-black">HL</span>
                  <span>Solo HL</span>
                </button>
              </div>

              <p id="batch-section-desc" class="text-[11px] text-gray-500 dark:text-gray-400 pt-1">
                Incluye solicitudes tanto del catálogo normal como del apartado exclusivo HL.
              </p>
            </div>
          </div>

          <!-- RESUMEN EN TIEMPO REAL DEL PERÍODO SELECCIONADO -->
          <div id="batch-summary-card" class="bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 dark:from-amber-950/30 dark:via-orange-950/20 dark:to-amber-950/30 p-3.5 rounded-2xl border border-amber-200 dark:border-amber-800/60 flex flex-wrap items-center justify-between gap-3 animate-g-fade">
            <!-- Se llena dinámicamente -->
          </div>

          <!-- TABLA / LISTA DE GARANTÍAS DEL PERÍODO CON CHECKBOXES -->
          <div class="space-y-2">
            <div class="flex items-center justify-between px-1">
              <label class="flex items-center gap-2 cursor-pointer select-none text-xs font-black text-gray-800 dark:text-gray-200">
                <input type="checkbox" id="batch-master-checkbox" checked class="w-4 h-4 text-amber-600 rounded cursor-pointer accent-amber-600" />
                <span id="batch-master-checkbox-label">Seleccionar Todas las Garantías del Período</span>
              </label>
              <span id="batch-selected-counter" class="text-xs font-bold text-amber-800 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/60 px-2.5 py-0.5 rounded-full">
                0 seleccionadas
              </span>
            </div>

            <div id="batch-tickets-list" class="space-y-2 max-h-72 overflow-y-auto garantia-scroll border border-gray-200 dark:border-gray-700 rounded-2xl p-2 bg-gray-50/50 dark:bg-gray-900/50">
              <!-- Se llena dinámicamente con los renglones de garantías -->
            </div>
          </div>

          <!-- ACCIONES EN LOTE: CONFIRMAR + EXPORTAR -->
          <div class="bg-gray-50 dark:bg-gray-800/80 p-4 rounded-2xl border border-gray-200 dark:border-gray-700 space-y-3">
            <h4 class="text-xs font-black uppercase text-gray-700 dark:text-gray-300 flex items-center gap-1.5">
              <span>🚀</span>
              <span>Acciones en Lote para el Período</span>
            </h4>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label class="block text-[11px] font-bold text-gray-600 dark:text-gray-400 mb-1">
                  Cambiar Estado a:
                </label>
                <select id="batch-action-status-select" class="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs font-bold text-gray-800 dark:text-white focus:outline-none focus:border-amber-500">
                  <option value="aprobada" selected>✅ Aprobada / Confirmada</option>
                  <option value="completada">📦 Completada / Entregada</option>
                  <option value="en_revision">🔍 En Revisión Técnica</option>
                  <option value="rechazada">❌ Rechazada</option>
                </select>
              </div>

              <div>
                <label class="block text-[11px] font-bold text-gray-600 dark:text-gray-400 mb-1">
                  Nota o Resolución de Administración (Opcional):
                </label>
                <input type="text" id="batch-action-note-input" class="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs text-gray-800 dark:text-white focus:outline-none focus:border-amber-500" placeholder="Ej. Aprobado en lote por cierre administrativo..." />
              </div>
            </div>

            <div class="flex flex-col sm:flex-row items-center justify-between gap-2.5 pt-2 border-t border-gray-200 dark:border-gray-700">
              <button type="button" id="batch-confirm-submit-btn" class="w-full sm:w-auto px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white rounded-xl font-black text-xs sm:text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer">
                <span>✅</span>
                <span id="batch-confirm-btn-label">Confirmar Todas las Seleccionadas</span>
              </button>

              <button type="button" id="batch-export-submit-btn" class="w-full sm:w-auto px-5 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-700 hover:from-blue-700 hover:to-indigo-800 text-white rounded-xl font-black text-xs sm:text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer">
                <span>📊</span>
                <span>Exportar Todo Junto a Excel (.xlsx)</span>
              </button>
            </div>
          </div>

        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Helpers internos del modal
    function getMatchingTickets() {
      return allGarantias.filter(g => {
        // Filtro de apartado
        if (batchSectionChoice === 'normal' && isHLGarantia(g)) return false;
        if (batchSectionChoice === 'hl' && !isHLGarantia(g)) return false;

        // Filtro de período
        if (batchPeriodMode === 'day') {
          return getLocalDateStr(g.created_at) === batchTargetDate;
        } else if (batchPeriodMode === 'week') {
          return isDateInCurrentWeek(g.created_at);
        } else if (batchPeriodMode === 'month') {
          return isDateInMonth(g.created_at, batchTargetMonth, batchTargetYear);
        }

        return true;
      });
    }

    function getPeriodLabelText() {
      if (batchPeriodMode === 'day') {
        const todayStr = getLocalDateStr(new Date());
        return batchTargetDate === todayStr ? `Hoy (${batchTargetDate})` : `Día ${batchTargetDate}`;
      } else if (batchPeriodMode === 'week') {
        return `Semana en Curso`;
      } else if (batchPeriodMode === 'month') {
        const mIdx = parseInt(batchTargetMonth) - 1;
        return `${MONTH_NAMES[mIdx]} ${batchTargetYear}`;
      }
      return 'Período';
    }

    function renderSubcontrol() {
      const container = document.getElementById('batch-subcontrol-container');
      if (!container) return;

      if (batchPeriodMode === 'day') {
        container.innerHTML = `
          <div class="flex items-center gap-2 flex-wrap">
            <input type="date" id="batch-date-input" value="${batchTargetDate}" class="px-3 py-1.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs font-bold text-gray-800 dark:text-white focus:outline-none focus:border-amber-500" />
            <button type="button" id="batch-btn-today" class="px-2.5 py-1.5 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 text-gray-800 dark:text-gray-200 rounded-lg text-xs font-bold transition-all">Hoy</button>
            <button type="button" id="batch-btn-yesterday" class="px-2.5 py-1.5 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 text-gray-800 dark:text-gray-200 rounded-lg text-xs font-bold transition-all">Ayer</button>
          </div>
        `;
        document.getElementById('batch-date-input').onchange = (e) => {
          batchTargetDate = e.target.value;
          updateBatchView();
        };
        document.getElementById('batch-btn-today').onclick = () => {
          batchTargetDate = getLocalDateStr(new Date());
          document.getElementById('batch-date-input').value = batchTargetDate;
          updateBatchView();
        };
        document.getElementById('batch-btn-yesterday').onclick = () => {
          const y = new Date();
          y.setDate(y.getDate() - 1);
          batchTargetDate = getLocalDateStr(y);
          document.getElementById('batch-date-input').value = batchTargetDate;
          updateBatchView();
        };
      } else if (batchPeriodMode === 'week') {
        const now = new Date();
        const currentDay = now.getDay() === 0 ? 7 : now.getDay();
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - currentDay + 1);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        const startStr = formatDateOnly(startOfWeek.toISOString());
        const endStr = formatDateOnly(endOfWeek.toISOString());

        container.innerHTML = `
          <div class="p-2 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center justify-between">
            <span>📅 Rango: <b>${startStr} al ${endStr}</b></span>
            <span class="text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-md">Lunes a Domingo</span>
          </div>
        `;
      } else if (batchPeriodMode === 'month') {
        container.innerHTML = `
          <div class="flex items-center gap-2">
            <select id="batch-select-month" class="flex-1 px-3 py-1.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs font-bold text-gray-800 dark:text-white focus:outline-none focus:border-amber-500">
              ${MONTH_NAMES.map((name, i) => {
                const val = String(i + 1).padStart(2, '0');
                return `<option value="${val}" ${val === batchTargetMonth ? 'selected' : ''}>${name}</option>`;
              }).join('')}
            </select>
            <select id="batch-select-year" class="w-24 px-3 py-1.5 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs font-bold text-gray-800 dark:text-white focus:outline-none focus:border-amber-500">
              <option value="2025" ${batchTargetYear === '2025' ? 'selected' : ''}>2025</option>
              <option value="2026" ${batchTargetYear === '2026' ? 'selected' : ''}>2026</option>
              <option value="2027" ${batchTargetYear === '2027' ? 'selected' : ''}>2027</option>
            </select>
          </div>
        `;
        document.getElementById('batch-select-month').onchange = (e) => {
          batchTargetMonth = e.target.value;
          updateBatchView();
        };
        document.getElementById('batch-select-year').onchange = (e) => {
          batchTargetYear = e.target.value;
          updateBatchView();
        };
      }
    }

    function updateBatchView() {
      const matches = getMatchingTickets();
      // Por defecto seleccionar todos los tickets del período
      batchSelectedTickets = new Set(matches.map(g => g.codigo_ticket));

      // Actualizar resumen
      const summaryEl = document.getElementById('batch-summary-card');
      const periodLabel = getPeriodLabelText();
      const totalUnits = matches.reduce((acc, g) => acc + (g.total_items || (g.items ? g.items.reduce((s, it) => s + (it.cantidad || 0), 0) : 1)), 0);
      const pendientes = matches.filter(g => g.estado === 'pendiente').length;
      const revision = matches.filter(g => g.estado === 'en_revision').length;
      const aprobadas = matches.filter(g => g.estado === 'aprobada' || g.estado === 'completada').length;
      const rechazadas = matches.filter(g => g.estado === 'rechazada').length;

      if (summaryEl) {
        summaryEl.innerHTML = `
          <div class="flex items-center gap-3">
            <span class="text-2xl">📋</span>
            <div>
              <div class="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase">Resumen del Período</div>
              <div class="text-sm sm:text-base font-black text-amber-950 dark:text-amber-100 flex items-center gap-2">
                <span>${periodLabel}</span>
                <span class="text-xs font-bold px-2 py-0.5 rounded-full ${batchSectionChoice === 'hl' ? 'bg-purple-600 text-white' : batchSectionChoice === 'normal' ? 'bg-emerald-600 text-white' : 'bg-orange-600 text-white'}">
                  ${batchSectionChoice === 'hl' ? 'Solo HL' : batchSectionChoice === 'normal' ? 'Solo Normales' : 'Normales + HL'}
                </span>
              </div>
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <span class="px-2.5 py-1 bg-white dark:bg-gray-800 rounded-lg font-black text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700 shadow-sm">
              🎫 ${matches.length} solicitudes (${totalUnits} uds)
            </span>
            <span class="px-2 py-1 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 rounded-lg font-bold">
              ⏳ ${pendientes} pend.
            </span>
            <span class="px-2 py-1 bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 rounded-lg font-bold">
              🔍 ${revision} rev.
            </span>
            <span class="px-2 py-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 rounded-lg font-bold">
              ✅ ${aprobadas} aprob.
            </span>
          </div>
        `;
      }

      // Renderizar renglones de tickets
      renderTicketsTable(matches);
    }

    function renderTicketsTable(matches) {
      const listEl = document.getElementById('batch-tickets-list');
      const counterEl = document.getElementById('batch-selected-counter');
      const masterChk = document.getElementById('batch-master-checkbox');
      const btnLabel = document.getElementById('batch-confirm-btn-label');

      if (counterEl) counterEl.textContent = `${batchSelectedTickets.size} de ${matches.length} seleccionadas`;
      if (btnLabel) btnLabel.textContent = `Confirmar ${batchSelectedTickets.size} Garantías Seleccionadas`;
      if (masterChk) masterChk.checked = matches.length > 0 && batchSelectedTickets.size === matches.length;

      if (matches.length === 0) {
        listEl.innerHTML = `
          <div class="text-center py-8 text-gray-400 space-y-1">
            <span class="text-3xl block">🔍</span>
            <p class="font-bold text-sm">No se encontraron garantías para este período y apartado.</p>
            <p class="text-xs">Prueba cambiando el día, semana o apartado arriba.</p>
          </div>
        `;
        return;
      }

      listEl.innerHTML = matches.map(g => {
        const isHL = isHLGarantia(g);
        const isChecked = batchSelectedTickets.has(g.codigo_ticket);
        const statusInfo = STATUS_CONFIG[g.estado] || { label: g.estado, icon: '🏷️', badgeClass: 'bg-gray-100 text-gray-800' };

        const itemsSummary = (g.items || []).map(it => `${it.cantidad}x ${it.codigo}`).join(', ');

        return `
          <div class="flex items-center justify-between p-2.5 rounded-xl bg-white dark:bg-gray-800 border ${isChecked ? (isHL ? 'border-purple-300 dark:border-purple-800/80' : 'border-emerald-300 dark:border-emerald-800/80') : 'border-gray-200 dark:border-gray-700 opacity-60'} transition-all gap-2">
            <div class="flex items-center gap-2.5 min-w-0">
              <input type="checkbox" class="batch-ticket-chk w-4 h-4 text-amber-600 rounded cursor-pointer accent-amber-600 flex-shrink-0" data-ticket="${g.codigo_ticket}" ${isChecked ? 'checked' : ''} />
              <div class="min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <span class="font-black font-mono text-xs ${isHL ? 'text-purple-600 dark:text-purple-400' : 'text-emerald-700 dark:text-emerald-400'}">${g.codigo_ticket}</span>
                  <span class="px-1.5 py-0.2 rounded text-[10px] font-black uppercase ${isHL ? 'bg-purple-600 text-white' : 'bg-emerald-600 text-white'}">
                    ${isHL ? 'HL' : 'Normal'}
                  </span>
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-bold border ${statusInfo.badgeClass}">
                    ${statusInfo.icon} ${statusInfo.label}
                  </span>
                  <span class="text-[11px] text-gray-400">🕒 ${formatDateTime(g.created_at)}</span>
                </div>
                <div class="text-xs text-gray-700 dark:text-gray-300 truncate mt-0.5">
                  <b>${g.user_name}</b> · ${g.cliente_nombre ? `Cliente: <b>${g.cliente_nombre}</b> · ` : ''} <span class="text-gray-500">Productos: ${itemsSummary || 'N/A'}</span>
                </div>
              </div>
            </div>
          </div>
        `;
      }).join('');

      // Eventos de checkboxes individuales
      listEl.querySelectorAll('.batch-ticket-chk').forEach(chk => {
        chk.onchange = () => {
          const t = chk.dataset.ticket;
          if (chk.checked) {
            batchSelectedTickets.add(t);
          } else {
            batchSelectedTickets.delete(t);
          }
          if (counterEl) counterEl.textContent = `${batchSelectedTickets.size} de ${matches.length} seleccionadas`;
          if (btnLabel) btnLabel.textContent = `Confirmar ${batchSelectedTickets.size} Garantías Seleccionadas`;
          if (masterChk) masterChk.checked = batchSelectedTickets.size === matches.length;
        };
      });
    }

    // Eventos de botones de período
    modal.querySelectorAll('.batch-p-btn').forEach(btn => {
      btn.onclick = () => {
        modal.querySelectorAll('.batch-p-btn').forEach(b => {
          b.className = 'batch-p-btn py-2 px-2 rounded-xl text-xs font-bold transition-all bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 flex items-center justify-center gap-1';
        });
        btn.className = 'batch-p-btn active py-2 px-2 rounded-xl text-xs font-bold transition-all bg-amber-600 text-white shadow-sm flex items-center justify-center gap-1';
        batchPeriodMode = btn.dataset.mode;
        renderSubcontrol();
        updateBatchView();
      };
    });

    // Eventos de botones de apartado
    modal.querySelectorAll('.batch-s-btn').forEach(btn => {
      btn.onclick = () => {
        modal.querySelectorAll('.batch-s-btn').forEach(b => {
          b.className = 'batch-s-btn py-2 px-2 rounded-xl text-xs font-bold transition-all bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-700 hover:bg-gray-100 flex items-center justify-center gap-1';
        });
        const sec = btn.dataset.sec;
        batchSectionChoice = sec;

        if (sec === 'hl') {
          btn.className = 'batch-s-btn active py-2 px-2 rounded-xl text-xs font-bold transition-all bg-purple-600 text-white shadow-sm flex items-center justify-center gap-1';
        } else if (sec === 'normal') {
          btn.className = 'batch-s-btn active py-2 px-2 rounded-xl text-xs font-bold transition-all bg-emerald-600 text-white shadow-sm flex items-center justify-center gap-1';
        } else {
          btn.className = 'batch-s-btn active py-2 px-2 rounded-xl text-xs font-bold transition-all bg-orange-600 text-white shadow-sm flex items-center justify-center gap-1';
        }

        const desc = document.getElementById('batch-section-desc');
        if (desc) {
          if (sec === 'hl') desc.textContent = 'Filtra únicamente garantías del apartado exclusivo HL.';
          else if (sec === 'normal') desc.textContent = 'Filtra únicamente garantías estándar del catálogo normal Sonimax.';
          else desc.textContent = 'Incluye solicitudes tanto de Garantías Normales como de Garantías HL.';
        }

        updateBatchView();
      };
    });

    // Master checkbox
    document.getElementById('batch-master-checkbox').onchange = (e) => {
      const isChecked = e.target.checked;
      const matches = getMatchingTickets();
      if (isChecked) {
        matches.forEach(g => batchSelectedTickets.add(g.codigo_ticket));
      } else {
        batchSelectedTickets.clear();
      }
      renderTicketsTable(matches);
    };

    // Cerrar modal
    document.getElementById('close-batch-modal-btn').onclick = () => modal.remove();

    // Botón: Confirmar seleccionadas en lote
    document.getElementById('batch-confirm-submit-btn').onclick = async () => {
      if (batchSelectedTickets.size === 0) {
        alert('⚠️ Por favor selecciona al menos una garantía para confirmar.');
        return;
      }

      const newStatus = document.getElementById('batch-action-status-select').value;
      const adminNote = document.getElementById('batch-action-note-input').value.trim();
      const count = batchSelectedTickets.size;
      const statusLabel = STATUS_CONFIG[newStatus]?.label || newStatus;

      if (!confirm(`¿Estás seguro de que deseas confirmar y actualizar ${count} garantías al estado "${statusLabel}"?`)) {
        return;
      }

      const submitBtn = document.getElementById('batch-confirm-submit-btn');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Guardando confirmación...';

      await batchUpdateGarantiasStatusInDB(Array.from(batchSelectedTickets), newStatus, adminNote || `Confirmado en lote (${getPeriodLabelText()})`);
      
      submitBtn.disabled = false;
      submitBtn.innerHTML = '<span>✅</span><span id="batch-confirm-btn-label">Confirmar Todas las Seleccionadas</span>';

      updateBatchView();
      renderHistoryList();

      alert(`✅ ¡${count} garantías fueron confirmadas y actualizadas exitosamente como "${statusLabel}"!`);

      // Preguntar si desea exportar inmediatamente a Excel
      if (confirm(`¿Deseas exportar a Excel el reporte consolidado de estas ${count} garantías ahora?`)) {
        const matches = getMatchingTickets().filter(g => batchSelectedTickets.has(g.codigo_ticket));
        const periodLabel = `${getPeriodLabelText()}_Confirmadas`;
        exportBatchConsolidatedToExcel(matches, periodLabel, batchSectionChoice);
      }
    };

    // Botón: Exportar a Excel todo el período
    document.getElementById('batch-export-submit-btn').onclick = () => {
      const matches = getMatchingTickets();
      const listToExport = matches.filter(g => batchSelectedTickets.has(g.codigo_ticket));
      if (listToExport.length === 0) {
        alert('⚠️ No hay garantías seleccionadas para exportar en este período.');
        return;
      }

      const periodLabel = `${getPeriodLabelText()}`;
      exportBatchConsolidatedToExcel(listToExport, periodLabel, batchSectionChoice);
    };

    // Inicializar vista
    renderSubcontrol();
    updateBatchView();
  }

  // ============================================================
  // AUTO-REFRESCO Y TIEMPO REAL ENTRE PCS
  // ============================================================
  function setupRealtimeAndPolling() {
    // 1. Polling cada 8 segundos si el modal está abierto en la lista de historial
    setInterval(() => {
      const modal = document.getElementById('garantias-main-modal');
      if (modal && !modal.classList.contains('hidden') && (currentActiveTab === 'normal' || currentActiveTab === 'hl' || currentActiveTab === 'history')) {
        fetchGarantiasFromDatabase().then(() => {
          renderHistoryList();
        });
      }
    }, 8000);

    // 2. Canales en tiempo real de Supabase
    const clients = getAllSupabaseClients();
    clients.forEach(c => {
      try {
        if (c.client && typeof c.client.channel === 'function') {
          c.client.channel('garantias_realtime_ch_' + c.id)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'garantias' }, (payload) => {
              console.log(`[GARANTIAS] ⚡ ¡Cambio recibido en tiempo real de ${c.name}!`, payload);
              fetchGarantiasFromDatabase().then(() => {
                renderHistoryList();
              });
            })
            .subscribe();
        }
      } catch (err) {
        console.warn(`[GARANTIAS] Realtime no disponible en ${c.name}:`, err);
      }
    });
  }

  // ============================================================
  // APERTURA Y CIERRE DEL MODAL PRINCIPAL
  // ============================================================
  function showGarantiasMainModal() {
    createMainModal();

    const userBadge = document.getElementById('garantias-user-badge');
    const previewUser = document.getElementById('garantias-preview-user');
    const previewTime = document.getElementById('garantias-preview-time');
    const previewTicket = document.getElementById('garantias-preview-ticket');

    const currentUser = getCurrentUser();
    const role = (getActiveRole() || '').toLowerCase();

    if (userBadge) userBadge.textContent = `${currentUser.name} (${role.toUpperCase()})`;
    if (previewUser) previewUser.textContent = `${currentUser.name} (${role.toUpperCase()})`;
    if (previewTime) previewTime.textContent = formatDateTime(new Date().toISOString());

    // Restaurar borrador si existe, sino generar ticket nuevo
    const draftRestored = restoreFormDraft();
    if (!draftRestored && previewTicket) {
      previewTicket.textContent = generateTicketCode();
    }

    // Cargar datos acumulados de Supabase de inmediato
    fetchGarantiasFromDatabase().then(() => {
      renderHistoryList();
    });

    const modal = document.getElementById('garantias-main-modal');
    modal?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    // Si es Administrador, abrir directamente en la pestaña de historial
    // Si es Gestor, abrir en el formulario de registro
    if (role === 'admin') {
      document.getElementById('garantias-tab-history-btn')?.click();
    } else {
      document.getElementById('garantias-tab-form-btn')?.click();
    }
  }

  function closeGarantiasModal() {
    const modal = document.getElementById('garantias-main-modal');
    modal?.classList.add('hidden');
    document.body.style.overflow = '';
  }

  // ============================================================
  // INICIALIZACIÓN DE BOTONES EN LA INTERFAZ
  // ============================================================
  function initializeButtons() {
    // 1. Botón en el header superior
    const headerBtn = document.getElementById('header-garantias-btn');
    if (headerBtn) {
      headerBtn.onclick = promptPinOrOpen;
      if (isAuthorized()) {
        headerBtn.classList.remove('hidden');
      }
    }

    // 2. Botón en la sección de gestor
    const gestorBtn = document.getElementById('gestor-garantias-button');
    if (gestorBtn) {
      gestorBtn.onclick = promptPinOrOpen;
    }

    // 3. Botón en la sección de administración
    const adminBtn = document.getElementById('garantias-button');
    if (adminBtn) {
      adminBtn.onclick = promptPinOrOpen;
    }

    console.log('[GARANTIAS] ✅ Módulo de Garantías y Devoluciones (Multi-PC) activo.');
  }

  // Exportar funciones globales
  window.openGarantiasModal = promptPinOrOpen;
  window.closeGarantiasModal = closeGarantiasModal;
  window.exportGarantiasExcel = exportFilteredGarantiasToExcel;
  window.openBatchPeriodModal = openBatchPeriodModal;
  window.exportBatchConsolidatedExcel = exportBatchConsolidatedToExcel;

  // Auto-guardar borrador al cerrar/recargar la página
  window.addEventListener('beforeunload', () => {
    if (currentWarrantyItems.length > 0) {
      saveFormDraft();
    }
  });

  // Backup: guardar al cambiar de pestaña/minimizar
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && currentWarrantyItems.length > 0) {
      saveFormDraft();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initializeButtons();
      setupRealtimeAndPolling();
    });
  } else {
    initializeButtons();
    setupRealtimeAndPolling();
  }

  setTimeout(initializeButtons, 800);
  setTimeout(initializeButtons, 2000);

})();
