// SONIMAX MÓVIL - Aplicación Principal
// Sistema actualizado con USUARIO en lugar de EMAIL con BANNERS integrados
// VERSIÓN CORREGIDA - Comparación correcta de productos nuevos

/* global XLSX */
/* eslint-disable no-undef */

/**
 * @typedef {Object} XLSX
 * @global
 */

let currentUser = null
let currentUserRole = null
// VARIABLE GLOBAL - Accesible desde app-features.js
window.currentUserRole = null
let allProducts = []
// EXPORTAR allProducts AL WINDOW para que app-features.js pueda acceder
Object.defineProperty(window, 'allProducts', {
  get() { return allProducts; },
  set(value) { allProducts = value; },
  configurable: true
});
let filteredProducts = []
let inventoryDataMap = new Map(); // [NUEVO] Mapa para datos de inventario (codigo -> datos)
let cart = []
let favorites = [] // [NUEVO] Para sistema de favoritos
let priceSnapshotMap = new Map(); // [NUEVO] Para comparación de precios
let fuse; // [NUEVO] Para búsqueda difusa
let currentDepartment = "all"
let selectedProductForQuantity = null

let currentPage = 1
const PRODUCTS_PER_PAGE = 50
let isLoadingMore = false

let imageObserver = null
let serviceWorkerRegistration = null

const IMAGE_LOAD_STATE_KEY = "sonimax_image_load_state"
const PRODUCTS_HASH_KEY = "sonimax_products_hash"
const FAVORITES_KEY = "sonimax_favorites" // [NUEVO]
const NEW_PRODUCTS_KEY = "sonimax_new_products"
const PRODUCT_SALES_KEY = "sonimax_product_sales"
const CART_BACKUP_KEY = "sonimax_cart_backup"
const CSV_SNAPSHOT_KEY = "sonimax_csv_snapshot" // Nueva clave para snapshot local
const STOCK_VISIBILITY_CONFIG_KEY = "sonimax_stock_visibility_config"
const MAX_RETRY_ATTEMPTS = 3
const RETRY_DELAY = 1500 // 1.5 segundos entre reintentos

let banners = []
let currentBannerIndex = 0
let bannerAutoPlayInterval = null

const imageLoadState = {
  loadedImages: new Set(),
  failedImages: new Map(), // url -> attemptCount
  inProgress: false,
  lastUpdate: null,
  // Nuevos campos para priorización
  isPaused: false,
  priorityQueue: [],
  backgroundQueue: [],
  currentAbortController: null,
}

// Variable global para el estado de edición de inventario
let inventoryEditMode = false;
let inventoryShowStockMode = false; // NUEVO
// Variable global para configuración de visibilidad de stock por rol
let stockVisibilityConfig = {
  admin: true,
  gestor: true,
  distribuidor: true,
  cliente: true,
  inventario: false
};

// ============================================
// GESTIÓN DE PRODUCTOS NUEVOS Y MÁS VENDIDOS (GLOBAL) - CORREGIDO
// ============================================

// Esta función ya no es necesaria porque is_new viene de la base de datos
/*
function getNewProducts() {
  try {
    const saved = localStorage.getItem(NEW_PRODUCTS_KEY)
    if (saved) {
      const newProductIds = JSON.parse(saved)
      return allProducts.filter((p) => newProductIds.includes(p.id))
    }
  } catch (error) {
    console.error("[NEW-PRODUCTS] Error cargando productos nuevos:", error)
  }
  return []
}
*/

function saveNewProducts(productIds) {
  try {
    localStorage.setItem(NEW_PRODUCTS_KEY, JSON.stringify(productIds))
    console.log(`[NEW-PRODUCTS] ${productIds.length} productos nuevos guardados`)
  } catch (error) {
    console.error("[NEW-PRODUCTS] Error guardando productos nuevos:", error)
  }
}

