// ============================================
// ACTUALIZAR PRODUCTOS DESDE EXCEL - SONIMAX MÓVIL
// ============================================

(function() {
  'use strict';

  const getGlobalState = () => ({
    currentUserRole: window.currentUserRole || null,
    allProducts: window.allProducts || [],
    supabaseClient: window.supabaseClient,
  });

  const XLSX = window.XLSX;

  // ============================================
  // MOSTRAR MODAL DE ACTUALIZAR PRODUCTOS
  // ============================================

  window.showUpdateProductsModal = async function() {
    const { currentUserRole, supabaseClient } = getGlobalState();

    console.log('[UPDATE-PRODUCTS] currentUserRole:', currentUserRole);

    if (currentUserRole !== 'admin') {
      alert('Solo administradores pueden actualizar productos. Tu rol: ' + (currentUserRole || 'desconocido'));
      return;
    }

    const modalDiv = document.createElement('div');
    modalDiv.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto';
    modalDiv.innerHTML = `
      <div class="bg-white rounded-2xl max-w-2xl w-full shadow-2xl my-8">
        <div class="bg-gradient-to-r from-green-600 to-green-700 p-6 text-white flex items-center justify-between sticky top-0 z-10">
          <div>
            <h2 class="text-2xl font-bold">Actualizar Productos</h2>
            <p class="text-green-100 mt-1">Sube un archivo Excel para actualizar el inventario</p>
          </div>
          <button onclick="this.closest('.fixed').remove()" class="text-white hover:bg-green-800 p-2 rounded-lg transition-all text-xl font-bold">✕</button>
        </div>

        <div class="p-6 space-y-6">
          <!-- Instrucciones -->
          <div class="bg-blue-50 border-l-4 border-blue-500 p-4 rounded">
            <h3 class="font-semibold text-blue-900 mb-2">📋 Columnas Requeridas del Excel:</h3>
            <ul class="text-sm text-blue-800 space-y-1">
              <li>• <strong>CODIGO</strong> - Código del producto</li>
              <li>• <strong>DESCRIPCION</strong> - Nombre/Descripción del producto</li>
              <li>• <strong>PRECIO DETAL</strong> - Precio cliente (precio_cliente)</li>
              <li>• <strong>PRECIO MAYOR</strong> - Precio mayor (precio_mayor)</li>
              <li>• <strong>PRECIO GMAYOR</strong> - Precio gran mayor (precio_gmayor)</li>
              <li>• <strong>EXISTENCIA ACTUAL</strong> - Cantidad en stock</li>
              <li>• <strong>DEPARTAMENTO</strong> - Departamento del producto</li>
            </ul>
          </div>

          <!-- Selector de Archivo -->
          <div class="border-2 border-dashed border-green-300 rounded-xl p-8 text-center hover:border-green-500 transition-all cursor-pointer" id="drop-zone">
            <svg class="w-12 h-12 mx-auto text-green-500 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h14a2 2 0 002-2v-6a2 2 0 00-2-2h-2a2 2 0 00-2 2v6m-6-6V5a2 2 0 012-2h2a2 2 0 012 2v6m0 0V5a2 2 0 012-2h2a2 2 0 012 2v6"></path>
            </svg>
            <p class="text-gray-600 font-semibold mb-2">Arrastra tu Excel aquí o haz clic</p>
            <p class="text-sm text-gray-500">Formatos soportados: .xlsx, .xls, .csv</p>
            <input type="file" id="excel-file-input" accept=".xlsx,.xls,.csv" class="hidden" />
          </div>

          <!-- Estado del Archivo -->
          <div id="file-status" class="hidden">
            <div class="bg-green-50 border border-green-300 rounded-lg p-4">
              <p class="text-sm text-green-800"><strong id="file-name">Archivo</strong> cargado correctamente</p>
              <p class="text-xs text-green-700 mt-1">Productos a procesar: <strong id="file-count">0</strong></p>
            </div>
          </div>

          <!-- Botones de Acción -->
          <div class="flex gap-3 pt-4">
            <button id="process-btn" class="flex-1 px-4 py-3 bg-green-600 text-white rounded-xl font-semibold hover:bg-green-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed" 
              disabled>
              Procesar Actualización
            </button>
            <button class="flex-1 px-4 py-3 bg-gray-200 text-gray-700 rounded-xl font-semibold hover:bg-gray-300 transition-all" 
              onclick="this.closest('.fixed').remove()">
              Cancelar
            </button>
          </div>

          <!-- Indicador de Progreso -->
          <div id="progress-container" class="hidden">
            <div class="space-y-2">
              <div class="flex justify-between text-sm">
                <span id="progress-text" class="font-semibold text-gray-700">Procesando...</span>
                <span id="progress-percent">0%</span>
              </div>
              <div class="w-full bg-gray-200 rounded-full h-2">
                <div id="progress-bar" class="bg-green-600 h-2 rounded-full transition-all" style="width: 0%"></div>
              </div>
            </div>
          </div>

          <!-- Resultado -->
          <div id="result-container" class="hidden">
            <div class="space-y-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <h3 class="font-bold text-gray-800">Resumen de Actualización:</h3>
              <ul class="text-sm text-gray-700 space-y-2">
                <li id="result-created">✅ Productos creados: <strong id="result-created-count">0</strong></li>
                <li id="result-updated">✅ Productos actualizados: <strong id="result-updated-count">0</strong></li>
                <li id="result-errors" class="text-red-700">❌ Errores: <strong id="result-errors-count">0</strong></li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modalDiv);

    let excelData = null;

    // Configurar drag and drop
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('excel-file-input');
    const processBtn = document.getElementById('process-btn');
    const fileStatus = document.getElementById('file-status');

    dropZone.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        handleExcelFile(file);
      }
    });

    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('border-green-500', 'bg-green-50');
    });

    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('border-green-500', 'bg-green-50');
    });

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('border-green-500', 'bg-green-50');
      const file = e.dataTransfer.files[0];
      if (file) {
        handleExcelFile(file);
      }
    });

    function handleExcelFile(file) {
      console.log('[UPDATE-EXCEL] Archivo seleccionado:', file.name);

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[sheetName];
          const jsonData = XLSX.utils.sheet_to_json(worksheet);

          console.log('[UPDATE-EXCEL] Datos parseados:', jsonData.length, 'filas');
          console.log('[UPDATE-EXCEL] Primera fila:', jsonData[0]);

          // Validar que tenga las columnas requeridas
          const requiredColumns = ['CODIGO', 'DESCRIPCION', 'PRECIO DETAL', 'PRECIO MAYOR', 'PRECIO GMAYOR', 'EXISTENCIA ACTUAL', 'DEPARTAMENTO'];
          const headers = Object.keys(jsonData[0] || {});

          const missingColumns = requiredColumns.filter(col => !headers.includes(col));
          if (missingColumns.length > 0) {
            alert('❌ Columnas faltantes:\n' + missingColumns.join(', ') + '\n\nAsegúrate que los nombres sean exactos (mayúsculas y minúsculas)');
            return;
          }

          excelData = jsonData;
          fileStatus.classList.remove('hidden');
          document.getElementById('file-name').textContent = file.name;
          document.getElementById('file-count').textContent = jsonData.length;
          processBtn.disabled = false;

          console.log('[UPDATE-EXCEL] Archivo validado correctamente');
        } catch (error) {
          console.error('[UPDATE-EXCEL] Error parseando Excel:', error);
          alert('Error al leer el archivo Excel: ' + error.message);
        }
      };
      reader.readAsArrayBuffer(file);
    }

    processBtn.addEventListener('click', async () => {
      if (!excelData || excelData.length === 0) {
        alert('No hay datos para procesar');
        return;
      }

      await processExcelData(excelData, supabaseClient);
    });

    async function processExcelData(data, supabaseClient) {
      console.log('[UPDATE-PROCESS] Iniciando procesamiento de', data.length, 'productos');

      const progressContainer = document.getElementById('progress-container');
      const resultContainer = document.getElementById('result-container');
      const progressBar = document.getElementById('progress-bar');
      const progressText = document.getElementById('progress-text');
      const progressPercent = document.getElementById('progress-percent');

      processBtn.disabled = true;
      fileStatus.classList.add('hidden');
      progressContainer.classList.remove('hidden');

      let createdCount = 0;
      let updatedCount = 0;
      let errorCount = 0;
      const errors = [];

      try {
        // Obtener productos existentes
        const { data: existingProducts, error: fetchError } = await supabaseClient
          .from('products')
          .select('id, codigo');

        if (fetchError) {
          throw new Error('Error obteniendo productos: ' + fetchError.message);
        }

        const existingCodesMap = new Map(
          (existingProducts || []).map(p => [p.codigo ? p.codigo.toUpperCase() : '', p.id])
        );

        console.log('[UPDATE-PROCESS] Productos existentes en BD:', existingCodesMap.size);

        // Procesar cada fila
        for (let i = 0; i < data.length; i++) {
          const row = data[i];
          const progress = ((i + 1) / data.length) * 100;
          progressBar.style.width = progress + '%';
          progressPercent.textContent = Math.round(progress) + '%';
          progressText.textContent = `Procesando producto ${i + 1}/${data.length}...`;

          try {
          const codigo = row['CODIGO'] ? String(row['CODIGO']).trim().toUpperCase() : '';
          const descripcion = row['DESCRIPCION'] ? String(row['DESCRIPCION']).trim() : '';
          const precioDetal = parseFloat(row['PRECIO DETAL']) || 0;
          const precioMayor = parseFloat(row['PRECIO MAYOR']) || 0;
          const precioGmayor = parseFloat(row['PRECIO GMAYOR']) || 0;
          
          // Buscar existencia con múltiples opciones de nombres de columna
          const existenciaRaw = row['EXISTENCIA ACTUAL'] || 
            row['Existencia Actual'] || 
            row['existencia actual'] || 
            row['Existencia'] || 
            row['existencia'] || 
            row['STOCK'] || 
            row['Stock'] || 
            row['stock'] || 
            row['CANTIDAD'] || 
            row['Cantidad'] || 
            row['cantidad'] || 
            row['QTY'] || 
            row['Qty'] || 
            row['qty'];
          
          // Limpiar y convertir a número
          const existencia = existenciaRaw 
            ? parseInt(String(existenciaRaw).trim().replace(/[^0-9.-]/g, '')) || 0 
            : 0;
          
          const departamento = row['DEPARTAMENTO'] ? String(row['DEPARTAMENTO']).trim() : '';
          
          // DEBUG: Ver qué cantidad se está leyendo
          console.log(`[UPDATE-PROCESS] Stock para ${codigo} (${descripcion}): ${existencia} | Valor raw: "${existenciaRaw}" | Limpio: "${String(existenciaRaw || '').trim()}"`);
          
          if (!codigo || !descripcion) {
            errorCount++;
            errors.push(`Fila ${i + 1}: Código o Descripción vacíos`);
            continue;
          }

          // Validar que al menos un precio no sea 0
          if (precioDetal === 0 && precioMayor === 0 && precioGmayor === 0) {
            errorCount++;
            errors.push(`Fila ${i + 1}: Todos los precios están en 0`);
            continue;
          }

            const existingProductId = existingCodesMap.get(codigo);

            if (existingProductId) {
              // ACTUALIZAR producto existente
              const { error: updateError } = await supabaseClient
                .from('products')
                .update({
                  nombre: descripcion,
                  descripcion: descripcion,
                  precio_cliente: precioDetal,
                  precio_mayor: precioMayor,
                  precio_gmayor: precioGmayor,
                  stock: existencia,
                  departamento: departamento,
                })
                .eq('id', existingProductId);

              if (updateError) {
                throw updateError;
              }

              updatedCount++;
              console.log(`[UPDATE-PROCESS] ✏️ Actualizado: ${codigo} - Stock: ${existencia}`);
            } else {
              // CREAR nuevo producto
              const { error: insertError } = await supabaseClient
                .from('products')
                .insert({
                  codigo: codigo,
                  nombre: descripcion,
                  descripcion: descripcion,
                  precio_cliente: precioDetal,
                  precio_mayor: precioMayor,
                  precio_gmayor: precioGmayor,
                  stock: existencia,
                  departamento: departamento,
                  imagen_url: '', // Sin imagen inicialmente
                });

              if (insertError) {
                throw insertError;
              }

              createdCount++;
              console.log(`[UPDATE-PROCESS] ✨ Creado: ${codigo} - Stock: ${existencia}`);
            }
          } catch (error) {
            errorCount++;
            errors.push(`Fila ${i + 1}: ${error.message}`);
            console.error(`[UPDATE-PROCESS] Error en fila ${i + 1}:`, error);
          }

          // Pequeña pausa para no saturar la BD
          if (i % 10 === 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
        }

        progressContainer.classList.add('hidden');
        resultContainer.classList.remove('hidden');

        document.getElementById('result-created-count').textContent = createdCount;
        document.getElementById('result-updated-count').textContent = updatedCount;
        document.getElementById('result-errors-count').textContent = errorCount;

        if (errors.length > 0) {
          console.warn('[UPDATE-PROCESS] Errores encontrados:', errors);
        }

        console.log('[UPDATE-PROCESS] ✅ Completado! Creados:', createdCount, 'Actualizados:', updatedCount, 'Errores:', errorCount);

        // Recargar productos en la aplicación
        if (window.allProducts) {
          console.log('[UPDATE-PROCESS] Recargando productos en la aplicación...');
          const { data: updatedProducts } = await supabaseClient.from('products').select('*');
          if (updatedProducts) {
            window.allProducts = updatedProducts;
            if (window.renderProducts) {
              window.renderProducts();
            }
          }
        }

        // Cerrar modal automáticamente después de 3 segundos
        setTimeout(() => {
          modalDiv.remove();
        }, 3000);
      } catch (error) {
        console.error('[UPDATE-PROCESS] Error general:', error);
        alert('Error durante la actualización: ' + error.message);
        processBtn.disabled = false;
        progressContainer.classList.add('hidden');
      }
    }
  };
})();
