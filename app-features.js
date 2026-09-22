// ============================================
// EXTENSIONES DE CARACTERÍSTICAS - SONIMAX MÓVIL
// ============================================
// Usa variables GLOBALES del archivo principal (current-user.js)
// NO declara propias, accede a las del window

(function() {
  'use strict';

  // Acceder a variables GLOBALES (definidas en app.js)
  const getGlobalState = () => ({
    currentUserRole: window.currentUserRole || null,
    allProducts: window.allProducts || [],
    supabaseClient: window.supabaseClient,
  });

  // Importación de XLSX
  const XLSX = window.XLSX;

  // Helper para comprimir archivo de imagen antes de subir a Supabase
  const compressImageToBlob = (file, maxDim = 800, quality = 0.75) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let width = img.width;
          let height = img.height;
          if (width > height && width > maxDim) {
            height = Math.round(height * (maxDim / width));
            width = maxDim;
          } else if (height > maxDim) {
            width = Math.round(width * (maxDim / height));
            height = maxDim;
          }

          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, width);
          canvas.height = Math.max(1, height);
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

          canvas.toBlob((blob) => {
            if (blob) resolve(blob);
            else reject(new Error('No se pudo generar el blob de la imagen'));
          }, 'image/webp', quality);
        };
        img.onerror = () => reject(new Error('Error al cargar la imagen seleccionada'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('Error al leer el archivo'));
      reader.readAsDataURL(file);
    });
  };

  const uploadProductPhotoFile = async (file, productId) => {
    // Usar DIRECTAMENTE el bucket del servidor VIEJO (Plan Pro - tuqwzrsgczhgmfnfmryw)
    const storageClient = window.supabaseOldClient;
    if (!storageClient || !storageClient.storage) {
      throw new Error("Cliente de Supabase viejo (Storage) no disponible en supabase-config.js");
    }

    // 1. Comprimir en cliente (WebP a 800px max, peso < 60KB)
    const compressedBlob = await compressImageToBlob(file, 800, 0.75);
    
    // 2. Nombre limpio en el bucket
    const cleanId = String(productId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `products/${cleanId}_${Date.now()}.webp`;

    // 3. Subir al bucket product-images del servidor VIEJO
    const { error: uploadErr } = await storageClient.storage
      .from('product-images')
      .upload(filename, compressedBlob, {
        contentType: 'image/webp',
        cacheControl: '31536000',
        upsert: true
      });

    if (uploadErr) {
      const errMsg = (uploadErr.message || uploadErr.error || '').toLowerCase();
      if (errMsg.includes('bucket not found') || errMsg.includes('nosuchbucket')) {
        throw new Error("El bucket 'product-images' no existe en el Supabase viejo.");
      }
      if (errMsg.includes('row-level security') || errMsg.includes('policy')) {
        throw new Error("Falta la política de acceso (RLS) en el bucket 'product-images' del Supabase viejo.");
      }
      throw new Error(`Error en Storage: ${uploadErr.message}`);
    }

    const { data: urlData } = storageClient.storage.from('product-images').getPublicUrl(filename);
    return urlData.publicUrl;
  };

  // ============================================
  // HELPER: Normalizar texto para comparacion
  // ============================================
  function _normalizeForMatch(str) {
    return (str || '')
      .toString()
      .trim()
      .toUpperCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quitar tildes
      .replace(/[^A-Z0-9]/g, ' ')                        // no alfanum -> espacio
      .replace(/\s+/g, ' ')                               // colapsar espacios
      .trim();
  }

  // Busca el producto en allProducts que mejor coincide con el nombre de archivo
  function _matchFileToProduct(fileName, products) {
    const baseName = _normalizeForMatch(fileName.replace(/\.[^.]+$/, '')); // quitar extension
    let best = null;
    let bestScore = 0;

    for (const p of products) {
      const codigo  = _normalizeForMatch(p.codigo);
      const nombre  = _normalizeForMatch(p.nombre || p.descripcion);

      // 1. Coincidencia exacta por código
      if (codigo && baseName === codigo) return { product: p, score: 100, matchType: 'Código exacto' };
      // 2. El nombre de archivo contiene el código como palabra entera
      if (codigo && baseName.includes(codigo) && codigo.length >= 3) {
        const score = 90 + (codigo.length / baseName.length) * 10;
        if (score > bestScore) { best = p; bestScore = score; p._matchType = 'Código parcial'; }
      }
      // 3. El código contiene el nombre del archivo
      if (codigo && codigo.includes(baseName) && baseName.length >= 3) {
        const score = 80;
        if (score > bestScore) { best = p; bestScore = score; p._matchType = 'Código contiene nombre'; }
      }
      // 4. Coincidencia exacta por nombre
      if (nombre && baseName === nombre) {
        const score = 85;
        if (score > bestScore) { best = p; bestScore = score; p._matchType = 'Nombre exacto'; }
      }
      // 5. Nombre del archivo contiene el nombre del producto (>= 8 chars)
      if (nombre && nombre.length >= 8 && baseName.includes(nombre)) {
        const score = 70 + (nombre.length / baseName.length) * 10;
        if (score > bestScore) { best = p; bestScore = score; p._matchType = 'Nombre parcial'; }
      }
    }
    return best ? { product: best, score: bestScore, matchType: best._matchType || 'Parcial' } : null;
  }

  // Modal de previsualización para carga masiva desde carpeta
  async function _showFolderBulkPreview(files, allProducts, modalDiv) {
    const { supabaseClient } = getGlobalState();
    const activeClient = supabaseClient || window.supabaseClient;

    // Filtrar solo imágenes
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      alert('No se encontraron imágenes en la carpeta seleccionada.');
      return;
    }

    // Emparejar cada imagen con un producto
    const pairs = imageFiles.map(file => {
      const match = _matchFileToProduct(file.name, allProducts);
      return { file, match, selected: !!match };
    });

    // Crear modal de previsualización
    const previewModal = document.createElement('div');
    previewModal.className = 'fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[60] p-3 overflow-y-auto';
    previewModal.innerHTML = `
      <div class="bg-white dark:bg-gray-800 rounded-2xl max-w-3xl w-full shadow-2xl my-4 border border-gray-100 dark:border-gray-700">
        <div class="bg-gradient-to-r from-violet-600 to-violet-700 p-5 text-white sticky top-0 z-10 rounded-t-2xl flex items-center justify-between">
          <div>
            <h2 class="text-xl font-bold flex items-center gap-2">📁 Vista Previa — Carga Masiva desde Carpeta</h2>
            <p class="text-violet-100 text-sm mt-0.5">${imageFiles.length} imágenes encontradas — Revisa y confirma los emparejamientos</p>
          </div>
          <button id="bulk-preview-close" class="text-white hover:bg-violet-800 p-2 rounded-xl transition text-xl font-bold">✕</button>
        </div>

        <!-- Resumen -->
        <div class="px-5 py-3 bg-violet-50 dark:bg-gray-700 border-b border-violet-100 dark:border-gray-600 flex flex-wrap gap-4 text-sm">
          <span class="font-semibold text-violet-800 dark:text-violet-200">
            ✅ <span id="bulk-match-count">${pairs.filter(p=>p.match).length}</span> con producto encontrado
          </span>
          <span class="font-semibold text-red-600 dark:text-red-400">
            ❌ <span id="bulk-nomatch-count">${pairs.filter(p=>!p.match).length}</span> sin coincidencia
          </span>
          <span class="font-semibold text-gray-600 dark:text-gray-300">
            ☑️ <span id="bulk-selected-count">${pairs.filter(p=>p.selected).length}</span> seleccionadas para subir
          </span>
        </div>

        <!-- Tabla de pares -->
        <div id="bulk-pairs-list" class="divide-y divide-gray-100 dark:divide-gray-700 max-h-[50vh] overflow-y-auto">
        </div>

        <!-- Barra de progreso (oculta inicialmente) -->
        <div id="bulk-progress-section" class="hidden px-5 py-4 bg-gray-50 dark:bg-gray-700 border-t border-gray-100">
          <div class="flex justify-between text-sm mb-1">
            <span id="bulk-progress-text" class="font-semibold text-gray-700 dark:text-gray-200">Procesando...</span>
            <span id="bulk-progress-pct" class="text-gray-500">0%</span>
          </div>
          <div class="w-full bg-gray-200 rounded-full h-2.5">
            <div id="bulk-progress-bar" class="bg-violet-600 h-2.5 rounded-full transition-all" style="width:0%"></div>
          </div>
        </div>

        <!-- Acciones -->
        <div class="p-5 border-t border-gray-100 dark:border-gray-700 flex gap-3">
          <button id="bulk-upload-btn" class="flex-1 py-3 px-5 bg-gradient-to-r from-violet-600 to-violet-700 hover:from-violet-700 hover:to-violet-800 text-white font-bold rounded-xl shadow-md transition flex items-center justify-center gap-2 text-sm">
            🚀 Subir Fotos Seleccionadas (<span id="bulk-count-label">${pairs.filter(p=>p.selected).length}</span>)
          </button>
          <button id="bulk-cancel-btn" class="py-3 px-5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 font-semibold rounded-xl hover:bg-gray-200 transition text-sm">
            Cancelar
          </button>
        </div>
      </div>
    `;
    document.body.appendChild(previewModal);

    // Renderizar la tabla de pares
    function renderPairs() {
      const listEl = previewModal.querySelector('#bulk-pairs-list');
      listEl.innerHTML = pairs.map((pair, idx) => {
        const p = pair.match ? pair.match.product : null;
        const previewUrl = URL.createObjectURL(pair.file);
        const hasMatch = !!p;
        const rowBg = !hasMatch ? 'bg-red-50 dark:bg-red-900/10' : (pair.selected ? '' : 'opacity-50');
        return `
          <div class="flex items-center gap-3 px-4 py-3 ${rowBg} hover:bg-gray-50 dark:hover:bg-gray-700/50 transition" data-pair-idx="${idx}">
            <!-- Checkbox -->
            <input type="checkbox" class="bulk-pair-check w-4 h-4 accent-violet-600 cursor-pointer flex-shrink-0"
              data-idx="${idx}" ${pair.selected ? 'checked' : ''} ${!hasMatch ? 'disabled' : ''}>
            <!-- Miniatura imagen -->
            <img src="${previewUrl}" class="w-12 h-12 object-cover rounded-lg shadow-sm flex-shrink-0 border border-gray-200" loading="lazy">
            <!-- Info archivo -->
            <div class="flex-1 min-w-0">
              <p class="text-xs font-semibold text-gray-700 dark:text-gray-200 truncate">${pair.file.name}</p>
              <p class="text-[10px] text-gray-400 mt-0.5">${Math.round(pair.file.size/1024)} KB</p>
            </div>
            <!-- Flecha -->
            <span class="text-gray-300 text-lg flex-shrink-0">${hasMatch ? '→' : '✗'}</span>
            <!-- Producto encontrado -->
            <div class="flex-1 min-w-0 ${hasMatch ? '' : 'text-red-500'}">
              ${hasMatch
                ? `<p class="text-xs font-bold text-gray-900 dark:text-white truncate">${p.codigo || ''}</p>
                   <p class="text-[10px] text-gray-500 dark:text-gray-400 truncate">${p.nombre || ''}</p>
                   <span class="text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${pair.match.score >= 90 ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}">${pair.match.matchType} (${Math.round(pair.match.score)}%)</span>`
                : '<p class="text-xs font-semibold">Sin coincidencia</p><p class="text-[10px] text-gray-400">Revisa el nombre del archivo</p>'}
            </div>
          </div>`;
      }).join('');

      // Actualizar contadores
      const sel = pairs.filter(p => p.selected).length;
      previewModal.querySelector('#bulk-selected-count').textContent = sel;
      previewModal.querySelector('#bulk-count-label').textContent = sel;
      previewModal.querySelector('#bulk-match-count').textContent = pairs.filter(p=>p.match).length;
      previewModal.querySelector('#bulk-nomatch-count').textContent = pairs.filter(p=>!p.match).length;
    }
    renderPairs();

    // Toggle checkboxes
    previewModal.querySelector('#bulk-pairs-list').addEventListener('change', (e) => {
      if (e.target.classList.contains('bulk-pair-check')) {
        const idx = parseInt(e.target.dataset.idx);
        pairs[idx].selected = e.target.checked;
        const sel = pairs.filter(p => p.selected).length;
        previewModal.querySelector('#bulk-selected-count').textContent = sel;
        previewModal.querySelector('#bulk-count-label').textContent = sel;
      }
    });

    // Cerrar
    previewModal.querySelector('#bulk-preview-close').addEventListener('click', () => previewModal.remove());
    previewModal.querySelector('#bulk-cancel-btn').addEventListener('click', () => previewModal.remove());

    // Subida masiva
    previewModal.querySelector('#bulk-upload-btn').addEventListener('click', async () => {
      const toUpload = pairs.filter(p => p.selected && p.match);
      if (toUpload.length === 0) {
        alert('No hay imágenes seleccionadas para subir.');
        return;
      }

      const uploadBtn = previewModal.querySelector('#bulk-upload-btn');
      const cancelBtn = previewModal.querySelector('#bulk-cancel-btn');
      const progressSection = previewModal.querySelector('#bulk-progress-section');
      const progressBar = previewModal.querySelector('#bulk-progress-bar');
      const progressText = previewModal.querySelector('#bulk-progress-text');
      const progressPct = previewModal.querySelector('#bulk-progress-pct');

      uploadBtn.disabled = true;
      cancelBtn.disabled = true;
      progressSection.classList.remove('hidden');

      let done = 0, errors = 0;
      const results = [];

      for (const pair of toUpload) {
        const p = pair.match.product;
        progressText.textContent = `Subiendo: ${pair.file.name}...`;
        try {
          // Subir imagen comprimida al bucket
          const photoUrl = await uploadProductPhotoFile(pair.file, p.id);

          // Guardar URL en la BD
          const { error: dbErr } = await activeClient
            .from('products')
            .update({ imagen_url: photoUrl })
            .eq('id', p.id);

          if (dbErr) throw dbErr;

          // Actualizar en memoria
          if (window.allProducts) {
            const idx = window.allProducts.findIndex(x => String(x.id) === String(p.id));
            if (idx !== -1) window.allProducts[idx].imagen_url = photoUrl;
          }

          results.push({ name: pair.file.name, product: p, ok: true });
          done++;

          // Quitar producto de la lista principal si estaba en la lista de sin foto
          const noPhotoItem = modalDiv?.querySelector(`.no-photo-item[data-id="${p.id}"]`);
          if (noPhotoItem) noPhotoItem.remove();

        } catch (err) {
          console.error('[BULK-UPLOAD] Error subiendo', pair.file.name, err);
          results.push({ name: pair.file.name, product: p, ok: false, err: err.message });
          errors++;
        }

        const total = toUpload.length;
        const pct = Math.round(((done + errors) / total) * 100);
        progressBar.style.width = pct + '%';
        progressPct.textContent = pct + '%';
      }

      // Re-renderizar catálogo
      if (window.renderProducts) window.renderProducts();

      // Actualizar contador del modal principal
      if (modalDiv) {
        const remaining = modalDiv.querySelectorAll('.no-photo-item').length;
        const subtitleEl = modalDiv.querySelector('.text-amber-100');
        if (subtitleEl) subtitleEl.textContent = `Total pendientes: ${remaining} — Selecciona una imagen desde tu dispositivo para subirla al instante`;
      }

      progressText.textContent = `✅ Completado: ${done} subidas, ${errors} errores.`;
      progressPct.textContent = '100%';
      progressBar.style.width = '100%';
      uploadBtn.disabled = false;
      cancelBtn.disabled = false;
      cancelBtn.textContent = 'Cerrar';
    });
  }

  window.showProductsWithoutPhoto = async function() {
    try {
      const { allProducts } = getGlobalState();
      
      if (!allProducts || allProducts.length === 0) {
        alert('Cargando productos... Por favor espera unos segundos.');
        return;
      }

      const productsWithoutPhoto = allProducts.filter(p => !p.imagen_url || p.imagen_url.trim() === '' || p.imagen_url === '/images/ProductImages.jpg');
      console.log('[NO-PHOTO] Encontrados:', productsWithoutPhoto.length, 'productos sin foto');

      const modalDiv = document.createElement('div');
      modalDiv.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 overflow-y-auto';
      modalDiv.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-2xl max-w-2xl w-full shadow-2xl my-8 border border-gray-100 dark:border-gray-700">
          <div class="bg-gradient-to-r from-amber-600 to-amber-700 p-6 text-white sticky top-0 z-10 rounded-t-2xl shadow">
            <div class="flex items-center justify-between">
              <div>
                <h2 class="text-2xl font-bold flex items-center gap-2">
                  <span>📷</span> Productos sin Foto
                </h2>
                <p class="text-amber-100 text-sm mt-1" id="no-photo-subtitle">Total pendientes: ${productsWithoutPhoto.length} — Selecciona una imagen desde tu dispositivo para subirla al instante</p>
              </div>
              <button onclick="this.closest('.fixed').remove()" class="text-white hover:bg-amber-800 p-2 rounded-xl transition text-xl font-bold">✕</button>
            </div>
            <!-- Botón carga masiva desde carpeta -->
            <div class="mt-4">
              <label class="flex items-center gap-2 cursor-pointer bg-white/20 hover:bg-white/30 border border-white/40 rounded-xl px-4 py-2.5 transition w-full sm:w-auto">
                <span class="text-lg">📁</span>
                <span class="font-semibold text-sm">Cargar fotos desde Carpeta (carga masiva)</span>
                <input type="file" id="bulk-folder-input" webkitdirectory multiple accept="image/*" class="hidden">
              </label>
              <p class="text-amber-200 text-xs mt-1.5">Las imágenes se emparejan automáticamente por código o nombre del archivo</p>
            </div>
          </div>
          
          <div class="p-6 space-y-4">
            <input type="text" id="no-photo-search" placeholder="🔍 Buscar por código o nombre..." 
              class="w-full px-4 py-3 border-2 border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 transition">
            
            <div id="no-photo-results" class="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
              ${productsWithoutPhoto.length === 0 
                ? '<div class="text-center py-12"><span class="text-4xl">🎉</span><p class="text-gray-500 dark:text-gray-400 font-semibold mt-2">¡Todos los productos tienen foto asignada!</p></div>' 
                : productsWithoutPhoto.map(p => `
                <div class="no-photo-item border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden shadow-sm bg-white dark:bg-gray-800 transition hover:shadow-md"
                  data-codigo="${(p.codigo || '').replace(/"/g,'&quot;')}" 
                  data-nombre="${(p.nombre || '').replace(/"/g,'&quot;')}" 
                  data-id="${p.id}">
                  <div class="p-4 bg-gray-50 dark:bg-gray-750 hover:bg-amber-50/50 dark:hover:bg-gray-700 transition cursor-pointer flex items-center justify-between no-photo-header">
                    <div>
                      <p class="font-bold text-gray-900 dark:text-white">${p.codigo || 'SIN CÓDIGO'}</p>
                      <p class="text-sm text-gray-600 dark:text-gray-300 mt-0.5">${p.nombre || 'Sin nombre'}</p>
                      <p class="text-xs font-semibold text-amber-600 dark:text-amber-400 mt-1">Stock disponible: ${p.stock || 0}</p>
                    </div>
                    <div class="flex items-center gap-2">
                      <span class="text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300 font-semibold px-2.5 py-1 rounded-lg">Subir Foto</span>
                      <span class="text-amber-500 text-lg">➕</span>
                    </div>
                  </div>
                  
                  <div class="no-photo-form hidden p-4 bg-amber-50/70 dark:bg-gray-700/60 border-t border-amber-100 dark:border-gray-600 space-y-3">
                    
                    <!-- Subida directa de archivo -->
                    <div class="flex flex-col gap-2">
                      <label class="block text-xs font-bold text-gray-700 dark:text-gray-200">Seleccionar Imagen (Galería o Archivo):</label>
                      <div class="flex items-center gap-3">
                        <label class="flex-1 cursor-pointer bg-white dark:bg-gray-800 border-2 border-dashed border-amber-400 hover:border-amber-600 rounded-xl p-3 text-center transition">
                          <span class="text-xs font-semibold text-amber-700 dark:text-amber-300 flex items-center justify-center gap-2">
                            📁 Elegir archivo de imagen...
                          </span>
                          <input type="file" accept="image/*" class="photo-file-input hidden" data-id="${p.id}">
                        </label>
                      </div>
                      <div class="photo-preview-container hidden flex items-center gap-3 p-2 bg-white dark:bg-gray-800 rounded-lg border border-gray-200">
                        <img class="photo-preview-img w-14 h-14 object-cover rounded-lg shadow-sm" src="">
                        <div class="flex-1 min-w-0">
                          <p class="text-xs font-semibold text-gray-800 dark:text-gray-200 truncate photo-file-name"></p>
                          <p class="text-[10px] text-green-600 font-bold">✓ Lista para comprimir y subir</p>
                        </div>
                      </div>
                    </div>

                    <!-- Opción secundaria: URL manual -->
                    <details class="text-xs text-gray-500 pt-1">
                      <summary class="cursor-pointer font-medium hover:text-amber-600">O pegar URL directa</summary>
                      <input type="url" class="photo-url-input w-full mt-2 px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-lg text-xs focus:ring-1 focus:ring-amber-500" placeholder="https://...">
                    </details>

                    <div class="flex gap-2 pt-2">
                      <button class="save-photo-btn flex-1 py-2.5 px-4 bg-amber-600 hover:bg-amber-700 text-white font-bold rounded-xl text-sm transition shadow-sm flex items-center justify-center gap-2" data-id="${p.id}">
                        💾 Subir y Guardar
                      </button>
                      <button class="cancel-photo-btn py-2.5 px-4 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 font-semibold rounded-xl text-sm hover:bg-gray-300 transition">
                        Cancelar
                      </button>
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
          
          <div class="p-5 border-t border-gray-100 dark:border-gray-700 flex justify-end">
            <button class="px-6 py-2.5 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-xl font-semibold hover:bg-gray-200 transition text-sm" 
              onclick="this.closest('.fixed').remove()">
              Cerrar
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(modalDiv);

      // ============================================
      // CARGA MASIVA DESDE CARPETA
      // ============================================
      const bulkFolderInput = document.getElementById('bulk-folder-input');
      bulkFolderInput?.addEventListener('change', (e) => {
        const files = e.target.files;
        if (!files || files.length === 0) return;
        // Incluir TODOS los productos (no solo los sin foto) para que actualice también los que ya tienen
        _showFolderBulkPreview(files, allProducts, modalDiv);
        e.target.value = ''; // reset para poder seleccionar de nuevo
      });

      // Búsqueda
      const searchInput = document.getElementById('no-photo-search');
      searchInput.addEventListener('input', () => {
        const term = searchInput.value.toLowerCase().trim();
        modalDiv.querySelectorAll('.no-photo-item').forEach(item => {
          const match = item.dataset.codigo.toLowerCase().includes(term) || item.dataset.nombre.toLowerCase().includes(term);
          item.style.display = match ? '' : 'none';
        });
      });
      searchInput.focus();

      // Manejador de cambio de archivo para previsualización
      modalDiv.addEventListener('change', (e) => {
        if (e.target.classList.contains('photo-file-input')) {
          const fileInput = e.target;
          const file = fileInput.files[0];
          const form = fileInput.closest('.no-photo-form');
          const previewContainer = form.querySelector('.photo-preview-container');
          const previewImg = form.querySelector('.photo-preview-img');
          const fileNameEl = form.querySelector('.photo-file-name');

          if (file) {
            previewImg.src = URL.createObjectURL(file);
            fileNameEl.textContent = `${file.name} (${Math.round(file.size / 1024)} KB)`;
            previewContainer.classList.remove('hidden');
          } else {
            previewContainer.classList.add('hidden');
          }
        }
      });

      // Toggle inline y acciones
      modalDiv.addEventListener('click', async (e) => {
        const header = e.target.closest('.no-photo-header');
        if (header) {
          const item = header.closest('.no-photo-item');
          const form = item.querySelector('.no-photo-form');
          const isOpen = !form.classList.contains('hidden');
          modalDiv.querySelectorAll('.no-photo-form').forEach(f => f.classList.add('hidden'));
          if (!isOpen) {
            form.classList.remove('hidden');
          }
          return;
        }

        if (e.target.classList.contains('cancel-photo-btn')) {
          e.target.closest('.no-photo-form').classList.add('hidden');
          return;
        }

        // Guardar foto (Archivo o URL)
        if (e.target.classList.contains('save-photo-btn') || e.target.closest('.save-photo-btn')) {
          const btn = e.target.closest('.save-photo-btn') || e.target;
          const productId = btn.dataset.id;
          const form = btn.closest('.no-photo-form');
          const fileInput = form.querySelector('.photo-file-input');
          const urlInput = form.querySelector('.photo-url-input');
          const selectedFile = fileInput.files ? fileInput.files[0] : null;
          let photoUrl = urlInput ? urlInput.value.trim() : '';

          if (!selectedFile && !photoUrl) {
            alert('Por favor selecciona una imagen de tu dispositivo o ingresa una URL.');
            return;
          }

          const originalText = btn.innerHTML;
          btn.innerHTML = '⏳ Subiendo y optimizando...';
          btn.disabled = true;

          try {
            const { supabaseClient } = getGlobalState();
            const activeClient = supabaseClient || window.supabaseClient;

            // Si seleccionó un archivo local, subirlo a Supabase Storage con compresión WebP
            if (selectedFile) {
              photoUrl = await uploadProductPhotoFile(selectedFile, productId);
            }

            // Actualizar la URL en la tabla products
            const { error: dbErr } = await activeClient
              .from('products')
              .update({ imagen_url: photoUrl })
              .eq('id', productId);

            if (dbErr) throw dbErr;

            // Actualizar estado en memoria
            if (window.allProducts) {
              const idx = window.allProducts.findIndex(p => String(p.id) === String(productId));
              if (idx !== -1) window.allProducts[idx].imagen_url = photoUrl;
            }

            // Quitar el elemento de la lista
            form.closest('.no-photo-item').remove();
            if (typeof window.renderProducts === 'function') window.renderProducts();

            // Actualizar contador
            const remaining = modalDiv.querySelectorAll('.no-photo-item').length;
            const subtitleEl = modalDiv.querySelector('#no-photo-subtitle');
            if (subtitleEl) {
              subtitleEl.textContent = `Total pendientes: ${remaining} — Selecciona una imagen desde tu dispositivo para subirla al instante`;
            }

          } catch (err) {
            console.error('[NO-PHOTO] Error subiendo foto:', err);
            alert('Error al guardar foto: ' + err.message);
            btn.innerHTML = originalText;
            btn.disabled = false;
          }
        }
      });

    } catch (error) {
      console.error('[NO-PHOTO] Error inesperado:', error);
      alert('Error: ' + error.message);
    }
  };

  // ============================================
  // BAJO STOCK (1-5) - VISIBILIDAD EN CATÁLOGO
  // ============================================

  window.showLowStockModal = async function() {
    try {
      const { allProducts, currentUserRole, supabaseClient } = getGlobalState();

      if (currentUserRole !== 'admin') {
        alert('Solo administradores pueden acceder a esta función.');
        return;
      }

      if (!allProducts || allProducts.length === 0) {
        alert('Cargando productos... Por favor espera unos segundos.');
        return;
      }

      // Filtrar productos con stock entre 1 y 5
      const lowStockProducts = allProducts.filter(p => {
        const s = p.stock || 0;
        return s >= 1 && s <= 5;
      });

      console.log('[LOW-STOCK] Productos con stock 1-5:', lowStockProducts.length);

      const modalDiv = document.createElement('div');
      modalDiv.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto';
      modalDiv.innerHTML = `
        <div class="bg-white rounded-2xl max-w-2xl w-full shadow-2xl my-8">
          <div class="bg-gradient-to-r from-red-600 to-red-700 p-6 text-white sticky top-0 z-10 flex items-center justify-between rounded-t-2xl">
            <div>
              <h2 class="text-2xl font-bold">⚠️ Productos con Bajo Stock (1-5)</h2>
              <p class="text-red-100 mt-1" id="low-stock-subtitle">Total: ${lowStockProducts.length} productos — Activa/desactiva su visibilidad en el catálogo</p>
            </div>
            <button onclick="this.closest('.fixed').remove()" class="text-white hover:bg-red-800 p-2 rounded-lg transition-all text-xl font-bold">✕</button>
          </div>

          <div class="p-6 space-y-4">
            <input type="text" id="low-stock-search" placeholder="Busca por código o nombre..." 
              class="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-600 focus:border-transparent transition-all">
            
            <div id="low-stock-list" class="space-y-2 max-h-[60vh] overflow-y-auto">
              ${lowStockProducts.length === 0
                ? '<p class="text-gray-500 text-center py-8">No hay productos con stock entre 1 y 5.</p>'
                : lowStockProducts.map(p => {
                    const isVisible = p.visible_in_catalog !== false; // default true
                    const stockColor = p.stock <= 2 ? 'bg-red-100 text-red-700 border-red-300' : 'bg-yellow-100 text-yellow-700 border-yellow-300';
                    return `
                    <div class="low-stock-item flex items-center justify-between p-4 bg-gray-50 rounded-xl border border-gray-200 hover:bg-gray-100 transition"
                      data-codigo="${(p.codigo || '').replace(/"/g,'&quot;')}"
                      data-nombre="${(p.nombre || '').replace(/"/g,'&quot;')}"
                      data-id="${p.id}">
                      <div class="flex-1 min-w-0 mr-4">
                        <p class="font-semibold text-gray-800 truncate">${p.codigo || 'SIN CÓDIGO'}</p>
                        <p class="text-sm text-gray-600 truncate">${p.nombre || 'Sin nombre'}</p>
                        <span class="inline-block mt-1 px-2 py-0.5 text-xs font-bold rounded-full border ${stockColor}">
                          Stock: ${p.stock}
                        </span>
                      </div>
                      <div class="flex items-center gap-3 flex-shrink-0">
                        <span class="text-xs font-semibold visibility-label ${isVisible ? 'text-green-600' : 'text-red-500'}">
                          ${isVisible ? 'Visible' : 'Oculto'}
                        </span>
                        <label class="relative inline-flex items-center cursor-pointer">
                          <input type="checkbox" class="sr-only peer visibility-toggle" data-id="${p.id}" ${isVisible ? 'checked' : ''}>
                          <div class="w-11 h-6 bg-gray-300 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-red-400 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500"></div>
                        </label>
                      </div>
                    </div>
                  `}).join('')}
            </div>
          </div>

          <div class="p-6 border-t flex gap-3">
            <button onclick="this.closest('.fixed').remove()" class="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300 transition">
              Cerrar
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(modalDiv);

      // Búsqueda
      document.getElementById('low-stock-search').addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase().trim();
        modalDiv.querySelectorAll('.low-stock-item').forEach(item => {
          const match = item.dataset.codigo.toLowerCase().includes(term) || item.dataset.nombre.toLowerCase().includes(term);
          item.style.display = match ? '' : 'none';
        });
      });
      document.getElementById('low-stock-search').focus();

      // Toggle de visibilidad
      modalDiv.addEventListener('change', async (e) => {
        if (!e.target.classList.contains('visibility-toggle')) return;

        const toggle = e.target;
        const productId = toggle.dataset.id;
        const isVisible = toggle.checked;
        const item = toggle.closest('.low-stock-item');
        const label = item.querySelector('.visibility-label');

        // Feedback visual inmediato
        label.textContent = isVisible ? 'Visible' : 'Oculto';
        label.className = `text-xs font-semibold visibility-label ${isVisible ? 'text-green-600' : 'text-red-500'}`;

        try {
          const { error } = await supabaseClient
            .from('products')
            .update({ visible_in_catalog: isVisible })
            .eq('id', productId);

          if (error) throw error;

          // Actualizar en memoria
          if (window.allProducts) {
            const idx = window.allProducts.findIndex(p => p.id === productId);
            if (idx !== -1) window.allProducts[idx].visible_in_catalog = isVisible;
          }

          console.log(`[LOW-STOCK] Producto ${productId} visible_in_catalog = ${isVisible}`);

          // Re-renderizar catálogo (productos ocultos desaparecen para no-admin)
          if (window.renderProducts) window.renderProducts();

        } catch (err) {
          console.error('[LOW-STOCK] Error actualizando visibilidad:', err);
          // Revertir toggle
          toggle.checked = !isVisible;
          label.textContent = !isVisible ? 'Visible' : 'Oculto';
          label.className = `text-xs font-semibold visibility-label ${!isVisible ? 'text-green-600' : 'text-red-500'}`;
          alert('Error al actualizar: ' + err.message);
        }
      });

    } catch (error) {
      console.error('[LOW-STOCK] Error inesperado:', error);
      alert('Error: ' + error.message);
    }
  };



  // ============================================
  // AGREGAR MERCANCÍA - BÚSQUEDA Y FORM
  // ============================================

  window.showAddMerchandiseModal = async function() {
    const { currentUserRole, allProducts } = getGlobalState();
    
    console.log('[ADMIN-CHECK] showAddMerchandiseModal - currentUserRole:', currentUserRole, 'Type:', typeof currentUserRole);
    
    if (currentUserRole !== 'admin') {
      console.error('[ADMIN-CHECK] DENEGADO - Rol no es admin:', currentUserRole);
      alert('Solo administradores pueden agregar mercancía. Tu rol actual: ' + (currentUserRole || 'desconocido'));
      return;
    }
    console.log('[ADMIN-CHECK] ✅ Acceso permitido a mercancía');

    // Usar productos ya cargados en memoria
    if (!allProducts || allProducts.length === 0) {
      alert('Cargando productos... Intenta de nuevo en unos segundos.');
      return;
    }
    
    console.log('[MERCHANDISE] Usando inventario en memoria:', allProducts.length);

    const modalDiv = document.createElement('div');
    modalDiv.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4';
    modalDiv.innerHTML = `
      <div class="bg-white rounded-2xl max-w-2xl w-full shadow-2xl">
        <div class="bg-gradient-to-r from-cyan-600 to-cyan-700 p-6 text-white flex items-center justify-between">
          <div>
            <h2 class="text-2xl font-bold">Agregar Mercancía</h2>
            <p class="text-cyan-100 mt-1">Busca un producto y agrega la foto</p>
          </div>
          <button onclick="this.closest('.fixed').remove()" class="text-white hover:bg-cyan-800 p-2 rounded-lg transition-all text-xl font-bold">✕</button>
        </div>
        
        <div class="p-6 space-y-4">
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-2">Buscar por Código o Nombre:</label>
            <input type="text" id="merchandise-search" placeholder="Ingresa código, nombre o descripción..." 
              class="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-600 focus:border-transparent transition-all">
            <div id="merchandise-results" class="mt-4 space-y-2 max-h-48 overflow-y-auto"></div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modalDiv);

    const searchInput = document.getElementById('merchandise-search');
    const resultsDiv = document.getElementById('merchandise-results');

    searchInput.addEventListener('input', () => {
      const searchTerm = searchInput.value.toLowerCase().trim();
      resultsDiv.innerHTML = '';

      if (searchTerm.length < 1) {
        resultsDiv.innerHTML = '<p class="text-gray-500 text-sm">Ingresa al menos 1 carácter</p>';
        return;
      }

      console.log('[MERCHANDISE-SEARCH] Buscando:', searchTerm, 'en', allProducts.length, 'productos');

      const filtered = allProducts.filter(p => 
        (p.codigo && p.codigo.toLowerCase().includes(searchTerm)) ||
        (p.nombre && p.nombre.toLowerCase().includes(searchTerm)) ||
        (p.descripcion && p.descripcion.toLowerCase().includes(searchTerm))
      ).slice(0, 15);

      console.log('[MERCHANDISE-SEARCH] Encontrados:', filtered.length);

      if (filtered.length === 0) {
        resultsDiv.innerHTML = '<p class="text-gray-500 text-sm">No se encontraron productos</p>';
        return;
      }

      filtered.forEach(product => {
        const resultDiv = document.createElement('div');
        resultDiv.className = 'p-3 bg-gray-50 rounded-lg border-2 border-transparent hover:border-cyan-500 cursor-pointer transition-all';
        resultDiv.innerHTML = `
          <p class="font-semibold text-gray-800">${product.codigo || 'N/A'} - ${product.nombre}</p>
          <p class="text-sm text-gray-600">${product.descripcion || 'Sin descripción'}</p>
          <p class="text-xs text-cyan-600 mt-1">Dept: ${product.departamento || 'N/A'} | Stock: ${product.stock || 0}</p>
        `;
        resultDiv.addEventListener('click', () => showPhotoForm(product, modalDiv));
        resultsDiv.appendChild(resultDiv);
      });
    });

    searchInput.focus();
  };

  function showPhotoForm(product, parentModal) {
    parentModal.remove();
    
    const formDiv = document.createElement('div');
    formDiv.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
    formDiv.innerHTML = `
      <div class="bg-white rounded-2xl max-w-md w-full shadow-2xl">
        <div class="bg-gradient-to-r from-cyan-600 to-cyan-700 p-6 text-white flex items-center justify-between">
          <div>
            <h2 class="text-2xl font-bold">Agregar Foto</h2>
            <p class="text-cyan-100 mt-1">${product.codigo || 'N/A'} - ${product.nombre}</p>
          </div>
          <button onclick="this.closest('.fixed').remove()" class="text-white hover:bg-cyan-800 p-2 rounded-lg transition-all text-xl font-bold">✕</button>
        </div>
        
        <div class="p-6 space-y-4">
          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-2">Departamento:</label>
            <input type="text" id="form-department" value="${product.departamento || ''}" 
              class="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-600" 
              placeholder="Ej: ACCESORIOS_MOTO">
          </div>

          <div>
            <label class="block text-sm font-semibold text-gray-700 mb-2">URL de la Foto:</label>
            <input type="url" id="form-url" placeholder="https://i.ibb.co/..." 
              class="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-cyan-600">
            <p class="text-xs text-gray-500 mt-2">Sube tu foto en <a href="https://imgbb.com" target="_blank" class="text-blue-600 underline">imgbb.com</a></p>
          </div>

          <div class="flex gap-3 pt-4">
            <button class="flex-1 px-4 py-3 bg-cyan-600 text-white rounded-xl font-semibold hover:bg-cyan-700 transition-all" 
              onclick="window.saveMerchandise('${product.id}', '${product.codigo}', '${product.nombre}')">
              Guardar
            </button>
            <button class="flex-1 px-4 py-3 bg-gray-200 text-gray-700 rounded-xl font-semibold hover:bg-gray-300 transition-all" 
              onclick="this.closest('.fixed').remove()">
              Cancelar
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(formDiv);
    document.getElementById('form-url').focus();
  }

  window.saveMerchandise = async function(productId, codigo, nombre) {
    const { supabaseClient } = getGlobalState();
    
    const url = document.getElementById('form-url').value.trim();
    const department = document.getElementById('form-department').value.trim();

    if (!url || !department) {
      alert('Por favor completa todos los campos');
      return;
    }

    try {
      console.log('[MERCHANDISE] Guardando URL para producto:', codigo);
      
      const { error } = await supabaseClient
        .from('products')
        .update({ imagen_url: url, departamento: department })
        .eq('id', productId);

      if (error) throw error;

      console.log('[MERCHANDISE] ✅ URL guardada exitosamente');
      
      // Mostrar mensaje de éxito
      const successMsg = document.createElement('div');
      successMsg.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50';
      successMsg.innerHTML = `
        <div class="bg-white rounded-2xl p-8 text-center shadow-2xl">
          <p class="text-3xl mb-4">✅</p>
          <h3 class="text-xl font-bold text-gray-800 mb-2">Mercancía guardada</h3>
          <p class="text-gray-600">${codigo} - ${nombre}</p>
          <p class="text-sm text-gray-500 mt-4">Removiendo de lista de sin foto...</p>
        </div>
      `;
      document.body.appendChild(successMsg);

      // Cerrar modal actual
      const modals = document.querySelectorAll('.fixed');
      modals.forEach(modal => {
        if (modal !== successMsg) modal.remove();
      });

      // Actualizar el DOM sin recargar - remover el producto de la lista visual
      setTimeout(() => {
        console.log('[MERCHANDISE] Actualizando lista visual...');
        
        // Remover producto de la lista de sin foto si el modal está abierto
        const productItems = document.querySelectorAll('.no-photo-item');
        productItems.forEach(item => {
          if (item.dataset.id === productId) {
            item.remove();
            console.log('[MERCHANDISE] Producto removido de la lista visual');
          }
        });
        
        // Cerrar mensaje de éxito
        successMsg.remove();

        // Actualizar el carrusel/galería principal si está visible
        console.log('[MERCHANDISE] Refrescando galería principal...');
        if (window.renderProducts) {
          window.renderProducts();
        }
        
        // Actualizar la variable global de productos
        if (window.allProducts) {
          const productIndex = window.allProducts.findIndex(p => p.id === productId);
          if (productIndex !== -1) {
            window.allProducts[productIndex].imagen_url = url;
            window.allProducts[productIndex].departamento = department;
            console.log('[MERCHANDISE] Producto actualizado en allProducts');
          }
        }
      }, 1500);

    } catch (error) {
      console.error('[MERCHANDISE] Error:', error);
      alert('Error al guardar: ' + error.message);
    }
  };

  // ============================================
  // MODIFICAR PRODUCTO
  // ============================================

  window.showModifyProductModal = async function() {
    const { currentUserRole, allProducts } = getGlobalState();
    
    console.log('[ADMIN-CHECK] showModifyProductModal - currentUserRole:', currentUserRole, 'Type:', typeof currentUserRole);
    
    if (currentUserRole !== 'admin') {
      console.error('[ADMIN-CHECK] DENEGADO - Rol no es admin:', currentUserRole);
      alert('Solo administradores pueden modificar productos. Tu rol actual: ' + (currentUserRole || 'desconocido'));
      return;
    }
    console.log('[ADMIN-CHECK] ✅ Acceso permitido a modificación');

    // Usar productos ya cargados en memoria
    if (!allProducts || allProducts.length === 0) {
      alert('Cargando productos... Intenta de nuevo en unos segundos.');
      return;
    }
    
    console.log('[MODIFY] Usando inventario en memoria:', allProducts.length);

    const modalDiv = document.createElement('div');
    modalDiv.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4';
    modalDiv.innerHTML = `
      <div class="bg-white rounded-2xl max-w-2xl w-full shadow-2xl">
        <div class="bg-gradient-to-r from-indigo-600 to-indigo-700 p-6 text-white flex items-center justify-between">
          <div>
            <h2 class="text-2xl font-bold">Modificar Producto</h2>
            <p class="text-indigo-100 mt-1">Busca el producto a editar</p>
          </div>
          <button onclick="this.closest('.fixed').remove()" class="text-white hover:bg-indigo-800 p-2 rounded-lg transition-all text-xl font-bold">✕</button>
        </div>
        
        <div class="p-6 space-y-4">
          <input type="text" id="modify-search" placeholder="Busca por código, nombre o descripción..." 
            class="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-600 focus:border-transparent transition-all">
          <div id="modify-results" class="space-y-2 max-h-48 overflow-y-auto"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modalDiv);

    const searchInput = document.getElementById('modify-search');
    const resultsDiv = document.getElementById('modify-results');

    searchInput.addEventListener('input', () => {
      const searchTerm = searchInput.value.toLowerCase().trim();
      resultsDiv.innerHTML = '';

      if (searchTerm.length < 1) {
        resultsDiv.innerHTML = '<p class="text-gray-500 text-sm">Ingresa al menos 1 carácter</p>';
        return;
      }

      console.log('[MODIFY-SEARCH] Buscando:', searchTerm, 'en', allProducts.length, 'productos');

      const filtered = allProducts.filter(p => 
        (p.codigo && p.codigo.toLowerCase().includes(searchTerm)) ||
        (p.nombre && p.nombre.toLowerCase().includes(searchTerm)) ||
        (p.descripcion && p.descripcion.toLowerCase().includes(searchTerm))
      ).slice(0, 10);

      console.log('[MODIFY-SEARCH] Encontrados:', filtered.length);

      if (filtered.length === 0) {
        resultsDiv.innerHTML = '<p class="text-gray-500 text-sm">No encontrado</p>';
        return;
      }

      filtered.forEach(product => {
        const resultDiv = document.createElement('div');
        resultDiv.className = 'p-3 bg-gray-50 rounded-lg border-2 border-transparent hover:border-indigo-500 cursor-pointer transition-all';
        resultDiv.innerHTML = `
          <p class="font-semibold text-gray-800">${product.codigo || 'N/A'} - ${product.nombre}</p>
          <p class="text-xs text-gray-600">Precio Mayor: ${product.precio_mayor || 0}</p>
        `;
        resultDiv.addEventListener('click', () => showEditForm(product, modalDiv));
        resultsDiv.appendChild(resultDiv);
      });
    });

    searchInput.focus();
  };

  async function showEditForm(product, parentModal) {
    parentModal.remove();
    
    // Obtener el depósito actual desde la base de datos
    let currentDeposito = "";
    try {
        const { supabaseClient } = getGlobalState();
        if (product.codigo) {
            const { data } = await supabaseClient
                .from('inventory_products')
                .select('deposito')
                .eq('codigo', product.codigo)
                .maybeSingle();
            if (data) currentDeposito = data.deposito || "";
        }
    } catch (err) {
        console.error("Error fetching deposit:", err);
    }
    
    const formDiv = document.createElement('div');
    formDiv.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 overflow-y-auto';
    formDiv.innerHTML = `
      <div class="bg-white rounded-2xl max-w-md w-full shadow-2xl my-8">
        <div class="bg-gradient-to-r from-indigo-600 to-indigo-700 p-6 text-white flex items-center justify-between">
          <h2 class="text-2xl font-bold">Editar Producto</h2>
          <button onclick="this.closest('.fixed').remove()" class="text-white hover:bg-indigo-800 p-2 rounded-lg transition-all text-xl font-bold">✕</button>
        </div>
        
        <div class="p-6 space-y-3 max-h-96 overflow-y-auto">
          <div>
            <label class="block text-xs font-semibold text-gray-700 mb-1">Código:</label>
            <input type="text" id="edit-codigo" value="${product.codigo || ''}" class="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-700 mb-1">Nombre:</label>
            <input type="text" id="edit-nombre" value="${product.nombre || ''}" class="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-700 mb-1">Descripción:</label>
            <textarea id="edit-descripcion" class="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" rows="2">${product.descripcion || ''}</textarea>
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-700 mb-1">Departamento:</label>
            <input type="text" id="edit-departamento" value="${product.departamento || ''}" class="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-700 mb-1">Precio Cliente:</label>
            <input type="number" id="edit-precio-cliente" value="${product.precio_cliente || 0}" class="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" step="0.01">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-700 mb-1">Precio Mayor:</label>
            <input type="number" id="edit-precio-mayor" value="${product.precio_mayor || 0}" class="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" step="0.01">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-700 mb-1">Precio Gmayor:</label>
            <input type="number" id="edit-precio-gmayor" value="${product.precio_gmayor || 0}" class="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm" step="0.01">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-700 mb-1">Stock:</label>
            <input type="number" id="edit-stock" value="${product.stock || 0}" class="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm">
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-700 mb-1">URL Foto:</label>
            <!-- Opción A: subir archivo -->
            <div class="mb-2">
              <label class="flex items-center gap-2 cursor-pointer w-full bg-gray-50 border-2 border-dashed border-indigo-300 hover:border-indigo-500 rounded-lg p-3 transition">
                <span class="text-xl">🖼️</span>
                <span class="text-xs font-semibold text-indigo-700" id="edit-file-label">Elegir imagen desde archivo...</span>
                <input type="file" accept="image/*" id="edit-photo-file" class="hidden">
              </label>
              <div id="edit-photo-preview-container" class="hidden mt-2 flex items-center gap-3 p-2 bg-white rounded-lg border border-gray-200">
                <img id="edit-photo-preview-img" src="" class="w-14 h-14 object-cover rounded-lg shadow-sm">
                <div class="flex-1 min-w-0">
                  <p id="edit-photo-preview-name" class="text-xs font-semibold text-gray-800 truncate"></p>
                  <p class="text-[10px] text-green-600 font-bold">✓ Se subirá al guardar</p>
                </div>
                <button type="button" id="edit-photo-clear" class="text-gray-400 hover:text-red-500 text-lg transition">✕</button>
              </div>
            </div>
            <!-- Opción B: URL directa -->
            <details class="text-xs text-gray-500">
              <summary class="cursor-pointer font-medium hover:text-indigo-600">O pegar URL directa</summary>
              <input type="url" id="edit-url" value="${product.imagen_url || ''}" class="w-full mt-2 px-3 py-2 border-2 border-gray-300 rounded-lg text-sm">
            </details>
          </div>
          <div>
            <label class="block text-xs font-semibold text-gray-700 mb-1">Depósito (Inventario):</label>
            <select id="edit-deposito" class="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm bg-white">
                <option value="">Sin Asignar</option>
                <option value="A">A</option>
                <option value="B">B</option>
                <option value="C">C</option>
                <option value="D">D</option>
                <option value="E">E</option>
                <option value="PLANTA BAJA">Planta Baja</option>
                <option value="PISO VENTA">Piso Venta</option>
            </select>
          </div>

          <div class="flex gap-2 pt-4">
            <button class="flex-1 px-3 py-2 bg-indigo-600 text-white rounded-lg font-semibold text-sm hover:bg-indigo-700 transition" 
              onclick="window.saveProductEdit('${product.id}', '${product.codigo || ''}')">
              Guardar
            </button>
            <button class="flex-1 px-3 py-2 bg-gray-200 text-gray-700 rounded-lg font-semibold text-sm hover:bg-gray-300 transition" 
              onclick="this.closest('.fixed').remove()">
              Cancelar
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(formDiv);
    document.getElementById('edit-deposito').value = currentDeposito;

    // Manejador preview de foto por archivo
    const photoFileInput = document.getElementById('edit-photo-file');
    const photoPreviewContainer = document.getElementById('edit-photo-preview-container');
    const photoPreviewImg = document.getElementById('edit-photo-preview-img');
    const photoPreviewName = document.getElementById('edit-photo-preview-name');
    const photoFileLabel = document.getElementById('edit-file-label');
    const photoClearBtn = document.getElementById('edit-photo-clear');

    photoFileInput?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) {
        photoPreviewImg.src = URL.createObjectURL(file);
        photoPreviewName.textContent = `${file.name} (${Math.round(file.size/1024)} KB)`;
        photoFileLabel.textContent = file.name;
        photoPreviewContainer.classList.remove('hidden');
      }
    });

    photoClearBtn?.addEventListener('click', () => {
      photoFileInput.value = '';
      photoPreviewContainer.classList.add('hidden');
      photoFileLabel.textContent = 'Elegir imagen desde archivo...';
    });
  }

  window.saveProductEdit = async function(productId, productCode) {
    const { supabaseClient } = getGlobalState();

    // Determinar imagen_url: si hay archivo seleccionado, subirlo primero
    let imagenUrl = (document.getElementById('edit-url')?.value || '').trim();
    const photoFileInput = document.getElementById('edit-photo-file');
    const selectedPhotoFile = photoFileInput?.files?.[0];

    // Botón guardar: feedback visual durante subida
    const saveBtn = document.querySelector('.fixed .bg-indigo-600');
    const originalBtnText = saveBtn ? saveBtn.textContent : '';
    if (saveBtn) { saveBtn.textContent = '⏳ Guardando...'; saveBtn.disabled = true; }

    try {
      if (selectedPhotoFile) {
        if (saveBtn) saveBtn.textContent = '⏳ Subiendo foto...';
        imagenUrl = await uploadProductPhotoFile(selectedPhotoFile, productId);
      }
    } catch (uploadErr) {
      if (saveBtn) { saveBtn.textContent = originalBtnText; saveBtn.disabled = false; }
      alert('Error subiendo la foto: ' + uploadErr.message);
      return;
    }

    const updates = {
      codigo: document.getElementById('edit-codigo').value,
      nombre: document.getElementById('edit-nombre').value,
      descripcion: document.getElementById('edit-descripcion').value,
      departamento: document.getElementById('edit-departamento').value,
      precio_cliente: parseFloat(document.getElementById('edit-precio-cliente').value) || 0,
      precio_mayor: parseFloat(document.getElementById('edit-precio-mayor').value) || 0,
      precio_gmayor: parseFloat(document.getElementById('edit-precio-gmayor').value) || 0,
      stock: parseInt(document.getElementById('edit-stock').value) || 0,
      imagen_url: imagenUrl
    };

    const newDeposito = document.getElementById('edit-deposito').value || null;

    try {
      const { error } = await supabaseClient
        .from('products')
        .update(updates)
        .eq('id', productId);

      if (error) throw error;

      // También actualizar la tabla de inventario para mantener la sincronización
      if (productCode) {
        const inventoryUpdates = {
            descripcion: updates.nombre,
            precio_detal: updates.precio_cliente,
            precio_mayor: updates.precio_mayor,
            precio_gmayor: updates.precio_gmayor,
            existencia_actual: updates.stock,
            departamento: updates.departamento,
            deposito: newDeposito
        };
        const { error: invError } = await supabaseClient
            .from('inventory_products')
            .update(inventoryUpdates)
            .eq('codigo', productCode);

        if (invError) {
            console.error('[EDIT] Error actualizando depósito en inventario:', invError);
        }
      }

      // ✅ FIX: Actualizar solo el producto en memoria (evitar recargar todo el inventario)
      if (window.allProducts) {
        const idx = window.allProducts.findIndex(p => String(p.id) === String(productId));
        if (idx !== -1) {
          window.allProducts[idx] = { ...window.allProducts[idx], ...updates };
          console.log('[EDIT] ✅ Producto actualizado en memoria:', updates.codigo);
        }
      }

      // Cerrar modal inmediatamente
      document.querySelector('.fixed')?.remove();

      // Re-renderizar catálogo con los datos actualizados
      if (window.renderProducts) window.renderProducts();

      // Toast de éxito no bloqueante
      _showEditSuccessToast('✅ Producto actualizado correctamente');

    } catch (error) {
      if (saveBtn) { saveBtn.textContent = originalBtnText; saveBtn.disabled = false; }
      console.error('[EDIT] Error:', error);
      alert('Error: ' + error.message);
    }
  };

  // Toast de éxito simple (no-blocking, reemplaza el alert)
  function _showEditSuccessToast(message) {
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-sm font-semibold px-5 py-3 rounded-xl shadow-2xl z-[9999] flex items-center gap-2 transition-all';
    toast.style.cssText = 'animation: slideUpFade 0.3s ease; pointer-events: none;';
    toast.innerHTML = `<span>${message}</span>`;
    document.body.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(10px)';
      setTimeout(() => toast.remove(), 400);
    }, 2800);
  }

  // ============================================
  // CARGAR EXCEL DE PRECIOS - REDIRIGIDO
  // ============================================

  // Esta función fue consolidada en el modal de "Actualizar Productos".
  // Para compatibilidad de código antiguo, redirigimos a la nueva función.
  window.showUploadExcelModal = function() {
    console.warn('[DEPRECATION] showUploadExcelModal redirigida a showUpdateProductsModal');
    if (window.showUpdateProductsModal) {
      window.showUpdateProductsModal();
    } else {
      alert('Función no disponible');
    }
  };

  // ============================================
  // EXPORTAR PDF CON TABLA
  // ============================================

  window.showPdfExportModal = async function() {
    const { allProducts } = getGlobalState();
    
    try {
      const departments = [...new Set(allProducts
        .map(p => p.departamento)
        .filter(d => d && d.trim())
      )].sort();

      if (departments.length === 0) {
        alert('No hay productos con departamentos');
        return;
      }

      const modalDiv = document.createElement('div');
      modalDiv.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4';
      modalDiv.innerHTML = `
        <div class="bg-white rounded-2xl max-w-sm w-full shadow-2xl">
          <div class="bg-gradient-to-r from-orange-600 to-orange-700 p-6 text-white">
            <h2 class="text-2xl font-bold">Exportar PDF</h2>
            <p class="text-orange-100 mt-1">Selecciona un departamento</p>
          </div>
          
          <div class="p-6 space-y-3">
            <select id="pdf-department" class="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:ring-2 focus:ring-orange-600">
              <option value="">-- Selecciona departamento --</option>
              <option value="all">Todos los departamentos</option>
              ${departments.map(d => `<option value="${d}">${d}</option>`).join('')}
            </select>

            <div class="flex gap-3">
              <button class="flex-1 px-4 py-3 bg-orange-600 text-white rounded-xl font-semibold hover:bg-orange-700 transition" 
                onclick="window.generatePdf()">
                Descargar PDF
              </button>
              <button class="flex-1 px-4 py-3 bg-gray-200 text-gray-700 rounded-xl font-semibold hover:bg-gray-300 transition" 
                onclick="this.closest('.fixed').remove()">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modalDiv);
      document.getElementById('pdf-department').focus();
    } catch (error) {
      console.error('[PDF] Error:', error);
      alert('Error: ' + error.message);
    }
  };

  // Función auxiliar optimizada para convertir URL de imagen a base64 con timeout de seguridad
  const imageUrlToBase64 = (url) => {
    return new Promise((resolve) => {
      if (!url || url === "/images/ProductImages.jpg" || url.startsWith("data:image/svg")) {
        return resolve(null);
      }
      
      const img = new Image();
      img.crossOrigin = 'anonymous';
      
      const TIMEOUT = 10000; // 10 segundos de timeout para no bloquear el PDF
      const timeoutId = setTimeout(() => {
        console.warn('[PDF] ⏱️ Timeout cargando imagen:', url);
        resolve(null);
      }, TIMEOUT);

      img.onload = () => {
        clearTimeout(timeoutId);
        try {
          const canvas = document.createElement('canvas');
          // Redimensionar para optimizar tamaño y memoria del PDF
          const MAX_DIM = 200; // Suficiente para miniaturas de tabla (25mm)
          let width = img.width;
          let height = img.height;
          if (width > height && width > MAX_DIM) { height *= MAX_DIM / width; width = MAX_DIM; }
          else if (height > MAX_DIM) { width *= MAX_DIM / height; height = MAX_DIM; }

          canvas.width = Math.max(1, Math.round(width));
          canvas.height = Math.max(1, Math.round(height));
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          // Calidad 0.6 para mantener el PDF ligero
          const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
          // Limpiar canvas de memoria
          canvas.width = 0;
          canvas.height = 0;
          resolve(dataUrl);
        } catch (canvasErr) {
          console.warn('[PDF] Error en canvas:', canvasErr);
          resolve(null);
        }
      };
      
      img.onerror = () => {
        clearTimeout(timeoutId);
        console.warn('[PDF] No se pudo cargar imagen:', url);
        resolve(null);
      };
      
      // Usar URL optimizada
      const optimizedUrl = typeof window.optimizeImageUrl === 'function' ? window.optimizeImageUrl(url, { width: 300, quality: 60 }) : url;
      img.src = optimizedUrl;
    });
  };

  window.generatePdf = async function () {
    const { allProducts } = getGlobalState();

    const selectedDept = document.getElementById('pdf-department').value;
    if (!selectedDept) {
      alert('Selecciona un departamento');
      return;
    }

    // --- 1. Configuración del Modal de Progreso ---
    const progressModal = document.createElement('div');
    progressModal.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4';
    progressModal.innerHTML = `
      <div class="bg-white rounded-2xl p-8 w-full max-w-md shadow-2xl">
        <div class="text-center">
          <h2 class="text-2xl font-bold text-red-600 mb-6">Generando Catálogo PDF</h2>
          <div class="mb-6">
            <div class="w-full h-2 bg-gray-300 rounded-full overflow-hidden">
              <div id="pdf-progress-bar" class="h-full bg-gradient-to-r from-red-600 to-red-800 w-0 transition-all duration-300"></div>
            </div>
            <div class="mt-3 text-sm text-gray-700">
              <span id="pdf-progress-text" class="font-semibold">Iniciando...</span>
            </div>
          </div>
          <p class="text-xs text-gray-500">Por favor espera, esto puede tomar unos momentos...</p>
        </div>
      </div>
    `;
    document.body.appendChild(progressModal);

    const progressBar = document.getElementById('pdf-progress-bar');
    const progressText = document.getElementById('pdf-progress-text');
    const updateProgress = (current, total, message) => {
      const percentage = total > 0 ? Math.round((current / total) * 100) : 0;
      progressBar.style.width = percentage + '%';
      progressText.textContent = message || `${current} de ${total} (${percentage}%)`;
    };

    try {
      // --- 2. Filtrar Productos y Cargar Recursos ---
      let filtered = allProducts;
      if (selectedDept !== 'all') {
        filtered = allProducts.filter(p => p.departamento === selectedDept);
      }
      filtered = filtered.filter(p => (p.stock || 0) > 0);

      if (filtered.length === 0) {
        progressModal.remove();
        alert('No hay productos con stock para este departamento.');
        return;
      }

      // --- 2. Cargar Recursos en Lotes (Batches) para máxima velocidad y evitar congelamiento ---
      const assets = {}; // Almacenará imágenes en base64
      const totalResources = filtered.length;
      updateProgress(0, totalResources, 'Cargando recursos...');

      const BATCH_SIZE = 8;
      for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
        const batch = filtered.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.allSettled(
          batch.map(async (product) => {
            if (product.imagen_url) {
              const base64 = await imageUrlToBase64(product.imagen_url);
              return { id: product.id, base64 };
            }
            return { id: product.id, base64: null };
          })
        );

        batchResults.forEach((res) => {
          if (res.status === 'fulfilled' && res.value && res.value.base64) {
            assets[res.value.id] = res.value.base64;
          }
        });

        const currentLoaded = Math.min(i + BATCH_SIZE, totalResources);
        updateProgress(currentLoaded, totalResources, `Cargando imágenes: ${currentLoaded} de ${totalResources}...`);
        // Pequeña pausa para no congelar la interfaz
        await new Promise((r) => setTimeout(r, 20));
      }

      updateProgress(totalResources, totalResources, 'Generando documento...');

      // --- 3. Inicialización de PDF y Constantes de Diseño ---
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      const PAGE_WIDTH = doc.internal.pageSize.getWidth();
      const PAGE_HEIGHT = doc.internal.pageSize.getHeight();
      const MARGIN = 10;
      const HEADER_HEIGHT = 25;
      const FOOTER_HEIGHT = 15;
      const GRID_COLS = 3;
      const GRID_ROWS = 3;
      const GAP = 3;
      const CELL_WIDTH = (PAGE_WIDTH - MARGIN * 2 - GAP * (GRID_COLS - 1)) / GRID_COLS;
      const CELL_HEIGHT = (PAGE_HEIGHT - HEADER_HEIGHT - FOOTER_HEIGHT - MARGIN * 2 - GAP * (GRID_ROWS - 1)) / GRID_ROWS;

      // Paleta de colores premium (basado en la web y la solicitud)
      const bgColor = [45, 55, 72]; // #2D3748 gris oscuro profundo
      const cardBgColor = [55, 65, 81]; // #374151 gris más oscuro para tarjetas
      const cardBorderColor = [220, 38, 38]; // #DC2626 rojo para borde sutil
      const redColor = [220, 38, 38]; // #DC2626 rojo intenso
      const greenNeon = [16, 185, 129]; // #10B981 verde neón
      const blueNeon = [59, 130, 246]; // #3B82F6 azul neón
      const white = [255, 255, 255];
      const black = [0, 0, 0];

      // --- 4. Funciones de Dibujo ---
      const drawWatermark = (doc) => {
        // Watermark eliminado por solicitud del usuario.
      };

      const drawHeader = (doc, dept, assets) => {
        doc.setFillColor(...bgColor);
        doc.rect(0, 0, PAGE_WIDTH, HEADER_HEIGHT, 'F');
        // Logo eliminado
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(...white);
        doc.text('SONIMAX MÓVIL', MARGIN, 12);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(200, 200, 200);
        doc.text(dept.toUpperCase(), MARGIN, 17);

        doc.setFillColor(...redColor);
        doc.roundedRect(PAGE_WIDTH / 2, 5, PAGE_WIDTH / 2 - MARGIN, 15, 3, 3, 'F');
        // Icono eliminado
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(255, 255, 255);
        doc.text(`Catálogo de Productos - ${dept}`, PAGE_WIDTH / 2 + 5, 11);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        const dateStr = new Date().toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
        doc.text(`Fecha: ${dateStr}`, PAGE_WIDTH / 2 + 5, 17);
      };

      const drawFooter = (doc, pageNum) => {
        doc.setFillColor(...bgColor);
        doc.rect(0, PAGE_HEIGHT - FOOTER_HEIGHT, PAGE_WIDTH, FOOTER_HEIGHT, 'F');
        doc.setFontSize(8);
        doc.setTextColor(200, 200, 200);
        doc.text('Tecnología al alcance de tus manos', MARGIN, PAGE_HEIGHT - 9);
        doc.text(`Página ${pageNum}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 9, { align: 'right' });
        doc.setFontSize(7);
        doc.setTextColor(150, 150, 150);
        doc.text('Av 20 entre calles 27 y 28 - Barquisimeto | Tel: 0424-9316999', PAGE_WIDTH / 2, PAGE_HEIGHT - 6, { align: 'center' });
      };

      const drawProductCell = (doc, product, x, y, w, h, assets) => {
        // Tarjeta con fondo oscuro y borde rojo
        doc.setFillColor(...cardBgColor);
        doc.setDrawColor(...cardBorderColor);
        doc.setLineWidth(0.5);
        doc.roundedRect(x, y, w, h, 5, 5, 'FD');

        // Imagen del producto
        const imgData = assets[product.id];
        if (imgData) {
          // NOTA: La calidad de la imagen y si tiene fondo o no depende de la URL de origen.
          // Este código no puede eliminar fondos de imágenes.
          try {
            doc.addImage(imgData, 'JPEG', x + 4, y + 4, w - 8, h * 0.5, undefined, 'FAST');
          } catch (e) {
            console.warn('[PDF] Error al añadir imagen para', product.codigo, e);
          }
        }

        // Contenido debajo de la imagen
        const contentY = y + h * 0.5 + 8;

        // Nombre/Descripción del producto
        doc.setTextColor(...white);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        const descLines = doc.splitTextToSize(product.nombre || '', w - 8);
        doc.text(descLines.slice(0, 2), x + 4, contentY);

        // Código del producto (etiqueta roja con texto negro)
        doc.setFontSize(7);
        doc.setFont('helvetica', 'bold');
        const codeText = product.codigo || 'S/C';
        const codeWidth = doc.getTextWidth(codeText);
        doc.setFillColor(...redColor);
        doc.roundedRect(x + 4, contentY + 10, codeWidth + 4, 6, 2, 2, 'F');
        doc.setTextColor(...black);
        doc.text(codeText, x + 6, contentY + 14);

        // Stock (blanco)
        // [MODIFICADO] Ocultar Stock en PDF
        // doc.setTextColor(...white);
        // doc.setFontSize(7);
        // doc.text(`Stock: ${product.stock || 0}`, x + 4 + codeWidth + 8, contentY + 14);

        // Precio Detal (verde neón)
        doc.setTextColor(...greenNeon);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        const detalPrice = `$${parseFloat(product.precio_cliente || 0).toLocaleString('es-CO', { minimumFractionDigits: 2 })}`;
        doc.text(`Detal: ${detalPrice}`, x + 4, h + y - 9);

        // Precio Mayor (azul neón)
        doc.setTextColor(...blueNeon);
        doc.setFontSize(8);
        const mayorPrice = `$${parseFloat(product.precio_mayor || 0).toLocaleString('es-CO', { minimumFractionDigits: 2 })}`;
        doc.text(`Mayor: ${mayorPrice}`, x + 4, h + y - 4);
      };

      // --- 5. Bucle de Generación de Páginas ---
      let productOnPageIndex = 0;
      let pageNum = 1;

      // Primera página
      doc.setFillColor(...bgColor);
      doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, 'F');
      drawWatermark(doc);
      drawHeader(doc, selectedDept, assets);

      for (let i = 0; i < filtered.length; i++) {
        const product = filtered[i];
        const col = productOnPageIndex % GRID_COLS;
        const row = Math.floor(productOnPageIndex / GRID_COLS);

        const x = MARGIN + col * (CELL_WIDTH + GAP);
        const y = HEADER_HEIGHT + MARGIN + row * (CELL_HEIGHT + GAP);

        drawProductCell(doc, product, x, y, CELL_WIDTH, CELL_HEIGHT, assets);

        productOnPageIndex++;

        if (productOnPageIndex === GRID_COLS * GRID_ROWS && i < filtered.length - 1) {
          drawFooter(doc, pageNum);
          pageNum++;
          productOnPageIndex = 0;
          doc.addPage();

          // Fondo para la nueva página
          doc.setFillColor(...bgColor);
          doc.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, 'F');

          drawWatermark(doc);
          drawHeader(doc, selectedDept, assets);
        }
      }

      drawFooter(doc, pageNum);

      // --- 6. Guardar PDF y Limpiar ---
      updateProgress(100, 100, 'Completado. Descargando...');
      doc.save(`Catalogo_${selectedDept}_${new Date().toISOString().split('T')[0]}.pdf`);

      setTimeout(() => progressModal.remove(), 1500);

    } catch (error) {
      console.error('[PDF] Error:', error);
      alert('Error generando PDF: ' + error.message);
      progressModal.remove();
    }
  };

  // ============================================
  // INICIALIZAR
  // ============================================

  function initializeListeners() {
    const buttons = {
      'update-products-button': window.showUpdateProductsModal,
      'add-merchandise-button': window.showAddMerchandiseModal,
      'no-photo-button': window.showProductsWithoutPhoto,
      'modify-product-button': window.showModifyProductModal,
      'export-pdf-button': window.showPdfExportModal,
      'upload-excel-button': window.showUploadExcelModal
    };

    Object.entries(buttons).forEach(([id, fn]) => {
      const btn = document.getElementById(id);
      if (btn) btn.addEventListener('click', fn);
    });

    console.log('[FEATURES] ✅ Listeners inicializados');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeListeners);
  } else {
    initializeListeners();
  }

  setTimeout(initializeListeners, 1000);

})();