async function saveCSVSnapshot(products) {
  try {
    const snapshot = products.map((p) => ({
      codigo: p.descripcion || "", // El código está en descripcion
      nombre: p.nombre,
      departamento: p.departamento || "",
      precio_cliente: p.precio_cliente || 0,
      precio_mayor: p.precio_mayor || 0,
      precio_gmayor: p.precio_gmayor || 0,
    }))

    // Guardar en Supabase
    const { data, error } = await window.supabaseClient
      .from("csv_snapshot")
      .insert({
        snapshot_data: snapshot,
        uploaded_by: currentUser?.id || null,
      })
      .select()

    if (error) {
      console.error("[CSV-SNAPSHOT] Error guardando en Supabase:", error)
      // Fallback a localStorage si falla Supabase
      localStorage.setItem(CSV_SNAPSHOT_KEY, JSON.stringify(snapshot))
      console.log(`[CSV-SNAPSHOT] Snapshot guardado en localStorage (fallback) con ${snapshot.length} productos`)
    } else {
      console.log(`[CSV-SNAPSHOT] ✅ Snapshot guardado en Supabase con ${snapshot.length} productos`)
      // También guardar en localStorage como backup
      localStorage.setItem(CSV_SNAPSHOT_KEY, JSON.stringify(snapshot))
    }
  } catch (error) {
    console.error("[CSV-SNAPSHOT] Error guardando snapshot:", error)
  }
}

function saveStockVisibilityConfigLocalBackup(config) {
  try {
    localStorage.setItem(STOCK_VISIBILITY_CONFIG_KEY, JSON.stringify(config))
  } catch (error) {
    console.warn("[CONFIG] No se pudo guardar respaldo local de visibilidad de stock:", error)
  }
}

function loadStockVisibilityConfigLocalBackup() {
  try {
    const saved = localStorage.getItem(STOCK_VISIBILITY_CONFIG_KEY)
    if (!saved) return null
    return JSON.parse(saved)
  } catch (error) {
    console.warn("[CONFIG] No se pudo cargar respaldo local de visibilidad de stock:", error)
    return null
  }
}

async function getPreviousCSVSnapshot() {
  try {
    // Intentar obtener el snapshot más reciente de Supabase
    const { data, error } = await window.supabaseClient
      .from("csv_snapshot")
      .select("snapshot_data, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      console.error('[CSV-SNAPSHOT] ❌ Error obteniendo snapshot de Supabase:', error, JSON.stringify(error))
      console.log("[CSV-SNAPSHOT] No hay snapshot en Supabase, intentando localStorage")
      // Fallback a localStorage
      const saved = localStorage.getItem(CSV_SNAPSHOT_KEY)
      if (saved) {
        return JSON.parse(saved)
      }
      return []
    }

    if (data && data.snapshot_data) {
      console.log(`[CSV-SNAPSHOT] ✅ Snapshot cargado desde Supabase: ${data.snapshot_data.length} productos`)
      try {
        localStorage.setItem(CSV_SNAPSHOT_KEY, JSON.stringify(data.snapshot_data))
      } catch (e) {
        console.warn("No se pudo guardar snapshot de precios en caché local:", e)
      }
      return data.snapshot_data
    }

    return []
  } catch (error) {
    console.error("[CSV-SNAPSHOT] Error cargando snapshot anterior:", error)
    return []
  }
}

