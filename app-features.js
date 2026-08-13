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

  // ============================================
  // PRODUCTOS SIN FOTO - CORREGIDO
  // ============================================

  window.showProductsWithoutPhoto = async function() {
    try {
      const { allProducts } = getGlobalState();
      
      console.log('[NO-PHOTO] Buscando productos sin foto en memoria...');
      
      if (!allProducts || allProducts.length === 0) {
        alert('Cargando productos... Por favor espera unos segundos.');
        return;
      }

      const productsWithoutPhoto = allProducts.filter(p => !p.imagen_url || p.imagen_url.trim() === '');
      console.log('[NO-PHOTO] Encontrados:', productsWithoutPhoto.length, 'productos sin foto');

      const modalDiv = document.createElement('div');
      modalDiv.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto';
      modalDiv.innerHTML = `
        <div class="bg-white rounded-2xl max-w-2xl w-full shadow-2xl my-8">
          <div class="bg-gradient-to-r from-amber-600 to-amber-700 p-6 text-white sticky top-0 z-10 flex items-center justify-between rounded-t-2xl">
            <div>
              <h2 class="text-2xl font-bold">Productos sin Foto</h2>
              <p class="text-amber-100 mt-1">Total encontrados: ${productsWithoutPhoto.length} — Haz clic en un producto para agregar su foto</p>
            </div>
            <button onclick="this.closest('.fixed').remove()" class="text-white hover:bg-amber-800 p-2 rounded-lg transition-all text-xl font-bold">✕</button>
          </div>
          
          <div class="p-6 space-y-4">
            <input type="text" id="no-photo-search" placeholder="Busca por código o nombre..." 
              class="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-600 focus:border-transparent transition-all">
            
            <div id="no-photo-results" class="space-y-2 max-h-[60vh] overflow-y-auto">
              ${productsWithoutPhoto.length === 0 
                ? '<p class="text-gray-500 text-center py-8">¡Todos los productos tienen foto!</p>' 
                : productsWithoutPhoto.map(p => `
                <div class="no-photo-item border-l-4 border-amber-500 rounded-lg overflow-hidden"
                  data-codigo="${(p.codigo || '').replace(/"/g,'&quot;')}" 
                  data-nombre="${(p.nombre || '').replace(/"/g,'&quot;')}" 
                  data-id="${p.id}">
                  <div class="p-4 bg-gray-50 hover:bg-amber-50 transition cursor-pointer flex items-center justify-between no-photo-header">
                    <div>
                      <p class="font-semibold text-gray-800">${p.codigo || 'SIN CÓDIGO'}</p>
                      <p class="text-sm text-gray-600 mt-0.5">${p.nombre || 'Sin nombre'}</p>
                      <p class="text-xs text-amber-600 mt-1">Stock: ${p.stock || 0}</p>
                    </div>
                    <span class="text-amber-500 text-xl font-bold ml-3">📷</span>
                  </div>
                  <div class="no-photo-form hidden px-4 pb-4 bg-amber-50 border-t border-amber-200">
                    <label class="block text-xs font-semibold text-gray-700 mt-3 mb-1">Foto del Producto:</label>
                    <input type="file" class="photo-file-input hidden" accept="image/*">
                    <label class="photo-file-label flex items-center gap-2 w-full px-3 py-2 border-2 border-dashed border-amber-400 rounded-lg text-sm cursor-pointer hover:bg-amber-100 transition">
                      <span>📁</span><span class="photo-file-name">Seleccionar imagen...</span>
                    </label>
                    <p class="text-xs text-gray-400 mt-1">La foto se sube directamente a Supabase</p>
                    <div class="flex gap-2 mt-3">
                      <button class="save-photo-btn flex-1 px-3 py-2 bg-amber-600 text-white rounded-lg font-semibold text-sm hover:bg-amber-700 transition" data-id="${p.id}">Guardar Foto</button>
                      <button class="cancel-photo-btn flex-1 px-3 py-2 bg-gray-200 text-gray-700 rounded-lg font-semibold text-sm hover:bg-gray-300 transition">Cancelar</button>
                    </div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
          
          <div class="p-6 border-t flex gap-3">
            <button class="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300 transition" 
              onclick="this.closest('.fixed').remove()">
              Cerrar
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(modalDiv);

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

      // Toggle inline del formulario al hacer clic en el header
      modalDiv.addEventListener('click', async (e) => {
        // Abrir/cerrar formulario inline
        const header = e.target.closest('.no-photo-header');
        if (header) {
          const item = header.closest('.no-photo-item');
          const form = item.querySelector('.no-photo-form');
          const isOpen = !form.classList.contains('hidden');
          // Cerrar todos los demás
          modalDiv.querySelectorAll('.no-photo-form').forEach(f => f.classList.add('hidden'));
          if (!isOpen) {
            form.classList.remove('hidden');
            // Conectar el label con el input de archivo
            const fileLabel = form.querySelector('.photo-file-label');
            const fileInput = form.querySelector('.photo-file-input');
            const fileName = form.querySelector('.photo-file-name');
            if (fileLabel && fileInput && !fileInput._connected) {
              fileInput._connected = true;
              fileLabel.addEventListener('click', () => fileInput.click());
              fileInput.addEventListener('change', () => {
                fileName.textContent = fileInput.files.length > 0 ? fileInput.files[0].name : 'Seleccionar imagen...';
              });
            }
          }
          return;
        }

        // Cancelar
        if (e.target.classList.contains('cancel-photo-btn')) {
          e.target.closest('.no-photo-form').classList.add('hidden');
          return;
        }

        // Guardar foto
        if (e.target.classList.contains('save-photo-btn')) {
          const btn = e.target;
          const productId = btn.dataset.id;
          const form = btn.closest('.no-photo-form');
          const fileInput = form.querySelector('.photo-file-input');
          const file = fileInput && fileInput.files.length > 0 ? fileInput.files[0] : null;

          if (!file) { alert('Por favor selecciona una imagen para subir.'); return; }

          const { supabaseClient } = getGlobalState();
          btn.textContent = 'Subiendo...';
          btn.disabled = true;

          try {
            // Subir imagen a Supabase Storage (con compresión previa)
            const compressFn = window.compressImageFile || (async (f) => f);
            const fileToUpload = await compressFn(file, 1000, 1000, 0.75);
            const fileExt = fileToUpload.name.split('.').pop();
            const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
            const filePath = `products/${fileName}`;

            const { error: uploadError } = await supabaseClient.storage
              .from('products')
              .upload(filePath, fileToUpload, { cacheControl: '31536000', upsert: false });

            if (uploadError) throw new Error('Error subiendo imagen: ' + uploadError.message);

            const { data: publicUrlData } = supabaseClient.storage.from('products').getPublicUrl(filePath);
            const url = publicUrlData.publicUrl;

            // Guardar URL en la base de datos
            const { error } = await supabaseClient.from('products').update({ imagen_url: url }).eq('id', productId);
            if (error) throw error;

            // Actualizar en memoria
            if (window.allProducts) {
              const idx = window.allProducts.findIndex(p => p.id === productId);
              if (idx !== -1) window.allProducts[idx].imagen_url = url;
            }

            // Remover el ítem de la lista
            form.closest('.no-photo-item').remove();
            if (window.renderProducts) window.renderProducts();

            // Actualizar contador
            const remaining = modalDiv.querySelectorAll('.no-photo-item').length;
            modalDiv.querySelector('.text-amber-100').textContent = `Total encontrados: ${remaining} — Haz clic en un producto para agregar su foto`;

          } catch (err) {
            console.error('[NO-PHOTO] Error guardando:', err);
            alert('Error al guardar: ' + err.message);
            btn.textContent = 'Guardar Foto';
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
            <label class="block text-sm font-semibold text-gray-700 mb-2">Foto del Producto:</label>
            <input type="file" id="form-file" accept="image/*" class="hidden">
            <label for="form-file" class="flex items-center gap-2 w-full px-4 py-3 border-2 border-dashed border-cyan-400 rounded-xl cursor-pointer hover:bg-cyan-50 transition">
              <span>📁</span><span id="form-file-name" class="text-sm text-gray-600">Seleccionar imagen...</span>
            </label>
            <p class="text-xs text-gray-400 mt-2">La foto se sube directamente a Supabase Storage</p>
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
    // Mostrar nombre de archivo al seleccionar
    document.getElementById('form-file').addEventListener('change', (e) => {
      const label = document.getElementById('form-file-name');
      if (label) label.textContent = e.target.files.length > 0 ? e.target.files[0].name : 'Seleccionar imagen...';
    });
  }

  window.saveMerchandise = async function(productId, codigo, nombre) {
    const { supabaseClient } = getGlobalState();
    
    const fileInput = document.getElementById('form-file');
    const department = document.getElementById('form-department').value.trim();
    const file = fileInput && fileInput.files.length > 0 ? fileInput.files[0] : null;

    if (!file || !department) {
      alert('Por favor selecciona una imagen y verifica el departamento');
      return;
    }

    try {
      console.log('[MERCHANDISE] Subiendo imagen para producto:', codigo);

      // Subir imagen a Supabase Storage (con compresión previa)
      const compressFn = window.compressImageFile || (async (f) => f);
      const fileToUpload = await compressFn(file, 1000, 1000, 0.75);
      const fileExt = fileToUpload.name.split('.').pop();
      const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
      const filePath = `products/${fileName}`;

      const { error: uploadError } = await supabaseClient.storage
        .from('products')
        .upload(filePath, fileToUpload, { cacheControl: '31536000', upsert: false });

      if (uploadError) throw new Error('Error subiendo imagen: ' + uploadError.message);

      const { data: publicUrlData } = supabaseClient.storage.from('products').getPublicUrl(filePath);
      const url = publicUrlData.publicUrl;

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
            <input type="url" id="edit-url" value="${product.imagen_url || ''}" class="w-full px-3 py-2 border-2 border-gray-300 rounded-lg text-sm">
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
    document.getElementById('edit-deposito').value = currentDeposito; // Ahora currentDeposito tiene el valor correcto
  }

  window.saveProductEdit = async function(productId, productCode) {
    const { supabaseClient, allProducts } = getGlobalState();
    
    const updates = {
      codigo: document.getElementById('edit-codigo').value,
      nombre: document.getElementById('edit-nombre').value,
      descripcion: document.getElementById('edit-descripcion').value,
      departamento: document.getElementById('edit-departamento').value,
      precio_cliente: parseFloat(document.getElementById('edit-precio-cliente').value) || 0,
      precio_mayor: parseFloat(document.getElementById('edit-precio-mayor').value) || 0,
      precio_gmayor: parseFloat(document.getElementById('edit-precio-gmayor').value) || 0,
      stock: parseInt(document.getElementById('edit-stock').value) || 0,
      imagen_url: document.getElementById('edit-url').value
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

      alert('✅ Producto actualizado correctamente');
      document.querySelector('.fixed')?.remove();
      await window.loadProducts();
      window.renderProducts();
    } catch (error) {
      console.error('[EDIT] Error:', error);
      alert('Error: ' + error.message);
    }
  };

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

  // Función auxiliar para convertir URL de imagen a base64 usando canvas
  const imageUrlToBase64 = (url) => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        // OPTIMIZACIÓN: Redimensionar para evitar error "Invalid string length" en PDFs grandes
        const MAX_DIM = 200; // Suficiente para miniaturas de tabla (25mm)
        let width = img.width;
        let height = img.height;
        if (width > height && width > MAX_DIM) { height *= MAX_DIM / width; width = MAX_DIM; }
        else if (height > MAX_DIM) { width *= MAX_DIM / height; height = MAX_DIM; }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        // Calidad reducida para optimizar tamaño del PDF
        resolve(canvas.toDataURL('image/jpeg', 0.6));
      };
      img.onerror = () => {
        console.warn('[PDF] No se pudo cargar imagen:', url);
        resolve(null); // Retornar null si falla
      };
      img.src = url;
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

      // --- 2. Cargar Recursos y Paleta de Colores ---
      const assets = {}; // Almacenará imágenes en base64

      const totalResources = filtered.length;
      updateProgress(0, totalResources, 'Cargando recursos...');

      let imagesLoaded = 0;
      for (const product of filtered) {
        if (product.imagen_url) {
          assets[product.id] = await imageUrlToBase64(product.imagen_url);
        }
        imagesLoaded++;
        updateProgress(imagesLoaded, totalResources, `Cargando imagen ${imagesLoaded} de ${filtered.length}...`);
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
