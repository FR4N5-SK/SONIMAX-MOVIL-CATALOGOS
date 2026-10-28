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
 * 6. Persistencia dual: Base de datos Supabase (tabla 'garantias') con sincronización
 *    y almacenamiento de respaldo automático en localStorage.
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
  let currentActiveTab = 'form'; // 'form', 'history', 'config'
  let currentWarrantyItems = []; // [{ id, codigo, nombre, departamento, cantidad, falla, imagen_url }]
  let selectedCatalogProduct = null;
  let allGarantias = [];
  let isSessionUnlocked = sessionStorage.getItem(STORAGE_SESSION_UNLOCKED) === 'true';

  // Filtros de la lista acumulada
  const currentDate = new Date();
  let filterMonth = String(currentDate.getMonth() + 1).padStart(2, '0'); // ej: "10"
  let filterYear = String(currentDate.getFullYear()); // ej: "2026"
  let filterStatus = 'all';
  let filterUser = 'all';
  let searchQuery = '';
  let onlyMyWarranties = false;

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
    const role = getActiveRole();
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

  function generateTicketCode() {
    const d = new Date();
    const yy = String(d.getFullYear()).slice(-2);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const randomNum = Math.floor(1000 + Math.random() * 9000);
    return `GAR-${yy}${mm}-${randomNum}`;
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
  // PERSISTENCIA: LOCALSTORAGE + SUPABASE
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

  async function fetchGarantiasFromDatabase() {
    allGarantias = loadLocalCache();

    if (!window.supabaseClient) {
      console.warn('[GARANTIAS] Supabase no disponible, usando caché local');
      return allGarantias;
    }

    try {
      const { data, error } = await window.supabaseClient
        .from('garantias')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('[GARANTIAS] Aviso al consultar Supabase (puede requerir ejecutar supabase-garantias.sql):', error.message);
        return allGarantias;
      }

      if (data && Array.isArray(data)) {
        allGarantias = data;
        saveLocalCache(data);
      }
    } catch (e) {
      console.warn('[GARANTIAS] Error de red o tabla no creada aún en Supabase:', e);
    }

    return allGarantias;
  }

  async function saveGarantiaToDatabase(garantia) {
    // 1. Guardar primero en el caché local para disponibilidad inmediata
    const list = loadLocalCache();
    list.unshift(garantia);
    saveLocalCache(list);
    allGarantias = list;

    // 2. Intentar guardar en Supabase
    if (window.supabaseClient) {
      try {
        const { error } = await window.supabaseClient
          .from('garantias')
          .insert([garantia]);

        if (error) {
          console.warn('[GARANTIAS] Guardado localmente. En Supabase devolvió:', error.message);
        } else {
          console.log('[GARANTIAS] ✅ Guardado exitoso en Supabase');
        }
      } catch (e) {
        console.warn('[GARANTIAS] Error sincronizando con Supabase:', e);
      }
    }

    return garantia;
  }

  async function updateGarantiaStatusInDB(ticketCode, newStatus, adminNote) {
    const list = loadLocalCache();
    const item = list.find(g => g.codigo_ticket === ticketCode);
    if (item) {
      item.estado = newStatus;
      if (adminNote !== undefined) item.notas_admin = adminNote;
      item.updated_at = new Date().toISOString();
      saveLocalCache(list);
      allGarantias = list;
    }

    if (window.supabaseClient) {
      try {
        const updates = {
          estado: newStatus,
          updated_at: new Date().toISOString()
        };
        if (adminNote !== undefined) updates.notas_admin = adminNote;

        await window.supabaseClient
          .from('garantias')
          .update(updates)
          .eq('codigo_ticket', ticketCode);
      } catch (e) {
        console.warn('[GARANTIAS] Error actualizando en Supabase:', e);
      }
    }
  }

  async function deleteGarantiaFromDB(ticketCode) {
    const list = loadLocalCache().filter(g => g.codigo_ticket !== ticketCode);
    saveLocalCache(list);
    allGarantias = list;

    if (window.supabaseClient) {
      try {
        await window.supabaseClient
          .from('garantias')
          .delete()
          .eq('codigo_ticket', ticketCode);
      } catch (e) {
        console.warn('[GARANTIAS] Error eliminando en Supabase:', e);
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
                <span>Registro de productos defectuosos, acumulación de pedidos y reportes mensuales</span>
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
          <div class="flex gap-2">
            <button id="garantias-tab-form-btn" class="garantia-tab-btn active px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-2 text-gray-700 dark:text-gray-300">
              <span>📝</span>
              <span>Nueva Garantía</span>
            </button>
            <button id="garantias-tab-history-btn" class="garantia-tab-btn px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-2 text-gray-700 dark:text-gray-300">
              <span>📋</span>
              <span>Garantías Registradas</span>
              <span id="garantias-history-count" class="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-xs px-2 py-0.5 rounded-full font-bold">0</span>
            </button>
            <button id="garantias-tab-config-btn" class="garantia-tab-btn px-3 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-1.5 text-gray-700 dark:text-gray-300">
              <span>⚙️</span>
              <span class="hidden sm:inline">Configuración</span>
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
          <div id="garantias-tab-form" class="space-y-6">
            
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
          <div id="garantias-tab-history" class="hidden space-y-6">
            
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
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                
                <!-- Filtro por Mes -->
                <div>
                  <label class="block text-[11px] font-bold uppercase text-gray-500 mb-1">📅 Mes</label>
                  <select id="garantias-filter-month" class="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-xs font-bold text-gray-800 dark:text-white focus:outline-none focus:border-emerald-500">
                    <option value="all">Todos los Meses</option>
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
                    <option value="2025">2025</option>
                    <option value="2026">2026</option>
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
                    <span id="garantias-export-label">Exportar Mes a Excel</span>
                  </button>
                  <button type="button" id="garantias-refresh-btn" class="p-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-xl text-xs font-bold transition-all" title="Recargar lista">
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
            </div>
          </div>

          <!-- ========================================== -->
          <!-- PESTAÑA 3: CONFIGURACIÓN (Solo Admin) -->
          <!-- ========================================== -->
          <div id="garantias-tab-config" class="hidden space-y-6">
            <div class="bg-gray-50 dark:bg-gray-800/50 p-6 rounded-3xl border border-gray-200 dark:border-gray-700 space-y-6 max-w-xl mx-auto">
              
              <div>
                <h3 class="text-lg font-black text-gray-900 dark:text-white flex items-center gap-2">
                  <span>🔐</span>
                  <span>Cambiar Clave de Acceso a Garantías</span>
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
                  <span>Estado de la Base de Datos (Supabase)</span>
                </h4>
                <p class="text-xs text-gray-500 mt-1">
                  Tabla requerida: <code class="font-mono text-emerald-600 dark:text-emerald-400">public.garantias</code>.
                  Si no la has creado aún en el Editor SQL de Supabase, puedes ejecutar el script <code class="font-mono text-gray-700 dark:text-gray-300">supabase-garantias.sql</code>.
                  Mientras tanto, tus datos se guardan de forma 100% segura en la memoria y caché local.
                </p>
              </div>

              <div class="flex gap-2">
                <button type="button" id="config-test-db-btn" class="flex-1 py-2 px-3 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-xs font-bold rounded-xl transition-all">
                  🔍 Probar Conexión con Supabase
                </button>
                <button type="button" id="config-sync-cache-btn" class="flex-1 py-2 px-3 bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold rounded-xl transition-all">
                  🔄 Sincronizar Registros Locales
                </button>
              </div>
              <div id="config-db-status" class="hidden text-xs text-center font-bold py-2 px-3 rounded-xl"></div>
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
    const tabConfigBtn = document.getElementById('garantias-tab-config-btn');

    const tabForm = document.getElementById('garantias-tab-form');
    const tabHistory = document.getElementById('garantias-tab-history');
    const tabConfig = document.getElementById('garantias-tab-config');

    const switchTab = (tab) => {
      currentActiveTab = tab;
      [tabFormBtn, tabHistoryBtn, tabConfigBtn].forEach(b => b?.classList.remove('active'));
      [tabForm, tabHistory, tabConfig].forEach(t => t?.classList.add('hidden'));

      if (tab === 'form') {
        tabFormBtn?.classList.add('active');
        tabForm?.classList.remove('hidden');
      } else if (tab === 'history') {
        tabHistoryBtn?.classList.add('active');
        tabHistory?.classList.remove('hidden');
        renderHistoryList();
      } else if (tab === 'config') {
        tabConfigBtn?.classList.add('active');
        tabConfig?.classList.remove('hidden');
        const pinInput = document.getElementById('config-new-pin-input');
        if (pinInput) pinInput.value = getStoredPIN();
      }
    };

    tabFormBtn.onclick = () => switchTab('form');
    tabHistoryBtn.onclick = () => switchTab('history');
    tabConfigBtn.onclick = () => switchTab('config');

    // Botón exportar excel en cabecera de tabs
    document.getElementById('garantias-quick-excel-btn').onclick = exportFilteredGarantiasToExcel;

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

      // Agregar a la lista de items
      currentWarrantyItems.push({
        id: selectedCatalogProduct.id,
        codigo: selectedCatalogProduct.codigo || 'S/C',
        nombre: selectedCatalogProduct.nombre,
        departamento: selectedCatalogProduct.departamento || '',
        cantidad: qty,
        falla: falla,
        imagen_url: selectedCatalogProduct.imagen_url || ''
      });

      // Limpiar selección actual
      selectedCatalogProduct = null;
      document.getElementById('garantia-selected-product-card').classList.add('hidden');
      descInput.value = '';
      qtyInput.value = '1';

      renderCurrentWarrantyItems();
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
          label.textContent = `Exportar Año ${filterYear} a Excel`;
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

    document.getElementById('garantias-refresh-btn').onclick = async () => {
      const btn = document.getElementById('garantias-refresh-btn');
      btn.classList.add('animate-spin');
      await fetchGarantiasFromDatabase();
      renderHistoryList();
      setTimeout(() => btn.classList.remove('animate-spin'), 600);
    };

    document.getElementById('garantias-export-excel-btn').onclick = exportFilteredGarantiasToExcel;

    // Pestaña Configuración
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

    document.getElementById('config-test-db-btn').onclick = async () => {
      const statusEl = document.getElementById('config-db-status');
      statusEl.className = 'text-xs text-center font-bold py-2 px-3 rounded-xl bg-blue-100 text-blue-800';
      statusEl.textContent = 'Probando conexión con Supabase...';
      statusEl.classList.remove('hidden');

      if (!window.supabaseClient) {
        statusEl.className = 'text-xs text-center font-bold py-2 px-3 rounded-xl bg-amber-100 text-amber-800';
        statusEl.textContent = '⚠️ Cliente de Supabase no inicializado en supabase-config.js';
        return;
      }

      try {
        const { data, error } = await window.supabaseClient.from('garantias').select('id').limit(1);
        if (error) {
          statusEl.className = 'text-xs text-center font-bold py-2 px-3 rounded-xl bg-amber-100 text-amber-800';
          statusEl.textContent = `⚠️ Tabla 'garantias' no detectada aún: ${error.message}. Por favor ejecuta supabase-garantias.sql en Supabase.`;
        } else {
          statusEl.className = 'text-xs text-center font-bold py-2 px-3 rounded-xl bg-emerald-100 text-emerald-800';
          statusEl.textContent = `✅ ¡Conexión con Supabase verificada! Tabla 'garantias' activa y funcionando.`;
        }
      } catch (e) {
        statusEl.className = 'text-xs text-center font-bold py-2 px-3 rounded-xl bg-red-100 text-red-800';
        statusEl.textContent = `Error al conectar: ${e.message}`;
      }
    };

    document.getElementById('config-sync-cache-btn').onclick = async () => {
      const statusEl = document.getElementById('config-db-status');
      statusEl.className = 'text-xs text-center font-bold py-2 px-3 rounded-xl bg-blue-100 text-blue-800';
      statusEl.textContent = 'Sincronizando registros con Supabase...';
      statusEl.classList.remove('hidden');

      const localList = loadLocalCache();
      if (!window.supabaseClient || localList.length === 0) {
        statusEl.textContent = `No hay registros nuevos o Supabase no está conectado. (${localList.length} en caché)`;
        return;
      }

      try {
        let synced = 0;
        for (const item of localList) {
          const { error } = await window.supabaseClient.from('garantias').upsert([item]);
          if (!error) synced++;
        }
        statusEl.className = 'text-xs text-center font-bold py-2 px-3 rounded-xl bg-emerald-100 text-emerald-800';
        statusEl.textContent = `✅ ¡Sincronización completada! ${synced} de ${localList.length} registros actualizados en Supabase.`;
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

    if (badgeEl) {
      badgeEl.textContent = `${totalCount} producto${totalCount === 1 ? '' : 's'} (${totalUnits} unidad${totalUnits === 1 ? '' : 'es'})`;
    }

    if (totalCount === 0) {
      emptyEl?.classList.remove('hidden');
      listEl.innerHTML = '';
      return;
    }

    emptyEl?.classList.add('hidden');

    listEl.innerHTML = currentWarrantyItems.map((item, index) => `
      <div class="flex items-center justify-between p-3 rounded-2xl bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700/80 animate-g-fade">
        <div class="flex items-center gap-3 min-w-0">
          <img src="${item.imagen_url || 'https://i.ibb.co/RkyBVXBP/LOGO-SONIMAX-PNG-2.png'}" class="w-12 h-12 object-contain rounded-xl bg-white p-1 border border-gray-200 flex-shrink-0" />
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 bg-emerald-600 text-white rounded font-mono font-bold text-xs">${item.codigo}</span>
              <span class="px-2 py-0.5 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded font-bold text-xs">${item.cantidad} ud${item.cantidad > 1 ? 's' : ''}</span>
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

    listEl.querySelectorAll('.remove-warranty-item-btn').forEach(btn => {
      btn.onclick = () => {
        const idx = parseInt(btn.dataset.index);
        currentWarrantyItems.splice(idx, 1);
        renderCurrentWarrantyItems();
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

    renderCurrentWarrantyItems();

    // Actualizar preview de ticket nuevo
    const previewTicket = document.getElementById('garantias-preview-ticket');
    if (previewTicket) previewTicket.textContent = generateTicketCode();
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
    submitBtn.innerHTML = '<span>⏳</span><span>Guardando solicitud...</span>';

    try {
      const ticketCode = document.getElementById('garantias-preview-ticket')?.textContent || generateTicketCode();
      const currentUser = getCurrentUser();
      const role = getActiveRole();
      const now = new Date();
      const mesAno = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      const cliente = document.getElementById('garantia-input-cliente')?.value?.trim() || '';
      const telefono = document.getElementById('garantia-input-telefono')?.value?.trim() || '';
      const observaciones = document.getElementById('garantia-input-observaciones')?.value?.trim() || '';

      const totalItems = currentWarrantyItems.reduce((acc, it) => acc + (it.cantidad || 0), 0);

      const payload = {
        codigo_ticket: ticketCode,
        user_id: currentUser.auth_id || currentUser.id || null,
        user_name: currentUser.name || 'Gestor',
        user_role: role,
        cliente_nombre: cliente,
        cliente_telefono: telefono,
        items: currentWarrantyItems,
        total_items: totalItems,
        estado: 'pendiente',
        observaciones: observaciones,
        notas_admin: '',
        mes_ano: mesAno,
        created_at: now.toISOString(),
        updated_at: now.toISOString()
      };

      await saveGarantiaToDatabase(payload);

      // Mostrar pantalla de éxito
      showSuccessModal(payload);

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
  function showSuccessModal(garantia) {
    const successDiv = document.createElement('div');
    successDiv.id = 'garantia-success-modal';
    successDiv.className = 'fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-g-fade';

    const itemsSummaryHtml = garantia.items.map(it => `
      <li class="flex items-center justify-between py-1 border-b border-gray-100 dark:border-gray-800 text-xs">
        <span class="font-bold text-gray-800 dark:text-gray-200">${it.cantidad}x ${it.codigo} - ${it.nombre}</span>
        <span class="text-amber-600 dark:text-amber-400 italic">(${it.falla})</span>
      </li>
    `).join('');

    successDiv.innerHTML = `
      <div class="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl max-w-lg w-full p-6 sm:p-7 border border-emerald-500/30 text-center space-y-4">
        
        <div class="w-16 h-16 mx-auto rounded-full bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-300 flex items-center justify-center text-3xl shadow-lg shadow-emerald-500/20">
          ✅
        </div>

        <div>
          <span class="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">¡Garantía Registrada con Éxito!</span>
          <h3 class="text-2xl font-black font-mono text-gray-900 dark:text-white mt-1">${garantia.codigo_ticket}</h3>
          <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Se ha guardado en la base de datos y acumulado para revisión del Administrador.
          </p>
        </div>

        <!-- Resumen -->
        <div class="bg-gray-50 dark:bg-gray-800/60 p-3.5 rounded-2xl text-left border border-gray-200 dark:border-gray-700/60 space-y-2">
          <div class="flex justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>Fecha: <b>${formatDateTime(garantia.created_at)}</b></span>
            <span>Registrado por: <b>${garantia.user_name}</b></span>
          </div>
          ${garantia.cliente_nombre ? `<div class="text-xs text-gray-700 dark:text-gray-300">Cliente/Tienda: <b>${garantia.cliente_nombre}</b></div>` : ''}
          <ul class="space-y-1 mt-2">
            ${itemsSummaryHtml}
          </ul>
        </div>

        <!-- Botones de Acción -->
        <div class="space-y-2 pt-2">
          <button id="success-share-whatsapp-btn" class="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-sm shadow-lg shadow-emerald-600/30 transition-all flex items-center justify-center gap-2">
            <span>📲</span>
            <span>Enviar por WhatsApp al Administrador</span>
          </button>

          <button id="success-print-btn" class="w-full py-2.5 px-4 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-800 dark:text-white rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-2">
            <span>🖨️</span>
            <span>Imprimir Comprobante de Entrega</span>
          </button>

          <div class="flex gap-2 pt-2">
            <button id="success-view-list-btn" class="flex-1 py-2 px-3 bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300 rounded-xl text-xs font-bold hover:bg-teal-100 transition-all">
              📋 Ver en Lista
            </button>
            <button id="success-new-btn" class="flex-1 py-2 px-3 bg-emerald-600 text-white rounded-xl text-xs font-bold hover:bg-emerald-700 transition-all">
              ➕ Crear Otra
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(successDiv);

    // Eventos del modal de éxito
    document.getElementById('success-share-whatsapp-btn').onclick = () => {
      shareGarantiaWhatsApp(garantia);
    };

    document.getElementById('success-print-btn').onclick = () => {
      printGarantiaReceipt(garantia);
    };

    document.getElementById('success-view-list-btn').onclick = () => {
      successDiv.remove();
      document.getElementById('garantias-tab-history-btn')?.click();
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
    msg += `*Registrado por:* ${g.user_name} (${g.user_role.toUpperCase()})\n`;
    if (g.cliente_nombre) msg += `*Cliente/Tienda:* ${g.cliente_nombre}\n`;
    if (g.cliente_telefono) msg += `*Teléfono:* ${g.cliente_telefono}\n`;
    msg += `*Estado:* ${STATUS_CONFIG[g.estado]?.label || g.estado}\n\n`;

    msg += `*PRODUCTOS EN GARANTÍA:*\n`;
    g.items.forEach((item, index) => {
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
            ${g.items.map(it => `
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

  function renderHistoryList() {
    const listEl = document.getElementById('garantias-history-list');
    const emptyEl = document.getElementById('garantias-history-empty');
    if (!listEl) return;

    populateUserFilterDropdown();

    // Filtrar garantias
    let filtered = allGarantias.filter(g => {
      // Filtro de Mes
      if (filterMonth !== 'all') {
        const itemMonth = (g.mes_ano || '').split('-')[1] || (g.created_at ? String(new Date(g.created_at).getMonth() + 1).padStart(2, '0') : '');
        if (itemMonth !== filterMonth) return false;
      }

      // Filtro de Año
      if (filterYear !== 'all') {
        const itemYear = (g.mes_ano || '').split('-')[0] || (g.created_at ? String(new Date(g.created_at).getFullYear()) : '');
        if (itemYear !== filterYear) return false;
      }

      // Filtro de Estado
      if (filterStatus !== 'all' && g.estado !== filterStatus) {
        return false;
      }

      // Filtro de Usuario
      if (filterUser !== 'all' && g.user_name !== filterUser) {
        return false;
      }

      // Búsqueda de texto
      if (searchQuery) {
        const ticket = (g.codigo_ticket || '').toLowerCase();
        const userName = (g.user_name || '').toLowerCase();
        const cliente = (g.cliente_nombre || '').toLowerCase();
        const obs = (g.observaciones || '').toLowerCase();
        const itemsText = (g.items || []).map(i => `${i.codigo} ${i.nombre} ${i.falla}`).join(' ').toLowerCase();

        const match = ticket.includes(searchQuery) ||
          userName.includes(searchQuery) ||
          cliente.includes(searchQuery) ||
          obs.includes(searchQuery) ||
          itemsText.includes(searchQuery);

        if (!match) return false;
      }

      return true;
    });

    // Actualizar Estadísticas (KPIs)
    updateStatsCounters(filtered);

    // Actualizar contador del tab
    const tabBadge = document.getElementById('garantias-history-count');
    if (tabBadge) tabBadge.textContent = filtered.length;

    if (filtered.length === 0) {
      emptyEl?.classList.remove('hidden');
      listEl.innerHTML = '';
      return;
    }

    emptyEl?.classList.add('hidden');

    const isAdmin = getActiveRole() === 'admin';

    listEl.innerHTML = filtered.map(g => {
      const statusInfo = STATUS_CONFIG[g.estado] || { label: g.estado, icon: '🏷️', badgeClass: 'bg-gray-100 text-gray-800' };

      const itemsHtml = (g.items || []).map(it => `
        <div class="flex items-center gap-2 text-xs py-1 border-b border-gray-100 dark:border-gray-800/80 last:border-0">
          <span class="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 font-bold rounded font-mono text-[10px]">${it.cantidad}x ${it.codigo}</span>
          <span class="font-bold text-gray-800 dark:text-gray-200 truncate flex-1">${it.nombre}</span>
          <span class="text-amber-700 dark:text-amber-400 font-medium text-[11px] truncate max-w-[200px]" title="${it.falla}">⚠️ ${it.falla}</span>
        </div>
      `).join('');

      return `
        <div class="bg-white dark:bg-gray-800/90 rounded-2xl p-4 sm:p-5 border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-all space-y-3">
          
          <!-- Encabezado de la Tarjeta -->
          <div class="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 dark:border-gray-700/80 pb-3">
            <div class="flex items-center gap-2.5">
              <span class="font-black font-mono text-base sm:text-lg text-emerald-700 dark:text-emerald-400">${g.codigo_ticket}</span>
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
  // EXPORTACIÓN A EXCEL POR MES (SheetJS / XLSX)
  // ============================================================
  function exportFilteredGarantiasToExcel() {
    if (!window.XLSX) {
      alert('⚠️ La librería de Excel (XLSX) no está cargada. Por favor recarga la página.');
      return;
    }

    // Filtrar garantias según el mes y año seleccionados
    const listToExport = allGarantias.filter(g => {
      if (filterMonth !== 'all') {
        const itemMonth = (g.mes_ano || '').split('-')[1] || (g.created_at ? String(new Date(g.created_at).getMonth() + 1).padStart(2, '0') : '');
        if (itemMonth !== filterMonth) return false;
      }
      if (filterYear !== 'all') {
        const itemYear = (g.mes_ano || '').split('-')[0] || (g.created_at ? String(new Date(g.created_at).getFullYear()) : '');
        if (itemYear !== filterYear) return false;
      }
      return true;
    });

    if (listToExport.length === 0) {
      alert('⚠️ No hay garantías registradas para exportar en el período seleccionado.');
      return;
    }

    const monthLabel = filterMonth === 'all' ? `Todo el Año ${filterYear}` : `${MONTH_NAMES[parseInt(filterMonth) - 1]} ${filterYear}`;

    // Construcción de filas de datos
    const rows = [];

    // Título y Metadatos
    rows.push(['SONIMAX MÓVIL - REPORTE DE GARANTÍAS Y DEVOLUCIONES (RMA)']);
    rows.push([`Período: ${monthLabel}`, '', `Total Tickets: ${listToExport.length}`, '', `Fecha de Generación: ${new Date().toLocaleDateString('es-VE')}`]);
    rows.push([]); // Espacio

    // Encabezados de Columnas
    rows.push([
      'N° TICKET',
      'FECHA',
      'HORA',
      'REGISTRADO POR',
      'ROL',
      'CLIENTE / TIENDA',
      'TELÉFONO CONTACTO',
      'CÓDIGO PRODUCTO',
      'DESCRIPCIÓN DEL PRODUCTO',
      'CANTIDAD DEFECTUOSA',
      'FALLA PRESENTADA',
      'ESTADO ACTUAL',
      'OBSERVACIONES GESTOR',
      'RESOLUCIÓN / NOTA ADMIN'
    ]);

    // Renglones de Datos (Desglosado por cada producto de la garantía)
    listToExport.forEach(g => {
      const fecha = formatDateOnly(g.created_at);
      const hora = g.created_at ? new Date(g.created_at).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }) : '';
      const estadoLabel = STATUS_CONFIG[g.estado]?.label || g.estado;

      if (g.items && g.items.length > 0) {
        g.items.forEach(it => {
          rows.push([
            g.codigo_ticket,
            fecha,
            hora,
            g.user_name || '',
            (g.user_role || '').toUpperCase(),
            g.cliente_nombre || 'N/A',
            g.cliente_telefono || 'N/A',
            it.codigo || 'S/C',
            it.nombre || '',
            it.cantidad || 1,
            it.falla || '',
            estadoLabel,
            g.observaciones || '',
            g.notas_admin || ''
          ]);
        });
      } else {
        // En caso de que no tenga items estructurados
        rows.push([
          g.codigo_ticket,
          fecha,
          hora,
          g.user_name || '',
          (g.user_role || '').toUpperCase(),
          g.cliente_nombre || 'N/A',
          g.cliente_telefono || 'N/A',
          'S/C',
          'Sin productos',
          1,
          'N/A',
          estadoLabel,
          g.observaciones || '',
          g.notas_admin || ''
        ]);
      }
    });

    // Crear libro y hoja con SheetJS
    const wb = window.XLSX.utils.book_new();
    const ws = window.XLSX.utils.aoa_to_sheet(rows);

    // Ajustar anchos de columnas
    ws['!cols'] = [
      { wch: 18 }, // Ticket
      { wch: 12 }, // Fecha
      { wch: 10 }, // Hora
      { wch: 22 }, // Registrado Por
      { wch: 10 }, // Rol
      { wch: 25 }, // Cliente
      { wch: 18 }, // Teléfono
      { wch: 16 }, // Código
      { wch: 38 }, // Descripción
      { wch: 14 }, // Cantidad
      { wch: 35 }, // Falla
      { wch: 18 }, // Estado
      { wch: 30 }, // Observaciones Gestor
      { wch: 30 }  // Resolución Admin
    ];

    const sheetName = filterMonth === 'all' ? `Garantias_${filterYear}` : `Garantias_${MONTH_NAMES[parseInt(filterMonth) - 1]}`;
    window.XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));

    // Nombre de archivo
    const cleanMonthStr = filterMonth === 'all' ? `Anual_${filterYear}` : `${MONTH_NAMES[parseInt(filterMonth) - 1]}_${filterYear}`;
    const fileName = `Garantias_SONIMAX_${cleanMonthStr}.xlsx`;

    window.XLSX.writeFile(wb, fileName);
    console.log(`[GARANTIAS] ✅ Excel exportado con éxito: ${fileName}`);
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
    const role = getActiveRole();

    if (userBadge) userBadge.textContent = `${currentUser.name} (${role.toUpperCase()})`;
    if (previewUser) previewUser.textContent = `${currentUser.name} (${role.toUpperCase()})`;
    if (previewTime) previewTime.textContent = formatDateTime(new Date().toISOString());
    if (previewTicket) previewTicket.textContent = generateTicketCode();

    // Cargar datos acumulados de base de datos
    fetchGarantiasFromDatabase().then(() => {
      renderHistoryList();
    });

    const modal = document.getElementById('garantias-main-modal');
    modal?.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    // Iniciar en tab de formulario
    document.getElementById('garantias-tab-form-btn')?.click();
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

    console.log('[GARANTIAS] ✅ Módulo de Garantías y Devoluciones cargado e inicializado correctamente.');
  }

  // Exportar funciones globales
  window.openGarantiasModal = promptPinOrOpen;
  window.closeGarantiasModal = closeGarantiasModal;
  window.exportGarantiasExcel = exportFilteredGarantiasToExcel;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeButtons);
  } else {
    initializeButtons();
  }

  setTimeout(initializeButtons, 800);
  setTimeout(initializeButtons, 2000);

})();