function compareProductsAndDetectNew(currentProducts, previousSnapshot) {
  const newProductIds = []
  const modifiedProductIds = []

  // Crear mapa de productos anteriores para búsqueda rápida
  const previousProductMap = new Map()
  previousSnapshot.forEach((p) => {
    // Usar código como clave principal, o nombre si no hay código
    const key = (p.codigo || p.nombre).toLowerCase().trim()
    previousProductMap.set(key, p)
  })

  console.log(`[COMPARISON] 📊 Productos anteriores en snapshot: ${previousSnapshot.length}`)
  console.log(`[COMPARISON] 📊 Productos actuales: ${currentProducts.length}`)

  // Comparar cada producto actual con el snapshot anterior
  currentProducts.forEach((product) => {
    const key = (product.descripcion || product.nombre).toLowerCase().trim()
    const previousProduct = previousProductMap.get(key)

    if (!previousProduct) {
      // Producto completamente nuevo
      newProductIds.push(product.id)
      console.log(`[COMPARISON] ✨ Producto NUEVO: ${product.nombre}`)
    } else {
      const priceChanged =
        previousProduct.precio_cliente !== product.precio_cliente ||
        previousProduct.precio_mayor !== product.precio_mayor ||
        previousProduct.precio_gmayor !== product.precio_gmayor

      const dataChanged =
        previousProduct.nombre !== product.nombre || previousProduct.departamento !== product.departamento

      const backInStock = (previousProduct.stock || 0) === 0 && (product.stock || 0) > 0

      if (priceChanged || dataChanged || backInStock) {
        if (backInStock) {
          newProductIds.push(product.id)
          console.log(`[COMPARISON] 🆕 Producto VOLVIÓ A STOCK: ${product.nombre}`)
        } else {
          modifiedProductIds.push(product.id)
          console.log(`[COMPARISON] 🔄 Producto MODIFICADO: ${product.nombre}`)
        }
        
        if (priceChanged) {
          console.log(`   💰 Cambio de precios detectado`)
        }
        if (dataChanged) {
          console.log(`   📝 Cambio de datos detectado`)
        }
      }
    }
  })

  // Detectar productos eliminados
  const currentProductKeys = new Set(currentProducts.map((p) => (p.descripcion || p.nombre).toLowerCase().trim()))
  const deletedProducts = []

  previousSnapshot.forEach((p) => {
    const key = (p.codigo || p.nombre).toLowerCase().trim()
    if (!currentProductKeys.has(key)) {
      deletedProducts.push(p.nombre)
    }
  })

  console.log(`[COMPARISON] ✅ Resumen de cambios:`)
  console.log(`   ✨ Productos nuevos: ${newProductIds.length}`)
  console.log(`   🔄 Productos modificados: ${modifiedProductIds.length}`)
  console.log(`   🗑️ Productos eliminados: ${deletedProducts.length}`)
  console.log(
    `   ➡️ Productos sin cambios: ${currentProducts.length - newProductIds.length - modifiedProductIds.length}`,
  )

  if (deletedProducts.length > 0 && deletedProducts.length <= 10) {
    console.log(`[COMPARISON] 🗑️ Productos eliminados:`, deletedProducts)
  }

  return {
    newProductIds,
    modifiedProductIds,
    deletedCount: deletedProducts.length,
    deletedProducts: deletedProducts.slice(0, 10), // Solo primeros 10 para mostrar
  }
}

async function recordSaleToDatabase(productId, quantity = 1, salePrice = 0) {
  try {
    const { error } = await window.supabaseClient.from("product_sales").insert({
      product_id: productId,
      quantity_sold: quantity,
      user_id: currentUser?.auth_id,
      sale_price: salePrice,
      created_at: new Date().toISOString(),
    })

    if (error) {
      console.error("[SALES-DB] ❌ Error registrando venta:", error.message)
      return false
    } else {
      console.log(`[SALES-DB] ✅ Venta registrada: Producto ${productId} x${quantity} a $${salePrice}`)
      return true
    }
  } catch (error) {
    console.error("[SALES-DB] ❌ Error inesperado:", error.message)
    return false
  }
}

async function getBestSellingProducts(limit = 20) {
  try {
    console.log("[SALES-DB] 📊 Obteniendo productos más vendidos...")

    const { data: salesViewData, error: salesViewError } = await window.supabaseClient
      .from("best_selling_products")
      .select("*")
      .order("total_sold", { ascending: false })
      .limit(limit)

    if (!salesViewError && Array.isArray(salesViewData) && salesViewData.length > 0) {
      console.log(`[SALES-DB] ✅ ${salesViewData.length} productos más vendidos obtenidos desde vista`)
      return salesViewData
    }

    if (salesViewError) {
      console.warn("[SALES-DB] ⚠️ No existe la vista best_selling_products o falló la consulta, usando fallback a product_sales:", salesViewError.message)
    } else {
      console.log("[SALES-DB] ⓘ No hay datos en la vista best_selling_products, usando fallback a product_sales")
    }

    const { data: rawSales, error: rawSalesError } = await window.supabaseClient
      .from("product_sales")
      .select("product_id, quantity_sold")

    if (rawSalesError) {
      console.error("[SALES-DB] ❌ Error obteniendo ventas para fallback:", rawSalesError.message)
      return []
    }

    if (!rawSales || rawSales.length === 0) {
      console.log("[SALES-DB] ⓘ No hay ventas registradas en product_sales")
      return []
    }

    const aggregated = rawSales.reduce((acc, row) => {
      const productId = row.product_id || row.id
      const qty = Number(row.quantity_sold) || 0
      if (!acc[productId]) acc[productId] = 0
      acc[productId] += qty
      return acc
    }, {})

    const salesData = Object.entries(aggregated)
      .map(([product_id, total_sold]) => ({ product_id, total_sold }))
      .sort((a, b) => b.total_sold - a.total_sold)
      .slice(0, limit)

    console.log(`[SALES-DB] ✅ ${salesData.length} productos más vendidos obtenidos desde product_sales`)
    return salesData
  } catch (error) {
    console.error("[SALES-DB] ❌ Error inesperado:", error.message)
    return []
  }
}

