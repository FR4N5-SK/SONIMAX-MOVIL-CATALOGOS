--- START OF FILE text/javascript ---

// ============================================
// ACTUALIZAR PRODUCTOS DESDE EXCEL - SONIMAX MÓVIL
// VERSIÓN CORREGIDA: NO DUPLICADOS, ACTUALIZACIÓN INTELIGENTE
// ============================================

(function() {
  'use strict';

  const getGlobalState = () => ({
    currentUserRole: window.currentUserRole || null,
    allProducts: window.allProducts || [],
    supabaseClient: window.supabaseClient,
  });

  const XLSX = window.XLSX;

  // Función para normalizar textos (elimina espacios extra, acentos y pone mayúsculas)
  // Ayuda a comparar "PROD 01" con "PROD01" o "Teléfono" con "telefono"
  const normalizeKey = (str) => {
    if (!str) return '';
    return String(str)
      .toUpperCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Quitar acentos
      .trim()
      .replace(/\s+/g, '') // Quitar espacios internos
      .replace(/[^\w]/g, ''); // Quitar caracteres especiales
  };

  const normalizeText = (str) => {
    if (!str) return '';
    return String(str).trim();
  };

  window.showUpdateProductsModal = async function() {
    const { currentUserRole, supabaseClient } = getGlobalState();

    if (currentUserRole !== 'admin') {
      alert('Solo administradores pueden actualizar productos.');
      return;
    }

    const modalDiv = document.createElement('div');
    modalDiv.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto';
    modalDiv.innerHTML = `
      <div class="bg-white rounded-2xl max-w-2xl w-full shadow-2xl my-8 transform transition-all scale-100">
        <div class="bg-gradient-to-r from-teal-600 to-teal-700 p-6 text-white flex items-center justify-between rounded-t-2xl">
          <div>
            <h2 class="text-2xl font-black">Actualizar Inventario</h2>
            <p class="text-teal-100 mt-1 text-sm">Sube tu Excel para sincronizar precios y stock</p>
          </div>
          <button onclick="this.closest('.fixed').remove()" class="text-white hover:bg-teal-800 p-2 rounded-lg transition-all text-xl font-bold">✕</button>
        </div>

        <div class="p-6 space-y-6">
          <div class="bg-blue-50 border-l-4 border-blue-500 p-4 rounded-xl shadow-sm">
            <h3 class="font-bold text-blue-900 mb-2 flex items-center gap-2">
              ℹ️ Lógica de Actualización:
            </h3>
            <ul class="text-sm text-blue-800 space-y-1 ml-1">
              <li>• Se busca producto por <strong>CÓDIGO</strong> o <strong>DESCRIPCIÓN</strong>.</li>
              <li>• Si existe ⮕ Actualiza precios, stock y descripción.</li>
              <li>• Si NO existe ⮕ Crea el producto nuevo.</li>
              <li>• Stock 0 ⮕ Se marca como <strong>AGOTADO</strong>.</li>
              <li>• Stock 1 a 5 ⮕ Se marca como <strong>POCAS UNIDADES</strong>.</li>
              <li>• <strong>No se eliminan</strong> productos existentes.</li>
            </ul>
          </div>

          <!-- Zona de Carga -->
          <div class="border-3 border-dashed border-teal-200 rounded-2xl p-10 text-center hover:border-teal-500 hover:bg-teal-50 transition-all cursor-pointer group" id="drop-zone">
            <div class="w-16 h-16 bg-teal-100 text-teal-600 rounded-full flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
              <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
              </svg>
            </div>
            <p class="text-gray-700 font-bold text-lg mb-1">Haz clic o arrastra tu Excel aquí</p>
            <p class="text-sm text-gray-400">Soporta .xlsx, .xls, .csv</p>
            <input type="file" id="excel-file-input" accept=".xlsx,.xls,.csv" class="hidden" />
          </div>

          <!-- Estado -->
          <div id="file-status" class="hidden animate-fade-in">
            <div class="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center justify-between">
              <div>
                <p class="text-sm font-bold text-green-800" id="file-name">Archivo.xlsx</p>
                <p class="text-xs text-green-600 mt-1">Filas encontradas: <strong id="file-count">0</strong></p>
              </div>
              <span class="text-2xl">📄</span>
            </div>
          </div>

          <!-- Botones -->
          <div class="flex gap-3 pt-2">
            <button id="process-btn" class="flex-1 px-6 py-4 bg-gradient-to-r from-teal-600 to-teal-700 text-white rounded-xl font-bold hover:from-teal-700 hover:to-teal-800 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transform active:scale-95" disabled>
              🚀 Procesar Actualización
            </button>
          </div>

          <!-- Progreso -->
          <div id="progress-container" class="hidden space-y-2 animate-fade-in">
            <div class="flex justify-between text-xs font-bold text-gray-600 uppercase tracking-wide">
              <span id="progress-text">Iniciando...</span>
              <span id="progress-percent">0%</span>
            </div>
            <div class="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
              <div id="progress-bar" class="bg-gradient-to-r from-teal-500 to-green-500 h-3 rounded-full transition-all duration-300 shadow-[0_0_10px_rgba(20,184,166,0.5)]" style="width: 0%"></div>
            </div>
          </div>

          <!-- Resultados -->
          <div id="result-container" class="hidden animate-fade-in">
            <div class="bg-gray-50 rounded-xl border border-gray-200 p-5 space-y-3">
              <h3 class="font-bold text-gray-800 border-b pb-2">📊 Resumen Final</h3>
              <div class="grid grid-cols-2 gap-4 text-sm">
                <div class="flex items-center text-green-700"><span class="mr-2">✨</span> Creados: <strong class="ml-auto" id="result-created-count">0</strong></div>
                <div class="flex items-center text-blue-700"><span class="mr-2">🔄</span> Actualizados: <strong class="ml-auto" id="result-updated-count">0</strong></div>
                <div class="flex items-center text-red-700"><span class="mr-2">❌</span> Errores: <strong class="ml-auto" id="result-errors-count">0</strong></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modalDiv);

    let excelData = null;
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('excel-file-input');
    const processBtn = document.getElementById('process-btn');
    const fileStatus = document.getElementById('file-status');

    // Event Listeners para Drag & Drop
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('border-teal-500', 'bg-teal-50');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('border-teal-500', 'bg-teal-50');
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('border-teal-500', 'bg-teal-50');
      const file = e.dataTransfer.files[0];
      if (file) handleExcelFile(file);
    });
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) handleExcelFile(file);
    });

    function handleExcelFile(file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet);

          if (jsonData.length === 0) {
            alert('El archivo Excel está vacío.');
            return;
          }

          excelData = jsonData;
          fileStatus.classList.remove('hidden');
          document.getElementById('file-name').textContent = file.name;
          document.getElementById('file-count').textContent = jsonData.length;
          processBtn.disabled = false;
        } catch (error) {
          alert('Error al leer el archivo: ' + error.message);
        }
      };
      reader.readAsArrayBuffer(file);
    }

    processBtn.addEventListener('click', async () => {
      if (!excelData) return;
      await processExcelData(excelData, supabaseClient);
    });

    // ---------------------------------------------------------
    // LÓGICA DE PROCESAMIENTO ROBUSTA
    // ---------------------------------------------------------
    async function processExcelData(data, supabaseClient) {
      const progressContainer = document.getElementById('progress-container');
      const resultContainer = document.getElementById('result-container');
      const progressBar = document.getElementById('progress-bar');
      const progressText = document.getElementById('progress-text');
      const progressPercent = document.getElementById('progress-percent');

      processBtn.disabled = true;
      progressContainer.classList.remove('hidden');
      resultContainer.classList.add('hidden');

      let createdCount = 0;
      let updatedCount = 0;
      let errorCount = 0;

      try {
        // 1. OBTENER TODOS LOS PRODUCTOS DE SUPABASE PARA COMPARAR
        // Traemos ID, CODIGO y NOMBRE para chequear duplicados por ambos campos
        const { data: dbProducts, error: fetchError } = await supabaseClient
          .from('products')
          .select('id, codigo, nombre');

        if (fetchError) throw fetchError;

        // 2. CREAR MAPAS DE BÚSQUEDA RÁPIDA (Normalizados)
        const dbMapByCode = new Map();
        const dbMapByName = new Map();

        dbProducts.forEach(p => {
          if (p.codigo) dbMapByCode.set(normalizeKey(p.codigo), p.id);
          if (p.nombre) dbMapByName.set(normalizeKey(p.nombre), p.id);
        });

        // 3. PROCESAR FILA POR FILA
        for (let i = 0; i < data.length; i++) {
          const row = data[i];
          
          // Actualizar barra de progreso
          if (i % 5 === 0) {
            const percent = Math.round(((i + 1) / data.length) * 100);
            progressBar.style.width = `${percent}%`;
            progressPercent.textContent = `${percent}%`;
            progressText.textContent = `Procesando ${i + 1} de ${data.length}`;
            await new Promise(r => setTimeout(r, 0)); // Dejar renderizar la UI
          }

          // Detección flexible de columnas
          const codigo = normalizeText(row['CODIGO'] || row['codigo'] || row['Codigo'] || '');
          const descripcion = normalizeText(row['DESCRIPCION'] || row['descripcion'] || row['NOMBRE'] || row['nombre'] || '');
          const precioDetal = parseFloat(row['PRECIO DETAL'] || row['precio detal'] || row['DETAL'] || row['detal'] || 0);
          const precioMayor = parseFloat(row['PRECIO MAYOR'] || row['precio mayor'] || row['MAYOR'] || row['mayor'] || 0);
          const precioGmayor = parseFloat(row['PRECIO GMAYOR'] || row['precio gmayor'] || row['GMAYOR'] || row['gmayor'] || 0);
          const existencia = parseInt(row['EXISTENCIA ACTUAL'] || row['existencia'] || row['STOCK'] || row['stock'] || row['CANTIDAD'] || 0);
          const departamento = normalizeText(row['DEPARTAMENTO'] || row['departamento'] || 'GENERAL');

          // Validaciones básicas
          if (!descripcion) {
            console.warn(`Fila ${i+1} ignorada: Sin descripción.`);
            continue; 
          }

          // Identificar si existe (por código O por nombre)
          const normalizedCode = normalizeKey(codigo);
          const normalizedName = normalizeKey(descripcion);
          
          let existingId = null;
          if (normalizedCode && dbMapByCode.has(normalizedCode)) {
            existingId = dbMapByCode.get(normalizedCode);
          } else if (normalizedName && dbMapByName.has(normalizedName)) {
            existingId = dbMapByName.get(normalizedName);
          }

          // Datos a guardar
          const productData = {
            codigo: codigo, // Guardar tal cual viene en el Excel
            nombre: descripcion,
            descripcion: codigo, // Guardamos el código en el campo descripción para compatibilidad visual
            precio_cliente: precioDetal,
            precio_mayor: precioMayor,
            precio_gmayor: precioGmayor,
            stock: existencia,
            departamento: departamento
          };

          if (existingId) {
            // --- ACTUALIZAR ---
            const { error: updateError } = await supabaseClient
              .from('products')
              .update(productData)
              .eq('id', existingId);

            if (updateError) {
              console.error(`Error actualizando ID ${existingId}:`, updateError);
              errorCount++;
            } else {
              updatedCount++;
            }

          } else {
            // --- CREAR NUEVO ---
            // Solo si es nuevo agregamos is_new: true
            const newProductData = {
              ...productData,
              is_new: true,
              imagen_url: '' // Sin imagen por defecto
            };

            const { error: insertError } = await supabaseClient
              .from('products')
              .insert(newProductData);

            if (insertError) {
              console.error(`Error insertando ${descripcion}:`, insertError);
              errorCount++;
            } else {
              createdCount++;
            }
          }
        }

        // Finalizar
        progressBar.style.width = '100%';
        progressPercent.textContent = '100%';
        progressText.textContent = 'Completado';
        
        resultContainer.classList.remove('hidden');
        document.getElementById('result-created-count').textContent = createdCount;
        document.getElementById('result-updated-count').textContent = updatedCount;
        document.getElementById('result-errors-count').textContent = errorCount;

        // Recargar la app para ver cambios
        if (window.loadProducts) {
          window.loadProducts();
        }

        setTimeout(() => {
          modalDiv.remove();
          alert('¡Inventario actualizado correctamente!');
        }, 2000);

      } catch (error) {
        console.error('Error crítico en proceso:', error);
        alert('Ocurrió un error: ' + error.message);
        processBtn.disabled = false;
        progressContainer.classList.add('hidden');
      }
    }
  };
})();
--- START OF FILE text/javascript ---
