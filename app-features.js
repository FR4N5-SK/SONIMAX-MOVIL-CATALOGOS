// ============================================
﻿// ============================================
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

      // Filtrar productos sin imagen URL desde la memoria local
      const productsWithoutPhoto = allProducts.filter(p => !p.imagen_url || p.imagen_url.trim() === '');

      console.log('[NO-PHOTO] Encontrados:', productsWithoutPhoto.length, 'productos sin foto');

      const modalDiv = document.createElement('div');
      modalDiv.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto';
      modalDiv.innerHTML = `
        <div class="bg-white rounded-2xl max-w-2xl w-full shadow-2xl my-8">
          <div class="bg-gradient-to-r from-amber-600 to-amber-700 p-6 text-white sticky top-0 z-10 flex items-center justify-between">
            <div>
              <h2 class="text-2xl font-bold">Productos sin Foto</h2>
              <p class="text-amber-100 mt-1">Total encontrados: ${productsWithoutPhoto.length}</p>
            </div>
            <button onclick="this.closest('.fixed').remove()" class="text-white hover:bg-amber-800 p-2 rounded-lg transition-all text-xl font-bold">✕</button>
          </div>
          
          <div class="p-6 space-y-4">
            <input type="text" id="no-photo-search" placeholder="Busca por código o nombre..." 
              class="w-full px-4 py-3 border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-600 focus:border-transparent transition-all">
            
            <div id="no-photo-results" class="space-y-3 max-h-96 overflow-y-auto">
              ${productsWithoutPhoto.length === 0 ? '<p class="text-gray-500 text-center py-8">¡Todos los productos tienen foto!</p>' : 
                productsWithoutPhoto.map(p => `
                <div class="p-4 bg-gray-50 rounded-lg border-l-4 border-amber-500 hover:bg-gray-100 transition cursor-pointer no-photo-item" 
                  data-codigo="${p.codigo || ''}" data-nombre="${p.nombre || ''}" data-id="${p.id}">
                  <p class="font-semibold text-gray-800">${p.codigo || 'SIN CODE'}</p>
                  <p class="text-sm text-gray-600 mt-1">${p.nombre || 'Sin nombre'}</p>
                  <p class="text-xs text-gray-500 mt-2">${p.descripcion || 'Sin descripción'}</p>
                  <p class="text-xs text-amber-600 mt-2">Stock: ${p.stock || 0}</p>
                </div>
              `).join('')}
            </div>
          </div>
          
          <div class="p-6 border-t flex gap-3">
            <button class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition" 
              onclick="window.showAddMerchandiseModal()">
              Agregar Fotos
            </button>
            <button class="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg font-semibold hover:bg-gray-300 transition" 
              onclick="this.closest('.fixed').remove()">
              Cerrar
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(modalDiv);

      // Agregar funcionalidad de búsqueda
      const searchInput = document.getElementById('no-photo-search');
      const resultsDiv = document.getElementById('no-photo-results');
      const items = modalDiv.querySelectorAll('.no-photo-item');

      searchInput.addEventListener('input', () => {
        const searchTerm = searchInput.value.toLowerCase().trim();
        let visibleCount = 0;

        items.forEach(item => {
          const codigo = item.dataset.codigo.toLowerCase();
          const nombre = item.dataset.nombre.toLowerCase();
          
          if (codigo.includes(searchTerm) || nombre.includes(searchTerm)) {
            item.style.display = 'block';
            visibleCount++;
          } else {
            item.style.display = 'none';
          }
        });

        if (visibleCount === 0 && searchTerm.length > 0) {
          resultsDiv.innerHTML = '<p class="text-gray-500 text-center py-8">No se encontraron productos</p>';
        }
      });

      searchInput.focus();
    } catch (error) {
      console.error('[NO-PHOTO] Error inesperado:', error);
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
    formDiv.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4';
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
    formDiv.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto';
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

  window.generatePdf = async function() {
    const { allProducts } = getGlobalState();
    
    const selectedDept = document.getElementById('pdf-department').value;
    if (!selectedDept) {
      alert('Selecciona un departamento');
      return;
    }

    try {
      // Crear modal de progreso
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
        const percentage = Math.round((current / total) * 100);
        progressBar.style.width = percentage + '%';
        progressText.textContent = message || `${current} de ${total} (${percentage}%)`;
      };

      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

      let filtered = allProducts;
      if (selectedDept !== 'all') {
        filtered = allProducts.filter(p => p.departamento === selectedDept);
      }

      if (filtered.length === 0) {
        progressModal.remove();
        alert('No hay productos para este departamento');
        return;
      }

      console.log('[PDF] Procesando', filtered.length, 'productos...');
      updateProgress(0, filtered.length, 'Descargando imágenes...');
      
      // Pre-cargar todas las imágenes como base64 con progreso
      const imageCache = {};
      let imagesProcessed = 0;
      const totalImages = filtered.filter(p => p.imagen_url && p.imagen_url.trim() !== '').length;
      let imagesLoaded = 0;
      
      for (const product of filtered) {
        if (product.imagen_url && product.imagen_url.trim() !== '') {
          console.log('[PDF] Cargando imagen de:', product.codigo);
          imageCache[product.id || product.codigo] = await imageUrlToBase64(product.imagen_url);
          imagesLoaded++;
          updateProgress(imagesLoaded, totalImages, `Descargando imagen ${imagesLoaded} de ${totalImages}...`);
        }
        imagesProcessed++;
      }
      console.log('[PDF] Imágenes cargadas:', Object.keys(imageCache).length);
      updateProgress(totalImages, totalImages, 'Generando documento PDF...');

      const pageHeight = doc.internal.pageSize.getHeight();
      const pageWidth = doc.internal.pageSize.getWidth();

      // ==================== CREAR PORTADA ====================
      // Fondo rojo sólido (Color corporativo Sonimax)
      doc.setFillColor(220, 38, 38); // #DC2626
      doc.rect(0, 0, pageWidth, pageHeight, 'F');
      
      // Elemento decorativo (Círculo sutil para dar profundidad)
      doc.setFillColor(185, 28, 28); // #B91C1C (Rojo más oscuro)
      doc.circle(pageWidth, 0, 120, 'F');
      doc.circle(0, pageHeight, 100, 'F');

      // Logo/Título SONIMAX MÓVIL
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(42);
      doc.setFont('helvetica', 'bold');
      doc.text('SONIMAX MÓVIL', pageWidth / 2, pageHeight * 0.35, { align: 'center' });
      
      // Línea decorativa roja
      doc.setDrawColor(255, 255, 255);
      doc.setLineWidth(1);
      doc.line(pageWidth * 0.2, pageHeight * 0.37, pageWidth * 0.8, pageHeight * 0.37);

      // Departamento en grande
      doc.setFontSize(24);
      doc.setFont('helvetica', 'normal');
      const deptTitle = selectedDept === 'all' ? 'CATÁLOGO GENERAL' : selectedDept.toUpperCase();
      doc.text(deptTitle, pageWidth / 2, pageHeight * 0.45, { align: 'center' });

      // Fecha
      doc.setFontSize(16);
      doc.setFont('helvetica', 'italic');
      const today = new Date();
      const dateStr = today.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
      doc.text(dateStr, pageWidth / 2, pageHeight * 0.50, { align: 'center' });

      // Información de contacto al pie
      doc.setFontSize(12);
      doc.setFont('helvetica', 'normal');
      doc.text('Tecnología al alcance de tus manos', pageWidth / 2, pageHeight - 30, { align: 'center' });
      doc.setFontSize(10);
      doc.text('Av 20 entre calles 27 y 28 - Barquisimeto | Tel: 0424-9316999', pageWidth / 2, pageHeight - 20, { align: 'center' });

      // ==================== TABLA DE PRODUCTOS ====================
      doc.addPage();

      // Definir columnas
      const columns = [
        { header: 'Imagen', dataKey: 'image' },
        { header: 'Código', dataKey: 'codigo' },
        { header: 'Descripción', dataKey: 'nombre' },
        { header: 'Precio Detal', dataKey: 'precio_cliente' },
        { header: 'Precio Mayor', dataKey: 'precio_mayor' }
      ];

      // Preparar datos
      const body = filtered.map(p => ({
        id: p.id,
        image: '', // Placeholder para el hook
        codigo: p.codigo || 'S/C',
        nombre: p.nombre || 'Sin descripción',
        precio_cliente: `$${parseFloat(p.precio_cliente || 0).toLocaleString('es-CO')}`,
        precio_mayor: `$${parseFloat(p.precio_mayor || 0).toLocaleString('es-CO')}`
      }));

      // Generar tabla con autoTable
      doc.autoTable({
        columns: columns,
        body: body,
        startY: 20,
        theme: 'striped',
        styles: {
          fontSize: 10,
          cellPadding: 4, // Aumentado para que no esté pegado
          valign: 'middle',
          overflow: 'linebreak',
          lineColor: [220, 220, 220],
          lineWidth: 0.1
        },
        headStyles: {
          fillColor: [220, 38, 38], // Rojo corporativo
          textColor: [255, 255, 255],
          fontStyle: 'bold',
          fontSize: 11,
          halign: 'center'
        },
        columnStyles: {
          image: { cellWidth: 25, minCellHeight: 25 },
          codigo: { cellWidth: 25, fontStyle: 'bold', halign: 'center' },
          nombre: { cellWidth: 'auto' },
          precio_cliente: { cellWidth: 30, halign: 'right', fontStyle: 'bold', textColor: [220, 38, 38] }, // Rojo para Detal
          precio_mayor: { cellWidth: 30, halign: 'right', fontStyle: 'bold', textColor: [22, 163, 74] } // Verde para Mayor (contraste)
        },
        alternateRowStyles: {
          fillColor: [254, 242, 242] // Rojo muy tenue para filas alternas
        },
        didDrawCell: (data) => {
          // Dibujar imagen en la celda correspondiente
          if (data.column.dataKey === 'image' && data.cell.section === 'body') {
            const productId = data.row.raw.id;
            const imgData = imageCache[productId];
            
            if (imgData) {
              const cell = data.cell;
              const padding = 2;
              const dim = Math.min(cell.width, cell.height) - (padding * 2);
              const x = cell.x + (cell.width - dim) / 2;
              const y = cell.y + (cell.height - dim) / 2;
              
              try {
                doc.addImage(imgData, 'JPEG', x, y, dim, dim);
                // Borde sutil
                doc.setDrawColor(200, 200, 200);
                doc.setLineWidth(0.1);
                doc.rect(x, y, dim, dim);
              } catch (e) {
                // Fallo silencioso
              }
            } else {
              // Marcador de posición estético
              doc.setFontSize(6);
              doc.setTextColor(150);
              doc.text('Sin Foto', data.cell.x + data.cell.width/2, data.cell.y + data.cell.height/2, { align: 'center', baseline: 'middle' });
            }
          }
        },
        didDrawPage: (data) => {
          // Encabezado de página
          doc.setFontSize(10);
          doc.setTextColor(100);
          doc.text('SONIMAX MÓVIL - Catálogo', data.settings.margin.left, 10);
          
          // Pie de página con numeración
          const pageCount = doc.internal.getNumberOfPages();
          doc.setFontSize(8);
          doc.text(`Página ${pageCount}`, pageWidth - 20, pageHeight - 10, { align: 'right' });
          doc.text('Av 20 entre calles 27 y 28 - Barquisimeto | Tel: 0424-9316999', pageWidth / 2, pageHeight - 10, { align: 'center' });
        }
      });

      updateProgress(100, 100, 'Completado! Descargando...');
      doc.save(`Catalogo_${selectedDept}_${new Date().toISOString().split('T')[0]}.pdf`);
      
      // Cerrar modal después de 1 segundo
      setTimeout(() => {
        progressModal.remove();
      }, 1000);
      
    } catch (error) {
      console.error('[PDF] Error:', error);
      alert('Error generando PDF: ' + error.message);
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