// Function to fetch all products
async function fetchAllProducts() {
  try {
    // FIX: Implementar paginación para cargar TODOS los productos (evitar límite de 1000)
    let allData = [];
    let start = 0;
    const batchSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await window.supabaseClient
        .from("products")
        .select("*")
        .range(start, start + batchSize - 1);

      if (error) {
        console.error("[PRODUCTS-DB] Error obteniendo productos:", error);
        throw error;
      }

      if (data && data.length > 0) {
        allData = [...allData, ...data];
        if (data.length < batchSize) {
          hasMore = false;
        } else {
          start += batchSize;
        }
      } else {
        hasMore = false;
      }
    }

    return allData;
  } catch (error) {
    console.error("[PRODUCTS-DB] Error inesperado:", error)
    return []
  }
}

function cleanupSalesData() {
  try {
    localStorage.removeItem(PRODUCT_SALES_KEY)
    console.log("[SALES] 🗑️ Datos de ventas locales limpiados para sincronizar con nuevo CSV")
    // No se limpia la BD aquí, ya que esa es la fuente global
  } catch (error) {
    console.error("[SALES] Error limpiando datos de ventas locales:", error)
  }
}

// ============================================
// GESTIÓN DE ESTADO DE CARGA DE IMÁGENES
// ============================================

function loadImageLoadState() {
  try {
    const saved = localStorage.getItem(IMAGE_LOAD_STATE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved) // Corregir JSON.JSON -> JSON.parse
      imageLoadState.loadedImages = new Set(parsed.loadedImages || [])
      imageLoadState.failedImages = new Map(parsed.failedImages || [])
      imageLoadState.lastUpdate = parsed.lastUpdate
      console.log(
        `[IMG-STATE] Estado cargado: ${imageLoadState.loadedImages.size} imágenes exitosas, ${imageLoadState.failedImages.size} fallidas`,
      )
    }
  } catch (error) {
    console.error("[IMG-STATE] Error cargando estado:", error)
  }
}

function saveImageLoadState() {
  try {
    const toSave = {
      loadedImages: Array.from(imageLoadState.loadedImages),
      failedImages: Array.from(imageLoadState.failedImages),
      lastUpdate: Date.now(),
    }
    localStorage.setItem(IMAGE_LOAD_STATE_KEY, JSON.stringify(toSave))
  } catch (error) {
    console.error("[IMG-STATE] Error guardando estado:", error)
  }
}

function getProductsHash(products) {
  // Crear hash simple basado en URLs de imágenes
  const urls = products
    .map((p) => p.imagen_url)
    .filter((url) => url && url !== "/images/ProductImages.jpg")
    .sort()
    .join("|")

  // Hash simple
  let hash = 0
  for (let i = 0; i < urls.length; i++) {
    const char = urls.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  return hash.toString()
}

function checkProductsChanged(products) {
  const currentHash = getProductsHash(products)
  const savedHash = localStorage.getItem(PRODUCTS_HASH_KEY)

  if (savedHash !== currentHash) {
    console.log("[IMG-STATE] Productos cambiaron, detectando nuevas imágenes...")
    localStorage.setItem(PRODUCTS_HASH_KEY, currentHash)

    // Obtener solo las URLs nuevas
    const currentUrls = new Set(
      products.map((p) => optimizeImageUrl(p.imagen_url)).filter((url) => url && url !== "/images/ProductImages.jpg"),
    )

    const newUrls = Array.from(currentUrls).filter((url) => !imageLoadState.loadedImages.has(url))
    console.log(`[IMG-STATE] ${newUrls.length} imágenes nuevas detectadas`)

    return { changed: true, newUrls }
  }

  return { changed: false, newUrls: [] }
}

// ============================================
// SERVICE WORKER Y CACHÉ DE IMÁGENES
// ============================================

async function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    try {
      serviceWorkerRegistration = await navigator.serviceWorker.register("sw.js")
      console.log("✅ Service Worker registrado para caché de imágenes")

      navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data && event.data.type === "PRELOAD_PROGRESS") {
          console.log(
            `[IMG-LOAD] Progreso: ${event.data.loaded}/${event.data.total} (Lote ${event.data.batch}/${event.data.totalBatches})`,
          )
        }

        if (event.data && event.data.type === "PRELOAD_COMPLETE") {
          console.log(`[IMG-LOAD] ✅ Precarga completada: ${event.data.count}/${event.data.total} imágenes`)
        }
      })
    } catch (error) {
      console.error("❌ Error registrando Service Worker:", error)
    }
  }
}

