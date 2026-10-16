/**
 * SONIMAX MÓVIL - Módulo de Impresión de Precios / Etiquetas Estilo Valery
 * Adaptado para impresora térmica de 80mm con corte fácil
 * - Sin líneas negras a los lados ni bordes externos
 * - 58mm y Peq pegados a la izquierda del rollo de 80mm para recortar fácilmente
 * - Precios exclusivamente DETAL en divisas (REF) sin L... ni moneda local
 * - Código propio del producto
 * - Gestión de Listas Guardadas con nombre editable
 * - Búsqueda con Foto de producto (Global y por Departamento)
 * - Impresión de listas completas e individuales con selector de impresora nativo
 * Compatible con roles Gestor y Admin
 */

(function () {
  'use strict';

  // ============================================================
  // CONSTANTES Y CLAVES DE ALMACENAMIENTO
  // ============================================================
  const STORAGE_LISTS_KEY = 'valery_saved_lists_v2';
  const STORAGE_ACTIVE_LIST_ID = 'valery_active_list_id';
  const STORAGE_FORMAT_KEY = 'valery_print_format';

  const DEFAULT_PLACEHOLDER_IMG = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'><rect width='100%' height='100%' fill='%23f1f5f9'/><path d='M28 34a6 6 0 100-12 6 6 0 000 12zm34 22H18l11-15 8 10 11-13 14 18z' fill='%23cbd5e1'/></svg>";

  // ============================================================
  // ESTADO GLOBAL DEL MÓDULO
  // ============================================================
  let currentFormat = localStorage.getItem(STORAGE_FORMAT_KEY) || '58mm'; // '58mm', '80mm', 'peq'
  let savedLists = [];
  let activeListId = null;
  let selectedDepartment = 'all';
  let globalSearchQuery = '';
  let deptSearchQuery = '';
  let selectedProductIds = new Set();
  let currentPreviewIndex = 0;
  let currentProductPage = 1;
  const PRODUCTS_PER_PAGE = 100;

  // Helper para fecha en formato DD/MM/YYYY
  function getTodayFormatted() {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    return `${day}/${month}/${year}`;
  }

  let labelDate = getTodayFormatted();

  // Helper para formatear número en divisas con coma decimal (ej: 62,77)
  function formatPriceNumber(num) {
    if (num === null || num === undefined || isNaN(num)) return '0,00';
    return Number(num).toFixed(2).replace('.', ',');
  }

  // El precio a imprimir SIEMPRE es DETAL (precio_cliente) en divisas
  function getProductDetalPrice(product) {
    if (!product) return 0;
    return parseFloat(product.precio_cliente || 0);
  }

  // ============================================================
  // GESTIÓN DE LISTAS GUARDADAS (LOCALSTORAGE)
  // ============================================================

  function loadSavedLists() {
    try {
      const raw = localStorage.getItem(STORAGE_LISTS_KEY);
      if (raw) {
        savedLists = JSON.parse(raw);
      }
    } catch (e) {
      console.warn('[VALERY] Error cargando listas guardadas:', e);
      savedLists = [];
    }

    if (!Array.isArray(savedLists) || savedLists.length === 0) {
      const defaultList = {
        id: 'list_' + Date.now(),
        name: 'Lista Principal',
        createdAt: new Date().toISOString(),
        items: []
      };
      savedLists = [defaultList];
      activeListId = defaultList.id;
      saveListsToStorage();
    } else {
      activeListId = localStorage.getItem(STORAGE_ACTIVE_LIST_ID) || savedLists[0].id;
      if (!savedLists.some(l => l.id === activeListId)) {
        activeListId = savedLists[0].id;
      }
    }
  }

  function saveListsToStorage() {
    try {
      localStorage.setItem(STORAGE_LISTS_KEY, JSON.stringify(savedLists));
      if (activeListId) {
        localStorage.setItem(STORAGE_ACTIVE_LIST_ID, activeListId);
      }
    } catch (e) {
      console.warn('[VALERY] Error guardando listas:', e);
    }
  }

  function getActiveList() {
    return savedLists.find(l => l.id === activeListId) || savedLists[0];
  }

  function createNewList(name) {
    const listName = (name || '').trim() || `Lista ${savedLists.length + 1}`;
    const newList = {
      id: 'list_' + Date.now(),
      name: listName,
      createdAt: new Date().toISOString(),
      items: []
    };
    savedLists.push(newList);
    activeListId = newList.id;
    saveListsToStorage();
    renderListsDropdown();
    renderQueueList();
    updateLivePreview();
  }

  function renameActiveList(newName) {
    const list = getActiveList();
    if (!list) return;
    const cleanName = (newName || '').trim();
    if (cleanName) {
      list.name = cleanName;
      saveListsToStorage();
      renderListsDropdown();
    }
  }

  function deleteActiveList() {
    if (savedLists.length <= 1) {
      alert('Debes conservar al menos una lista.');
      return;
    }
    const list = getActiveList();
    if (!confirm(`¿Eliminar la lista "${list.name}" y sus productos?`)) return;

    savedLists = savedLists.filter(l => l.id !== list.id);
    activeListId = savedLists[0].id;
    saveListsToStorage();
    renderListsDropdown();
    renderQueueList();
    renderAvailableProducts();
    updateLivePreview();
  }

  // ============================================================
  // OBTENER PRODUCTOS DEL CATÁLOGO
  // ============================================================
  function getAllProducts() {
    if (window.allProducts && Array.isArray(window.allProducts) && window.allProducts.length > 0) {
      return window.allProducts;
    }
    try {
      const cached = localStorage.getItem('sonimax_all_products');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    return [];
  }

  function getDepartments() {
    const products = getAllProducts();
    const depts = new Set();
    products.forEach((p) => {
      if (p.departamento && p.departamento.trim()) {
        depts.add(p.departamento.trim());
      }
    });
    return Array.from(depts).sort((a, b) => a.localeCompare(b));
  }

  // ============================================================
  // GENERADORES HTML DE ETIQUETAS (SIN BORDES NEGROS EXTERNOS, SIN L...)
  // ============================================================

  /**
   * FORMATO 1: 58mm
   * Código centrado arriba, nombre centrado, fecha a la derecha,
   * REF: [Precio], y línea horizontal debajo.
   * CERO bordes a los lados, CERO parte inferior de L...
   */
  function renderLabel58mm(product, options = {}) {
    const date = options.date || labelDate;
    const priceVal = getProductDetalPrice(product);
    const priceFormatted = formatPriceNumber(priceVal);
    const code = (product.codigo || 'SIN-CÓDIGO').trim();
    const name = (product.nombre || product.descripcion || '').toUpperCase();

    return `
      <div class="valery-label-card valery-format-58mm">
        <div class="v-code-58">${code}</div>
        <div class="v-name-58">${name}</div>
        <div class="v-date-58">${date}</div>
        <div class="v-price-row-58">
          <span class="v-ref-tag-58">REF:</span>
          <span class="v-ref-price-58">${priceFormatted}</span>
        </div>
        <div class="v-divider-line-58"></div>
      </div>
    `;
  }

  /**
   * FORMATO 2: Pequeño (Peq)
   * Compacto a la izquierda, código, nombre, fecha, REF: [Precio],
   * y línea horizontal debajo. CERO bordes laterales.
   */
  function renderLabelPeq(product, options = {}) {
    const date = options.date || labelDate;
    const priceVal = getProductDetalPrice(product);
    const priceFormatted = formatPriceNumber(priceVal);
    const code = (product.codigo || 'SIN-CÓDIGO').trim();
    const name = (product.nombre || product.descripcion || '').toUpperCase();

    return `
      <div class="valery-label-card valery-format-peq">
        <div class="v-peq-content-box">
          <div class="v-code-peq">${code}</div>
          <div class="v-name-peq">${name}</div>
          <div class="v-date-peq">${date}</div>
          <div class="v-price-row-peq">
            <span class="v-ref-tag-peq">REF:</span>
            <span class="v-ref-price-peq">${priceFormatted}</span>
          </div>
          <div class="v-divider-line-peq"></div>
        </div>
      </div>
    `;
  }

  /**
   * FORMATO 3: 80mm
   * Formato de ancho completo para rollo de 80mm:
   * Código centrado, nombre centrado, fecha a la derecha,
   * y PRECIO GIGANTE CENTRADO (sin REF, sin línea). CERO bordes laterales.
   */
  function renderLabel80mm(product, options = {}) {
    const date = options.date || labelDate;
    const priceVal = getProductDetalPrice(product);
    const priceFormatted = formatPriceNumber(priceVal);
    const code = (product.codigo || 'SIN-CÓDIGO').trim();
    const name = (product.nombre || product.descripcion || '').toUpperCase();

    return `
      <div class="valery-label-card valery-format-80mm">
        <div class="v-code-80">${code}</div>
        <div class="v-name-80">${name}</div>
        <div class="v-date-80">${date}</div>
        <div class="v-huge-price-80">${priceFormatted}</div>
      </div>
    `;
  }

  function renderLabelHTML(product, format = currentFormat, options = {}) {
    if (!product) return '';
    if (format === '80mm') return renderLabel80mm(product, options);
    if (format === 'peq') return renderLabelPeq(product, options);
    return renderLabel58mm(product, options);
  }

  // ============================================================
  // INYECCIÓN DE ESTILOS CSS (UI Y @media print)
  // ============================================================
  function injectStyles() {
    if (document.getElementById('valery-prices-styles')) return;

    const styleEl = document.createElement('style');
    styleEl.id = 'valery-prices-styles';
    styleEl.textContent = `
      #valery-prices-modal {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      }

      /* ============================================================
         DISEÑO DE LAS ETIQUETAS (CERO BORDES NEGROS EXTERNOS)
         ============================================================ */
      .valery-label-card {
        background: #ffffff !important;
        color: #000000 !important;
        border: none !important; /* CERO LÍNEAS NEGRAS ALREDEDOR */
        box-sizing: border-box !important;
        font-family: Arial, Helvetica, "Segoe UI", sans-serif !important;
        position: relative !important;
        user-select: none;
      }

      /* Simulador del rollo térmico de 80mm en la pantalla */
      .valery-roll-simulator {
        width: 320px;
        background: #ffffff;
        border: 1px dashed #94a3b8;
        border-radius: 4px;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
        padding: 2px 8px 6px 8px; /* Mínimo espacio superior */
        position: relative;
        overflow: hidden;
      }

      /* Línea guía que muestra la zona de recorte en 80mm */
      .valery-cut-guide {
        position: absolute;
        top: 0;
        bottom: 0;
        border-right: 1px dashed #cbd5e1;
        pointer-events: none;
      }
      .valery-cut-guide-label {
        position: absolute;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        font-size: 10px;
        color: #94a3b8;
        font-weight: 700;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        pointer-events: none;
      }

      /* ---------------- Formato 58mm (Pegado a la izquierda, Cero espacio arriba) ---------------- */
      .valery-format-58mm {
        width: 220px;
        margin-left: 0;
        margin-right: auto;
        padding: 0 6px 6px 0; /* Cero espacio superior */
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        border: none !important;
      }
      .valery-format-58mm .v-code-58 {
        font-size: 17px;
        font-weight: 900;
        text-align: center;
        letter-spacing: 0.5px;
        color: #000;
        margin: 0 0 2px 0;
        padding: 0;
        line-height: 1.0;
      }
      .valery-format-58mm .v-name-58 {
        font-size: 12.5px;
        font-weight: 700;
        text-align: center;
        text-transform: uppercase;
        line-height: 1.15;
        color: #000;
        margin-bottom: 2px;
        word-break: break-word;
        max-height: 38px;
        overflow: hidden;
      }
      .valery-format-58mm .v-date-58 {
        font-size: 11px;
        font-weight: 600;
        text-align: right;
        color: #000;
        margin-bottom: 1px;
        line-height: 1;
      }
      .valery-format-58mm .v-price-row-58 {
        display: flex;
        align-items: baseline;
        justify-content: flex-start;
        gap: 5px;
        line-height: 1;
        margin-bottom: 1px;
      }
      .valery-format-58mm .v-ref-tag-58 {
        font-size: 19px;
        font-weight: 900;
        color: #000;
        letter-spacing: -0.5px;
      }
      .valery-format-58mm .v-ref-price-58 {
        font-size: 42px;
        font-weight: 900;
        font-style: italic;
        color: #000;
        letter-spacing: -1px;
        line-height: 0.88;
      }
      .valery-format-58mm .v-divider-line-58 {
        width: 100%;
        border-bottom: 2px solid #000;
        margin-top: 2px;
      }

      /* ---------------- Formato Peq (Reducido más, Código Centrado, Cero espacio arriba) ---------------- */
      .valery-format-peq {
        width: 135px; /* Reducido a ultra compacto */
        margin-left: 0;
        margin-right: auto;
        padding: 0 4px 4px 0; /* Cero espacio superior */
        border: none !important;
      }
      .valery-format-peq .v-peq-content-box {
        width: 100%;
      }
      .valery-format-peq .v-code-peq {
        font-size: 11.5px;
        font-weight: 900;
        text-align: center; /* CENTRADO A PETICIÓN */
        color: #000;
        margin: 0 0 2px 0;
        padding: 0;
        line-height: 1.0;
      }
      .valery-format-peq .v-name-peq {
        font-size: 9.5px;
        font-weight: 700;
        text-align: left;
        text-transform: uppercase;
        line-height: 1.1;
        color: #000;
        margin-bottom: 2px;
        word-break: break-word;
        max-height: 30px;
        overflow: hidden;
      }
      .valery-format-peq .v-date-peq {
        font-size: 8.5px;
        font-weight: 600;
        text-align: right;
        color: #000;
        margin-bottom: 1px;
        line-height: 1;
      }
      .valery-format-peq .v-price-row-peq {
        display: flex;
        align-items: baseline;
        gap: 3px;
        line-height: 1;
      }
      .valery-format-peq .v-ref-tag-peq {
        font-size: 12px;
        font-weight: 900;
        color: #000;
      }
      .valery-format-peq .v-ref-price-peq {
        font-size: 20px;
        font-weight: 900;
        font-style: italic;
        color: #000;
        line-height: 0.9;
        letter-spacing: -0.5px;
      }
      .valery-format-peq .v-divider-line-peq {
        width: 100%;
        border-bottom: 2px solid #000;
        margin-top: 1px;
      }

      /* ---------------- Formato 80mm (Ancho completo, Cero espacio arriba) ---------------- */
      .valery-format-80mm {
        width: 100%;
        max-width: 310px;
        padding: 0 8px 8px 0; /* Cero espacio superior */
        display: flex;
        flex-direction: column;
        justify-content: flex-start;
        border: none !important;
      }
      .valery-format-80mm .v-code-80 {
        font-size: 20px;
        font-weight: 900;
        text-align: center;
        letter-spacing: 0.5px;
        color: #000;
        margin: 0 0 3px 0;
        padding: 0;
        line-height: 1.0;
      }
      .valery-format-80mm .v-name-80 {
        font-size: 14px;
        font-weight: 700;
        text-align: center;
        text-transform: uppercase;
        line-height: 1.18;
        color: #000;
        margin-bottom: 4px;
        word-break: break-word;
        max-height: 40px;
        overflow: hidden;
      }
      .valery-format-80mm .v-date-80 {
        font-size: 12px;
        font-weight: 700;
        text-align: right;
        color: #000;
        margin-bottom: 2px;
        line-height: 1;
      }
      .valery-format-80mm .v-huge-price-80 {
        font-size: 56px;
        font-weight: 900;
        font-style: italic;
        text-align: center;
        color: #000;
        line-height: 0.9;
        letter-spacing: -1.5px;
        margin-top: 3px;
      }

      /* ============================================================
         ESTILOS DE IMPRESIÓN (@media print) PARA IMPRESORA DE 80MM
         - Sin bordes externos negros
         - 58mm y Peq pegados a la izquierda para recorte fácil del sobrante
         - Sin desperdicio de espacio arriba (inicio inmediato de etiqueta)
         ============================================================ */
      @media print {
        * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }

        body > *:not(#valery-print-container) {
          display: none !important;
        }

        @page {
          margin: 0mm !important;
        }

        html, body {
          margin: 0 !important;
          padding: 0 !important;
          background: #ffffff !important;
          width: 80mm !important;
        }

        #valery-print-container {
          display: block !important;
          position: absolute !important;
          left: 0 !important;
          top: 0 !important;
          width: 80mm !important;
          max-width: 80mm !important;
          margin: 0 !important;
          padding: 0 !important;
          background: #ffffff !important;
        }

        .valery-print-page-item {
          display: block !important;
          page-break-inside: avoid !important;
          break-inside: avoid !important;
          page-break-after: always !important;
          break-after: page !important;
          margin: 0 0 1.5mm 0 !important;
          padding: 0 !important;
          position: relative !important;
          width: 80mm !important;
          text-align: left !important;
        }

        .valery-label-card {
          border: none !important;
          outline: none !important;
          box-shadow: none !important;
          width: 100% !important;
          max-width: 100% !important;
          margin: 0 !important;
          padding: 0 !important;
        }

        /* ---------------- Formato 58mm en rollo de 80mm (Pegado a la izquierda) ---------------- */
        .valery-print-format-58mm {
          width: 52mm !important;
          max-width: 52mm !important;
          margin-left: 0 !important;
          margin-right: auto !important;
          padding: 0 1mm 2mm 0 !important; /* CERO ESPACIO ARRIBA */
          border: none !important;
        }
        .valery-print-format-58mm .v-code-58 { font-size: 13pt !important; font-weight: 900 !important; text-align: center !important; margin: 0 0 1pt 0 !important; padding: 0 !important; line-height: 1 !important; }
        .valery-print-format-58mm .v-name-58 { font-size: 9pt !important; font-weight: 700 !important; line-height: 1.15 !important; text-align: center !important; margin: 0 0 1.5pt 0 !important; }
        .valery-print-format-58mm .v-date-58 { font-size: 7.5pt !important; text-align: right !important; margin: 0 0 1pt 0 !important; line-height: 1 !important; }
        .valery-print-format-58mm .v-price-row-58 { display: flex !important; align-items: baseline !important; gap: 4px !important; margin: 0 !important; }
        .valery-print-format-58mm .v-ref-tag-58 { font-size: 13.5pt !important; font-weight: 900 !important; line-height: 1 !important; }
        .valery-print-format-58mm .v-ref-price-58 { font-size: 28pt !important; font-weight: 900 !important; font-style: italic !important; line-height: 0.9 !important; }
        .valery-print-format-58mm .v-divider-line-58 { border-bottom: 1.8pt solid #000 !important; width: 100% !important; margin-top: 1.5pt !important; }

        /* ---------------- Formato Peq en rollo de 80mm (Más pequeño y Código Centrado) ---------------- */
        .valery-print-format-peq {
          width: 35mm !important; /* REDUCIDO A 35mm */
          max-width: 35mm !important;
          margin-left: 0 !important;
          margin-right: auto !important;
          padding: 0 0.8mm 1.5mm 0 !important; /* CERO ESPACIO ARRIBA */
          border: none !important;
        }
        .valery-print-format-peq .v-code-peq { font-size: 8pt !important; font-weight: 900 !important; text-align: center !important; margin: 0 0 1pt 0 !important; padding: 0 !important; line-height: 1 !important; }
        .valery-print-format-peq .v-name-peq { font-size: 6.8pt !important; font-weight: 700 !important; line-height: 1.1 !important; text-align: left !important; margin: 0 0 1pt 0 !important; }
        .valery-print-format-peq .v-date-peq { font-size: 6pt !important; text-align: right !important; margin: 0 !important; line-height: 1 !important; }
        .valery-print-format-peq .v-price-row-peq { display: flex !important; align-items: baseline !important; gap: 2.5px !important; margin: 0 !important; }
        .valery-print-format-peq .v-ref-tag-peq { font-size: 8.5pt !important; font-weight: 900 !important; line-height: 1 !important; }
        .valery-print-format-peq .v-ref-price-peq { font-size: 15.5pt !important; font-weight: 900 !important; font-style: italic !important; line-height: 0.88 !important; }
        .valery-print-format-peq .v-divider-line-peq { border-bottom: 1.5pt solid #000 !important; width: 100% !important; margin-top: 1pt !important; }

        /* ---------------- Formato 80mm en rollo de 80mm (Ancho completo) ---------------- */
        .valery-print-format-80mm {
          width: 75mm !important;
          max-width: 75mm !important;
          margin-left: 0 !important;
          margin-right: auto !important;
          padding: 0 1.5mm 2.5mm 0 !important; /* CERO ESPACIO ARRIBA */
          border: none !important;
        }
        .valery-print-format-80mm .v-code-80 { font-size: 15pt !important; font-weight: 900 !important; text-align: center !important; margin: 0 0 2pt 0 !important; padding: 0 !important; line-height: 1 !important; }
        .valery-print-format-80mm .v-name-80 { font-size: 11pt !important; font-weight: 700 !important; line-height: 1.15 !important; text-align: center !important; margin: 0 0 2pt 0 !important; }
        .valery-print-format-80mm .v-date-80 { font-size: 8.5pt !important; text-align: right !important; margin: 0 0 1pt 0 !important; line-height: 1 !important; }
        .valery-print-format-80mm .v-huge-price-80 { font-size: 38pt !important; font-weight: 900 !important; font-style: italic !important; text-align: center !important; line-height: 0.9 !important; }
      }
    `;
    document.head.appendChild(styleEl);
  }

  // ============================================================
  // CONSTRUCCIÓN DEL MODAL PRINCIPAL
  // ============================================================
  function createModal() {
    if (document.getElementById('valery-prices-modal')) return;

    injectStyles();

    const modal = document.createElement('div');
    modal.id = 'valery-prices-modal';
    modal.className = 'hidden fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 overflow-y-auto';

    modal.innerHTML = `
      <div class="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl max-w-6xl w-full max-h-[96vh] flex flex-col overflow-hidden border border-gray-200 dark:border-gray-800 animate-fadeIn">
        
        <!-- HEADER DEL MODAL -->
        <div class="bg-gradient-to-r from-sky-600 via-blue-600 to-indigo-700 p-4 text-white flex items-center justify-between shadow-md flex-shrink-0">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur-md flex items-center justify-center text-2xl shadow-inner">
              🏷️
            </div>
            <div>
              <h2 class="text-lg sm:text-xl font-black leading-tight flex items-center gap-2">
                Sacar Precios (Estilo Valery)
                <span class="bg-emerald-500/30 text-emerald-100 text-xs px-2 py-0.5 rounded-full font-bold border border-emerald-400/30">Precio Detal en Divisas</span>
              </h2>
              <p class="text-xs text-sky-100">Adaptado para impresora de 80mm con recorte fácil a la izquierda · Sin bordes negros</p>
            </div>
          </div>
          <button id="valery-modal-close-btn" class="p-2 text-white/80 hover:text-white hover:bg-white/10 rounded-xl transition-all" title="Cerrar">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
            </svg>
          </button>
        </div>

        <!-- BARRA SUPERIOR: GESTIÓN DE LISTAS GUARDADAS & FORMATO -->
        <div class="bg-gray-50 dark:bg-gray-800/80 p-3 border-b border-gray-200 dark:border-gray-800 flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
          
          <!-- Selector y Gestión de Listas con Nombre -->
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-xs font-bold text-gray-700 dark:text-gray-300 flex items-center gap-1">
              <span>📋 Lista:</span>
            </span>
            <select id="valery-lists-select" class="px-3 py-1.5 text-xs sm:text-sm font-bold rounded-xl border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sky-500 shadow-sm min-w-[170px]">
              <!-- Opciones de listas -->
            </select>
            <button type="button" id="valery-create-list-btn" class="px-2.5 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-1" title="Crear una nueva lista con nombre">
              <span>➕ Nueva Lista</span>
            </button>
            <button type="button" id="valery-rename-list-btn" class="p-1.5 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-xl text-xs font-bold transition-all" title="Cambiar nombre a esta lista">
              ✏️
            </button>
            <button type="button" id="valery-delete-list-btn" class="p-1.5 bg-red-100 hover:bg-red-200 dark:bg-red-900/40 dark:hover:bg-red-900/60 text-red-600 dark:text-red-300 rounded-xl text-xs font-bold transition-all" title="Eliminar esta lista">
              🗑️
            </button>
          </div>

          <!-- Selector de Formato (58mm, 80mm, Peq) & Fecha -->
          <div class="flex items-center gap-3 flex-wrap">
            <div class="flex items-center gap-1 bg-white dark:bg-gray-800 p-1 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm">
              <span class="text-xs font-bold text-gray-500 dark:text-gray-400 px-2 hidden sm:inline">Formato:</span>
              <button type="button" data-valery-format="58mm" class="valery-format-btn px-3 py-1 rounded-xl text-xs font-bold transition-all ${currentFormat === '58mm' ? 'bg-sky-600 text-white shadow-md' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}">
                58 mm (Corte Izq)
              </button>
              <button type="button" data-valery-format="80mm" class="valery-format-btn px-3 py-1 rounded-xl text-xs font-bold transition-all ${currentFormat === '80mm' ? 'bg-sky-600 text-white shadow-md' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}">
                80 mm (Completo)
              </button>
              <button type="button" data-valery-format="peq" class="valery-format-btn px-3 py-1 rounded-xl text-xs font-bold transition-all ${currentFormat === 'peq' ? 'bg-sky-600 text-white shadow-md' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}">
                Peq (Corte Izq)
              </button>
            </div>

            <div class="flex items-center gap-1 bg-white dark:bg-gray-800 px-2.5 py-1 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
              <span class="text-xs font-bold text-gray-500 dark:text-gray-400">Fecha:</span>
              <input type="text" id="valery-date-input" value="${labelDate}" class="w-20 px-1 py-0.5 text-xs font-bold bg-transparent text-gray-800 dark:text-white border-b border-gray-300 focus:border-sky-500 focus:outline-none text-center">
            </div>
          </div>
        </div>

        <!-- CUERPO PRINCIPAL (2 COLUMNAS) -->
        <div class="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden">
          
          <!-- ========================================================
               COLUMNA IZQUIERDA: BUSCADORES (GLOBAL Y DEPARTAMENTO) CON FOTO
               ======================================================== -->
          <div class="lg:col-span-7 p-3 sm:p-4 border-r border-gray-200 dark:border-gray-800 flex flex-col overflow-hidden bg-white dark:bg-gray-900">
            
            <!-- 1. BUSCADOR GLOBAL -->
            <div class="mb-3">
              <div class="relative">
                <input type="text" id="valery-global-search-input" placeholder="🌐 Búsqueda global por nombre o código (Enter para añadir)..." 
                  class="w-full px-4 py-2.5 pl-10 text-xs sm:text-sm rounded-xl border-2 border-gray-200 dark:border-gray-700 dark:bg-gray-800 dark:text-white focus:outline-none focus:border-sky-500 transition-all shadow-sm">
                <svg class="w-4 h-4 text-gray-400 absolute left-3.5 top-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                </svg>
                <button id="valery-clear-global-search" class="hidden absolute right-3 top-2.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xs font-bold p-1">
                  ✕
                </button>
              </div>
            </div>

            <!-- 2. EXPLORADOR & BUSCADOR POR DEPARTAMENTO -->
            <div class="bg-sky-50/70 dark:bg-sky-950/30 border border-sky-100 dark:border-sky-900/40 rounded-2xl p-3 mb-3">
              <div class="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 mb-2">
                <div class="flex-1 flex items-center gap-2">
                  <label class="text-xs font-bold text-sky-900 dark:text-sky-300 whitespace-nowrap">Departamento:</label>
                  <select id="valery-dept-select" class="flex-1 px-3 py-1.5 text-xs sm:text-sm font-semibold rounded-xl border border-sky-200 dark:border-sky-800 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-sky-500">
                    <option value="all">📦 Todos los Departamentos</option>
                  </select>
                </div>

                <div class="flex items-center gap-1.5 flex-wrap">
                  <button type="button" id="valery-add-dept-to-queue-btn" class="px-2.5 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-1" title="Añade todos los productos de este departamento a la lista activa">
                    <span>➕ Añadir Todo Dept</span>
                  </button>
                  <button type="button" id="valery-direct-print-dept-btn" class="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-1" title="Imprimir todo el departamento">
                    <span>⚡ Imprimir Dept</span>
                  </button>
                </div>
              </div>

              <!-- Buscador dentro del departamento -->
              <div class="relative">
                <input type="text" id="valery-dept-search-input" placeholder="🔍 Filtrar dentro del departamento seleccionado..." 
                  class="w-full px-3 py-1.5 pl-8 text-xs rounded-lg border border-sky-200 dark:border-sky-800 dark:bg-gray-800 dark:text-white focus:outline-none focus:border-sky-500">
                <svg class="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                </svg>
              </div>

              <!-- Barra de selección múltiple -->
              <div class="mt-2.5 pt-2 border-t border-sky-200/60 dark:border-sky-900/40 flex items-center justify-between text-xs">
                <label class="flex items-center gap-2 cursor-pointer font-bold text-gray-700 dark:text-gray-300 select-none">
                  <input type="checkbox" id="valery-select-all-checkbox" class="w-4 h-4 rounded text-sky-600 focus:ring-sky-500 border-gray-300">
                  <span id="valery-select-all-label">Seleccionar Todos (<span id="valery-visible-count">0</span>)</span>
                </label>

                <button type="button" id="valery-add-selected-btn" class="hidden px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs shadow transition-all flex items-center gap-1">
                  <span>➕ Agregar a la Lista (<span id="valery-selected-badge">0</span>)</span>
                </button>
              </div>
            </div>

            <!-- Listado de Productos Disponibles CON FOTO -->
            <div id="valery-products-list" class="flex-1 overflow-y-auto pr-1 space-y-2 border border-gray-100 dark:border-gray-800 rounded-2xl p-2 bg-gray-50/50 dark:bg-gray-800/20">
              <!-- Renderizado dinámicamente con fotos -->
            </div>
          </div>

          <!-- ========================================================
               COLUMNA DERECHA: LISTA ACTIVA & PREVISUALIZADOR 1:1
               ======================================================== -->
          <div class="lg:col-span-5 p-3 sm:p-4 flex flex-col overflow-hidden bg-gray-50 dark:bg-gray-800/40">
            
            <!-- Resumen de la Lista Activa -->
            <div class="flex items-center justify-between mb-2 pb-2 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
              <div>
                <h3 class="text-sm font-black text-gray-800 dark:text-white flex items-center gap-2">
                  <span id="valery-active-list-title">Lista Principal</span>
                  <span id="valery-queue-badge" class="bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 text-xs px-2 py-0.5 rounded-full font-bold">0 etiquetas</span>
                </h3>
                <p class="text-[11px] text-gray-500 dark:text-gray-400">Edita las cantidades de cada producto o imprime directamente</p>
              </div>
              <button type="button" id="valery-clear-queue-btn" class="text-xs text-red-600 dark:text-red-400 hover:text-red-700 font-bold px-2 py-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 transition-all" title="Vaciar toda la lista activa">
                🗑️ Vaciar
              </button>
            </div>

            <!-- Items en la Lista Activa CON FOTO -->
            <div id="valery-queue-list" class="flex-1 overflow-y-auto pr-1 space-y-2 mb-3 max-h-[170px] sm:max-h-[220px] border border-gray-200 dark:border-gray-700 rounded-2xl p-2 bg-white dark:bg-gray-800 shadow-inner">
              <!-- Renderizado dinámicamente con fotos -->
            </div>

            <!-- Previsualizador con simulador de papel de 80mm -->
            <div class="bg-white dark:bg-gray-900 rounded-2xl p-3 border border-gray-200 dark:border-gray-700 shadow-sm flex-shrink-0 mb-3">
              <div class="flex items-center justify-between mb-2">
                <span class="text-xs font-bold text-gray-600 dark:text-gray-300 flex items-center gap-1.5">
                  <span>👁️ Vista en Rollo de 80mm</span>
                  <span id="valery-preview-format-tag" class="text-[10px] bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-gray-500 font-mono">58mm (Corte Izq)</span>
                </span>
                
                <!-- Paginador de previsualización -->
                <div id="valery-preview-nav" class="hidden items-center gap-1 text-xs">
                  <button type="button" id="valery-preview-prev-btn" class="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-gray-600 dark:text-gray-300 font-bold">◀</button>
                  <span id="valery-preview-counter" class="text-[11px] font-bold text-gray-500">1 / 1</span>
                  <button type="button" id="valery-preview-next-btn" class="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-gray-600 dark:text-gray-300 font-bold">▶</button>
                </div>
              </div>

              <!-- Contenedor centrado del rollo de 80mm -->
              <div class="flex items-center justify-center p-2 bg-gray-100 dark:bg-gray-950 rounded-xl overflow-x-auto min-h-[190px] border border-gray-200 dark:border-gray-800 shadow-inner">
                <div id="valery-label-live-preview">
                  <!-- Se inyecta aquí la etiqueta exacta en su rollo -->
                </div>
              </div>
            </div>

            <!-- Botones de Acción / Impresión -->
            <div class="flex flex-col gap-1.5 flex-shrink-0 pt-2 border-t border-gray-200 dark:border-gray-700">
              <button type="button" id="valery-print-now-btn" class="w-full py-3 px-4 bg-gradient-to-r from-emerald-600 via-green-600 to-teal-700 hover:from-emerald-700 hover:to-teal-800 text-white rounded-2xl font-black text-sm sm:text-base shadow-lg hover:shadow-green-500/30 flex items-center justify-center gap-2 transition-all transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed">
                <span class="text-lg">🖨️</span>
                <span>IMPRIMIR LISTA (<span id="valery-total-print-count">0</span>)</span>
              </button>
              <p class="text-[10px] text-center text-gray-400 dark:text-gray-500">
                Se abrirá el selector de tu PC. <span class="font-bold text-sky-600 dark:text-sky-400">Tip en red:</span> Si tu navegador da error, presiona <kbd class="px-1 py-0.5 bg-gray-200 dark:bg-gray-700 rounded font-mono text-[9px] text-gray-700 dark:text-gray-200">Ctrl + Mayús + P</kbd>
              </p>
            </div>

          </div>
        </div>

      </div>
    `;

    document.body.appendChild(modal);

    if (!document.getElementById('valery-print-container')) {
      const printBox = document.createElement('div');
      printBox.id = 'valery-print-container';
      printBox.style.display = 'none';
      document.body.appendChild(printBox);
    }

    setupModalEvents(modal);
  }

  // ============================================================
  // EVENTOS Y LÓGICA INTERACTIVA DEL MODAL
  // ============================================================
  function setupModalEvents(modal) {
    modal.querySelector('#valery-modal-close-btn')?.addEventListener('click', closeValeryPricesModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeValeryPricesModal();
    });

    modal.querySelectorAll('.valery-format-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const fmt = btn.getAttribute('data-valery-format');
        if (fmt) {
          setValeryFormat(fmt);
        }
      });
    });

    const listsSelect = modal.querySelector('#valery-lists-select');
    if (listsSelect) {
      listsSelect.addEventListener('change', () => {
        activeListId = listsSelect.value;
        saveListsToStorage();
        renderQueueList();
        renderAvailableProducts();
        updateLivePreview();
      });
    }

    modal.querySelector('#valery-create-list-btn')?.addEventListener('click', () => {
      const name = prompt('Ingresa el nombre para la nueva lista de etiquetas:', `Lista ${savedLists.length + 1}`);
      if (name !== null) {
        createNewList(name);
      }
    });

    modal.querySelector('#valery-rename-list-btn')?.addEventListener('click', () => {
      const list = getActiveList();
      const newName = prompt(`Cambiar nombre a la lista "${list.name}":`, list.name);
      if (newName !== null && newName.trim()) {
        renameActiveList(newName);
      }
    });

    modal.querySelector('#valery-delete-list-btn')?.addEventListener('click', deleteActiveList);

    const dateInput = modal.querySelector('#valery-date-input');
    if (dateInput) {
      dateInput.addEventListener('input', () => {
        labelDate = dateInput.value.trim() || getTodayFormatted();
        updateLivePreview();
      });
    }

    const globalInput = modal.querySelector('#valery-global-search-input');
    const clearGlobalBtn = modal.querySelector('#valery-clear-global-search');
    if (globalInput) {
      globalInput.addEventListener('input', () => {
        globalSearchQuery = globalInput.value.trim();
        currentProductPage = 1;
        if (clearGlobalBtn) {
          clearGlobalBtn.classList.toggle('hidden', !globalSearchQuery);
        }
        renderAvailableProducts();
      });

      globalInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleSearchEnter(globalInput);
        }
      });
    }

    if (clearGlobalBtn) {
      clearGlobalBtn.addEventListener('click', () => {
        if (globalInput) globalInput.value = '';
        globalSearchQuery = '';
        clearGlobalBtn.classList.add('hidden');
        renderAvailableProducts();
      });
    }

    const deptSelect = modal.querySelector('#valery-dept-select');
    if (deptSelect) {
      deptSelect.addEventListener('change', () => {
        selectedDepartment = deptSelect.value;
        currentProductPage = 1;
        selectedProductIds.clear();
        updateSelectAllCheckboxState();
        renderAvailableProducts();
      });
    }

    const deptSearchInput = modal.querySelector('#valery-dept-search-input');
    if (deptSearchInput) {
      deptSearchInput.addEventListener('input', () => {
        deptSearchQuery = deptSearchInput.value.trim();
        currentProductPage = 1;
        renderAvailableProducts();
      });
    }

    modal.querySelector('#valery-add-dept-to-queue-btn')?.addEventListener('click', () => {
      addDepartmentToQueue(selectedDepartment);
    });

    modal.querySelector('#valery-direct-print-dept-btn')?.addEventListener('click', () => {
      directPrintDepartment(selectedDepartment);
    });

    const selectAllCb = modal.querySelector('#valery-select-all-checkbox');
    if (selectAllCb) {
      selectAllCb.addEventListener('change', () => {
        // Seleccionar/deseleccionar solo los de la PÁGINA ACTUAL
        const allFiltered = getFilteredProducts();
        const startIdx = (currentProductPage - 1) * PRODUCTS_PER_PAGE;
        const pageProducts = allFiltered.slice(startIdx, startIdx + PRODUCTS_PER_PAGE);
        if (selectAllCb.checked) {
          pageProducts.forEach((p) => selectedProductIds.add(p.id));
        } else {
          pageProducts.forEach((p) => selectedProductIds.delete(p.id));
        }
        updateSelectedBadge();
        renderAvailableProducts();
      });
    }

    modal.querySelector('#valery-add-selected-btn')?.addEventListener('click', () => {
      addSelectedProductsToQueue();
    });

    modal.querySelector('#valery-clear-queue-btn')?.addEventListener('click', () => {
      const list = getActiveList();
      if (!list || list.items.length === 0) return;
      if (confirm(`¿Vaciar todos los productos de la lista "${list.name}"?`)) {
        list.items = [];
        saveListsToStorage();
        renderQueueList();
        renderAvailableProducts();
        updateLivePreview();
      }
    });

    modal.querySelector('#valery-preview-prev-btn')?.addEventListener('click', () => {
      const list = getActiveList();
      if (!list || list.items.length === 0) return;
      currentPreviewIndex = (currentPreviewIndex - 1 + list.items.length) % list.items.length;
      updateLivePreview();
    });

    modal.querySelector('#valery-preview-next-btn')?.addEventListener('click', () => {
      const list = getActiveList();
      if (!list || list.items.length === 0) return;
      currentPreviewIndex = (currentPreviewIndex + 1) % list.items.length;
      updateLivePreview();
    });

    modal.querySelector('#valery-print-now-btn')?.addEventListener('click', () => {
      executePrintList();
    });
  }

  // ============================================================
  // FILTRADO Y BÚSQUEDA DE PRODUCTOS
  // ============================================================
  function getFilteredProducts() {
    const all = getAllProducts();
    const gQuery = globalSearchQuery.toLowerCase().trim();
    const dQuery = deptSearchQuery.toLowerCase().trim();

    return all.filter((product) => {
      // FILTRO: Solo productos con stock > 0
      if ((product.stock || 0) <= 0) return false;

      if (selectedDepartment !== 'all') {
        const dept = (product.departamento || '').trim();
        if (dept.toUpperCase() !== selectedDepartment.toUpperCase()) return false;
      }

      const name = (product.nombre || product.descripcion || '').toLowerCase();
      const code = (product.codigo || '').toLowerCase();

      if (gQuery) {
        if (!name.includes(gQuery) && !code.includes(gQuery)) return false;
      }

      if (dQuery) {
        if (!name.includes(dQuery) && !code.includes(dQuery)) return false;
      }

      return true;
    });
  }

  function handleSearchEnter(inputElement) {
    const filtered = getFilteredProducts();
    if (filtered.length === 0) {
      alert('No se encontró ningún producto con ese nombre o código.');
      return;
    }

    const query = (inputElement.value || '').trim().toLowerCase();
    const exactMatch = filtered.find((p) => (p.codigo || '').trim().toLowerCase() === query);
    const targetProduct = exactMatch || filtered[0];

    addProductToActiveList(targetProduct);

    inputElement.value = '';
    globalSearchQuery = '';
    document.getElementById('valery-clear-global-search')?.classList.add('hidden');
    renderAvailableProducts();
    inputElement.focus();
  }

  function updateSelectAllCheckboxState() {
    const selectAllCb = document.getElementById('valery-select-all-checkbox');
    if (!selectAllCb) return;

    const allFiltered = getFilteredProducts();
    const totalProducts = allFiltered.length;
    const startIdx = (currentProductPage - 1) * PRODUCTS_PER_PAGE;
    const endIdx = Math.min(startIdx + PRODUCTS_PER_PAGE, totalProducts);
    const pageProducts = allFiltered.slice(startIdx, endIdx);

    const labelEl = document.getElementById('valery-select-all-label');
    if (labelEl) {
      if (totalProducts <= PRODUCTS_PER_PAGE) {
        labelEl.innerHTML = `Seleccionar Todos (<span id="valery-visible-count">${totalProducts}</span>)`;
      } else {
        labelEl.innerHTML = `Seleccionar esta Página (${pageProducts.length} de <span id="valery-visible-count">${totalProducts}</span>)`;
      }
    }

    if (pageProducts.length === 0) {
      selectAllCb.checked = false;
      selectAllCb.indeterminate = false;
      return;
    }

    const selectedInPageCount = pageProducts.filter((p) => selectedProductIds.has(p.id)).length;
    selectAllCb.checked = selectedInPageCount === pageProducts.length;
    selectAllCb.indeterminate = selectedInPageCount > 0 && selectedInPageCount < pageProducts.length;
  }

  function updateSelectedBadge() {
    const addSelectedBtn = document.getElementById('valery-add-selected-btn');
    const badge = document.getElementById('valery-selected-badge');
    const count = selectedProductIds.size;

    if (badge) badge.textContent = count.toString();
    if (addSelectedBtn) {
      addSelectedBtn.classList.toggle('hidden', count === 0);
    }
  }

  // ============================================================
  // RENDERIZADO DE PRODUCTOS DISPONIBLES (CON FOTO)
  // ============================================================
  function renderAvailableProducts() {
    const listContainer = document.getElementById('valery-products-list');
    const visibleCountEl = document.getElementById('valery-visible-count');
    if (!listContainer) return;

    const allFiltered = getFilteredProducts();
    const totalProducts = allFiltered.length;
    const totalPages = Math.max(1, Math.ceil(totalProducts / PRODUCTS_PER_PAGE));

    // Asegurar que la página actual no exceda el total
    if (currentProductPage > totalPages) currentProductPage = totalPages;
    if (currentProductPage < 1) currentProductPage = 1;

    if (visibleCountEl) visibleCountEl.textContent = totalProducts.toString();

    if (totalProducts === 0) {
      listContainer.innerHTML = `
        <div class="text-center py-10 text-gray-400 dark:text-gray-500">
          <p class="text-2xl mb-1">🔍</p>
          <p class="text-sm font-semibold">No se encontraron productos con stock</p>
          <p class="text-xs">Solo se muestran productos con stock mayor a 0. Prueba cambiando el departamento o la búsqueda.</p>
        </div>
      `;
      return;
    }

    // Paginación: extraer solo los de la página actual
    const startIdx = (currentProductPage - 1) * PRODUCTS_PER_PAGE;
    const endIdx = Math.min(startIdx + PRODUCTS_PER_PAGE, totalProducts);
    const pageProducts = allFiltered.slice(startIdx, endIdx);

    const activeList = getActiveList();
    let html = '';

    // ---- BARRA DE PAGINACIÓN SUPERIOR ----
    if (totalPages > 1) {
      html += `
        <div class="flex items-center justify-between py-2 px-1 mb-2 bg-sky-50/80 dark:bg-sky-950/40 rounded-xl border border-sky-200 dark:border-sky-800">
          <button type="button" id="valery-page-prev" class="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1" ${currentProductPage <= 1 ? 'disabled' : ''}>
            ◀ Anterior
          </button>
          <div class="text-center">
            <span class="text-xs font-black text-sky-800 dark:text-sky-200">Página ${currentProductPage} de ${totalPages}</span>
            <span class="text-[10px] text-sky-600 dark:text-sky-400 block">Mostrando ${startIdx + 1}-${endIdx} de ${totalProducts} productos</span>
          </div>
          <button type="button" id="valery-page-next" class="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1" ${currentProductPage >= totalPages ? 'disabled' : ''}>
            Siguiente ▶
          </button>
        </div>
      `;
    }

    // ---- PRODUCTOS DE LA PÁGINA ACTUAL ----
    pageProducts.forEach((p) => {
      const isChecked = selectedProductIds.has(p.id);
      const priceVal = getProductDetalPrice(p);
      const priceFormatted = formatPriceNumber(priceVal);
      const code = (p.codigo || 'SIN-CÓDIGO').trim();
      const name = p.nombre || p.descripcion || 'Sin nombre';
      const imgSrc = p.imagen_url || DEFAULT_PLACEHOLDER_IMG;

      const inQueue = activeList.items.find((item) => item.product.id === p.id);
      const queueQty = inQueue ? inQueue.quantity : 0;

      html += `
        <div class="valery-product-row flex items-center justify-between p-2 rounded-2xl border transition-all cursor-pointer select-none ${
          isChecked
            ? 'bg-sky-50/90 border-sky-300 dark:bg-sky-950/40 dark:border-sky-800'
            : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-sky-300 hover:bg-sky-50/30'
        }" data-row-product-id="${p.id}">
          
          <div class="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
            <input type="checkbox" data-product-id="${p.id}" class="valery-product-cb w-4 h-4 rounded text-sky-600 focus:ring-sky-500 border-gray-300 cursor-pointer flex-shrink-0" ${
        isChecked ? 'checked' : ''
      }>

            <!-- FOTO DEL PRODUCTO -->
            <div class="w-12 h-12 rounded-xl bg-gray-100 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 overflow-hidden flex-shrink-0 flex items-center justify-center">
              <img src="${imgSrc}" alt="${name}" class="w-full h-full object-cover" onerror="this.src='${DEFAULT_PLACEHOLDER_IMG}'">
            </div>

            <!-- Código, Precio y Nombre -->
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="text-[11px] font-mono font-black px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200">${code}</span>
                <span class="text-xs font-black text-emerald-600 dark:text-emerald-400">REF: $${priceFormatted}</span>
                ${
                  p.stock !== undefined
                    ? `<span class="text-[10px] text-gray-400 font-semibold">Stock: ${p.stock}</span>`
                    : ''
                }
              </div>
              <p class="text-xs font-bold text-gray-800 dark:text-gray-200 truncate mt-0.5" title="${name}">${name}</p>
            </div>
          </div>

          <!-- Acciones: Añadir a la lista e Imprimir Individual -->
          <div class="flex items-center gap-1.5 flex-shrink-0">
            ${
              queueQty > 0
                ? `<span class="text-[10px] font-bold bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">${queueQty} en lista</span>`
                : ''
            }
            <button type="button" data-add-id="${p.id}" class="valery-quick-add-btn px-2.5 py-1 bg-sky-50 hover:bg-sky-600 text-sky-700 hover:text-white dark:bg-sky-950/50 dark:text-sky-300 dark:hover:bg-sky-600 dark:hover:text-white rounded-xl text-xs font-bold transition-all border border-sky-200 dark:border-sky-800 flex items-center gap-1 shadow-xs" title="Añadir a la lista activa">
              <span>+ Lista</span>
            </button>
            <button type="button" data-print-single-id="${p.id}" class="valery-print-single-btn p-1.5 bg-gray-100 hover:bg-emerald-600 hover:text-white dark:bg-gray-700 dark:hover:bg-emerald-600 rounded-xl text-xs transition-all border border-gray-200 dark:border-gray-600" title="Imprimir etiqueta individual de este producto">
              🖨️
            </button>
          </div>

        </div>
      `;
    });

    // ---- BARRA DE PAGINACIÓN INFERIOR (si hay más de 1 página) ----
    if (totalPages > 1) {
      html += `
        <div class="flex items-center justify-between py-2 px-1 mt-2 bg-sky-50/80 dark:bg-sky-950/40 rounded-xl border border-sky-200 dark:border-sky-800">
          <button type="button" id="valery-page-prev-bottom" class="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1" ${currentProductPage <= 1 ? 'disabled' : ''}>
            ◀ Anterior
          </button>
          <span class="text-xs font-black text-sky-800 dark:text-sky-200">Pág. ${currentProductPage}/${totalPages} · ${startIdx + 1}-${endIdx} de ${totalProducts}</span>
          <button type="button" id="valery-page-next-bottom" class="px-3 py-1.5 bg-sky-600 hover:bg-sky-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1" ${currentProductPage >= totalPages ? 'disabled' : ''}>
            Siguiente ▶
          </button>
        </div>
      `;
    }

    listContainer.innerHTML = html;

    // ---- EVENT LISTENERS: PAGINACIÓN ----
    const prevBtn = listContainer.querySelector('#valery-page-prev');
    const nextBtn = listContainer.querySelector('#valery-page-next');
    const prevBtnBottom = listContainer.querySelector('#valery-page-prev-bottom');
    const nextBtnBottom = listContainer.querySelector('#valery-page-next-bottom');

    const goToPrevPage = () => {
      if (currentProductPage > 1) {
        currentProductPage--;
        renderAvailableProducts();
        listContainer.scrollTop = 0;
      }
    };
    const goToNextPage = () => {
      if (currentProductPage < totalPages) {
        currentProductPage++;
        renderAvailableProducts();
        listContainer.scrollTop = 0;
      }
    };

    if (prevBtn) prevBtn.addEventListener('click', goToPrevPage);
    if (nextBtn) nextBtn.addEventListener('click', goToNextPage);
    if (prevBtnBottom) prevBtnBottom.addEventListener('click', goToPrevPage);
    if (nextBtnBottom) nextBtnBottom.addEventListener('click', goToNextPage);

    // ---- EVENT LISTENERS: FILA COMPLETA Y CHECKBOXES (SELECCIONAR CON CLIC EN CUALQUIER PARTE) ----
    listContainer.querySelectorAll('.valery-product-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        // Si el clic fue en un botón de acción (+ Lista, Imprimir), no seleccionar
        if (e.target.closest('button')) return;

        const pId = row.getAttribute('data-row-product-id');
        if (!pId) return;

        const cb = row.querySelector('.valery-product-cb');

        // Si el clic fue directamente en el checkbox, dejamos que su evento change lo procese
        if (e.target === cb) return;

        // Clic en cualquier otra parte de la fila: alternar selección
        const willBeChecked = !selectedProductIds.has(pId);
        if (willBeChecked) {
          selectedProductIds.add(pId);
          if (cb) cb.checked = true;
          row.classList.add('bg-sky-50/90', 'border-sky-300', 'dark:bg-sky-950/40', 'dark:border-sky-800');
          row.classList.remove('bg-white', 'dark:bg-gray-800', 'border-gray-200', 'dark:border-gray-700');
        } else {
          selectedProductIds.delete(pId);
          if (cb) cb.checked = false;
          row.classList.remove('bg-sky-50/90', 'border-sky-300', 'dark:bg-sky-950/40', 'dark:border-sky-800');
          row.classList.add('bg-white', 'dark:bg-gray-800', 'border-gray-200', 'dark:border-gray-700');
        }

        updateSelectAllCheckboxState();
        updateSelectedBadge();
      });
    });

    listContainer.querySelectorAll('.valery-product-cb').forEach((cb) => {
      cb.addEventListener('change', () => {
        const pId = cb.getAttribute('data-product-id');
        if (!pId) return;
        const row = cb.closest('.valery-product-row');
        if (cb.checked) {
          selectedProductIds.add(pId);
          if (row) {
            row.classList.add('bg-sky-50/90', 'border-sky-300', 'dark:bg-sky-950/40', 'dark:border-sky-800');
            row.classList.remove('bg-white', 'dark:bg-gray-800', 'border-gray-200', 'dark:border-gray-700');
          }
        } else {
          selectedProductIds.delete(pId);
          if (row) {
            row.classList.remove('bg-sky-50/90', 'border-sky-300', 'dark:bg-sky-950/40', 'dark:border-sky-800');
            row.classList.add('bg-white', 'dark:bg-gray-800', 'border-gray-200', 'dark:border-gray-700');
          }
        }
        updateSelectAllCheckboxState();
        updateSelectedBadge();
      });
    });

    listContainer.querySelectorAll('.valery-quick-add-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pId = btn.getAttribute('data-add-id');
        const product = allFiltered.find((p) => p.id === pId);
        if (product) {
          addProductToActiveList(product);
        }
      });
    });

    listContainer.querySelectorAll('.valery-print-single-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const pId = btn.getAttribute('data-print-single-id');
        const product = allFiltered.find((p) => p.id === pId);
        if (product) {
          printSingleProduct(product);
        }
      });
    });

    updateSelectAllCheckboxState();
  }

  // ============================================================
  // GESTIÓN DE PRODUCTOS EN LA LISTA ACTIVA
  // ============================================================

  function addProductToActiveList(product, quantity = 1) {
    if (!product) return;
    const list = getActiveList();
    const existing = list.items.find((item) => item.product.id === product.id);
    if (existing) {
      existing.quantity += quantity;
    } else {
      list.items.push({ product, quantity });
    }
    saveListsToStorage();
    renderQueueList();
    renderAvailableProducts();
    updateLivePreview();
  }

  function addSelectedProductsToQueue() {
    if (selectedProductIds.size === 0) return;
    const all = getAllProducts();
    const toAdd = all.filter((p) => selectedProductIds.has(p.id));
    const list = getActiveList();

    toAdd.forEach((product) => {
      const existing = list.items.find((item) => item.product.id === product.id);
      if (existing) {
        existing.quantity += 1;
      } else {
        list.items.push({ product, quantity: 1 });
      }
    });

    selectedProductIds.clear();
    updateSelectedBadge();
    updateSelectAllCheckboxState();
    saveListsToStorage();
    renderQueueList();
    renderAvailableProducts();
    updateLivePreview();
  }

  function addDepartmentToQueue(department) {
    const all = getAllProducts();
    const deptProducts = all.filter((p) => {
      // Solo productos con stock > 0
      if ((p.stock || 0) <= 0) return false;
      if (department === 'all') return true;
      return (p.departamento || '').trim().toUpperCase() === department.trim().toUpperCase();
    });

    if (deptProducts.length === 0) {
      alert('No hay productos con stock en este departamento');
      return;
    }

    const list = getActiveList();
    if (!confirm(`¿Deseas agregar los ${deptProducts.length} productos (con stock) del departamento "${department}" a la lista "${list.name}"?`)) {
      return;
    }

    deptProducts.forEach((product) => {
      const existing = list.items.find((item) => item.product.id === product.id);
      if (existing) {
        existing.quantity += 1;
      } else {
        list.items.push({ product, quantity: 1 });
      }
    });

    saveListsToStorage();
    renderQueueList();
    renderAvailableProducts();
    updateLivePreview();
  }

  function updateItemQuantity(productId, delta) {
    const list = getActiveList();
    const index = list.items.findIndex((item) => item.product.id === productId);
    if (index === -1) return;

    list.items[index].quantity += delta;
    if (list.items[index].quantity <= 0) {
      list.items.splice(index, 1);
    }

    saveListsToStorage();
    renderQueueList();
    renderAvailableProducts();
    updateLivePreview();
  }

  function removeItemFromActiveList(productId) {
    const list = getActiveList();
    list.items = list.items.filter((item) => item.product.id !== productId);
    saveListsToStorage();
    renderQueueList();
    renderAvailableProducts();
    updateLivePreview();
  }

  // ============================================================
  // RENDERIZADO DE LA COLA / LISTA ACTIVA (CON FOTO)
  // ============================================================
  function renderQueueList() {
    const container = document.getElementById('valery-queue-list');
    const badge = document.getElementById('valery-queue-badge');
    const totalCountEl = document.getElementById('valery-total-print-count');
    const printNowBtn = document.getElementById('valery-print-now-btn');
    const activeListTitle = document.getElementById('valery-active-list-title');
    if (!container) return;

    const list = getActiveList();
    if (activeListTitle) activeListTitle.textContent = list.name;

    let totalLabels = 0;
    list.items.forEach((item) => {
      totalLabels += item.quantity;
    });

    if (badge) badge.textContent = `${list.items.length} prod · ${totalLabels} etiq`;
    if (totalCountEl) totalCountEl.textContent = totalLabels.toString();
    if (printNowBtn) {
      printNowBtn.disabled = totalLabels === 0;
    }

    if (list.items.length === 0) {
      container.innerHTML = `
        <div class="text-center py-8 text-gray-400 dark:text-gray-500">
          <p class="text-2xl mb-1">🏷️</p>
          <p class="text-xs font-bold">La lista "${list.name}" está vacía</p>
          <p class="text-[11px]">Agrega productos desde la izquierda usando "+ Lista" o seleccionando un departamento</p>
        </div>
      `;
      return;
    }

    let html = '';
    list.items.forEach((item, index) => {
      const p = item.product;
      const priceVal = getProductDetalPrice(p);
      const priceFormatted = formatPriceNumber(priceVal);
      const isCurrentlyPreviewed = currentPreviewIndex === index;
      const imgSrc = p.imagen_url || DEFAULT_PLACEHOLDER_IMG;
      const code = (p.codigo || 'SIN-CÓDIGO').trim();

      html += `
        <div class="flex items-center justify-between p-2 rounded-2xl border transition-all ${
          isCurrentlyPreviewed
            ? 'bg-sky-50 dark:bg-sky-950/40 border-sky-400 dark:border-sky-700 shadow-xs'
            : 'bg-white dark:bg-gray-800/80 border-gray-200 dark:border-gray-700 hover:border-gray-300'
        }">
          <div class="flex items-center gap-2 min-w-0 flex-1 mr-2 cursor-pointer valery-preview-item-click" data-preview-idx="${index}">
            <div class="w-10 h-10 rounded-xl bg-gray-100 dark:bg-gray-700 overflow-hidden flex-shrink-0 flex items-center justify-center border border-gray-200 dark:border-gray-600">
              <img src="${imgSrc}" alt="${p.nombre || ''}" class="w-full h-full object-cover" onerror="this.src='${DEFAULT_PLACEHOLDER_IMG}'">
            </div>

            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-1.5">
                <span class="text-[10px] font-mono font-bold px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200">${code}</span>
                <span class="text-xs font-bold text-emerald-600 dark:text-emerald-400">REF: $${priceFormatted}</span>
              </div>
              <p class="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate mt-0.5">${p.nombre || p.descripcion || ''}</p>
            </div>
          </div>

          <div class="flex items-center gap-1 flex-shrink-0">
            <button type="button" data-print-single-id="${p.id}" class="valery-print-single-btn p-1.5 bg-gray-100 hover:bg-emerald-600 hover:text-white dark:bg-gray-700 dark:hover:bg-emerald-600 rounded-xl text-xs transition-all border border-gray-200 dark:border-gray-600" title="Imprimir ahora solo este producto">
              🖨️
            </button>

            <div class="flex items-center border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden bg-gray-50 dark:bg-gray-900">
              <button type="button" data-qty-delta="-1" data-prod-id="${p.id}" class="valery-qty-btn px-2 py-1 hover:bg-gray-200 dark:hover:bg-gray-800 font-bold text-xs text-gray-700 dark:text-gray-300">−</button>
              <span class="px-2 py-0.5 text-xs font-extrabold text-gray-800 dark:text-white min-w-[20px] text-center">${item.quantity}</span>
              <button type="button" data-qty-delta="1" data-prod-id="${p.id}" class="valery-qty-btn px-2 py-1 hover:bg-gray-200 dark:hover:bg-gray-800 font-bold text-xs text-gray-700 dark:text-gray-300">+</button>
            </div>

            <button type="button" data-remove-id="${p.id}" class="valery-remove-item-btn p-1.5 text-gray-400 hover:text-red-600 rounded-xl transition-colors" title="Eliminar de la lista">
              ✕
            </button>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;

    container.querySelectorAll('.valery-preview-item-click').forEach((el) => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.getAttribute('data-preview-idx'));
        if (!isNaN(idx)) {
          currentPreviewIndex = idx;
          renderQueueList();
          updateLivePreview();
        }
      });
    });

    container.querySelectorAll('.valery-qty-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pId = btn.getAttribute('data-prod-id');
        const delta = parseInt(btn.getAttribute('data-qty-delta'));
        if (pId && !isNaN(delta)) {
          updateItemQuantity(pId, delta);
        }
      });
    });

    container.querySelectorAll('.valery-remove-item-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pId = btn.getAttribute('data-remove-id');
        if (pId) {
          removeItemFromActiveList(pId);
        }
      });
    });

    container.querySelectorAll('.valery-print-single-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pId = btn.getAttribute('data-print-single-id');
        const item = list.items.find((it) => it.product.id === pId);
        if (item) {
          printSingleProduct(item.product, item.quantity);
        }
      });
    });
  }

  // ============================================================
  // PREVISUALIZACIÓN EN VIVO (ROL DE 80MM CON CORTE FÁCIL)
  // ============================================================
  function updateLivePreview() {
    const previewContainer = document.getElementById('valery-label-live-preview');
    const previewNav = document.getElementById('valery-preview-nav');
    const previewCounter = document.getElementById('valery-preview-counter');
    const previewFormatTag = document.getElementById('valery-preview-format-tag');
    if (!previewContainer) return;

    if (previewFormatTag) {
      if (currentFormat === '80mm') {
        previewFormatTag.textContent = '80mm (Completo)';
      } else if (currentFormat === 'peq') {
        previewFormatTag.textContent = 'Peq (Corte Izq)';
      } else {
        previewFormatTag.textContent = '58mm (Corte Izq)';
      }
    }

    const list = getActiveList();
    let targetProduct = null;

    if (list && list.items.length > 0) {
      if (currentPreviewIndex >= list.items.length) {
        currentPreviewIndex = list.items.length - 1;
      }
      targetProduct = list.items[currentPreviewIndex]?.product;
      if (previewNav) previewNav.classList.remove('hidden');
      if (previewCounter) previewCounter.textContent = `${currentPreviewIndex + 1} / ${list.items.length}`;
    } else {
      const all = getAllProducts();
      targetProduct = all.length > 0 ? all[0] : {
        codigo: '6957939000707',
        nombre: 'EXTENSOR DE RANGO MERCUSY ME30 AC1200',
        precio_cliente: 62.77
      };
      if (previewNav) previewNav.classList.add('hidden');
    }

    const labelHtml = renderLabelHTML(targetProduct, currentFormat, {
      date: labelDate
    });

    // Simulador visual de rollo de 80mm mostrando el alineado a la izquierda para recorte fácil
    let previewWrapHtml = '';
    if (currentFormat === '58mm') {
      previewWrapHtml = `
        <div class="valery-roll-simulator flex items-start justify-between relative">
          <div class="flex-1">
            ${labelHtml}
          </div>
          <div class="valery-cut-guide" style="left: 228px;"></div>
          <div class="valery-cut-guide-label">
            <span>✂</span>
            <span>Cortar</span>
          </div>
        </div>
      `;
    } else if (currentFormat === 'peq') {
      previewWrapHtml = `
        <div class="valery-roll-simulator flex items-start justify-between relative">
          <div class="flex-1">
            ${labelHtml}
          </div>
          <div class="valery-cut-guide" style="left: 142px;"></div>
          <div class="valery-cut-guide-label">
            <span>✂</span>
            <span>Cortar</span>
          </div>
        </div>
      `;
    } else {
      previewWrapHtml = `
        <div class="valery-roll-simulator">
          ${labelHtml}
        </div>
      `;
    }

    previewContainer.innerHTML = previewWrapHtml;
  }

  function setValeryFormat(fmt) {
    currentFormat = fmt;
    localStorage.setItem(STORAGE_FORMAT_KEY, fmt);

    document.querySelectorAll('.valery-format-btn').forEach((btn) => {
      const isSelected = btn.getAttribute('data-valery-format') === fmt;
      btn.className = `valery-format-btn px-3 py-1 rounded-xl text-xs font-bold transition-all ${
        isSelected ? 'bg-sky-600 text-white shadow-md' : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
      }`;
    });

    updateLivePreview();
  }

  // ============================================================
  // MOTOR DE IMPRESIÓN (DISPARA SELECTOR DE IMPRESORAS DE LA PC)
  // ============================================================

  // Imprimir toda la lista activa
  function executePrintList() {
    const list = getActiveList();
    if (!list || list.items.length === 0) {
      alert('La lista de etiquetas a imprimir está vacía.');
      return;
    }

    const printContainer = document.getElementById('valery-print-container');
    if (!printContainer) return;

    let printHtml = '';
    list.items.forEach((item) => {
      const labelSingleHtml = renderLabelHTML(item.product, currentFormat, {
        date: labelDate
      });

      for (let i = 0; i < item.quantity; i++) {
        printHtml += `
          <div class="valery-print-page-item">
            <div class="valery-print-format-${currentFormat}">
              ${labelSingleHtml}
            </div>
          </div>
        `;
      }
    });

    printContainer.innerHTML = printHtml;
    // Dar un breve tiempo al navegador para computar el DOM antes de abrir el diálogo de impresión
    setTimeout(() => {
      window.print();
    }, 100);
  }

  // Imprimir etiqueta individual (sin modificar la lista activa)
  function printSingleProduct(product, defaultQty = 1) {
    if (!product) return;

    const qtyPrompt = prompt(`¿Cuántas etiquetas deseas imprimir para "${product.nombre || product.codigo}"?`, defaultQty.toString());
    if (qtyPrompt === null) return;

    const qty = parseInt(qtyPrompt);
    if (isNaN(qty) || qty <= 0) {
      alert('Cantidad no válida.');
      return;
    }

    const printContainer = document.getElementById('valery-print-container');
    if (!printContainer) return;

    let printHtml = '';
    const labelSingleHtml = renderLabelHTML(product, currentFormat, {
      date: labelDate
    });

    for (let i = 0; i < qty; i++) {
      printHtml += `
        <div class="valery-print-page-item">
          <div class="valery-print-format-${currentFormat}">
            ${labelSingleHtml}
          </div>
        </div>
      `;
    }

    printContainer.innerHTML = printHtml;
    setTimeout(() => {
      window.print();
    }, 100);
  }

  // Imprimir todo un departamento directamente
  function directPrintDepartment(department) {
    const all = getAllProducts();
    const deptProducts = all.filter((p) => {
      // Solo productos con stock > 0
      if ((p.stock || 0) <= 0) return false;
      if (department === 'all') return true;
      return (p.departamento || '').trim().toUpperCase() === department.trim().toUpperCase();
    });

    if (deptProducts.length === 0) {
      alert('No hay productos en este departamento para imprimir.');
      return;
    }

    if (!confirm(`¿Imprimir directamente las etiquetas de los ${deptProducts.length} productos del departamento "${department}" en formato ${currentFormat.toUpperCase()}?`)) {
      return;
    }

    const printContainer = document.getElementById('valery-print-container');
    if (!printContainer) return;

    let printHtml = '';
    deptProducts.forEach((product) => {
      const labelSingleHtml = renderLabelHTML(product, currentFormat, {
        date: labelDate
      });

      printHtml += `
        <div class="valery-print-page-item">
          <div class="valery-print-format-${currentFormat}">
            ${labelSingleHtml}
          </div>
        </div>
      `;
    });

    printContainer.innerHTML = printHtml;
    setTimeout(() => {
      window.print();
    }, 100);
  }

  // Limpiar el contenedor de impresión tras cerrar el diálogo
  window.addEventListener('afterprint', () => {
    const printContainer = document.getElementById('valery-print-container');
    if (printContainer) printContainer.innerHTML = '';
  });

  // ============================================================
  // REPOBLAR SELECTORES (DEPARTAMENTOS Y LISTAS GUARDADAS)
  // ============================================================

  function renderListsDropdown() {
    const listsSelect = document.getElementById('valery-lists-select');
    if (!listsSelect) return;

    let html = '';
    savedLists.forEach((l) => {
      html += `<option value="${l.id}" ${l.id === activeListId ? 'selected' : ''}>📋 ${l.name} (${l.items.length})</option>`;
    });

    listsSelect.innerHTML = html;
  }

  function populateDepartmentSelect() {
    const deptSelect = document.getElementById('valery-dept-select');
    if (!deptSelect) return;

    const departments = getDepartments();
    let optionsHtml = '<option value="all">📦 Todos los Departamentos</option>';
    departments.forEach((dept) => {
      optionsHtml += `<option value="${dept}">${dept}</option>`;
    });

    deptSelect.innerHTML = optionsHtml;
    deptSelect.value = selectedDepartment;
  }

  // ============================================================
  // APERTURA Y CIERRE DEL MODAL
  // ============================================================

  window.openValeryPricesModal = function () {
    const role = window.currentUserRole;
    if (role !== 'admin' && role !== 'gestor') {
      alert('Esta función solo está disponible para los roles de Gestor y Administrador.');
      return;
    }

    loadSavedLists();
    createModal();
    renderListsDropdown();
    populateDepartmentSelect();
    renderAvailableProducts();
    renderQueueList();
    updateLivePreview();

    const modal = document.getElementById('valery-prices-modal');
    if (modal) {
      modal.classList.remove('hidden');
      document.body.style.overflow = 'hidden';
      setTimeout(() => {
        document.getElementById('valery-global-search-input')?.focus();
      }, 150);
    }
  };

  window.closeValeryPricesModal = function () {
    const modal = document.getElementById('valery-prices-modal');
    if (modal) {
      modal.classList.add('hidden');
      document.body.style.overflow = '';
    }
  };

  // ============================================================
  // INICIALIZACIÓN DE BOTONES EN LA INTERFAZ
  // ============================================================
  function initializeButtons() {
    const adminBtn = document.getElementById('valery-prices-button');
    if (adminBtn) {
      adminBtn.onclick = window.openValeryPricesModal;
    }

    const gestorBtn = document.getElementById('gestor-valery-prices-button');
    if (gestorBtn) {
      gestorBtn.onclick = window.openValeryPricesModal;
    }

    const headerBtn = document.getElementById('header-valery-prices-btn');
    if (headerBtn) {
      headerBtn.onclick = window.openValeryPricesModal;
    }

    console.log('[VALERY] ✅ Módulo de Impresión de Precios (Listas, Fotos e Impresión Individual) listo.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeButtons);
  } else {
    initializeButtons();
  }

  setTimeout(initializeButtons, 1200);

})();
