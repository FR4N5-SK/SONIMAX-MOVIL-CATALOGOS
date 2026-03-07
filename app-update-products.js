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
              <div id="file-stats" class="hidden mt-2 text-sm text-gray-700"></div>
              <div class="flex items-center gap-2 mt-3">
                <input type="checkbox" id="force-update-desc" checked />
                <label for="force-update-desc" class="text-sm font-bold text-gray-800">Forzar actualización de descripciones (Recomendado para corregir nombres)</label>
              </div>
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

              <!-- Listado de productos creados durante esta operación -->
              <div id="result-created-list" class="hidden mt-4 p-3 bg-white border rounded max-h-56 overflow-auto text-sm"></div>
              <div class="mt-3 space-y-2">
                <a id="download-created-csv" class="hidden inline-block bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-all" href="#">Descargar CSV de creados</a>
                <a id="download-skipped-csv" class="hidden inline-block bg-yellow-600 text-white px-4 py-2 rounded-lg hover:bg-yellow-700 transition-all" href="#">Descargar CSV de omitidos</a>
                <div id="result-skipped-list" class="hidden mt-2 text-sm text-yellow-700"></div>
              </div>
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

          // Estadísticas rápidas: filas con descripcion vacía o igual al codigo
          const normalizeCode = (c) => (String(c || '')).trim().toUpperCase();
          const normalizeDesc = (d) => (String(d || '')).trim().toUpperCase();
          let emptyDesc = 0;
          let descEqualsCode = 0;
          for (let i = 0; i < jsonData.length; i++) {
            const r = jsonData[i];
            const codigoRaw = r['CODIGO'] || r['Código'] || r['codigo'] || '';
            const descripcionRaw = r['DESCRIPCION'] || r['Descripción'] || r['DESCRIPCION '] || '';
            const c = normalizeCode(codigoRaw);
            const d = normalizeDesc(descripcionRaw);
            if (!d) emptyDesc++;
            if (c && d && c === d) descEqualsCode++;
          }

          const fileStats = document.getElementById('file-stats');
          fileStats.textContent = `Filas con DESCRIPCION vacía: ${emptyDesc} — Filas con DESCRIPCION igual al CODIGO: ${descEqualsCode}.`;
          fileStats.classList.remove('hidden');

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

      const forceUpdateDesc = document.getElementById('force-update-desc')?.checked || false;

      await processExcelData(excelData, supabaseClient, { forceUpdateDesc });
    });

    async function processExcelData(data, supabaseClient) {
      console.log('[UPDATE-PROCESS] Iniciando procesamiento de', data.length, 'productos (modo batch)');

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

      const CHUNK_SIZE = 100; // Reducido para mayor estabilidad con 10k productos

      // Marca temporal para poder verificar qué productos fueron creados por esta operación
      const opStartISO = new Date().toISOString();
      const createdCodes = [];
      const createdProducts = [];
      // Para reportar sincronizaciones omitidas
      const skippedSyncCodes = [];
      let skippedSyncCount = 0;
      const forceUpdateDesc = (typeof arguments[2] === 'object' && arguments[2].forceUpdateDesc) || false;

      // Helpers
      const normalizeCode = (c) => (String(c || '')).trim().toUpperCase();
      const normalizeDescKey = (d) => (String(d || '')).trim().toUpperCase();

      const parseNumber = (raw) => {
        if (raw == null) return 0;
        let s = String(raw).trim();
        s = s.replace(/[^0-9.,-]/g, '');
        if (s.indexOf('.') !== -1 && s.indexOf(',') !== -1) {
          s = s.replace(/\./g, '');
          s = s.replace(/,/g, '.');
        } else {
          s = s.replace(/,/g, '.');
        }
        const n = parseFloat(s);
        return isNaN(n) ? 0 : n;
      };

      const parseStock = (raw) => Math.round(parseNumber(raw));

      const chunkArray = (arr, size) => {
        const res = [];
        for (let i = 0; i < arr.length; i += size) res.push(arr.slice(i, i + size));
        return res;
      };

      // Helper para reintentar operaciones (útil para inestabilidad de red con muchos datos)
      const retryOperation = async (operation, maxRetries = 3) => {
        for (let i = 0; i < maxRetries; i++) {
          const result = await operation();
          if (!result.error) return result;
          if (i === maxRetries - 1) return result;
          // Esperar un poco antes de reintentar (backoff)
          await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
      };

      try {
        // Cargar productos existentes (PAGINADO para soportar >1000 productos)
        let existingProducts = [];
        let page = 0;
        const pageSize = 1000;
        let hasMore = true;
        
        progressText.textContent = "Cargando inventario actual...";
        
        while (hasMore) {
          const { data, error: fetchError } = await supabaseClient
            .from('products')
            .select('id, codigo, nombre, descripcion')
            .range(page * pageSize, (page + 1) * pageSize - 1);

          if (fetchError) throw new Error('Error obteniendo productos: ' + fetchError.message);
          
          if (data && data.length > 0) {
            existingProducts = existingProducts.concat(data);
            progressText.textContent = `Cargando inventario actual (${existingProducts.length})...`;
            if (data.length < pageSize) hasMore = false;
            page++;
          } else {
            hasMore = false;
          }
        }
        
        console.log(`[UPDATE-PROCESS] Inventario cargado: ${existingProducts.length} productos existentes.`);

        const codesMap = new Map(); // codigo -> id
        const descMap = new Map(); // descripcion -> id
        (existingProducts || []).forEach(p => {
          const codeKey = normalizeCode(p.codigo);
          if (codeKey) codesMap.set(codeKey, p.id);
          const descKey = normalizeDescKey(p.nombre || p.descripcion || '');
          if (descKey && !descMap.has(descKey)) descMap.set(descKey, p.id);
        });

        // Mapas locales para agrupar filas del Excel (evitar duplicados en el mismo archivo)
        const codeRowsMap = new Map(); // codigoKey -> record
        const idUpdateMap = new Map(); // existingId -> record (matched by descripcion)
        const insertRowsMap = new Map(); // descKey -> record (no codigo)

        for (let i = 0; i < data.length; i++) {
          const row = data[i];

          const codigoRaw = row['CODIGO'] || row['Código'] || row['codigo'] || '';
          const codigoKey = normalizeCode(codigoRaw);
          const descripcion = row['DESCRIPCION'] || row['Descripción'] || row['DESCRIPCION '] || '';
          const descKey = normalizeDescKey(descripcion);

          const precioDetal = parseNumber(row['PRECIO DETAL']);
          const precioMayor = parseNumber(row['PRECIO MAYOR']);
          const precioGmayor = parseNumber(row['PRECIO GMAYOR']);

          const existenciaRaw = row['EXISTENCIA ACTUAL'] || row['Existencia Actual'] || row['Existencia'] || row['Stock'] || row['stock'] || row['CANTIDAD'] || row['Cantidad'] || row['cantidad'] || row['QTY'] || row['Qty'] || row['qty'];
          const stock = parseStock(existenciaRaw);

          const departamento = row['DEPARTAMENTO'] || row['Departamento'] || row['departamento'] || '';

          // Validaciones básicas
          if (!codigoKey && !descKey) {
            errorCount++;
            errors.push(`Fila ${i + 1}: sin código ni descripción`);
            continue;
          }

          if (precioDetal === 0 && precioMayor === 0 && precioGmayor === 0) {
            errorCount++;
            errors.push(`Fila ${i + 1}: precios inválidos`);
            continue;
          }

          const estado = stock === 0 ? 'agotado' : (stock < 5 ? 'pocas unidades' : 'disponible');

          // Si falta departamento, usar fallback 'GENERAL' para evitar fallos por NOT NULL en la BD
          if (!departamento || (String(departamento).trim() === '')) {
            console.warn(`[UPDATE-PROCESS] Fila ${i + 1}: departamento vacío. Usando 'GENERAL' como valor por defecto.`);
          }

          const record = {
            codigo: codigoKey || null,
            nombre: descripcion || (codigoRaw ? codigoRaw : null),
            descripcion: descripcion || (codigoRaw ? codigoRaw : null),
            precio_cliente: precioDetal,
            precio_mayor: precioMayor,
            precio_gmayor: precioGmayor,
            stock: stock,
            departamento: (departamento && String(departamento).trim() !== '') ? departamento : 'GENERAL',
            estado: estado
          };

          // Si hay código, agrupar por código (último valor gana)
          if (codigoKey) {
            codeRowsMap.set(codigoKey, record);
            continue;
          }

          // Si no hay código pero descripción coincide con producto existente -> actualizar por id
          if (descKey && descMap.has(descKey)) {
            const existingId = descMap.get(descKey);
            idUpdateMap.set(existingId, record);
            continue;
          }

          // No hay código y no existe en BD, agrupar para insertar sin codigo (por descripción única)
          if (descKey) {
            insertRowsMap.set(descKey, record);
          }
        }

        // Preparar arrays
        const upsertByCode = Array.from(codeRowsMap.values());
        const updatesById = Array.from(idUpdateMap.entries()).map(([id, rec]) => ({ id, ...rec }));
        const insertsNoCode = Array.from(insertRowsMap.values());

        const totalOps = upsertByCode.length + updatesById.length + insertsNoCode.length;
        let completedOps = 0;

        const updateProgressUI = () => {
          const pct = totalOps === 0 ? 100 : Math.round((completedOps / totalOps) * 100);
          progressBar.style.width = pct + '%';
          progressPercent.textContent = pct + '%';
          progressText.textContent = `Procesando: ${completedOps}/${totalOps}`;
        };

        // ===== 1) Upsert por código (bulk, en chunks) =====
        if (upsertByCode.length > 0) {
          const chunks = chunkArray(upsertByCode, CHUNK_SIZE);
          for (const chunk of chunks) {
            // Intentamos upsert en bloque por 'codigo'. Si la BD no tiene UNIQUE sobre 'codigo' (error 42P10),
            // caemos a un flujo de fallback que hace updates/inserts por registro para no abortar todo el proceso.

            // Precomputar existencia para conteo correcto después de la operación
            const existsBefore = chunk.map(r => codesMap.has((r.codigo || '').toString().toUpperCase()));

            const { data: upserted, error: upsertError } = await retryOperation(() => supabaseClient
              .from('products')
              .upsert(chunk, { onConflict: 'codigo' })
              .select('id, codigo'));

            if (upsertError) {
              console.error('[UPDATE-PROCESS] Upsert error:', upsertError);

              // Si el error es por falta de UNIQUE/INDEX para ON CONFLICT -> fallback por registro
              const msg = (upsertError && (upsertError.code === '42P10' || /ON CONFLICT/i.test(upsertError.message || '')));
              if (msg) {
                console.warn('[UPDATE-PROCESS] ON CONFLICT no soportado (falta UNIQUE). Ejecutando fallback por registro...');
                errors.push('ON CONFLICT no soportado: se ejecutó fallback por registro. Mejora recomendada: crear UNIQUE INDEX en products(codigo) para mejor rendimiento.');

                for (let i = 0; i < chunk.length; i++) {
                  const item = chunk[i];
                  const codeKey = (item.codigo || '').toString().toUpperCase();

                  try {
                    if (codesMap.has(codeKey)) {
                      // actualizar por código
                      const { data: updatedRows, error: updateErr } = await retryOperation(() => supabaseClient
                        .from('products')
                        .update({
                          nombre: item.nombre,
                          descripcion: item.descripcion,
                          precio_cliente: item.precio_cliente,
                          precio_mayor: item.precio_mayor,
                          precio_gmayor: item.precio_gmayor,
                          stock: item.stock,
                          departamento: item.departamento,
                          estado: item.estado
                        })
                        .eq('codigo', codeKey)
                        .select('id, codigo')
                        .limit(1));

                      if (updateErr) {
                        errorCount++;
                        errors.push(`Error actualizando por codigo ${codeKey}: ${updateErr.message}`);
                        console.error('[UPDATE-PROCESS] Update by code error:', updateErr);
                      } else if (updatedRows && updatedRows.length > 0) {
                        updatedCount++;
                        codesMap.set(codeKey, updatedRows[0].id);
                      } else {
                        // No se encontró fila para actualizar (peculiar) -> intentar insertar
                        const { data: inserted, error: insertErr } = await retryOperation(() => supabaseClient
                          .from('products')
                          .insert(item)
                          .select('id, codigo')
                          .single());

                        if (insertErr) {
                          errorCount++;
                          errors.push(`Error insertando por fallback (codigo ${codeKey}): ${insertErr.message}`);
                          console.error('[UPDATE-PROCESS] Insert fallback error:', insertErr);
                        } else {
                          createdCount++;
                          const ckey = (inserted.codigo || '').toString().toUpperCase();
                          createdCodes.push(ckey);
                          createdProducts.push({ id: inserted.id, codigo: ckey });
                          codesMap.set(ckey, inserted.id);
                        }
                      }

                    } else {
                      // insertar nuevo
                      const { data: inserted, error: insertErr } = await retryOperation(() => supabaseClient
                        .from('products')
                        .insert(item)
                        .select('id, codigo')
                        .single());

                      if (insertErr) {
                        errorCount++;
                        errors.push(`Error insertando por fallback (codigo ${codeKey}): ${insertErr.message}`);
                        console.error('[UPDATE-PROCESS] Insert fallback error:', insertErr);
                      } else {
                        createdCount++;
                        codesMap.set((inserted.codigo || '').toString().toUpperCase(), inserted.id);
                      }
                    }
                  } catch (err) {
                    errorCount++;
                    errors.push(`Error procesando registro con codigo ${codeKey}: ${err.message || err}`);
                    console.error('[UPDATE-PROCESS] Fallback unexpected error:', err);
                  }
                }

              } else {
                // Error distinto: contar todo el chunk como error para visibilidad
                errorCount += chunk.length;
                errors.push('Error al upsert por código: ' + upsertError.message);
              }

            } else {
              // Upsert exitoso: actualizar codesMap y conteos según existencia previa
              upserted?.forEach(p => {
                const key = (p.codigo || '').toString().toUpperCase();
                if (codesMap.has(key)) {
                  updatedCount++;
                } else {
                  createdCount++;
                  createdCodes.push(key);
                  createdProducts.push({ id: p.id, codigo: key });
                }
                codesMap.set(key, p.id);
              });
            }

            completedOps += chunk.length;
            updateProgressUI();
            await new Promise(r => setTimeout(r, 200));
          }
        }

        // ===== 2) Updates por ID (matched by descripcion) =====
        if (updatesById.length > 0) {
          const chunks = chunkArray(updatesById, CHUNK_SIZE);
          for (const chunk of chunks) {
            // hacer updates secuenciales para cada id dentro del chunk
            for (const item of chunk) {
              const id = item.id;
              const { error: updateErr } = await retryOperation(() => supabaseClient
                .from('products')
                .update({
                  nombre: item.nombre,
                  descripcion: item.descripcion,
                  precio_cliente: item.precio_cliente,
                  precio_mayor: item.precio_mayor,
                  precio_gmayor: item.precio_gmayor,
                  stock: item.stock,
                  departamento: item.departamento,
                  estado: item.estado
                })
                .eq('id', id));

              if (updateErr) {
                errorCount++;
                errors.push(`Error actualizando ID ${id}: ${updateErr.message}`);
              } else {
                updatedCount++;
              }

              completedOps++;
              updateProgressUI();
            }
            await new Promise(r => setTimeout(r, 200));
          }
        }

        // ===== 3) Insertar sin código en batch =====
        if (insertsNoCode.length > 0) {
          const chunks = chunkArray(insertsNoCode, CHUNK_SIZE);
          for (const chunk of chunks) {
            const { data: insertedData, error: insertError } = await retryOperation(() => supabaseClient
              .from('products')
              .insert(chunk)
              .select('id, codigo, nombre, departamento, created_at'));

            if (insertError) {
              errorCount += chunk.length;
              errors.push('Error insertando nuevos productos: ' + insertError.message);
              console.error('[UPDATE-PROCESS] Insert error:', insertError);
            } else {
              const n = insertedData?.length || chunk.length;
              createdCount += n;
              (insertedData || []).forEach(r => {
                createdProducts.push({ id: r.id, codigo: (r.codigo || null), nombre: (r.nombre || null), departamento: (r.departamento || null), created_at: r.created_at || null });
                if (r.codigo) createdCodes.push((r.codigo || '').toString().toUpperCase());
              });
            }

            completedOps += chunk.length;
            updateProgressUI();
            await new Promise(r => setTimeout(r, 200));
          }
        }

        // ============================================================
        // MARCAR COMO AGOTADOS LOS PRODUCTOS QUE NO ESTÁN EN EL EXCEL
        // ============================================================
        progressText.textContent = "Verificando productos faltantes...";
        const excelCodes = new Set(Array.from(codeRowsMap.keys()));
        const dbCodes = new Set(existingProducts.map(p => normalizeCode(p.codigo)));
        
        const missingCodes = [...dbCodes].filter(code => !excelCodes.has(code));

        if (missingCodes.length > 0) {
            console.log(`[UPDATE-PROCESS] 📉 Encontrados ${missingCodes.length} productos para marcar como agotados.`);
            progressText.textContent = `Marcando ${missingCodes.length} productos como agotados...`;

            // Marcar en la tabla 'products'
            const { error: stockError } = await supabaseClient.from('products').update({ stock: 0 }).in('codigo', missingCodes);
            if (stockError) console.error('[UPDATE-PROCESS] Error al poner stock 0 en products:', stockError);

            // Marcar en la tabla 'inventory_products'
            const { error: invStockError } = await supabaseClient.from('inventory_products').update({ existencia_actual: 0 }).in('codigo', missingCodes);
            if (invStockError) console.error('[UPDATE-PROCESS] Error al poner stock 0 en inventory_products:', invStockError);

            console.log(`[UPDATE-PROCESS] ✅ ${missingCodes.length} productos marcados como agotados en ambas tablas.`);
        } else {
            console.log('[UPDATE-PROCESS] ✅ No se encontraron productos faltantes en el Excel. No se marcó nada como agotado.');
        }

        // ============================================================
        // SINCRONIZACIÓN CON TABLA DE INVENTARIO (NUEVO REQUERIMIENTO)
        // ============================================================
        try {
            progressText.textContent = "Sincronizando tabla de inventario...";
            console.log('[UPDATE-PROCESS] Iniciando sincronización con inventory_products...');

            // Preparamos los datos para inventory_products
            // Solo enviamos las columnas del sistema. NO enviamos 'deposito' ni 'cantidad_fisica'
            // para que el upsert las mantenga intactas si ya existen.
            const inventoryData = upsertByCode.map(p => ({
                codigo: (p.codigo || '').toString().toUpperCase(),
                descripcion: p.descripcion,
                precio_detal: p.precio_cliente,
                precio_mayor: p.precio_mayor,
                precio_gmayor: p.precio_gmayor,
                existencia_actual: p.stock,
                departamento: p.departamento
            })).filter(p => p.codigo); // Asegurar que tenga código

            if (inventoryData.length > 0) {
                const invChunks = chunkArray(inventoryData, CHUNK_SIZE);
                let invProcessed = 0;
                
                for (const chunk of invChunks) {
                    // Upsert basado en 'codigo'. Actualizará precios/nombres pero dejará deposito/cantidad quietos
                    const { error: invError } = await supabaseClient
                        .from('inventory_products')
                        .upsert(chunk, { onConflict: 'codigo' });
                        
                    if(invError) console.error('[UPDATE-PROCESS] Error sync inventory:', invError);
                    invProcessed += chunk.length;
                }
                console.log(`[UPDATE-PROCESS] ✅ ${invProcessed} productos sincronizados con inventario.`);
            }
        } catch (invErr) {
            console.error('[UPDATE-PROCESS] Error crítico sincronizando inventario:', invErr);
        }

        // Finalizar UI
        progressContainer.classList.add('hidden');
        resultContainer.classList.remove('hidden');

        document.getElementById('result-created-count').textContent = createdCount;
        document.getElementById('result-updated-count').textContent = updatedCount;
        document.getElementById('result-errors-count').textContent = errorCount;

        if (errors.length > 0) console.warn('[UPDATE-PROCESS] Errores:', errors);

        console.log('[UPDATE-PROCESS] ✅ Completado! Creados:', createdCount, 'Actualizados:', updatedCount, 'Errores:', errorCount);

        // Recargar productos en la aplicación
        if (window.allProducts) {
          console.log('[UPDATE-PROCESS] Recargando productos en la aplicación...');
          
          // FIX: Usar paginación para cargar TODOS los productos (evitar límite de 1000 de Supabase)
          let allUpdatedProducts = [];
          let p = 0;
          const pSize = 1000;
          let more = true;

          try {
            while (more) {
              const { data: batch, error: batchErr } = await supabaseClient
                .from('products')
                .select('*')
                .range(p * pSize, (p + 1) * pSize - 1);

              if (batchErr) throw batchErr;

              if (batch && batch.length > 0) {
                allUpdatedProducts = allUpdatedProducts.concat(batch);
                if (batch.length < pSize) more = false;
                p++;
              } else {
                more = false;
              }
            }

            if (allUpdatedProducts.length > 0) {
              // [MODIFICADO] Ordenar productos al recargar: Stock > 0 primero
              allUpdatedProducts.sort((a, b) => {
                const stockA = (a.stock || 0) > 0 ? 1 : 0;
                const stockB = (b.stock || 0) > 0 ? 1 : 0;
                if (stockA !== stockB) return stockB - stockA;
                return (a.nombre || '').localeCompare(b.nombre || '');
              });

              window.allProducts = allUpdatedProducts;
              if (window.renderProducts) window.renderProducts();
              console.log(`[UPDATE-PROCESS] Inventario recargado: ${allUpdatedProducts.length} productos.`);
            }
          } catch (err) {
            console.error('[UPDATE-PROCESS] Error recargando inventario:', err);
          }
        }

        // Verificar y mostrar productos creados durante esta operación
        try {
          const { data: newRows, error: fetchNewErr } = await supabaseClient
            .from('products')
            .select('id, codigo, nombre, departamento, created_at')
            .gte('created_at', opStartISO)
            .order('created_at', { ascending: false });

          if (fetchNewErr) {
            console.warn('[UPDATE-PROCESS] Error obteniendo productos creados:', fetchNewErr);
          } else if (newRows && newRows.length > 0) {
            console.log('[UPDATE-PROCESS] Productos creados en esta operación:', newRows);

            // Marcar como is_new en la BD para que aparezcan en 'Mercancía Recién Llegada'
            try {
              const newIds = newRows.map(r => r.id).filter(Boolean);
              if (newIds.length > 0) {
                const { error: markError } = await supabaseClient
                  .from('products')
                  .update({ is_new: true })
                  .in('id', newIds);

                if (markError) console.warn('[UPDATE-PROCESS] Error marcando is_new:', markError);
                else {
                  console.log(`[UPDATE-PROCESS] ✅ ${newIds.length} productos marcados como is_new`);

                  // Guardar lista limitada localmente para compatibilidad con la UI
                  try {
                    if (window.saveNewProducts) window.saveNewProducts(newIds.slice(0, 100));
                  } catch (err) {
                    console.warn('[UPDATE-PROCESS] Error saveNewProducts:', err);
                  }

                  // Actualizar cache local y re-renderizar
                  if (window.allProducts && window.renderProducts) {
                    window.allProducts = window.allProducts.map(p => (newIds.includes(p.id) ? { ...p, is_new: true } : p));
                    window.renderProducts();
                  }
                }
              }
            } catch (err) {
              console.error('[UPDATE-PROCESS] Error marcando productos nuevos:', err);
            }

            // ===== Sincronizar nombre y descripcion por codigo (si difieren del Excel) =====
            try {
              const codesToCheck = Array.from(codeRowsMap.keys());

              // Procesar en chunks para no saturar
              const chunksToCheck = chunkArray(codesToCheck, CHUNK_SIZE);
              for (const codesChunk of chunksToCheck) {
                // 1) Intentar búsqueda directa por 'codigo' (exact match)
                let { data: dbRowsDirect, error: fetchErr } = await supabaseClient
                  .from('products')
                  .select('id,codigo,nombre,descripcion')
                  .in('codigo', codesChunk);

                if (fetchErr) {
                  console.warn('[UPDATE-PROCESS] Error fetching products (direct) for sync:', fetchErr);
                  dbRowsDirect = [];
                }

                // Recolectar los códigos encontrados
                const foundCodes = new Set((dbRowsDirect || []).map(r => (r.codigo || '').toString().toUpperCase()));
                const missing = codesChunk.filter(c => !foundCodes.has(c));

                // 2) Para los faltantes, intentar búsquedas case-insensitive y por patrón
                const dbRowsFallback = [];
                for (const code of missing) {
                  try {
                    // exacto case-insensitive
                    const { data: rowsCI, error: ciErr } = await supabaseClient
                      .from('products')
                      .select('id,codigo,nombre,descripcion')
                      .ilike('codigo', code);

                    if (ciErr) {
                      console.warn('[UPDATE-PROCESS] Error ilike search for codigo', code, ciErr);
                    } else if (rowsCI && rowsCI.length > 0) {
                      dbRowsFallback.push(...rowsCI);
                      continue;
                    }

                    // patrón
                    const { data: rowsPat, error: patErr } = await supabaseClient
                      .from('products')
                      .select('id,codigo,nombre,descripcion')
                      .ilike('codigo', `%${code}%`);

                    if (patErr) {
                      console.warn('[UPDATE-PROCESS] Error pattern search for codigo', code, patErr);
                    } else if (rowsPat && rowsPat.length > 0) {
                      dbRowsFallback.push(...rowsPat);
                    }
                  } catch (err) {
                    console.warn('[UPDATE-PROCESS] Fallback search error for codigo', code, err);
                  }
                }

                const dbRows = (dbRowsDirect || []).concat(dbRowsFallback);

                // 3) Actualizar filas encontradas si difieren
                for (const dbRow of dbRows) {
                  const normCode = (dbRow.codigo || '').toString().toUpperCase().trim();
                  const rec = codeRowsMap.get(normCode);
                  if (!rec) continue; // no tenemos datos del Excel para este codigo

                  const dbNombre = (dbRow.nombre || '').toString();
                  const dbDesc = (dbRow.descripcion || '').toString();
                  const newNombre = (rec.nombre || '').toString();
                  const newDesc = (rec.descripcion || '').toString();

                  // Si la fila en el Excel solo tiene el codigo como descripcion, no sobrescribimos
                  if (!forceUpdateDesc && ((newNombre === normCode && newDesc === normCode) || (!newNombre && !newDesc))) {
                    skippedSyncCount++;
                    if (!skippedSyncCodes.includes(normCode)) skippedSyncCodes.push(normCode);
                    continue;
                  }

                  if (dbNombre !== newNombre || dbDesc !== newDesc) {
                    const { error: updErr } = await supabaseClient
                      .from('products')
                      .update({ nombre: newNombre, descripcion: newDesc })
                      .eq('id', dbRow.id);

                    if (updErr) {
                      console.warn('[UPDATE-PROCESS] Error actualizando nombre/descripcion para codigo', dbRow.codigo, updErr);
                    } else {
                      console.log('[UPDATE-PROCESS] Sincronizado producto codigo', dbRow.codigo);
                      if (window.allProducts) {
                        window.allProducts = window.allProducts.map(p => (p.id === dbRow.id ? { ...p, nombre: newNombre, descripcion: newDesc } : p));
                      }
                    }
                  }
                }
              }
            } catch (err) {
              console.error('[UPDATE-PROCESS] Error sincronizando nombres/descripciones:', err);
            }

            const listDiv = document.getElementById('result-created-list');
            const downloadLink = document.getElementById('download-created-csv');
            listDiv.classList.remove('hidden');
            listDiv.innerHTML = `
              <h4 class="font-semibold mb-2">Productos agregados durante esta actualización (${newRows.length}):</h4>
              <ul class="text-sm space-y-1">${newRows.map(r => `<li>${r.codigo || '(sin codigo)'} — ${r.nombre || ''} — ${r.departamento || ''} — ${new Date(r.created_at).toLocaleString()}</li>`).join('')}</ul>
            `;

            // preparar CSV y enlace de descarga
            const csvRows = ['id,codigo,nombre,departamento,created_at', ...newRows.map(r => `${r.id},${JSON.stringify(r.codigo||'')},${JSON.stringify(r.nombre||'')},${JSON.stringify(r.departamento||'')},${r.created_at || ''}`)];
            const csv = csvRows.join('\n');
            const blob = new Blob([csv], { type: 'text/csv' });
            const url = URL.createObjectURL(blob);
            downloadLink.href = url;
            downloadLink.classList.remove('hidden');
            downloadLink.download = `created_products_${Date.now()}.csv`;

            // Informar si hubo sincronizaciones omitidas
            if (skippedSyncCount > 0) {
              const skippedLink = document.getElementById('download-skipped-csv');
              const skippedDiv = document.getElementById('result-skipped-list');
              skippedDiv.classList.remove('hidden');
              skippedDiv.textContent = `Se omitieron ${skippedSyncCount} sincronizaciones (DESCRIPCION = CODIGO). Marca 'Forzar actualizar' si quieres forzar y vuelve a ejecutar.`;

              const skippedCsvRows = ['codigo', ...skippedSyncCodes.map(c => `${c}`)];
              const skippedCsv = skippedCsvRows.join('\n');
              const skippedBlob = new Blob([skippedCsv], { type: 'text/csv' });
              const skippedUrl = URL.createObjectURL(skippedBlob);
              skippedLink.href = skippedUrl;
              skippedLink.classList.remove('hidden');
              skippedLink.download = `skipped_sync_codes_${Date.now()}.csv`;
            }
          }
        } catch (err) {
          console.error('[UPDATE-PROCESS] Error verificando productos creados:', err);
        }

        // Cerrar modal automáticamente después de 3 segundos
        setTimeout(() => modalDiv.remove(), 3000);
      } catch (error) {
        console.error('[UPDATE-PROCESS] Error general:', error);
        alert('Error durante la actualización: ' + error.message);
        processBtn.disabled = false;
        progressContainer.classList.add('hidden');
      }
    }
  };
})();