function pauseBackgroundDownloads() {
  if (imageLoadState.isPaused) {
    console.log("[IMG-PRIORITY] ⏸️ Descargas ya pausadas")
    return
  }

  console.log("[IMG-PRIORITY] ⏸️ PAUSANDO descargas en segundo plano")
  imageLoadState.isPaused = true

  // Cancelar descarga actual si existe
  if (imageLoadState.currentAbortController) {
    imageLoadState.currentAbortController.abort()
    console.log("[IMG-PRIORITY] ❌ Descarga actual cancelada")
  }
}

function resumeBackgroundDownloads() {
  if (!imageLoadState.isPaused) {
    console.log("[IMG-PRIORITY] ▶️ Descargas ya activas")
    return
  }

  console.log("[IMG-PRIORITY] ▶️ REANUDANDO descargas en segundo plano")
  imageLoadState.isPaused = false

  // Reanudar proceso de carga si hay imágenes pendientes
  if (imageLoadState.backgroundQueue.length > 0) {
    console.log(`[IMG-PRIORITY] 📋 Continuando con ${imageLoadState.backgroundQueue.length} imágenes en cola`)
    setTimeout(() => processBackgroundQueue(), 1000)
  }
}

async function loadPriorityImages(urls) {
  if (urls.length === 0) {
    console.log("[IMG-PRIORITY] ⚠️ No hay imágenes prioritarias para cargar")
    return
  }

  console.log(`[IMG-PRIORITY] 🚀 Cargando ${urls.length} imágenes PRIORITARIAS`)

  // Pausar descargas en segundo plano
  pauseBackgroundDownloads()

  const cache = await caches.open("sonimax-images-store")

  // Filtrar solo las que no están cargadas
  const urlsToLoad = urls.filter((url) => !imageLoadState.loadedImages.has(url))

  console.log(`[IMG-PRIORITY] 📊 ${urlsToLoad.length} imágenes prioritarias necesitan descarga`)

  const priorityPromises = urlsToLoad.map(async (url) => {
    try {
      // Verificar si ya está en caché
      const cachedResponse = await cache.match(url)
      if (cachedResponse) {
        imageLoadState.loadedImages.add(url)
        imageLoadState.failedImages.delete(url)
        console.log(`[IMG-PRIORITY] ✅ Ya en caché: ${url.substring(url.lastIndexOf("/") + 1)}`)
        return
      }

      // Descargar con alta prioridad
      console.log(`[IMG-PRIORITY] ⬇️ Descargando PRIORITARIA: ${url.substring(url.lastIndexOf("/") + 1)}`)

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 8000)

      const response = await fetch(url, {
        mode: "no-cors",
        cache: "force-cache",
        signal: controller.signal,
        priority: "high", // Alta prioridad
      })

      clearTimeout(timeoutId)

      if (response) {
        await cache.put(url, response)
        imageLoadState.loadedImages.add(url)
        imageLoadState.failedImages.delete(url)
        console.log(`[IMG-PRIORITY] ✅ PRIORITARIA descargada: ${url.substring(url.lastIndexOf("/") + 1)}`)
      }
    } catch (error) {
      console.log(
        `[IMG-PRIORITY] ❌ Error en prioritaria: ${url.substring(url.lastIndexOf("/") + 1)} - ${error.message}`,
      )
      const attemptCount = (imageLoadState.failedImages.get(url) || 0) + 1
      imageLoadState.failedImages.set(url, attemptCount)
    }
  })

  await Promise.allSettled(priorityPromises)

  saveImageLoadState()

  setTimeout(() => {
    console.log("[IMG-PRIORITY] ⏱️ Reanudando descargas en segundo plano...")
    resumeBackgroundDownloads()
  }, 500)
}

