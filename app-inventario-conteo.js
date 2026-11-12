/**
 * SONIMAX MÓVIL - Módulo de Filtros, Conteo Físico y Auditoría de Inventario
 * =========================================================================
 * Características:
 * 1. Admin: Configuración de filtros por precio mínimo (GMayor), cantidad/stock y depósitos activos.
 * 2. Inventario: Lista de productos filtrados por depósito con bloqueo de campo de cantidad al ingresar.
 * 3. Inventario: Apartado "Productos Listos - Depósito [X]" que acumula los conteos del día.
 * 4. Inventario: Envío final de jornada ("Enviar Cantidades") guardado en la base de datos como pedido/sesión
 *    con nombre, usuario, depósito, fecha, hora y detalle de diferencias.
 * 5. Admin: Panel de auditoría para filtrar por día, fecha, mes, depósito y usuario con exportación a Excel (.xlsx).
 */

(function () {
  'use strict';

  // ============================================================
  // CONSTANTES Y CONFIGURACIÓN LOCAL
  // ============================================================
  const STORAGE_FILTER_KEY = 'sonimax_inv_filter_config_v1';
  const STORAGE_READY_PREFIX = 'sonimax_inv_ready_dep_';
  const STORAGE_SESSIONS_BACKUP = 'sonimax_inv_sessions_history_v1';

  // Configuración predeterminada de filtros
  const DEFAULT_FILTER_CONFIG = {
    active: false,
    minPrice: 0, // Sobre precio_gmayor
    maxPrice: null,
    minStock: 1, // Por defecto filtrar agotados
    maxStock: null,
    minTotalValue: 0, // Sumatoria de cantidad * precio GMayor >= monto (ej. $700)
    sortByPrice: 'none',   // [NUEVO] 'none' | 'desc' (mayor a menor) | 'asc' (menor a mayor)
    productLimit: 0,       // [NUEVO] 0 = sin límite, N = mostrar los primeros N productos
    deposits: ['A', 'B', 'C', 'D', 'E', 'PLANTA BAJA', 'PISO VENTA']
  };

  // Estado en memoria
  let currentFilterConfig = { ...DEFAULT_FILTER_CONFIG };
  let currentActiveTab = 'pending'; // 'pending' | 'ready'
  let cachedSessions = [];

  // ============================================================
  // OBTENER DEPÓSITO ACTIVO (ROBUSTO Y SINCRONIZADO)
  // ============================================================
  function getCurrentDeposit() {
    let dept = window.currentDepartment;
    if (!dept || dept === 'all') {
      const activeBtn = document.querySelector('.dept-button.active, .sidebar-dept-btn.active');
      if (activeBtn && activeBtn.dataset && activeBtn.dataset.dept) {
        dept = activeBtn.dataset.dept;
        window.currentDepartment = dept;
      }
    }
    if (dept && dept.startsWith('inv_')) {
      return dept.replace('inv_', '').trim().toUpperCase();
    }
    return (dept || 'unassigned').trim().toUpperCase();
  }

  // ============================================================
  // CLIENTES DE SUPABASE ACTIVOS (SOPORTE MULTI-SERVIDOR / PLAN PRO)
  // ============================================================
  function getActiveSupabaseClients() {
    const clients = [];
    if (window.supabaseClient) clients.push(window.supabaseClient);
    if (window.supabaseOldClient && window.supabaseOldClient !== window.supabaseClient) {
      clients.push(window.supabaseOldClient);
    }
    return clients;
  }

  // ============================================================
  // GESTIÓN DE CONFIGURACIÓN DE FILTROS (ADMIN)
  // ============================================================

  /**
   * Carga la configuración de filtros desde Supabase o localStorage
   */
  async function loadInventoryFilterConfig() {
    try {
      // 1. Intentar cargar desde respaldo local primero (inmediato)
      const localBackup = localStorage.getItem(STORAGE_FILTER_KEY);
      if (localBackup) {
        try {
          const parsed = JSON.parse(localBackup);
          currentFilterConfig = { ...DEFAULT_FILTER_CONFIG, ...parsed };
        } catch (e) {
          console.warn('[INV-FILTER] Error parseando respaldo local:', e);
        }
      }

      // 2. Intentar cargar desde Supabase (probar clientes principal y secundario)
      const clients = getActiveSupabaseClients();
      for (const client of clients) {
        try {
          const { data, error } = await client
            .from('inventory_config')
            .select('*')
            .eq('id', 1)
            .maybeSingle();

          if (!error && data) {
            let updated = false;
            if (typeof data.filter_active !== 'undefined' && data.filter_active !== null) {
              currentFilterConfig.active = Boolean(data.filter_active);
              updated = true;
            }
            if (typeof data.filter_min_price !== 'undefined' && data.filter_min_price !== null) {
              currentFilterConfig.minPrice = parseFloat(data.filter_min_price) || 0;
              updated = true;
            }
            if (typeof data.filter_max_price !== 'undefined' && data.filter_max_price !== null) {
              currentFilterConfig.maxPrice = data.filter_max_price ? parseFloat(data.filter_max_price) : null;
              updated = true;
            }
            if (typeof data.filter_min_stock !== 'undefined' && data.filter_min_stock !== null) {
              currentFilterConfig.minStock = parseInt(data.filter_min_stock) || 0;
              updated = true;
            }
            if (typeof data.filter_max_stock !== 'undefined' && data.filter_max_stock !== null) {
              currentFilterConfig.maxStock = data.filter_max_stock ? parseInt(data.filter_max_stock) : null;
              updated = true;
            }
            if (typeof data.filter_min_total_value !== 'undefined' && data.filter_min_total_value !== null) {
              currentFilterConfig.minTotalValue = parseFloat(data.filter_min_total_value) || 0;
              updated = true;
            }
            if (data.filter_deposits && Array.isArray(data.filter_deposits)) {
              currentFilterConfig.deposits = data.filter_deposits;
              updated = true;
            }
            if (typeof data.filter_sort_by_price !== 'undefined' && data.filter_sort_by_price !== null) {
              currentFilterConfig.sortByPrice = data.filter_sort_by_price;
              updated = true;
            }
            if (typeof data.filter_product_limit !== 'undefined' && data.filter_product_limit !== null) {
              currentFilterConfig.productLimit = parseInt(data.filter_product_limit) || 0;
              updated = true;
            }
            if (data.filter_settings && typeof data.filter_settings === 'object') {
              currentFilterConfig = { ...currentFilterConfig, ...data.filter_settings };
              updated = true;
            }

            if (updated) {
              localStorage.setItem(STORAGE_FILTER_KEY, JSON.stringify(currentFilterConfig));
              console.log('[INV-FILTER] ☁️ Configuración cargada desde Supabase:', currentFilterConfig);
              break; // Cargada exitosamente de un servidor
            }
          }
        } catch (clientErr) {
          console.warn('[INV-FILTER] Aviso probando cliente Supabase:', clientErr);
        }
      }
    } catch (err) {
      console.warn('[INV-FILTER] Aviso cargando configuración:', err);
    }
    return currentFilterConfig;
  }

  /**
   * Guarda la configuración de filtros en Supabase y localmente
   */
  async function saveInventoryFilterConfig(newConfig) {
    currentFilterConfig = { ...currentFilterConfig, ...newConfig };
    localStorage.setItem(STORAGE_FILTER_KEY, JSON.stringify(currentFilterConfig));

    const payload = {
      id: 1,
      filter_active: Boolean(currentFilterConfig.active),
      filter_min_price: currentFilterConfig.minPrice || 0,
      filter_max_price: currentFilterConfig.maxPrice || null,
      filter_min_stock: currentFilterConfig.minStock !== null ? currentFilterConfig.minStock : null,
      filter_max_stock: currentFilterConfig.maxStock || null,
      filter_min_total_value: currentFilterConfig.minTotalValue || 0,
      filter_sort_by_price: currentFilterConfig.sortByPrice || 'none',
      filter_product_limit: currentFilterConfig.productLimit || 0,
      filter_deposits: currentFilterConfig.deposits,
      filter_settings: currentFilterConfig
    };

    let cloudSaved = false;
    let lastError = null;
    const clients = getActiveSupabaseClients();

    for (const client of clients) {
      try {
        const { error } = await client
          .from('inventory_config')
          .upsert(payload, { onConflict: 'id' });

        if (!error) {
          cloudSaved = true;
          console.log('[INV-FILTER] ✅ Guardado en servidor Supabase');
        } else {
          lastError = error;
          console.warn('[INV-FILTER] Upsert directo falló en un servidor, intentando filter_settings:', error);
          const { error: err2 } = await client
            .from('inventory_config')
            .upsert({ id: 1, filter_settings: currentFilterConfig }, { onConflict: 'id' });
          if (!err2) cloudSaved = true;
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (cloudSaved) {
      console.log('[INV-FILTER] ✅ Configuración guardada y sincronizada en Supabase con éxito');
      return { success: true, cloudSaved: true };
    } else {
      console.warn('[INV-FILTER] Error guardando en nube:', lastError);
      return { 
        success: true, 
        cloudSaved: false, 
        error: lastError ? (lastError.message || lastError.details || JSON.stringify(lastError)) : 'Error de permisos o tabla inexistente' 
      };
    }
  }

  /**
   * Verifica si un producto cumple con los filtros activos fijados por Admin para el rol inventario
   */
  function isProductEligibleForInventory(product) {
    const stock = parseInt(product.stock || 0);
    const precioGMayor = parseFloat(product.precio_gmayor || 0);

    if (!currentFilterConfig.active) {
      return stock > 0;
    }

    // 1. Filtro por Stock / Cantidad
    if (currentFilterConfig.minStock !== null && stock < currentFilterConfig.minStock) {
      return false;
    }
    if (currentFilterConfig.maxStock !== null && stock > currentFilterConfig.maxStock) {
      return false;
    }

    // 2. Filtro por Precio GMayor
    if (currentFilterConfig.minPrice > 0 && precioGMayor < currentFilterConfig.minPrice) {
      return false;
    }
    if (currentFilterConfig.maxPrice > 0 && precioGMayor > currentFilterConfig.maxPrice) {
      return false;
    }

    // 3. [NUEVO] Filtro por Sumatoria de Cantidades por Precio (Valor Total de Inventario = stock * precio_gmayor)
    const minTotal = parseFloat(currentFilterConfig.minTotalValue || 0);
    if (minTotal > 0) {
      const totalValue = stock * precioGMayor;
      if (totalValue < minTotal) {
        return false;
      }
    }

    return true;
  }

  // ============================================================
  // GESTIÓN DE PRODUCTOS LISTOS (ROL INVENTARIO)
  // ============================================================

  function getStorageReadyKey(deposito) {
    const cleanDep = (deposito || 'unassigned').trim().toUpperCase().replace(/\s+/g, '_');
    return STORAGE_READY_PREFIX + cleanDep;
  }

  /**
   * Obtiene la lista de productos listos para un depósito en la jornada actual
   */
  function getReadyProductsForDeposit(deposito) {
    try {
      const key = getStorageReadyKey(deposito);
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('[INV-READY] Error leyendo productos listos:', e);
      return [];
    }
  }

  /**
   * Guarda la lista de productos listos para un depósito
   */
  function saveReadyProductsForDeposit(deposito, list) {
    try {
      const key = getStorageReadyKey(deposito);
      localStorage.setItem(key, JSON.stringify(list));
      if (window.renderDepartments) window.renderDepartments();
      updateInventoryHeaderCounters();
    } catch (e) {
      console.error('[INV-READY] Error guardando productos listos:', e);
    }
  }

  /**
   * Construye el Set de códigos elegibles del catálogo GLOBAL aplicando
   * orden y límite antes de filtrar por depósito.
   * Se recalcula solo cuando cambia la configuración (memoizado por referencia).
   */
  function getGlobalEligibleCodes() {
    if (!window.allProducts || window.allProducts.length === 0) return null;

    const sortByPrice   = currentFilterConfig.sortByPrice   || 'none';
    const productLimit  = parseInt(currentFilterConfig.productLimit) || 0;

    // 1. Partir del catálogo completo con stock > 0 que pase los filtros de precio/stock/valor
    let globalPool = window.allProducts.filter(p => {
      if (parseInt(p.stock || 0) <= 0) return false;
      return isProductEligibleForInventory(p);
    });

    // 2. Ordenar globalmente por precio G.Mayor si está activo
    if (sortByPrice === 'desc') {
      globalPool.sort((a, b) => parseFloat(b.precio_gmayor || 0) - parseFloat(a.precio_gmayor || 0));
    } else if (sortByPrice === 'asc') {
      globalPool.sort((a, b) => parseFloat(a.precio_gmayor || 0) - parseFloat(b.precio_gmayor || 0));
    }

    // 3. Aplicar límite global (ej. los 200 más caros de TODO el catálogo)
    if (productLimit > 0 && globalPool.length > productLimit) {
      globalPool = globalPool.slice(0, productLimit);
    }

    // 4. Devolver un Set de códigos y el array ya ordenado para preservar el orden
    return {
      codes: new Set(globalPool.map(p => (p.codigo || '').trim().toUpperCase())),
      ordered: globalPool
    };
  }

  /**
   * Obtiene la lista calculada de pendientes de un depósito.
   * Cuando hay límite/orden global, primero selecciona del catálogo global
   * (ej. los 200 más caros) y luego filtra los que pertenecen al depósito.
   */
  function getPendingProductsForDeposit(deposito) {
    if (!window.allProducts || window.allProducts.length === 0) return [];
    const currentDep = (deposito || '').trim().toUpperCase();
    const readyList   = getReadyProductsForDeposit(currentDep);
    const readyCodes  = new Set(readyList.map(it => it.codigo));

    const globalScope = getGlobalEligibleCodes();

    if (globalScope) {
      // --- Modo con límite/orden global ---
      // Usamos el array ya ordenado globalmente y filtramos por depósito
      return globalScope.ordered.filter(p => {
        const pCode  = (p.codigo || '').trim().toUpperCase();
        const invData = window.inventoryDataMap ? window.inventoryDataMap.get(pCode) : null;
        const itemDep = invData ? (invData.deposito || '').trim().toUpperCase() : null;

        if (currentDep === 'UNASSIGNED') {
          if (itemDep) return false;
        } else {
          if (itemDep !== currentDep) return false;
        }

        if (currentDep !== 'UNASSIGNED' && readyCodes.has(pCode)) return false;

        return true;
      });
    }

    // --- Modo sin límite/orden global (comportamiento original) ---
    return window.allProducts.filter(p => {
      const pCode   = (p.codigo || '').trim().toUpperCase();
      const invData = window.inventoryDataMap ? window.inventoryDataMap.get(pCode) : null;
      const itemDep = invData ? (invData.deposito || '').trim().toUpperCase() : null;
      const stock   = parseInt(p.stock || 0);

      if (stock <= 0) return false;

      if (currentDep === 'UNASSIGNED') {
        if (itemDep) return false;
      } else {
        if (itemDep !== currentDep) return false;
      }

      if (!isProductEligibleForInventory(p)) return false;

      if (currentDep !== 'UNASSIGNED' && readyCodes.has(pCode)) return false;

      return true;
    });
  }

  /**
   * Agrega o actualiza un producto como "Listo" en el depósito actual
   */
  async function markProductAsReady(productCode, cantidadFisica, deposito) {
    const cleanCode = (productCode || '').trim().toUpperCase();
    const qty = parseInt(cantidadFisica) || 0;
    const currentDep = (deposito || getCurrentDeposit()).trim().toUpperCase();

    // Buscar datos maestros del producto
    const product = (window.allProducts || []).find(p => (p.codigo || '').trim().toUpperCase() === cleanCode);
    const stockSistema = product ? parseInt(product.stock || 0) : 0;
    const precioGMayor = product ? parseFloat(product.precio_gmayor || 0) : 0;
    const descripcion = product ? (product.nombre || product.descripcion || cleanCode) : cleanCode;

    const list = getReadyProductsForDeposit(currentDep);
    const existingIndex = list.findIndex(item => item.codigo === cleanCode);

    const readyItem = {
      codigo: cleanCode,
      descripcion: descripcion,
      deposito: currentDep,
      cantidad_fisica: qty,
      stock_sistema: stockSistema,
      diferencia: qty - stockSistema,
      precio_gmayor: precioGMayor,
      subtotal_gmayor: Math.round(qty * precioGMayor * 100) / 100,
      timestamp: new Date().toISOString(),
      hora: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    };

    if (existingIndex > -1) {
      list[existingIndex] = readyItem;
    } else {
      list.push(readyItem);
    }

    saveReadyProductsForDeposit(currentDep, list);

    // Actualizar también mapa de inventario en memoria y base de datos
    if (window.inventoryDataMap) {
      const itemData = window.inventoryDataMap.get(cleanCode) || { codigo: cleanCode, deposito: currentDep };
      itemData.cantidad_fisica = qty;
      itemData.deposito = currentDep;
      window.inventoryDataMap.set(cleanCode, itemData);
    }

    try {
      if (window.supabaseClient) {
        await window.supabaseClient
          .from('inventory_products')
          .update({ cantidad_fisica: qty, deposito: currentDep })
          .eq('codigo', cleanCode);
      }
    } catch (err) {
      console.warn('[INV-READY] Advertencia actualizando inventory_products:', err);
    }

    // Mostrar aviso flotante interactivo (Toast)
    showReadyToast(cleanCode, qty, currentDep, list.length);

    return readyItem;
  }

  function showReadyToast(code, qty, dep, totalReady) {
    let toast = document.getElementById('inventory-ready-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'inventory-ready-toast';
      toast.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 transform translate-y-20 opacity-0';
      document.body.appendChild(toast);
    }

    toast.innerHTML = `
      <div class="bg-gray-900/95 backdrop-blur text-white px-5 py-3.5 rounded-2xl shadow-2xl border border-emerald-500/40 flex items-center space-x-3 text-sm">
        <span class="text-xl">✅</span>
        <div>
          <p class="font-bold"><code class="font-mono text-emerald-400">${code}</code> añadido a Listos (${qty} pzs)</p>
          <p class="text-[11px] text-gray-300">Depósito ${dep} • ${totalReady} productos listos en total</p>
        </div>
        <button onclick="window.SonimaxInventoryConteo.switchToReadyTab('${dep}')" class="ml-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl transition-all shadow">
          Ver Listos ➔
        </button>
      </div>
    `;

    toast.classList.remove('translate-y-20', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');

    setTimeout(() => {
      if (toast) {
        toast.classList.add('translate-y-20', 'opacity-0');
        toast.classList.remove('translate-y-0', 'opacity-100');
      }
    }, 4000);
  }

  /**
   * Devuelve un producto de "Listos" a "Pendientes"
   */
  function unmarkProductReady(productCode, deposito) {
    const cleanCode = (productCode || '').trim().toUpperCase();
    const currentDep = (deposito || getCurrentDeposit()).trim().toUpperCase();
    let list = getReadyProductsForDeposit(currentDep);
    list = list.filter(item => item.codigo !== cleanCode);
    saveReadyProductsForDeposit(currentDep, list);
    renderInventoryViews();
  }

  /**
   * Vacía los productos listos de un depósito tras el envío de la jornada
   */
  function clearReadyProductsForDeposit(deposito) {
    const key = getStorageReadyKey(deposito);
    localStorage.removeItem(key);
    if (window.renderDepartments) window.renderDepartments();
    updateInventoryHeaderCounters();
  }

  // ============================================================
  // ENVÍO FINAL DE JORNADA: GUARDAR COMO PEDIDO / SESIÓN
  // ============================================================

  /**
   * Envía las cantidades acumuladas del depósito y las guarda en la base de datos
   */
  async function submitInventorySession(deposito, notas = '') {
    const currentDep = (deposito || getCurrentDeposit()).trim().toUpperCase();
    const readyItems = getReadyProductsForDeposit(currentDep);

    if (readyItems.length === 0) {
      alert('⚠️ No hay productos en el apartado de "Listos" para enviar en este depósito.');
      return { success: false, message: 'Sin productos listos' };
    }

    const currentUser = window.currentUser || {};
    const userId = currentUser.id || currentUser.auth_id || 'inv_user';
    const userName = currentUser.name || 'Personal de Inventario';
    const userUsername = currentUser.username || currentUser.email || 'inventario';

    // Calcular totales
    const totalItems = readyItems.length;
    const totalPiezas = readyItems.reduce((acc, item) => acc + (parseInt(item.cantidad_fisica) || 0), 0);
    const totalValorGMayor = readyItems.reduce((acc, item) => acc + (parseFloat(item.subtotal_gmayor) || 0), 0);
    const diferenciaTotal = readyItems.reduce((acc, item) => acc + (parseInt(item.diferencia) || 0), 0);

    const now = new Date();
    const fecha = now.toISOString().split('T')[0];
    const hora = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const folio = `INV-${fecha.replace(/-/g, '')}-${currentDep.replace(/\s+/g, '_')}-${randomSuffix}`;

    const sessionData = {
      folio: folio,
      user_id: String(userId),
      user_name: userName,
      user_username: userUsername,
      deposito: currentDep,
      total_items: totalItems,
      total_piezas: totalPiezas,
      total_valor_gmayor: Math.round(totalValorGMayor * 100) / 100,
      diferencia_total: diferenciaTotal,
      items: readyItems,
      notas: notas,
      estado: 'enviado',
      fecha: fecha,
      hora: hora,
      created_at: now.toISOString(),
      updated_at: now.toISOString()
    };

    // Guardar en respaldo local siempre
    saveSessionToLocalBackup(sessionData);

    // Intentar guardar en Supabase (todos los servidores disponibles)
    let cloudSaved = false;
    const clients = getActiveSupabaseClients();

    for (const client of clients) {
      try {
        const { error } = await client
          .from('inventory_count_sessions')
          .insert([sessionData]);

        if (!error) {
          cloudSaved = true;
          console.log('[INV-SESSION] ✅ Sesión guardada en Supabase con folio:', folio);
        } else {
          console.warn('[INV-SESSION] Aviso insertando sesión en un servidor:', error);
        }
      } catch (err) {
        console.warn('[INV-SESSION] Excepción guardando sesión en nube:', err);
      }
    }

    // Sincronizar cantidades maestras en inventory_products
    for (const client of clients) {
      try {
        for (const item of readyItems) {
          await client
            .from('inventory_products')
            .update({
              cantidad_fisica: item.cantidad_fisica,
              deposito: currentDep
            })
            .eq('codigo', item.codigo);
        }
      } catch (syncErr) {
        console.warn('[INV-SESSION] Advertencia sincronizando cantidades físicas maestras:', syncErr);
      }
    }

    // Limpiar listos de ese depósito tras envío exitoso
    clearReadyProductsForDeposit(currentDep);
    currentActiveTab = 'pending';
    if (window.filterByDepartment) {
      window.filterByDepartment(`inv_${currentDep}`);
    } else {
      renderInventoryViews();
    }

    return {
      success: true,
      folio: folio,
      cloudSaved: cloudSaved,
      sessionData: sessionData
    };
  }

  function getLocalSessionsBackup() {
    try {
      const data = localStorage.getItem(STORAGE_SESSIONS_BACKUP);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  function saveSessionToLocalBackup(sessionData) {
    const list = getLocalSessionsBackup();
    list.unshift(sessionData);
    if (list.length > 200) list.pop();
    localStorage.setItem(STORAGE_SESSIONS_BACKUP, JSON.stringify(list));
  }

  // ============================================================
  // UI: MODAL DE CONFIGURACIÓN DE FILTROS PARA ADMIN
  // ============================================================

  function showInventoryFilterModal() {
    const existingModal = document.getElementById('inventory-filter-modal');
    if (existingModal) existingModal.remove();

    const config = { ...currentFilterConfig };
    const allDeposits = ['A', 'B', 'C', 'D', 'E', 'PLANTA BAJA', 'PISO VENTA'];

    function calculateMatchingCount(testConfig) {
      if (!window.allProducts || window.allProducts.length === 0) return { filtered: 0, afterLimit: 0 };
      // 1. Filtrar por criterios de precio/stock/valor
      let pool = window.allProducts.filter(p => {
        const precioG = parseFloat(p.precio_gmayor || 0);
        const stock   = parseInt(p.stock || 0);
        if (stock <= 0) return false;
        if (testConfig.minPrice > 0 && precioG < testConfig.minPrice) return false;
        if (testConfig.maxPrice > 0 && precioG > testConfig.maxPrice) return false;
        if (testConfig.minStock !== null && stock < testConfig.minStock) return false;
        if (testConfig.maxStock !== null && stock > testConfig.maxStock) return false;
        if (testConfig.minTotalValue > 0 && (stock * precioG) < testConfig.minTotalValue) return false;
        return true;
      });
      const filtered = pool.length;
      // 2. Ordenar globalmente (para que el límite tome los más caros)
      const sort = testConfig.sortByPrice || 'none';
      if (sort === 'desc') pool.sort((a, b) => parseFloat(b.precio_gmayor || 0) - parseFloat(a.precio_gmayor || 0));
      else if (sort === 'asc') pool.sort((a, b) => parseFloat(a.precio_gmayor || 0) - parseFloat(b.precio_gmayor || 0));
      // 3. Aplicar límite global
      const lim = parseInt(testConfig.productLimit) || 0;
      const afterLimit = lim > 0 ? Math.min(pool.length, lim) : pool.length;
      return { filtered, afterLimit };
    }

    const initialMatch = calculateMatchingCount(config);

    const modal = document.createElement('div');
    modal.id = 'inventory-filter-modal';
    modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4';
    modal.innerHTML = `
      <div class="bg-white dark:bg-gray-800 rounded-3xl max-w-xl w-full shadow-2xl overflow-hidden animate-fade-in border border-gray-100 dark:border-gray-700">
        <!-- Encabezado con gradiente llamativo -->
        <div class="bg-gradient-to-r from-indigo-600 via-blue-600 to-indigo-700 p-6 text-white flex justify-between items-center">
          <div class="flex items-center space-x-3">
            <div class="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-xl shadow-inner">
              ⚙️
            </div>
            <div>
              <h2 class="text-xl font-black">Filtros para Rol Inventario</h2>
              <p class="text-xs text-blue-100">Controla qué productos saldrán en la jornada de conteo</p>
            </div>
          </div>
          <button class="modal-close-btn text-white/80 hover:text-white hover:bg-white/20 rounded-xl p-2 transition-colors">✕</button>
        </div>

        <div class="p-6 space-y-6 max-h-[75vh] overflow-y-auto">
          <!-- Switch Principal: Activar / Desactivar Filtro -->
          <div class="bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800 p-4 rounded-2xl flex items-center justify-between">
            <div>
              <p class="font-bold text-gray-800 dark:text-white text-sm">Filtro Restrictivo de Conteo</p>
              <p class="text-xs text-gray-500 dark:text-gray-300">Si está activo, Inventario solo verá productos que cumplan estos criterios.</p>
            </div>
            <label class="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" id="inv-filter-active-toggle" class="sr-only peer" ${config.active ? 'checked' : ''}>
              <div class="w-12 h-6 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
            </label>
          </div>

          <!-- Filtro por Precio GMayor -->
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <label class="font-bold text-sm text-gray-700 dark:text-gray-200 flex items-center gap-2">
                <span>💰</span> Precio Mínimo Unitario (G.Mayor):
              </label>
              <span class="text-xs text-indigo-600 dark:text-indigo-400 font-semibold">Productos más caros</span>
            </div>
            <div class="relative">
              <span class="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-lg">$</span>
              <input type="number" id="inv-filter-min-price" min="0" step="1" 
                value="${config.minPrice || 0}" 
                placeholder="Ej. 50"
                class="w-full pl-9 pr-4 py-3 bg-gray-50 dark:bg-gray-700 border-2 border-gray-200 dark:border-gray-600 rounded-xl font-bold text-gray-800 dark:text-white outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 text-lg transition-all">
            </div>
            <p class="text-[11px] text-gray-500 dark:text-gray-400">
              Ejemplo: Si colocas <strong>$50.00</strong>, todos los productos de $50 hacia arriba saldrán al rol de inventario y los económicos quedarán ocultos.
            </p>
          </div>

          <!-- [NUEVO] Filtro por Sumatoria / Valor Total del Producto (Stock x Precio GMayor) -->
          <div class="space-y-3 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-gray-700/60 dark:to-gray-700/30 p-4 rounded-2xl border border-blue-200 dark:border-gray-600">
            <div class="flex items-center justify-between">
              <label class="font-black text-sm text-gray-800 dark:text-gray-100 flex items-center gap-2">
                <span>💎</span> Valor Total Mínimo en Inventario (Stock × Precio G.Mayor):
              </label>
              <span class="text-xs text-blue-600 dark:text-blue-400 font-bold">Sumatoria total</span>
            </div>
            <div class="relative">
              <span class="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold text-lg">$</span>
              <input type="number" id="inv-filter-min-total-value" min="0" step="10" 
                value="${config.minTotalValue || 0}" 
                placeholder="Ej. 700"
                class="w-full pl-9 pr-4 py-3 bg-white dark:bg-gray-700 border-2 border-blue-300 dark:border-gray-500 rounded-xl font-black text-gray-800 dark:text-white outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/20 text-lg transition-all">
            </div>
            <p class="text-[11px] text-gray-600 dark:text-gray-300">
              <strong>Ejemplo:</strong> Si colocas <strong>$700</strong>, solo saldrán productos cuyo valor total acumulado (existencia actual × precio G.Mayor) sea igual o mayor a $700. Los de menor valor quedarán ocultos.
            </p>
          </div>

          <!-- Filtro por Cantidad / Existencia (Stock) -->
          <div class="space-y-3">
            <label class="font-bold text-sm text-gray-700 dark:text-gray-200 flex items-center gap-2">
              <span>📦</span> Filtro por Cantidad (Stock en Sistema):
            </label>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="text-xs font-semibold text-gray-500 mb-1 block">Stock Mínimo:</label>
                <input type="number" id="inv-filter-min-stock" min="0" step="1" 
                  value="${config.minStock !== null ? config.minStock : 1}" 
                  class="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-700 border-2 border-gray-200 dark:border-gray-600 rounded-xl font-bold text-gray-800 dark:text-white outline-none focus:border-indigo-500 text-sm">
              </div>
              <div>
                <label class="text-xs font-semibold text-gray-500 mb-1 block">Stock Máximo (Opcional):</label>
                <input type="number" id="inv-filter-max-stock" min="0" step="1" 
                  value="${config.maxStock !== null ? config.maxStock : ''}" 
                  placeholder="Sin límite"
                  class="w-full px-3 py-2.5 bg-gray-50 dark:bg-gray-700 border-2 border-gray-200 dark:border-gray-600 rounded-xl font-bold text-gray-800 dark:text-white outline-none focus:border-indigo-500 text-sm">
              </div>
            </div>
            <p class="text-[11px] text-gray-500 dark:text-gray-400">
              Coloca <strong>1</strong> en Stock Mínimo para ocultar automáticamente productos con stock 0 (agotados).
            </p>
          </div>

          <!-- Filtro por Depósitos Asignados -->
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <label class="font-bold text-sm text-gray-700 dark:text-gray-200 flex items-center gap-2">
                <span>🏢</span> Depósitos Habilitados para Conteo:
              </label>
              <button type="button" id="select-all-deposits-btn" class="text-xs text-indigo-600 dark:text-indigo-400 font-bold hover:underline">
                Seleccionar Todos
              </button>
            </div>
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2" id="filter-deposits-checkboxes">
              ${allDeposits.map(d => `
                <label class="flex items-center space-x-2 p-2 bg-gray-50 dark:bg-gray-700 rounded-xl border border-gray-200 dark:border-gray-600 cursor-pointer hover:bg-indigo-50/50 transition-colors">
                  <input type="checkbox" value="${d}" class="deposit-checkbox rounded text-indigo-600 focus:ring-indigo-500" ${config.deposits.includes(d) ? 'checked' : ''}>
                  <span class="text-xs font-bold text-gray-700 dark:text-gray-200 truncate">${d}</span>
                </label>
              `).join('')}
            </div>
          </div>

          <!-- [NUEVO] Ordenar por Precio -->
          <div class="space-y-3 bg-gradient-to-r from-violet-50 to-purple-50 dark:from-gray-700/60 dark:to-gray-700/30 p-4 rounded-2xl border border-violet-200 dark:border-gray-600">
            <div class="flex items-center justify-between">
              <label class="font-black text-sm text-gray-800 dark:text-gray-100 flex items-center gap-2">
                <span>↕️</span> Ordenar por Precio G.Mayor:
              </label>
              <span class="text-xs text-violet-600 dark:text-violet-400 font-bold">Orden de aparición</span>
            </div>
            <div class="grid grid-cols-3 gap-2" id="sort-price-options">
              <label class="flex flex-col items-center gap-1 p-3 bg-white dark:bg-gray-700 rounded-xl border-2 cursor-pointer transition-all ${(config.sortByPrice || 'none') === 'none' ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/30' : 'border-gray-200 dark:border-gray-600 hover:border-violet-300'}">
                <input type="radio" name="inv-sort-price" value="none" class="sr-only" ${(config.sortByPrice || 'none') === 'none' ? 'checked' : ''}>
                <span class="text-xl">🔀</span>
                <span class="text-xs font-bold text-gray-700 dark:text-gray-200 text-center">Sin orden</span>
              </label>
              <label class="flex flex-col items-center gap-1 p-3 bg-white dark:bg-gray-700 rounded-xl border-2 cursor-pointer transition-all ${(config.sortByPrice || 'none') === 'desc' ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/30' : 'border-gray-200 dark:border-gray-600 hover:border-violet-300'}">
                <input type="radio" name="inv-sort-price" value="desc" class="sr-only" ${(config.sortByPrice || 'none') === 'desc' ? 'checked' : ''}>
                <span class="text-xl">⬆️</span>
                <span class="text-xs font-bold text-gray-700 dark:text-gray-200 text-center">Mayor a Menor</span>
              </label>
              <label class="flex flex-col items-center gap-1 p-3 bg-white dark:bg-gray-700 rounded-xl border-2 cursor-pointer transition-all ${(config.sortByPrice || 'none') === 'asc' ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/30' : 'border-gray-200 dark:border-gray-600 hover:border-violet-300'}">
                <input type="radio" name="inv-sort-price" value="asc" class="sr-only" ${(config.sortByPrice || 'none') === 'asc' ? 'checked' : ''}>
                <span class="text-xl">⬇️</span>
                <span class="text-xs font-bold text-gray-700 dark:text-gray-200 text-center">Menor a Mayor</span>
              </label>
            </div>
            <p class="text-[11px] text-gray-600 dark:text-gray-300">
              <strong>Ejemplo:</strong> Selecciona <strong>Mayor a Menor</strong> para que el rol inventario vea primero los productos más costosos.
            </p>
          </div>

          <!-- [NUEVO] Límite de Productos a Mostrar -->
          <div class="space-y-3 bg-gradient-to-r from-orange-50 to-amber-50 dark:from-gray-700/60 dark:to-gray-700/30 p-4 rounded-2xl border border-orange-200 dark:border-gray-600">
            <div class="flex items-center justify-between">
              <label class="font-black text-sm text-gray-800 dark:text-gray-100 flex items-center gap-2">
                <span>🔢</span> Límite de Productos Visibles:
              </label>
              <span class="text-xs text-orange-600 dark:text-orange-400 font-bold">Primeros N productos</span>
            </div>
            <div class="relative">
              <span class="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 font-bold">#</span>
              <input type="number" id="inv-filter-product-limit" min="0" step="10"
                value="${config.productLimit || 0}"
                placeholder="0 = Sin límite"
                class="w-full pl-9 pr-4 py-3 bg-white dark:bg-gray-700 border-2 border-orange-300 dark:border-gray-500 rounded-xl font-black text-gray-800 dark:text-white outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 text-lg transition-all">
            </div>
            <p class="text-[11px] text-gray-600 dark:text-gray-300">
              <strong>Ejemplo:</strong> Si colocas <strong>200</strong>, el inventario solo verá los primeros 200 productos (según el orden seleccionado arriba). Coloca <strong>0</strong> para no limitar.
            </p>
          </div>

          <!-- Medidor en tiempo real de productos coincidentes -->
          <div class="p-4 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-2xl flex items-center justify-between">
            <div class="flex items-center space-x-3">
              <div class="w-8 h-8 rounded-lg bg-emerald-500 text-white flex items-center justify-center font-bold">✓</div>
              <div>
                <p class="text-xs text-emerald-800 dark:text-emerald-300 font-medium">Productos del catálogo global que saldrán:</p>
                <p class="text-base font-black text-emerald-900 dark:text-emerald-200" id="inv-filter-match-count">${initialMatch.afterLimit} productos${initialMatch.afterLimit !== initialMatch.filtered ? ` <span class="text-xs font-normal text-emerald-700">(de ${initialMatch.filtered} que cumplen filtros)</span>` : ''}</p>
              </div>
            </div>
            <span class="text-xs font-bold px-2.5 py-1 bg-emerald-200 text-emerald-800 dark:bg-emerald-800 dark:text-emerald-100 rounded-lg">Total global</span>
          </div>
        </div>

        <!-- Botones de Acción -->
        <div class="p-6 bg-gray-50 dark:bg-gray-900 border-t border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row gap-3">
          <button id="save-inv-filter-btn" class="flex-1 py-3.5 bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700 text-white font-bold rounded-2xl transition-all shadow-lg shadow-indigo-500/25 flex items-center justify-center space-x-2">
            <span>💾</span>
            <span>Guardar y Sincronizar Filtros</span>
          </button>
          <button class="modal-close-btn px-6 py-3.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-bold rounded-2xl hover:bg-gray-300 transition-colors">
            Cancelar
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelectorAll('.modal-close-btn').forEach(btn => {
      btn.addEventListener('click', () => modal.remove());
    });

    const activeToggle = modal.querySelector('#inv-filter-active-toggle');
    const minPriceInput = modal.querySelector('#inv-filter-min-price');
    const minStockInput = modal.querySelector('#inv-filter-min-stock');
    const maxStockInput = modal.querySelector('#inv-filter-max-stock');
    const minTotalValueInput = modal.querySelector('#inv-filter-min-total-value');
    const matchCountSpan = modal.querySelector('#inv-filter-match-count');
    const depositCheckboxes = modal.querySelectorAll('.deposit-checkbox');
    const selectAllBtn = modal.querySelector('#select-all-deposits-btn');
    const productLimitInput = modal.querySelector('#inv-filter-product-limit');
    const sortPriceRadios = modal.querySelectorAll('input[name="inv-sort-price"]');

    // Interactividad de las tarjetas de orden de precio
    const sortLabels = modal.querySelectorAll('#sort-price-options label');
    sortPriceRadios.forEach(radio => {
      radio.addEventListener('change', () => {
        sortLabels.forEach(lbl => {
          lbl.classList.remove('border-violet-500', 'bg-violet-50', 'dark:bg-violet-900/30');
          lbl.classList.add('border-gray-200', 'dark:border-gray-600');
        });
        const checkedRadio = modal.querySelector('input[name="inv-sort-price"]:checked');
        if (checkedRadio) {
          checkedRadio.closest('label').classList.add('border-violet-500', 'bg-violet-50', 'dark:bg-violet-900/30');
          checkedRadio.closest('label').classList.remove('border-gray-200', 'dark:border-gray-600');
        }
      });
    });

    function updateMatchMeter() {
      const testConfig = {
        minPrice:      parseFloat(minPriceInput.value) || 0,
        maxPrice:      null,
        minStock:      minStockInput.value !== '' ? parseInt(minStockInput.value) : null,
        maxStock:      maxStockInput.value !== '' ? parseInt(maxStockInput.value) : null,
        minTotalValue: parseFloat(minTotalValueInput.value) || 0,
        sortByPrice:   (modal.querySelector('input[name="inv-sort-price"]:checked') || {}).value || 'none',
        productLimit:  parseInt(productLimitInput.value) || 0
      };
      const result = calculateMatchingCount(testConfig);
      if (result.afterLimit !== result.filtered) {
        matchCountSpan.innerHTML = `${result.afterLimit} productos <span class="text-xs font-normal text-emerald-700">(de ${result.filtered} que cumplen filtros)</span>`;
      } else {
        matchCountSpan.textContent = `${result.afterLimit} productos`;
      }
    }

    minPriceInput.addEventListener('input', updateMatchMeter);
    minStockInput.addEventListener('input', updateMatchMeter);
    maxStockInput.addEventListener('input', updateMatchMeter);
    minTotalValueInput.addEventListener('input', updateMatchMeter);
    productLimitInput.addEventListener('input', updateMatchMeter);
    sortPriceRadios.forEach(r => r.addEventListener('change', updateMatchMeter));

    selectAllBtn.addEventListener('click', () => {
      const allChecked = Array.from(depositCheckboxes).every(cb => cb.checked);
      depositCheckboxes.forEach(cb => cb.checked = !allChecked);
      selectAllBtn.textContent = allChecked ? 'Seleccionar Todos' : 'Deseleccionar Todos';
    });

    modal.querySelector('#save-inv-filter-btn').addEventListener('click', async () => {
      const saveBtn = modal.querySelector('#save-inv-filter-btn');
      saveBtn.disabled = true;
      saveBtn.innerHTML = '<span class="loading-spinner"></span> Guardando en Supabase...';

      const selectedDeposits = Array.from(depositCheckboxes)
        .filter(cb => cb.checked)
        .map(cb => cb.value);

      const selectedSort = (modal.querySelector('input[name="inv-sort-price"]:checked') || {}).value || 'none';
      const productLimit = parseInt(productLimitInput.value) || 0;

      const newConfig = {
        active: activeToggle.checked,
        minPrice: parseFloat(minPriceInput.value) || 0,
        maxPrice: null,
        minStock: minStockInput.value !== '' ? parseInt(minStockInput.value) : 1,
        maxStock: maxStockInput.value !== '' ? parseInt(maxStockInput.value) : null,
        minTotalValue: parseFloat(minTotalValueInput.value) || 0,
        sortByPrice: selectedSort,
        productLimit: productLimit,
        deposits: selectedDeposits.length > 0 ? selectedDeposits : allDeposits
      };

      const result = await saveInventoryFilterConfig(newConfig);

      if (result.success) {
        const sortLabels = { none: 'Sin orden', desc: '⬆️ Mayor a Menor', asc: '⬇️ Menor a Mayor' };
        let msg = `✅ Configuración guardada exitosamente.\n\n` +
          `• Filtro Restrictivo: ${newConfig.active ? 'ACTIVADO' : 'DESACTIVADO'}\n` +
          `• Precio G.Mayor Mínimo: $${newConfig.minPrice}\n` +
          `• Valor Total Mínimo (Cant × Precio): $${newConfig.minTotalValue}\n` +
          `• Stock Mínimo: ${newConfig.minStock}\n` +
          `• Ordenar por Precio: ${sortLabels[newConfig.sortByPrice] || 'Sin orden'}\n` +
          `• Límite de Productos: ${newConfig.productLimit > 0 ? `${newConfig.productLimit} productos` : 'Sin límite'}\n` +
          `• Depósitos: ${newConfig.deposits.join(', ')}`;
        
        if (result.cloudSaved) {
          msg += `\n\n☁️ Sincronizado en Supabase: Todos los dispositivos recibirán estos filtros.`;
        } else {
          msg += `\n\n⚠️ Guardado en este equipo. (Nota: Para sincronizar entre todos los dispositivos, asegúrate de ejecutar el script SQL en Supabase).`;
        }
        alert(msg);
        modal.remove();

        if (window.renderDepartments) window.renderDepartments();
        if (window.filterByDepartment && window.currentDepartment) {
          window.filterByDepartment(window.currentDepartment);
        }
      } else {
        alert('⚠️ Aviso: ' + (result.error || 'No se pudo guardar'));
        modal.remove();
        if (window.renderDepartments) window.renderDepartments();
      }
    });
  }

  // ============================================================
  // UI: BARRA FLOTANTE FIJA DE ACCESO RÁPIDO A LISTOS / ENVIAR
  // ============================================================
  function renderInventoryFloatingBar(currentDep, readyCount, totalPiezas) {
    if (window.currentUserRole !== 'inventario') {
      const existing = document.getElementById('inventory-floating-bottom-bar');
      if (existing) existing.remove();
      return;
    }

    let bar = document.getElementById('inventory-floating-bottom-bar');
    if (readyCount === 0 || currentDep === 'UNASSIGNED') {
      if (bar) bar.remove();
      return;
    }

    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'inventory-floating-bottom-bar';
      bar.className = 'fixed bottom-4 left-4 right-4 max-w-xl mx-auto z-40';
      document.body.appendChild(bar);
    }

    const isReadyView = currentActiveTab === 'ready';

    bar.innerHTML = `
      <div class="bg-gray-900/95 backdrop-blur-md text-white px-4 py-3 sm:px-5 sm:py-3.5 rounded-2xl shadow-2xl border border-emerald-500/60 flex flex-wrap items-center justify-between gap-3 animate-fade-in">
        <div class="flex items-center space-x-3">
          <div class="w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center text-xl font-black shadow-inner">
            ${isReadyView ? '📋' : '✅'}
          </div>
          <div>
            <p class="font-black text-xs sm:text-sm">
              Depósito ${currentDep}: <span class="text-emerald-400 font-mono">${readyCount} ${readyCount === 1 ? 'producto listo' : 'productos listos'}</span>
            </p>
            <p class="text-[11px] text-gray-300">${totalPiezas} piezas contadas en total</p>
          </div>
        </div>

        <div class="flex items-center gap-2">
          ${!isReadyView ? `
            <button onclick="window.SonimaxInventoryConteo.switchToReadyTab('${currentDep}')" class="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs rounded-xl shadow transition-all flex items-center space-x-1.5">
              <span>👀</span>
              <span>Ver Listos (${readyCount})</span>
            </button>
          ` : `
            <button onclick="window.SonimaxInventoryConteo.switchToPendingTab('${currentDep}')" class="px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white font-extrabold text-xs rounded-xl shadow transition-all flex items-center space-x-1.5">
              <span>📋</span>
              <span>Volver a Pendientes</span>
            </button>
          `}
          <button onclick="window.SonimaxInventoryConteo.openSubmitModal('${currentDep}')" class="px-4 py-2 bg-gradient-to-r from-teal-500 to-emerald-600 hover:from-teal-600 hover:to-emerald-700 text-white font-black text-xs rounded-xl shadow-lg shadow-emerald-500/30 transition-all flex items-center space-x-1.5">
            <span>📤</span>
            <span>Enviar del Día</span>
          </button>
        </div>
      </div>
    `;
  }

  // ============================================================
  // UI: BANNER Y CONTROL DE CONTEO EN CATÁLOGO (ROL INVENTARIO)
  // ============================================================

  /**
   * Inyecta o actualiza la barra de control de conteo de inventario arriba del grid de productos
   */
  function updateInventoryHeaderCounters() {
    if (window.currentUserRole !== 'inventario') return;

    let headerBar = document.getElementById('inventory-counting-control-bar');
    const mainGrid = document.getElementById('products-grid');
    if (!mainGrid) return;

    const currentDep = getCurrentDeposit();
    const isUnassigned = currentDep === 'UNASSIGNED';

    const readyProducts = getReadyProductsForDeposit(currentDep);
    const readyCount = readyProducts.length;
    const totalPiezas = readyProducts.reduce((acc, it) => acc + (parseInt(it.cantidad_fisica) || 0), 0);

    // Calcular cuántos pendientes hay
    const pendingList = getPendingProductsForDeposit(currentDep);
    const pendingCount = pendingList.length;
    const totalDeposit = pendingCount + readyCount;
    const percent = totalDeposit > 0 ? Math.round((readyCount / totalDeposit) * 100) : 0;

    // Actualizar barra flotante inferior fija
    renderInventoryFloatingBar(currentDep, readyCount, totalPiezas);

    if (!headerBar) {
      headerBar = document.createElement('div');
      headerBar.id = 'inventory-counting-control-bar';
      headerBar.className = 'container mx-auto px-4 mb-4';
      mainGrid.parentElement.insertBefore(headerBar, mainGrid);
    }

    if (isUnassigned) {
      headerBar.innerHTML = `
        <div class="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 flex flex-col sm:flex-row justify-between items-center gap-3">
          <div class="flex items-center space-x-3 text-center sm:text-left">
            <span class="text-2xl">⚠️</span>
            <div>
              <h4 class="font-bold text-amber-900 dark:text-amber-200 text-sm">Productos por Asignar a Depósito</h4>
              <p class="text-xs text-amber-700 dark:text-amber-400">Asigna estos productos a un depósito para poder iniciar su conteo.</p>
            </div>
          </div>
          <span class="text-xs font-bold px-3 py-1.5 bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100 rounded-xl">${pendingCount} pendientes</span>
        </div>
      `;
      return;
    }

    let filterDescParts = [];
    if (currentFilterConfig.active) {
      if (currentFilterConfig.minPrice > 0) filterDescParts.push(`G.Mayor ≥ $${currentFilterConfig.minPrice}`);
      if (currentFilterConfig.minTotalValue > 0) filterDescParts.push(`Valor Tot ≥ $${currentFilterConfig.minTotalValue}`);
      if (currentFilterConfig.minStock !== null) filterDescParts.push(`Stock ≥ ${currentFilterConfig.minStock}`);
    }
    if (currentFilterConfig.sortByPrice === 'desc') filterDescParts.push(`Precio ↑ Mayor→Menor`);
    if (currentFilterConfig.sortByPrice === 'asc') filterDescParts.push(`Precio ↓ Menor→Mayor`);
    if (currentFilterConfig.productLimit > 0) filterDescParts.push(`Límite: ${currentFilterConfig.productLimit} productos`);
    const filterInfo = filterDescParts.length > 0
      ? `⚡ Filtro Admin: ${filterDescParts.join(' | ')}`
      : `📋 Todos los productos del depósito`;

    headerBar.innerHTML = `
      <div class="bg-white dark:bg-gray-800 rounded-3xl p-5 shadow-lg border border-gray-100 dark:border-gray-700 space-y-4">
        <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <div class="flex items-center space-x-2">
              <span class="text-xs font-mono px-3 py-1 bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 rounded-xl font-black">Depósito: ${currentDep}</span>
              <span class="text-xs text-gray-500 dark:text-gray-400 font-medium">${filterInfo}</span>
            </div>
            <h3 class="text-xl sm:text-2xl font-black text-gray-800 dark:text-white mt-1">Conteo Físico - Depósito ${currentDep}</h3>
          </div>

          <!-- Pestañas de Vista: Pendientes vs Listos -->
          <div class="flex flex-wrap items-center gap-2 self-stretch md:self-auto">
            <button id="btn-inv-subview-pending" class="flex-1 sm:flex-none px-5 py-2.5 rounded-2xl font-black text-xs sm:text-sm transition-all flex items-center justify-center space-x-2 ${currentActiveTab === 'pending' ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/25 ring-2 ring-blue-600' : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200'}">
              <span>📋 Pendientes</span>
              <span class="px-2 py-0.5 rounded-full text-xs ${currentActiveTab === 'pending' ? 'bg-white text-blue-600' : 'bg-gray-200 text-gray-700'}">${pendingCount}</span>
            </button>
            <button id="btn-inv-subview-ready" class="flex-1 sm:flex-none px-5 py-2.5 rounded-2xl font-black text-xs sm:text-sm transition-all flex items-center justify-center space-x-2 ${currentActiveTab === 'ready' ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/25 ring-2 ring-emerald-600' : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-100'}">
              <span>✅ Productos Listos</span>
              <span class="px-2 py-0.5 rounded-full text-xs font-extrabold ${currentActiveTab === 'ready' ? 'bg-white text-emerald-700' : 'bg-emerald-600 text-white'}">${readyCount}</span>
            </button>
            ${readyCount > 0 ? `
              <button id="btn-quick-submit-header" class="w-full sm:w-auto px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white font-black text-xs rounded-2xl shadow transition-all flex items-center justify-center space-x-1.5">
                <span>📤</span>
                <span>Enviar (${readyCount})</span>
              </button>
            ` : ''}
          </div>
        </div>

        <!-- Barra de Progreso -->
        <div class="space-y-1.5 pt-1 border-t border-gray-100 dark:border-gray-700/60">
          <div class="flex justify-between text-xs font-extrabold text-gray-500">
            <span>Progreso del Depósito</span>
            <span class="text-blue-600 dark:text-blue-400 font-mono">${readyCount} de ${totalDeposit} listos (${percent}%)</span>
          </div>
          <div class="w-full h-3 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden p-0.5">
            <div class="h-full bg-gradient-to-r from-blue-500 via-teal-500 to-emerald-500 transition-all duration-500 rounded-full" style="width: ${percent}%"></div>
          </div>
        </div>
      </div>
    `;

    document.getElementById('btn-inv-subview-pending')?.addEventListener('click', () => {
      currentActiveTab = 'pending';
      renderInventoryViews();
    });

    document.getElementById('btn-inv-subview-ready')?.addEventListener('click', () => {
      currentActiveTab = 'ready';
      renderInventoryViews();
    });

    document.getElementById('btn-quick-submit-header')?.addEventListener('click', () => {
      const readyItems = getReadyProductsForDeposit(currentDep);
      showSubmitConfirmationModal(currentDep, readyItems);
    });
  }

  /**
   * Renderiza la vista correspondiente (Pendientes o Productos Listos)
   */
  function renderInventoryViews() {
    const mainGrid = document.getElementById('products-grid');
    if (!mainGrid) return;

    let readyContainer = document.getElementById('inventory-ready-container');
    if (!readyContainer) {
      readyContainer = document.createElement('div');
      readyContainer.id = 'inventory-ready-container';
      readyContainer.className = 'container mx-auto px-4 py-4 space-y-4 hidden';
      mainGrid.parentElement.insertBefore(readyContainer, mainGrid.nextSibling);
    }

    const currentDep = getCurrentDeposit();
    updateInventoryHeaderCounters();

    const noProductsDiv = document.getElementById('no-products');

    if (currentActiveTab === 'ready' && currentDep !== 'UNASSIGNED') {
      mainGrid.classList.add('hidden');
      if (noProductsDiv) noProductsDiv.classList.add('hidden');
      readyContainer.classList.remove('hidden');
      renderReadySectionContent(readyContainer, currentDep);
    } else {
      readyContainer.classList.add('hidden');
      mainGrid.classList.remove('hidden');

      // Si estamos en un depósito específico y no quedan pendientes pero sí hay listos, cambiar a listos
      const pendingList = getPendingProductsForDeposit(currentDep);
      const readyList = getReadyProductsForDeposit(currentDep);

      if (currentDep !== 'UNASSIGNED' && pendingList.length === 0) {
        if (noProductsDiv) noProductsDiv.classList.add('hidden');
        if (readyList.length > 0) {
          // Cambiar automáticamente a la vista de Listos para que vean sus conteos y puedan enviar
          currentActiveTab = 'ready';
          mainGrid.classList.add('hidden');
          readyContainer.classList.remove('hidden');
          renderReadySectionContent(readyContainer, currentDep);
          return;
        } else {
          mainGrid.innerHTML = `
            <div class="col-span-full bg-white dark:bg-gray-800 rounded-3xl p-10 text-center shadow border border-gray-100 dark:border-gray-700 space-y-3">
              <p class="text-3xl">📦</p>
              <h4 class="text-lg font-bold text-gray-800 dark:text-white">No hay productos en Depósito ${currentDep} con los filtros actuales</h4>
              <p class="text-xs text-gray-500 max-w-sm mx-auto">
                Revisa los filtros fijados por el Administrador o asigna productos desde <strong>"⚠️ Por Asignar"</strong>.
              </p>
            </div>
          `;
        }
      }
    }
  }

  /**
   * Renderiza el contenido del apartado "Productos Listos - Depósito [X]"
   */
  function renderReadySectionContent(container, deposito) {
    const readyItems = getReadyProductsForDeposit(deposito);
    const totalPiezas = readyItems.reduce((acc, it) => acc + (parseInt(it.cantidad_fisica) || 0), 0);
    const totalGMayor = readyItems.reduce((acc, it) => acc + (parseFloat(it.subtotal_gmayor) || 0), 0);

    if (readyItems.length === 0) {
      container.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-3xl p-10 text-center shadow-xl border border-gray-100 dark:border-gray-700 space-y-4">
          <div class="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-3xl mx-auto">
            📦
          </div>
          <h3 class="text-xl font-bold text-gray-800 dark:text-white">Aún no hay productos en "Listos" para Depósito ${deposito}</h3>
          <p class="text-sm text-gray-500 max-w-md mx-auto">
            Ingresa a la pestaña <strong>"📋 Pendientes"</strong>, coloca la cantidad física que contaste y presiona <strong>"✅ Marcar Listo"</strong> para trasladar los productos aquí.
          </p>
          <button id="go-back-to-pending-btn" class="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl transition-all shadow-md">
            Ir a Productos Pendientes
          </button>
        </div>
      `;
      container.querySelector('#go-back-to-pending-btn')?.addEventListener('click', () => {
        currentActiveTab = 'pending';
        renderInventoryViews();
      });
      return;
    }

    container.innerHTML = `
      <div class="space-y-4 animate-fade-in">
        <!-- Resumen de Totales y Botón de Enviar Cantidades del Día -->
        <div class="bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 rounded-3xl p-6 text-white shadow-2xl flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div class="space-y-2">
            <div class="flex items-center space-x-2">
              <span class="px-3 py-1 bg-white/20 rounded-full text-xs font-bold uppercase tracking-wider">Apartado de Conteo Listo</span>
              <button id="return-to-pending-top-btn" class="text-xs bg-white/10 hover:bg-white/30 px-3 py-1 rounded-full font-bold transition-colors">
                ⬅ Volver a Pendientes
              </button>
            </div>
            <h2 class="text-2xl sm:text-3xl font-black">Productos Listos - Depósito ${deposito}</h2>
            <div class="flex flex-wrap items-center gap-4 text-sm font-semibold text-emerald-100 pt-1">
              <span>📋 <strong>${readyItems.length}</strong> productos</span>
              <span>•</span>
              <span>🔢 <strong>${totalPiezas}</strong> piezas contadas</span>
              <span>•</span>
              <span>💵 <strong>$${totalGMayor.toFixed(2)}</strong> valor G.Mayor</span>
            </div>
          </div>

          <!-- Botón de Envío de Jornada / Pedido de Inventario -->
          <button id="btn-submit-day-inventory" class="w-full md:w-auto px-8 py-4 bg-white text-emerald-800 hover:bg-emerald-50 rounded-2xl font-black text-base shadow-2xl transition-all transform active:scale-95 flex items-center justify-center space-x-3">
            <span class="text-2xl">📤</span>
            <div class="text-left">
              <span class="block text-xs uppercase tracking-wider text-emerald-600 font-extrabold">Finalizar Conteo</span>
              <span class="block text-base leading-tight">Enviar Cantidades del Día</span>
            </div>
          </button>
        </div>

        <!-- Tabla / Lista de Productos Listos -->
        <div class="bg-white dark:bg-gray-800 rounded-3xl shadow-lg border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div class="p-4 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-800/80">
            <h3 class="font-bold text-gray-800 dark:text-white text-base">Detalle de Productos Verificados (${readyItems.length})</h3>
            <span class="text-xs text-gray-500">Puedes desbloquear para corregir antes del envío</span>
          </div>

          <div class="divide-y divide-gray-100 dark:divide-gray-700" id="ready-items-list-container">
            ${readyItems.map(item => {
              const diff = item.diferencia || 0;
              let diffBadge = '';
              if (diff === 0) {
                diffBadge = '<span class="text-xs font-bold px-2.5 py-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300 rounded-lg">✓ Exacto (0)</span>';
              } else if (diff < 0) {
                diffBadge = `<span class="text-xs font-bold px-2.5 py-1 bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-300 rounded-lg">⚠️ Faltan ${Math.abs(diff)}</span>`;
              } else {
                diffBadge = `<span class="text-xs font-bold px-2.5 py-1 bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-300 rounded-lg">➕ Sobran ${diff}</span>`;
              }

              return `
                <div class="p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors" data-code="${item.codigo}">
                  <div class="flex items-center space-x-3 flex-1 min-w-0">
                    <div class="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-lg font-bold text-gray-400 flex-shrink-0">
                      📦
                    </div>
                    <div class="min-w-0">
                      <p class="font-bold text-gray-800 dark:text-white text-sm truncate">${item.descripcion}</p>
                      <div class="flex flex-wrap items-center gap-2 text-xs text-gray-500 pt-0.5">
                        <span class="font-mono font-semibold text-gray-700 dark:text-gray-300">${item.codigo}</span>
                        <span>•</span>
                        <span>Stock Sist: <strong>${item.stock_sistema}</strong></span>
                        <span>•</span>
                        <span>G.Mayor: <strong>$${item.precio_gmayor.toFixed(2)}</strong></span>
                        <span>•</span>
                        <span>Hora: ${item.hora || ''}</span>
                      </div>
                    </div>
                  </div>

                  <div class="flex items-center space-x-3 self-end sm:self-center">
                    <div class="text-right">
                      <div class="flex items-center justify-end space-x-2">
                        <span class="text-xs text-gray-400 uppercase font-bold">Físico:</span>
                        <span class="text-xl font-black text-emerald-600 dark:text-emerald-400 font-mono">${item.cantidad_fisica}</span>
                      </div>
                      <div class="pt-0.5">${diffBadge}</div>
                    </div>

                    <!-- Botones de Acción para el Producto Listo -->
                    <div class="flex items-center space-x-1 pl-2 border-l border-gray-200 dark:border-gray-700">
                      <button class="btn-edit-ready p-2 rounded-xl text-blue-600 hover:bg-blue-50 dark:hover:bg-gray-700 transition-colors" title="Modificar cantidad" data-code="${item.codigo}" data-qty="${item.cantidad_fisica}">
                        ✏️
                      </button>
                      <button class="btn-return-pending p-2 rounded-xl text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-gray-700 transition-colors" title="Regresar a Pendientes" data-code="${item.codigo}">
                        ↩️
                      </button>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      </div>
    `;

    container.querySelector('#return-to-pending-top-btn')?.addEventListener('click', () => {
      currentActiveTab = 'pending';
      renderInventoryViews();
    });

    container.querySelector('#btn-submit-day-inventory')?.addEventListener('click', () => {
      showSubmitConfirmationModal(deposito, readyItems);
    });

    container.querySelectorAll('.btn-edit-ready').forEach(btn => {
      btn.addEventListener('click', async () => {
        const code = btn.dataset.code;
        const currentQ = btn.dataset.qty;
        const newQtyStr = prompt(`Ingresa la nueva cantidad física para ${code}:`, currentQ);
        if (newQtyStr !== null && newQtyStr.trim() !== '') {
          const val = parseInt(newQtyStr);
          if (!isNaN(val) && val >= 0) {
            await markProductAsReady(code, val, deposito);
            renderInventoryViews();
          } else {
            alert('Por favor ingresa un número válido.');
          }
        }
      });
    });

    container.querySelectorAll('.btn-return-pending').forEach(btn => {
      btn.addEventListener('click', () => {
        const code = btn.dataset.code;
        if (confirm(`¿Regresar el producto ${code} a la lista de pendientes?`)) {
          unmarkProductReady(code, deposito);
        }
      });
    });
  }

  /**
   * Modal de confirmación para el envío final de jornada
   */
  function showSubmitConfirmationModal(deposito, readyItems) {
    const existing = document.getElementById('submit-inventory-modal');
    if (existing) existing.remove();

    const currentUser = window.currentUser || {};
    const userName = currentUser.name || 'Personal de Inventario';
    const userRole = window.currentUserRole || 'inventario';
    const totalPiezas = readyItems.reduce((acc, it) => acc + (parseInt(it.cantidad_fisica) || 0), 0);
    const totalValor = readyItems.reduce((acc, it) => acc + (parseFloat(it.subtotal_gmayor) || 0), 0);

    const modal = document.createElement('div');
    modal.id = 'submit-inventory-modal';
    modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4';
    modal.innerHTML = `
      <div class="bg-white dark:bg-gray-800 rounded-3xl max-w-lg w-full shadow-2xl overflow-hidden animate-fade-in border border-gray-100 dark:border-gray-700">
        <div class="bg-gradient-to-r from-emerald-600 to-teal-700 p-6 text-white text-center">
          <div class="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center text-3xl mx-auto mb-3 shadow-inner">
            📤
          </div>
          <h3 class="text-2xl font-black">Enviar Cantidades del Día</h3>
          <p class="text-xs text-emerald-100">Se registrará como un pedido oficial de inventario</p>
        </div>

        <div class="p-6 space-y-4">
          <div class="bg-gray-50 dark:bg-gray-700/50 p-4 rounded-2xl space-y-2 border border-gray-100 dark:border-gray-700">
            <div class="flex justify-between text-sm">
              <span class="text-gray-500 font-medium">Inventarista:</span>
              <span class="font-bold text-gray-800 dark:text-white">${userName} (${userRole})</span>
            </div>
            <div class="flex justify-between text-sm">
              <span class="text-gray-500 font-medium">Depósito:</span>
              <span class="font-bold text-blue-600 dark:text-blue-400">Depósito ${deposito}</span>
            </div>
            <div class="flex justify-between text-sm">
              <span class="text-gray-500 font-medium">Productos contados:</span>
              <span class="font-bold text-gray-800 dark:text-white">${readyItems.length} ítems</span>
            </div>
            <div class="flex justify-between text-sm">
              <span class="text-gray-500 font-medium">Total unidades contadas:</span>
              <span class="font-bold text-emerald-600 dark:text-emerald-400 text-base">${totalPiezas} piezas</span>
            </div>
            <div class="flex justify-between text-sm">
              <span class="text-gray-500 font-medium">Valor total a G.Mayor:</span>
              <span class="font-bold text-gray-800 dark:text-white">$${totalValor.toFixed(2)}</span>
            </div>
          </div>

          <div>
            <label class="block text-xs font-bold text-gray-600 dark:text-gray-300 mb-1">Notas u observaciones de la jornada (Opcional):</label>
            <textarea id="session-notes-input" placeholder="Ej. Conteo completado sin novedades en pasillo 1 y 2..." rows="2" class="w-full p-3 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-sm outline-none focus:border-emerald-500"></textarea>
          </div>

          <div class="p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-xl text-[11px] text-amber-800 dark:text-amber-300">
            ⚠️ Al confirmar, las cantidades se guardarán en la base de datos de administración y se reiniciará la lista de listos de este depósito para una nueva jornada.
          </div>
        </div>

        <div class="p-6 bg-gray-50 dark:bg-gray-900 border-t border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row gap-3">
          <button id="confirm-submit-session-btn" class="flex-1 py-3.5 bg-gradient-to-r from-emerald-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white font-bold rounded-2xl transition-all shadow-lg shadow-emerald-500/25 flex items-center justify-center space-x-2">
            <span>✅</span>
            <span>Confirmar y Enviar</span>
          </button>
          <button class="modal-close-btn px-6 py-3.5 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-bold rounded-2xl hover:bg-gray-300 transition-colors">
            Cancelar
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelectorAll('.modal-close-btn').forEach(b => b.addEventListener('click', () => modal.remove()));

    modal.querySelector('#confirm-submit-session-btn').addEventListener('click', async () => {
      const btn = modal.querySelector('#confirm-submit-session-btn');
      btn.disabled = true;
      btn.innerHTML = '<span class="loading-spinner"></span> Registrando pedido...';

      const notas = modal.querySelector('#session-notes-input').value;
      const res = await submitInventorySession(deposito, notas);

      modal.remove();

      if (res.success) {
        showSuccessModal(res.folio, deposito, totalPiezas, res.sessionData);
      } else {
        alert('Error al enviar cantidades: ' + (res.message || ''));
      }
    });
  }

  function showSuccessModal(folio, deposito, totalPiezas, sessionData) {
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4';
    modal.innerHTML = `
      <div class="bg-white dark:bg-gray-800 rounded-3xl max-w-md w-full shadow-2xl p-6 text-center space-y-4 animate-fade-in border border-emerald-500/30">
        <div class="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center text-4xl mx-auto shadow-inner">
          🎉
        </div>
        <h3 class="text-2xl font-black text-gray-800 dark:text-white">¡Conteo Registrado Exitosamente!</h3>
        <p class="text-sm text-gray-500">
          Se guardó el pedido de inventario para <strong>Depósito ${deposito}</strong> con un total de <strong>${totalPiezas} piezas</strong>.
        </p>
        <div class="p-3 bg-gray-50 dark:bg-gray-700 rounded-xl font-mono text-xs font-bold text-gray-700 dark:text-gray-300">
          Folio: ${folio}
        </div>
        <div class="flex flex-col gap-2 pt-2">
          <button id="download-session-excel-btn" class="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl transition-all shadow flex items-center justify-center space-x-2">
            <span>📥</span>
            <span>Descargar Comprobante en Excel</span>
          </button>
          <button id="close-success-btn" class="w-full py-3 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-bold rounded-xl hover:bg-gray-200 transition-colors">
            Aceptar y Continuar
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector('#close-success-btn').addEventListener('click', () => modal.remove());
    modal.querySelector('#download-session-excel-btn').addEventListener('click', () => {
      exportSingleSessionExcel(sessionData);
      modal.remove();
    });
  }

  // ============================================================
  // ADMIN: PANEL DE AUDITORÍA Y HISTORIAL DE CONTEOS
  // ============================================================

  async function fetchAllInventorySessions() {
    let cloudSessions = [];
    const localSessions = getLocalSessionsBackup();
    const clients = getActiveSupabaseClients();

    for (const client of clients) {
      try {
        const { data, error } = await client
          .from('inventory_count_sessions')
          .select('*')
          .order('created_at', { ascending: false });

        if (!error && data && data.length > 0) {
          cloudSessions = cloudSessions.concat(data);
        }
      } catch (err) {
        console.warn('[INV-AUDIT] Aviso cargando sesiones de Supabase:', err);
      }
    }

    const combinedMap = new Map();
    localSessions.forEach(s => { if (s.folio) combinedMap.set(s.folio, s); });
    cloudSessions.forEach(s => { if (s.folio) combinedMap.set(s.folio, s); });

    cachedSessions = Array.from(combinedMap.values());
    cachedSessions.sort((a, b) => new Date(b.created_at || b.fecha) - new Date(a.created_at || a.fecha));
    return cachedSessions;
  }

  async function showInventoryAuditModal() {
    const existing = document.getElementById('inventory-audit-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'inventory-audit-modal';
    modal.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4';
    modal.innerHTML = `
      <div class="bg-white dark:bg-gray-900 rounded-3xl max-w-6xl w-full h-[90vh] shadow-2xl overflow-hidden flex flex-col border border-gray-100 dark:border-gray-800">
        <!-- Encabezado -->
        <div class="bg-gradient-to-r from-teal-700 via-emerald-700 to-teal-800 p-5 sm:p-6 text-white flex justify-between items-center flex-shrink-0">
          <div class="flex items-center space-x-3">
            <div class="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center text-2xl shadow-inner">
              📋
            </div>
            <div>
              <h2 class="text-xl sm:text-2xl font-black">Auditoría de Conteos y Pedidos de Inventario</h2>
              <p class="text-xs text-teal-100">Filtra por día, fecha, mes, depósito y usuario. Descarga en Excel.</p>
            </div>
          </div>
          <div class="flex items-center space-x-2">
            <button id="export-all-audit-excel-btn" class="px-4 py-2 bg-white text-teal-800 hover:bg-teal-50 rounded-xl font-bold text-xs sm:text-sm shadow transition-all flex items-center space-x-1.5">
              <span>📥</span>
              <span>Exportar Excel</span>
            </button>
            <button class="modal-close-btn text-white/80 hover:text-white hover:bg-white/20 rounded-xl p-2 transition-colors">✕</button>
          </div>
        </div>

        <!-- Barra de Filtros Multifunción -->
        <div class="p-4 sm:p-5 bg-gray-50 dark:bg-gray-800/80 border-b border-gray-200 dark:border-gray-700 flex-shrink-0 space-y-3">
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div>
              <label class="block text-[11px] font-bold text-gray-500 uppercase mb-1">Fecha Desde:</label>
              <input type="date" id="audit-filter-date-from" class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl text-xs font-semibold">
            </div>

            <div>
              <label class="block text-[11px] font-bold text-gray-500 uppercase mb-1">Fecha Hasta:</label>
              <input type="date" id="audit-filter-date-to" class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl text-xs font-semibold">
            </div>

            <div>
              <label class="block text-[11px] font-bold text-gray-500 uppercase mb-1">Depósito:</label>
              <select id="audit-filter-deposit" class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl text-xs font-bold text-gray-700 dark:text-gray-200">
                <option value="ALL">Todos los Depósitos</option>
                <option value="A">Depósito A</option>
                <option value="B">Depósito B</option>
                <option value="C">Depósito C</option>
                <option value="D">Depósito D</option>
                <option value="E">Depósito E</option>
                <option value="PLANTA BAJA">Planta Baja</option>
                <option value="PISO VENTA">Piso Venta</option>
              </select>
            </div>

            <div>
              <label class="block text-[11px] font-bold text-gray-500 uppercase mb-1">Usuario / Inventarista:</label>
              <select id="audit-filter-user" class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl text-xs font-bold text-gray-700 dark:text-gray-200">
                <option value="ALL">Todos los Usuarios</option>
              </select>
            </div>

            <div>
              <label class="block text-[11px] font-bold text-gray-500 uppercase mb-1">Buscar (Folio / Producto):</label>
              <input type="text" id="audit-filter-search" placeholder="🔍 Código, nombre, folio..." class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-xl text-xs">
            </div>
          </div>

          <!-- Botones Rápidos de Fecha -->
          <div class="flex flex-wrap items-center gap-2 pt-1 text-xs">
            <span class="text-gray-400 font-bold uppercase text-[10px]">Rango rápido:</span>
            <button class="quick-date-btn px-2.5 py-1 bg-white dark:bg-gray-700 rounded-lg border text-gray-600 dark:text-gray-300 hover:bg-teal-50 font-semibold" data-range="today">Hoy</button>
            <button class="quick-date-btn px-2.5 py-1 bg-white dark:bg-gray-700 rounded-lg border text-gray-600 dark:text-gray-300 hover:bg-teal-50 font-semibold" data-range="yesterday">Ayer</button>
            <button class="quick-date-btn px-2.5 py-1 bg-white dark:bg-gray-700 rounded-lg border text-gray-600 dark:text-gray-300 hover:bg-teal-50 font-semibold" data-range="week">Esta Semana</button>
            <button class="quick-date-btn px-2.5 py-1 bg-white dark:bg-gray-700 rounded-lg border text-gray-600 dark:text-gray-300 hover:bg-teal-50 font-semibold" data-range="month">Este Mes</button>
            <button class="quick-date-btn px-2.5 py-1 bg-white dark:bg-gray-700 rounded-lg border text-gray-600 dark:text-gray-300 hover:bg-teal-50 font-semibold" data-range="all">Histórico Completo</button>
          </div>
        </div>

        <!-- Tarjetas de Métricas Resumen -->
        <div class="px-5 py-3 bg-white dark:bg-gray-900 grid grid-cols-2 sm:grid-cols-4 gap-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0" id="audit-kpis-container">
          <div class="p-3 bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 rounded-xl">
            <p class="text-[10px] font-bold text-teal-700 dark:text-teal-400 uppercase">Sesiones / Pedidos</p>
            <p class="text-xl font-black text-teal-900 dark:text-teal-200" id="kpi-sessions-count">0</p>
          </div>
          <div class="p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl">
            <p class="text-[10px] font-bold text-blue-700 dark:text-blue-400 uppercase">Piezas Físicas Contadas</p>
            <p class="text-xl font-black text-blue-900 dark:text-blue-200" id="kpi-pieces-count">0</p>
          </div>
          <div class="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl">
            <p class="text-[10px] font-bold text-amber-700 dark:text-amber-400 uppercase">Balance Diferencias</p>
            <p class="text-xl font-black text-amber-900 dark:text-amber-200" id="kpi-diff-count">0</p>
          </div>
          <div class="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-xl">
            <p class="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 uppercase">Total Valor G.Mayor</p>
            <p class="text-xl font-black text-emerald-900 dark:text-emerald-200" id="kpi-value-count">$0.00</p>
          </div>
        </div>

        <!-- Listado de Sesiones con Scroll -->
        <div class="flex-1 overflow-y-auto p-4 sm:p-6" id="audit-sessions-table-container">
          <div class="text-center py-12"><div class="loading-spinner mx-auto"></div><p class="text-xs text-gray-500 mt-2">Cargando registros...</p></div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelectorAll('.modal-close-btn').forEach(b => b.addEventListener('click', () => modal.remove()));

    const allSessions = await fetchAllInventorySessions();

    const userSelect = modal.querySelector('#audit-filter-user');
    const uniqueUsers = Array.from(new Set(allSessions.map(s => s.user_name || s.user_username).filter(Boolean)));
    uniqueUsers.forEach(u => {
      const opt = document.createElement('option');
      opt.value = u;
      opt.textContent = u;
      userSelect.appendChild(opt);
    });

    const dateFromInput = modal.querySelector('#audit-filter-date-from');
    const dateToInput = modal.querySelector('#audit-filter-date-to');
    const depositSelect = modal.querySelector('#audit-filter-deposit');
    const searchInput = modal.querySelector('#audit-filter-search');

    function applyAuditFilters() {
      const dateFrom = dateFromInput.value;
      const dateTo = dateToInput.value;
      const selectedDep = depositSelect.value;
      const selectedUser = userSelect.value;
      const query = (searchInput.value || '').toLowerCase().trim();

      const filtered = allSessions.filter(s => {
        const sFecha = (s.fecha || (s.created_at ? s.created_at.split('T')[0] : ''));
        if (dateFrom && sFecha < dateFrom) return false;
        if (dateTo && sFecha > dateTo) return false;
        if (selectedDep !== 'ALL' && s.deposito !== selectedDep) return false;
        if (selectedUser !== 'ALL') {
          const userName = s.user_name || s.user_username || '';
          if (userName !== selectedUser) return false;
        }
        if (query) {
          const inFolio = (s.folio || '').toLowerCase().includes(query);
          const inUser = (s.user_name || '').toLowerCase().includes(query) || (s.user_username || '').toLowerCase().includes(query);
          const inNotes = (s.notas || '').toLowerCase().includes(query);
          const inItems = (s.items || []).some(it =>
            (it.codigo || '').toLowerCase().includes(query) ||
            (it.descripcion || '').toLowerCase().includes(query)
          );
          if (!inFolio && !inUser && !inNotes && !inItems) return false;
        }
        return true;
      });

      renderAuditSessionsTable(filtered);
    }

    modal.querySelectorAll('.quick-date-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const range = btn.dataset.range;
        const today = new Date();
        const formatDate = (d) => d.toISOString().split('T')[0];

        if (range === 'today') {
          dateFromInput.value = formatDate(today);
          dateToInput.value = formatDate(today);
        } else if (range === 'yesterday') {
          const yest = new Date(today);
          yest.setDate(yest.getDate() - 1);
          dateFromInput.value = formatDate(yest);
          dateToInput.value = formatDate(yest);
        } else if (range === 'week') {
          const start = new Date(today);
          start.setDate(today.getDate() - 7);
          dateFromInput.value = formatDate(start);
          dateToInput.value = formatDate(today);
        } else if (range === 'month') {
          const start = new Date(today.getFullYear(), today.getMonth(), 1);
          dateFromInput.value = formatDate(start);
          dateToInput.value = formatDate(today);
        } else if (range === 'all') {
          dateFromInput.value = '';
          dateToInput.value = '';
        }
        applyAuditFilters();
      });
    });

    dateFromInput.addEventListener('change', applyAuditFilters);
    dateToInput.addEventListener('change', applyAuditFilters);
    depositSelect.addEventListener('change', applyAuditFilters);
    userSelect.addEventListener('change', applyAuditFilters);
    searchInput.addEventListener('input', applyAuditFilters);

    modal.querySelector('#export-all-audit-excel-btn').addEventListener('click', () => {
      const dateFrom = dateFromInput.value;
      const dateTo = dateToInput.value;
      const selectedDep = depositSelect.value;
      const selectedUser = userSelect.value;
      const query = (searchInput.value || '').toLowerCase().trim();

      const filtered = allSessions.filter(s => {
        const sFecha = (s.fecha || (s.created_at ? s.created_at.split('T')[0] : ''));
        if (dateFrom && sFecha < dateFrom) return false;
        if (dateTo && sFecha > dateTo) return false;
        if (selectedDep !== 'ALL' && s.deposito !== selectedDep) return false;
        if (selectedUser !== 'ALL' && (s.user_name || s.user_username) !== selectedUser) return false;
        if (query) {
          const inFolio = (s.folio || '').toLowerCase().includes(query);
          const inUser = (s.user_name || '').toLowerCase().includes(query);
          const inItems = (s.items || []).some(it => (it.codigo || '').toLowerCase().includes(query) || (it.descripcion || '').toLowerCase().includes(query));
          if (!inFolio && !inUser && !inItems) return false;
        }
        return true;
      });

      exportMultipleSessionsExcel(filtered);
    });

    applyAuditFilters();
  }

  function renderAuditSessionsTable(sessions) {
    const container = document.getElementById('audit-sessions-table-container');
    if (!container) return;

    const totalSessions = sessions.length;
    const totalPieces = sessions.reduce((acc, s) => acc + (parseInt(s.total_piezas) || 0), 0);
    const totalDiff = sessions.reduce((acc, s) => acc + (parseInt(s.diferencia_total) || 0), 0);
    const totalVal = sessions.reduce((acc, s) => acc + (parseFloat(s.total_valor_gmayor) || 0), 0);

    const kpiSessions = document.getElementById('kpi-sessions-count');
    const kpiPieces = document.getElementById('kpi-pieces-count');
    const kpiDiff = document.getElementById('kpi-diff-count');
    const kpiVal = document.getElementById('kpi-value-count');

    if (kpiSessions) kpiSessions.textContent = totalSessions;
    if (kpiPieces) kpiPieces.textContent = totalPieces;
    if (kpiDiff) kpiDiff.textContent = (totalDiff > 0 ? `+${totalDiff}` : totalDiff);
    if (kpiVal) kpiVal.textContent = `$${totalVal.toFixed(2)}`;

    if (sessions.length === 0) {
      container.innerHTML = `
        <div class="text-center py-16 text-gray-500 space-y-2">
          <p class="text-4xl">🔍</p>
          <p class="font-bold text-base">No se encontraron sesiones de conteo con esos filtros</p>
          <p class="text-xs">Prueba seleccionando otro rango de fechas o depósito.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div class="space-y-3">
        ${sessions.map(s => {
          const diff = s.diferencia_total || 0;
          let diffClass = 'bg-gray-100 text-gray-700';
          if (diff < 0) diffClass = 'bg-red-100 text-red-800';
          if (diff > 0) diffClass = 'bg-blue-100 text-blue-800';
          if (diff === 0) diffClass = 'bg-emerald-100 text-emerald-800';

          return `
            <div class="bg-white dark:bg-gray-800 rounded-2xl p-4 border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-all flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div class="space-y-1 flex-1">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-mono font-bold text-xs bg-gray-100 dark:bg-gray-700 px-2.5 py-1 rounded-lg text-gray-800 dark:text-gray-200">${s.folio}</span>
                  <span class="font-bold text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 px-2.5 py-1 rounded-lg">Dep: ${s.deposito}</span>
                  <span class="text-xs text-gray-500">📅 ${s.fecha || ''} ${s.hora ? `• ⏰ ${s.hora}` : ''}</span>
                </div>
                <div class="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  <span>👤 Realizado por: <strong>${s.user_name || 'Desconocido'}</strong> (@${s.user_username || 'inventario'})</span>
                </div>
                ${s.notas ? `<p class="text-xs text-gray-500 italic">💬 "${s.notas}"</p>` : ''}
              </div>

              <!-- Resumen Numérico -->
              <div class="flex flex-wrap items-center gap-4 self-stretch md:self-auto justify-between md:justify-end border-t md:border-t-0 pt-3 md:pt-0 border-gray-100 dark:border-gray-700">
                <div class="text-center md:text-right">
                  <span class="text-[10px] text-gray-400 font-bold uppercase block">Ítems / Piezas</span>
                  <span class="text-sm font-black text-gray-800 dark:text-white">${s.total_items} ítems / ${s.total_piezas} pzs</span>
                </div>

                <div class="text-center md:text-right">
                  <span class="text-[10px] text-gray-400 font-bold uppercase block">Diferencia</span>
                  <span class="text-xs font-bold px-2 py-0.5 rounded-md ${diffClass}">${diff > 0 ? `+${diff}` : diff} pzs</span>
                </div>

                <div class="text-center md:text-right">
                  <span class="text-[10px] text-gray-400 font-bold uppercase block">Total G.Mayor</span>
                  <span class="text-sm font-black text-emerald-600 dark:text-emerald-400 font-mono">$${(parseFloat(s.total_valor_gmayor) || 0).toFixed(2)}</span>
                </div>

                <!-- Botones de Acción -->
                <div class="flex items-center space-x-2">
                  <button class="btn-view-session-detail px-3 py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 rounded-xl font-bold text-xs transition-colors flex items-center space-x-1" data-folio="${s.folio}">
                    <span>👁️</span>
                    <span>Ver Detalle</span>
                  </button>
                  <button class="btn-export-session-excel p-2 bg-gray-100 text-gray-700 hover:bg-emerald-50 hover:text-emerald-700 dark:bg-gray-700 dark:text-gray-200 rounded-xl transition-colors" title="Exportar esta sesión a Excel" data-folio="${s.folio}">
                    📥
                  </button>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    container.querySelectorAll('.btn-view-session-detail').forEach(btn => {
      btn.addEventListener('click', () => {
        const folio = btn.dataset.folio;
        const session = sessions.find(s => s.folio === folio);
        if (session) showSessionDetailModal(session);
      });
    });

    container.querySelectorAll('.btn-export-session-excel').forEach(btn => {
      btn.addEventListener('click', () => {
        const folio = btn.dataset.folio;
        const session = sessions.find(s => s.folio === folio);
        if (session) exportSingleSessionExcel(session);
      });
    });
  }

  function showSessionDetailModal(session) {
    const existing = document.getElementById('session-detail-modal');
    if (existing) existing.remove();

    const items = session.items || [];

    const modal = document.createElement('div');
    modal.id = 'session-detail-modal';
    modal.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-2 sm:p-4';
    modal.innerHTML = `
      <div class="bg-white dark:bg-gray-900 rounded-3xl max-w-4xl w-full h-[85vh] shadow-2xl overflow-hidden flex flex-col border border-gray-200 dark:border-gray-700">
        <div class="p-5 bg-gradient-to-r from-gray-900 to-gray-800 text-white flex justify-between items-center">
          <div>
            <div class="flex items-center space-x-2">
              <span class="text-xs bg-blue-600 px-2.5 py-0.5 rounded-full font-bold">Depósito ${session.deposito}</span>
              <span class="font-mono text-xs text-gray-400 font-bold">${session.folio}</span>
            </div>
            <h3 class="text-xl font-black mt-1">Detalle de Conteo - ${session.user_name}</h3>
            <p class="text-xs text-gray-400">${session.fecha} ${session.hora || ''}</p>
          </div>
          <div class="flex items-center space-x-2">
            <button id="export-this-modal-excel-btn" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow transition-colors flex items-center space-x-1">
              <span>📥</span>
              <span>Exportar Excel</span>
            </button>
            <button class="modal-close-btn text-white/80 hover:text-white p-2 text-xl font-bold">✕</button>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto p-4 sm:p-6">
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs border-collapse">
              <thead>
                <tr class="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-bold uppercase border-b border-gray-200 dark:border-gray-700">
                  <th class="p-3">Código</th>
                  <th class="p-3">Descripción</th>
                  <th class="p-3 text-center">Stock Sist.</th>
                  <th class="p-3 text-center">Conteo Físico</th>
                  <th class="p-3 text-center">Diferencia</th>
                  <th class="p-3 text-right">Precio G.Mayor</th>
                  <th class="p-3 text-right">Total $</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
                ${items.map(it => {
                  const diff = it.diferencia || 0;
                  let diffColor = 'text-gray-700';
                  if (diff < 0) diffColor = 'text-red-600 font-bold';
                  if (diff > 0) diffColor = 'text-blue-600 font-bold';
                  if (diff === 0) diffColor = 'text-emerald-600 font-bold';

                  return `
                    <tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td class="p-3 font-mono font-bold text-gray-800 dark:text-gray-200">${it.codigo}</td>
                      <td class="p-3 font-medium text-gray-700 dark:text-gray-300 max-w-xs truncate">${it.descripcion}</td>
                      <td class="p-3 text-center font-bold text-gray-500">${it.stock_sistema || 0}</td>
                      <td class="p-3 text-center font-bold text-blue-600 text-sm">${it.cantidad_fisica || 0}</td>
                      <td class="p-3 text-center ${diffColor}">${diff > 0 ? `+${diff}` : diff}</td>
                      <td class="p-3 text-right font-mono">$${(parseFloat(it.precio_gmayor) || 0).toFixed(2)}</td>
                      <td class="p-3 text-right font-mono font-bold text-emerald-600">$${(parseFloat(it.subtotal_gmayor) || 0).toFixed(2)}</td>
                    </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelectorAll('.modal-close-btn').forEach(b => b.addEventListener('click', () => modal.remove()));
    modal.querySelector('#export-this-modal-excel-btn').addEventListener('click', () => {
      exportSingleSessionExcel(session);
    });
  }

  // ============================================================
  // EXPORTACIÓN A EXCEL (SHEETJS / XLSX)
  // ============================================================

  function exportSingleSessionExcel(session) {
    if (!window.XLSX) {
      alert('Error: Librería de Excel no cargada.');
      return;
    }

    const items = session.items || [];
    const rows = items.map(it => {
      const diff = it.diferencia || 0;
      let estadoDiff = 'EXACTO';
      if (diff < 0) estadoDiff = `FALTANTE (${Math.abs(diff)})`;
      if (diff > 0) estadoDiff = `SOBRANTE (+${diff})`;

      return {
        'Folio': session.folio,
        'Fecha': session.fecha,
        'Hora': session.hora || '',
        'Usuario': session.user_name,
        'Username': session.user_username,
        'Depósito': session.deposito,
        'Código Producto': it.codigo,
        'Descripción': it.descripcion,
        'Stock Sistema': it.stock_sistema || 0,
        'Conteo Físico': it.cantidad_fisica || 0,
        'Diferencia': diff,
        'Estado': estadoDiff,
        'Precio G.Mayor ($)': parseFloat(it.precio_gmayor) || 0,
        'Total Valor ($)': parseFloat(it.subtotal_gmayor) || 0
      };
    });

    const ws = window.XLSX.utils.json_to_sheet(rows);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, "Conteo Físico");

    const fileName = `Conteo_${session.deposito}_${session.folio}.xlsx`;
    window.XLSX.writeFile(wb, fileName);
  }

  function exportMultipleSessionsExcel(sessions) {
    if (!window.XLSX) {
      alert('Error: Librería de Excel no cargada.');
      return;
    }

    if (!sessions || sessions.length === 0) {
      alert('No hay datos filtrados para exportar.');
      return;
    }

    const detailedRows = [];
    const summaryRows = [];

    sessions.forEach(s => {
      summaryRows.push({
        'Folio': s.folio,
        'Fecha': s.fecha,
        'Hora': s.hora || '',
        'Usuario': s.user_name,
        'Username': s.user_username,
        'Depósito': s.deposito,
        'Total Ítems': s.total_items,
        'Total Piezas': s.total_piezas,
        'Diferencia Total': s.diferencia_total,
        'Total Valor G.Mayor ($)': parseFloat(s.total_valor_gmayor) || 0,
        'Notas': s.notas || ''
      });

      (s.items || []).forEach(it => {
        const diff = it.diferencia || 0;
        let estadoDiff = 'EXACTO';
        if (diff < 0) estadoDiff = `FALTANTE (${Math.abs(diff)})`;
        if (diff > 0) estadoDiff = `SOBRANTE (+${diff})`;

        detailedRows.push({
          'Folio': s.folio,
          'Fecha': s.fecha,
          'Hora': s.hora || '',
          'Usuario': s.user_name,
          'Username': s.user_username,
          'Depósito': s.deposito,
          'Código': it.codigo,
          'Descripción': it.descripcion,
          'Stock Sistema': it.stock_sistema || 0,
          'Conteo Físico': it.cantidad_fisica || 0,
          'Diferencia': diff,
          'Estado Diferencia': estadoDiff,
          'Precio G.Mayor ($)': parseFloat(it.precio_gmayor) || 0,
          'Total Valor ($)': parseFloat(it.subtotal_gmayor) || 0
        });
      });
    });

    const wb = window.XLSX.utils.book_new();

    const wsDetailed = window.XLSX.utils.json_to_sheet(detailedRows);
    window.XLSX.utils.book_append_sheet(wb, wsDetailed, "Detalle Productos");

    const wsSummary = window.XLSX.utils.json_to_sheet(summaryRows);
    window.XLSX.utils.book_append_sheet(wb, wsSummary, "Resumen Sesiones");

    const nowStr = new Date().toISOString().split('T')[0];
    const fileName = `Reporte_Auditoria_Inventario_${nowStr}.xlsx`;
    window.XLSX.writeFile(wb, fileName);
  }

  // ============================================================
  // MÉTODOS PÚBLICOS DE NAVEGACIÓN
  // ============================================================
  function switchToReadyTab(dep) {
    if (dep) {
      window.currentDepartment = `inv_${dep}`;
      document.querySelectorAll('.dept-button, .sidebar-dept-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.dept === `inv_${dep}`) {
          btn.classList.add('active');
        }
      });
    }
    currentActiveTab = 'ready';
    renderInventoryViews();
  }

  function switchToPendingTab(dep) {
    if (dep) {
      window.currentDepartment = `inv_${dep}`;
      document.querySelectorAll('.dept-button, .sidebar-dept-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.dept === `inv_${dep}`) {
          btn.classList.add('active');
        }
      });
    }
    currentActiveTab = 'pending';
    renderInventoryViews();
  }

  // ============================================================
  // EXPONER MÓDULO GLOBALMENTE
  // ============================================================
  window.SonimaxInventoryConteo = {
    loadConfig: loadInventoryFilterConfig,
    saveConfig: saveInventoryFilterConfig,
    getConfig: () => currentFilterConfig,
    isEligible: isProductEligibleForInventory,
    getCurrentDeposit: getCurrentDeposit,
    getReadyProducts: getReadyProductsForDeposit,
    getPendingProducts: getPendingProductsForDeposit,
    markAsReady: markProductAsReady,
    unmarkReady: unmarkProductReady,
    showFilterModal: showInventoryFilterModal,
    showAuditModal: showInventoryAuditModal,
    updateHeaderCounters: updateInventoryHeaderCounters,
    renderViews: renderInventoryViews,
    submitSession: submitInventorySession,
    switchToReadyTab: switchToReadyTab,
    switchToPendingTab: switchToPendingTab,
    openSubmitModal: (dep) => {
      const currentDep = (dep || getCurrentDeposit()).trim().toUpperCase();
      const readyItems = getReadyProductsForDeposit(currentDep);
      showSubmitConfirmationModal(currentDep, readyItems);
    }
  };

  // Carga inicial de configuración
  document.addEventListener('DOMContentLoaded', () => {
    loadInventoryFilterConfig();
  });

})();