async function processBackgroundQueue() {
  if (imageLoadState.isPaused) {
    console.log("[IMG-PRIORITY] ⏸️ Proceso pausado, esperando...")
    return
  }

  if (imageLoadState.backgroundQueue.length === 0) {
    console.log("[IMG-PRIORITY] ✅ Cola de segundo plano vacía")
    return
  }

  const cache = await caches.open("sonimax-images-store")
  const BATCH_SIZE = 10

  while (imageLoadState.backgroundQueue.length > 0 && !imageLoadState.isPaused) {
    const batch = imageLoadState.backgroundQueue.splice(0, BATCH_SIZE)

    console.log(
      `[IMG-PRIORITY] 📦 Procesando lote de ${batch.length} imágenes (${imageLoadState.backgroundQueue.length} restantes)`,
    )

    for (const url of batch) {
      if (imageLoadState.isPaused) {
        console.log("[IMG-PRIORITY] ⏸️ Pausado durante procesamiento")
        imageLoadState.backgroundQueue.unshift(...batch.slice(batch.indexOf(url)))
        return
      }

      try {
        const cachedResponse = await cache.match(url)
        if (cachedResponse) {
          imageLoadState.loadedImages.add(url)
          continue
        }

        const controller = new AbortController()
        imageLoadState.currentAbortController = controller

        const timeoutId = setTimeout(() => controller.abort(), 10000)

        const response = await fetch(url, {
          mode: "no-cors",
          cache: "force-cache",
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        if (response) {
          await cache.put(url, response)
          imageLoadState.loadedImages.add(url)
          imageLoadState.failedImages.delete(url)
          console.log(`[IMG-PRIORITY] ✅ Segundo plano: ${url.substring(url.lastIndexOf("/") + 1)}`)
        }
      } catch (error) {
        if (error.name === "AbortError") {
          console.log(`[IMG-PRIORITY] ⏸️ Descarga cancelada: ${url.substring(url.lastIndexOf("/") + 1)}`)
          imageLoadState.backgroundQueue.unshift(url) // Devolver a la cola
        } else {
          console.log(`[IMG-PRIORITY] ❌ Error: ${url.substring(url.lastIndexOf("/") + 1)} - ${error.message}`)
          const attemptCount = (imageLoadState.failedImages.get(url) || 0) + 1
          imageLoadState.failedImages.set(url, attemptCount)
        }
      }

      imageLoadState.currentAbortController = null
    }

    await new Promise((resolve) => setTimeout(resolve, 50))
    saveImageLoadState()
  }

  console.log("[IMG-PRIORITY] ✅ Cola de segundo plano completada")
}

async function preloadAllImages() {
  if (!("caches" in window)) {
    console.log("[IMG-LOAD] ⚠️ Cache API no disponible")
    return
  }

  loadImageLoadState()

  const { changed, newUrls } = checkProductsChanged(allProducts)

  const allImageUrls = allProducts
    .map((p) => p.imagen_url)
    .filter((url) => url && url !== "/images/ProductImages.jpg")
    .map((url) => optimizeImageUrl(url))

  let urlsToLoad = []

  if (changed && newUrls.length > 0) {
    urlsToLoad = newUrls
    console.log(`[IMG-LOAD] 🔄 Cargando solo ${urlsToLoad.length} imágenes nuevas`)
  } else {
    urlsToLoad = allImageUrls.filter(
      (url) => !imageLoadState.loadedImages.has(url) || imageLoadState.failedImages.has(url),
    )

    if (urlsToLoad.length === 0) {
      console.log("[IMG-LOAD] ✅ Todas las imágenes ya están cargadas")
      return
    }

    console.log(`[IMG-LOAD] 🔄 Continuando carga: ${urlsToLoad
