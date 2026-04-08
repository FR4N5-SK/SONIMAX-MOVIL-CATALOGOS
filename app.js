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
const CSV_SNAPSHOT_KEY = "sonimax_csv_snapshot" // Nueva clave para snapshot local
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

async function getPreviousCSVSnapshot() {
  try {
    // Intentar obtener el snapshot más reciente de Supabase
    const { data, error } = await window.supabaseClient
      .from("csv_snapshot")
      .select("snapshot_data, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .single()

    if (error) {
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

    const { data: salesData, error: salesError } = await window.supabaseClient
      .from("best_selling_products")
      .select("*")
      .order("total_sold", { ascending: false })
      .limit(limit)

    if (salesError) {
      console.error("[SALES-DB] ❌ Error obteniendo estadísticas:", salesError.message)
      return []
    }

    if (!salesData || salesData.length === 0) {
      console.log("[SALES-DB] ⓘ No hay datos de ventas aún")
      return []
    }

    console.log(`[SALES-DB] ✅ ${salesData.length} productos más vendidos obtenidos`)
    console.log("[SALES-DB] Estructura de datos:", salesData[0])
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

    console.log(`[IMG-LOAD] 🔄 Continuando carga: ${urlsToLoad.length} imágenes pendientes`)
  }

  if (imageLoadState.inProgress) {
    console.log("[IMG-LOAD] ⚠️ Carga ya en progreso, omitiendo...")
    return
  }

  imageLoadState.inProgress = true

  imageLoadState.backgroundQueue = [...urlsToLoad]
  console.log(`[IMG-LOAD] 📋 ${urlsToLoad.length} imágenes agregadas a cola de segundo plano`)

  await processBackgroundQueue()

  imageLoadState.inProgress = false
  saveImageLoadState()
}

async function loadImagesWithRetry(urls) {
  const cache = await caches.open("sonimax-images-store")
  const BATCH_SIZE = 10
  const CONCURRENT_BATCHES = 4

  console.log(`[IMG-LOAD] 🚀 Iniciando carga de ${urls.length} imágenes...`)
  console.log(`[IMG-LOAD] 📊 Ya cargadas: ${imageLoadState.loadedImages.size}`)
  console.log(`[IMG-LOAD] 📊 Con errores previos: ${imageLoadState.failedImages.size}`)
  console.log(`[IMG-LOAD] 📊 Por cargar ahora: ${urls.length}`)

  const batches = []
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    batches.push(urls.slice(i, i + BATCH_SIZE))
  }

  let totalLoaded = 0
  let totalFailed = 0

  for (let i = 0; i < batches.length; i += CONCURRENT_BATCHES) {
    const batchGroup = []

    for (let j = 0; j < CONCURRENT_BATCHES && i + j < batches.length; j++) {
      const batchIndex = i + j
      batchGroup.push(processBatch(cache, batches[batchIndex], batchIndex + 1, batches.length))
    }

    const results = await Promise.allSettled(batchGroup)

    results.forEach((result) => {
      if (result.status === "fulfilled") {
        totalLoaded += result.value.loaded
        totalFailed += result.value.failed
      }
    })

    const remaining = urls.length - (totalLoaded + totalFailed)
    console.log(
      `[IMG-LOAD] 📊 Progreso: ${totalLoaded} exitosas, ${totalFailed} fallidas, ${remaining} restantes de ${urls.length} totales`,
    )

    saveImageLoadState()

    await new Promise((resolve) => setTimeout(resolve, 50))
  }

  console.log(`[IMG-LOAD] ✅ Carga inicial completada`)
  console.log(`[IMG-LOAD] 📊 Resultado: ${totalLoaded} exitosas, ${totalFailed} fallidas de ${urls.length} totales`)
  console.log(`[IMG-LOAD] 📊 Total acumulado: ${imageLoadState.loadedImages.size} imágenes cargadas en total`)

  if (totalFailed > 0) {
    console.log(`[IMG-LOAD] 🔄 Iniciando proceso de reintentos para ${totalFailed} imágenes fallidas...`)
    await retryFailedImages(cache)
  }
}

async function processBatch(cache, batch, batchNum, totalBatches) {
  let loaded = 0
  let failed = 0

  const promises = batch.map(async (url) => {
    try {
      const cachedResponse = await cache.match(url)
      if (cachedResponse) {
        imageLoadState.loadedImages.add(url)
        imageLoadState.failedImages.delete(url)
        console.log(`[IMG-LOAD] ✅ Ya en caché: ${url.substring(url.lastIndexOf("/") + 1)}`)
        return { success: true, cached: true }
      }

      const controller = new AbortController()
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
        console.log(`[IMG-LOAD] ✅ Descargada: ${url.substring(url.lastIndexOf("/") + 1)}`)
        return { success: true, cached: false }
      }

      console.log(`[IMG-LOAD] ❌ Sin respuesta: ${url.substring(url.lastIndexOf("/") + 1)}`)
      return { success: false, error: "No response" }
    } catch (error) {
      const attemptCount = (imageLoadState.failedImages.get(url) || 0) + 1
      imageLoadState.failedImages.set(url, attemptCount)
      console.log(
        `[IMG-LOAD] ❌ Error (intento ${attemptCount}): ${url.substring(url.lastIndexOf("/") + 1)} - ${error.message}`,
      )
      return { success: false, error: error.message }
    }
  })

  const results = await Promise.allSettled(promises)

  results.forEach((result) => {
    if (result.status === "fulfilled" && result.value.success) {
      loaded++
    } else {
      failed++
    }
  })

  console.log(`[IMG-LOAD] Lote ${batchNum}/${totalBatches}: ${loaded} exitosas, ${failed} fallidas`)

  return { loaded, failed }
}

async function retryFailedImages(cache) {
  const failedUrls = Array.from(imageLoadState.failedImages.entries())
    .filter(([url, attempts]) => attempts < MAX_RETRY_ATTEMPTS)
    .map(([url]) => url)

  if (failedUrls.length === 0) {
    console.log("[IMG-LOAD] ✅ No hay imágenes para reintentar")
    return
  }

  console.log(`[IMG-LOAD] 🔄 Reintentando ${failedUrls.length} imágenes fallidas...`)
  console.log(`[IMG-LOAD] ⏳ Esperando ${RETRY_DELAY / 1000} segundos antes de reintentar...`)

  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY))

  let retrySuccess = 0
  let retryFailed = 0

  const RETRY_CONCURRENT = 5
  for (let i = 0; i < failedUrls.length; i += RETRY_CONCURRENT) {
    const batch = failedUrls.slice(i, i + RETRY_CONCURRENT)

    const retryPromises = batch.map(async (url) => {
      const currentAttempt = imageLoadState.failedImages.get(url) || 0

      console.log(
        `[IMG-LOAD] 🔄 Reintentando intento ${currentAttempt + 1}/${MAX_RETRY_ATTEMPTS}: ${url.substring(url.lastIndexOf("/") + 1)}`,
      )

      try {
        const controller = new AbortController()
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
          retrySuccess++
          console.log(`[IMG-LOAD] ✅ Reintento exitoso: ${url.substring(url.lastIndexOf("/") + 1)}`)
          return { success: true }
        } else {
          const attempts = imageLoadState.failedImages.get(url) + 1
          imageLoadState.failedImages.set(url, attempts)
          retryFailed++
          console.log(`[IMG-LOAD] ❌ Reintento fallido: ${url.substring(url.lastIndexOf("/") + 1)}`)
          return { success: false }
        }
      } catch (error) {
        const attempts = imageLoadState.failedImages.get(url) + 1
        imageLoadState.failedImages.set(url, attempts)
        retryFailed++
        console.log(
          `[IMG-LOAD] ❌ Reintento fallido (intento ${attempts}/${MAX_RETRY_ATTEMPTS}): ${url.substring(url.lastIndexOf("/") + 1)} - ${error.message}`,
        )
        return { success: false }
      }
    })

    await Promise.allSettled(retryPromises)

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  console.log(`[IMG-LOAD] 📊 Reintentos completados: ${retrySuccess} exitosos, ${retryFailed} fallidas`)
  console.log(`[IMG-LOAD] 📊 Total acumulado: ${imageLoadState.loadedImages.size} imágenes cargadas`)

  saveImageLoadState()

  const stillFailed = Array.from(imageLoadState.failedImages.entries()).filter(
    ([url, attempts]) => attempts < MAX_RETRY_ATTEMPTS,
  )

  if (stillFailed.length > 0) {
    console.log(`[IMG-LOAD] 🔄 Quedan ${stillFailed.length} imágenes por reintentar...`)
    console.log(`[IMG-LOAD] ⏳ Esperando ${RETRY_DELAY / 1000} segundos antes del próximo ciclo...`)
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY))
    await retryFailedImages(cache)
  } else {
    const permanentlyFailed = Array.from(imageLoadState.failedImages.entries()).filter(
      ([url, attempts]) => attempts >= MAX_RETRY_ATTEMPTS,
    )

    if (permanentlyFailed.length > 0) {
      console.log(
        `[IMG-LOAD] ⚠️ ${permanentlyFailed.length} imágenes no pudieron cargarse después de ${MAX_RETRY_ATTEMPTS} intentos:`,
      )
      permanentlyFailed.forEach(([url, attempts]) => {
        console.log(`[IMG-LOAD]    ❌ ${url.substring(url.lastIndexOf("/") + 1)} (${attempts} intentos)`)
      })
    } else {
      console.log("[IMG-LOAD] ✅ ¡Todas las imágenes cargadas exitosamente!")
      console.log(`[IMG-LOAD] 📊 Total final: ${imageLoadState.loadedImages.size} imágenes en caché`)
    }
  }
}

// ============================================
// OPTIMIZACIÓN DE IMÁGENES
// ============================================

function optimizeImageUrl(url) {
  if (!url || url === "/images/ProductImages.jpg") {
    return url
  }

  if (url.includes("ibb.co")) {
    const separator = url.includes("?") ? "&" : "?"
    return `${url}${separator}w=400&quality=70`
  }

  return url
}

function createImagePlaceholder(url) {
  if (!url || url === "/images/ProductImages.jpg") {
    return url
  }

  if (url.includes("ibb.co")) {
    const separator = url.includes("?") ? "&" : "?"
    return `${url}${separator}w=50&quality=30`
  }

  return url
}

function initImageObserver() {
  if ("IntersectionObserver" in window) {
    imageObserver = new IntersectionObserver(
      (entries, observer) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const img = entry.target
            const fullSrc = img.dataset.src

            if (fullSrc) {
              console.log(
                `[IMG-PRIORITY] 👁️ Imagen visible detectada: ${fullSrc.substring(fullSrc.lastIndexOf("/") + 1)}`,
              )
              loadPriorityImages([fullSrc])

              const tempImg = new Image()
              tempImg.onload = () => {
                img.src = fullSrc
                img.classList.remove("image-loading")
                img.classList.add("image-loaded")
                const retryBtn = img.parentElement.querySelector(".image-retry-btn")
                if (retryBtn) {
                  retryBtn.remove()
                }
              }
              tempImg.onerror = () => {
                img.src = "/images/ProductImages.jpg"
                img.classList.remove("image-loading")
                addRetryButton(img, fullSrc)
              }
              tempImg.src = fullSrc

              observer.unobserve(img)
            }
          }
        })
      },
      {
        rootMargin: "100px",
        threshold: 0.01,
      },
    )
  }
}

function addRetryButton(imgElement, imageUrl) {
  // Verificar si ya existe un botón de retry
  const existingBtn = imgElement.parentElement.querySelector(".image-retry-btn")
  if (existingBtn) return

  console.log(`[IMG-RETRY] 🔄 Agregando botón de retry para: ${imageUrl.substring(imageUrl.lastIndexOf("/") + 1)}`)

  const retryBtn = document.createElement("button")
  retryBtn.className = "image-retry-btn"
  retryBtn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  `
  retryBtn.title = "Reintentar cargar imagen"

  retryBtn.addEventListener("click", async (e) => {
    e.stopPropagation()
    console.log(`[IMG-RETRY] 🔄 Reintentando carga: ${imageUrl.substring(imageUrl.lastIndexOf("/") + 1)}`)

    retryBtn.classList.add("spinning")

    try {
      const cache = await caches.open("sonimax-images-store")
      await cache.delete(imageUrl)
      imageLoadState.loadedImages.delete(imageUrl)
      imageLoadState.failedImages.delete(imageUrl)

      console.log(`[IMG-RETRY] 🗑️ Caché limpiada para: ${imageUrl.substring(imageUrl.lastIndexOf("/") + 1)}`)

      const cacheBustUrl = imageUrl.includes("?") ? `${imageUrl}&_t=${Date.now()}` : `${imageUrl}?_t=${Date.now()}`

      // Intentar cargar la imagen con cache busting
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000)

      const response = await fetch(cacheBustUrl, {
        mode: "no-cors",
        cache: "reload", // Forzar recarga desde servidor
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (response) {
        await cache.put(imageUrl, response.clone())
        imageLoadState.loadedImages.add(imageUrl)
        console.log(`[IMG-RETRY] 💾 Imagen guardada en caché`)
      }

      // Cargar la imagen en el elemento
      const tempImg = new Image()
      tempImg.onload = () => {
        imgElement.src = imageUrl
        imgElement.classList.remove("image-loading")
        imgElement.classList.add("image-loaded")
        retryBtn.remove()
        saveImageLoadState()
        console.log(`[IMG-RETRY] ✅ Imagen cargada exitosamente`)
      }
      tempImg.onerror = () => {
        retryBtn.classList.remove("spinning")
        console.log(`[IMG-RETRY] ❌ Error al cargar imagen después de retry`)
      }
      tempImg.src = imageUrl
    } catch (error) {
      retryBtn.classList.remove("spinning")
      console.log(`[IMG-RETRY] ❌ Error en retry: ${error.message}`)
    }
  })

  imgElement.parentElement.appendChild(retryBtn)
}

// ============================================
// SISTEMA DE BANNERS (ROJO Y NEGRO)
// ============================================

async function loadBanners() {
  try {
    const { data, error } = await window.supabaseClient
      .from("banners")
      .select("*")
      .eq("activo", true)
      .order("posicion", { ascending: true })

    if (error) throw error

    banners = data || []

    if (banners.length > 0) {
      displayBanner(0)
      startBannerAutoPlay()
      renderBannerIndicators()
    }

    console.log(`✅ ${banners.length} banners cargados`)
  } catch (error) {
    console.error("❌ Error cargando banners:", error)
    banners = []
  }
}

function displayBanner(index) {
  if (banners.length === 0) return

  currentBannerIndex = index % banners.length
  const banner = banners[currentBannerIndex]

  const bannerImage = document.getElementById("banner-image")
  if (bannerImage) {
    bannerImage.src = banner.imagen_url
    bannerImage.alt = banner.titulo
  }

  updateBannerIndicators()
}

function startBannerAutoPlay() {
  if (bannerAutoPlayInterval) {
    clearInterval(bannerAutoPlayInterval)
  }

  bannerAutoPlayInterval = setInterval(() => {
    nextBanner()
  }, 5000) // Cambia cada 5 segundos
}

function nextBanner() {
  if (banners.length === 0) return
  displayBanner(currentBannerIndex + 1)
  restartBannerAutoPlay()
}

function previousBanner() {
  if (banners.length === 0) return
  displayBanner(currentBannerIndex - 1)
  restartBannerAutoPlay()
}

function restartBannerAutoPlay() {
  startBannerAutoPlay()
}

function renderBannerIndicators() {
  const container = document.getElementById("banner-indicators")
  if (!container) return

  container.innerHTML = ""

  banners.forEach((_, index) => {
    const dot = document.createElement("button")
    dot.className = `banner-indicator w-3 h-3 rounded-full transition-all ${
      index === currentBannerIndex ? "bg-red-600 w-8" : "bg-white/50 hover:bg-white/75"
    }`
    dot.addEventListener("click", () => {
      displayBanner(index)
      restartBannerAutoPlay()
    })
    container.appendChild(dot)
  })
}

function updateBannerIndicators() {
  const indicators = document.querySelectorAll(".banner-indicator")
  indicators.forEach((indicator, index) => {
    if (index === currentBannerIndex) {
      indicator.classList.add("bg-red-600", "w-8")
      indicator.classList.remove("bg-white/50")
    } else {
      indicator.classList.remove("bg-red-600", "w-8")
      indicator.classList.add("bg-white/50")
    }
  })
}

async function loadBannersForModal() {
  try {
    const { data, error } = await window.supabaseClient
      .from("banners")
      .select("*")
      .order("posicion", { ascending: true })

    if (error) throw error

    const list = document.getElementById("banners-list")
    const noMsg = document.getElementById("no-banners-msg")

    if (!data || data.length === 0) {
      list.innerHTML = ""
      noMsg.classList.remove("hidden")
      return
    }

    noMsg.classList.add("hidden")
    list.innerHTML = ""

    data.forEach((banner) => {
      const item = document.createElement("div")
      item.className = "p-4 border-2 border-gray-200 rounded-xl hover:border-red-400 transition-all"
      item.innerHTML = `
        <div class="flex items-start gap-4">
          <img src="${banner.imagen_url}" alt="${banner.titulo}" class="w-24 h-24 object-cover rounded-lg">
          <div class="flex-1">
            <h4 class="font-bold text-gray-800">${banner.titulo}</h4>
            <p class="text-sm text-gray-600 mt-1 truncate">${banner.imagen_url}</p>
            <div class="flex gap-2 mt-3">
              <button class="px-3 py-2 bg-blue-100 text-blue-700 rounded-lg text-sm font-semibold hover:bg-blue-200 transition-all toggle-banner-btn" data-id="${banner.id}" data-active="${banner.activo}">
                ${banner.activo ? "✓ Activo" : "○ Inactivo"}
              </button>
              <button class="px-3 py-2 bg-red-100 text-red-700 rounded-lg text-sm font-semibold hover:bg-red-200 transition-all delete-banner-btn" data-id="${banner.id}">
                🗑️ Eliminar
              </button>
            </div>
          </div>
        </div>
      `

      const toggleBtn = item.querySelector(".toggle-banner-btn")
      const deleteBtn = item.querySelector(".delete-banner-btn")

      toggleBtn.addEventListener("click", async () => {
        await toggleBannerActive(banner.id, !banner.activo)
      })

      deleteBtn.addEventListener("click", async () => {
        if (confirm(`¿Eliminar banner "${banner.titulo}"?`)) {
          await deleteBanner(banner.id)
        }
      })

      list.appendChild(item)
    })
  } catch (error) {
    console.error("❌ Error cargando banners para modal:", error)
  }
}

async function addBanner() {
  const title = document.getElementById("banner-title-input").value.trim()
  const url = document.getElementById("banner-url-input").value.trim()

  if (!title || !url) {
    alert("Por favor completa todos los campos")
    return
  }

  if (!url.startsWith("http")) {
    alert("Por favor ingresa una URL válida que comience con http:// o https://")
    return
  }

  try {
    const { data, error } = await window.supabaseClient
      .from("banners")
      .insert({
        titulo: title,
        imagen_url: url,
        activo: true,
        posicion: 0,
      })
      .select()

    if (error) throw error

    console.log("✅ Banner agregado:", data)

    document.getElementById("banner-title-input").value = ""
    document.getElementById("banner-url-input").value = ""

    loadBannersForModal()
    loadBanners()

    alert("¡Banner agregado exitosamente!")
  } catch (error) {
    console.error("❌ Error agregando banner:", error)
    alert("Error al agregar banner: " + error.message)
  }
}

async function toggleBannerActive(bannerId, active) {
  try {
    const { error } = await window.supabaseClient.from("banners").update({ activo: active }).eq("id", bannerId)

    if (error) throw error

    console.log(`✅ Banner ${bannerId} actualizado`)
    loadBannersForModal()
    loadBanners()
  } catch (error) {
    console.error("❌ Error actualizando banner:", error)
    alert("Error al actualizar banner")
  }
}

async function deleteBanner(bannerId) {
  try {
    const { error } = await window.supabaseClient.from("banners").delete().eq("id", bannerId)

    if (error) throw error

    console.log(`✅ Banner ${bannerId} eliminado`)
    loadBannersForModal()
    loadBanners()
  } catch (error) {
    console.error("❌ Error eliminando banner:", error)
    alert("Error al eliminar banner")
  }
}

// ============================================
// INICIALIZACIÓN
// ============================================

document.addEventListener("DOMContentLoaded", async () => {
  console.log("🚀 Iniciando SONIMAX MÓVIL...")

  await registerServiceWorker()

  initImageObserver()

  const {
    data: { session },
  } = await window.supabaseClient.auth.getSession()

  if (session) {
    console.log("✅ Sesión activa encontrada")
    await loadUserData(session.user.id)
    await loadCartFromSupabase() // [MODIFICADO] Cargar carrito desde la nube
    showApp()
    loadBanners()
  } else {
    // [NUEVO] Limpiar datos de sesión anterior al cerrar sesión
    Object.keys(localStorage).forEach(key => {
        if (key.startsWith('sonimax_')) {
            localStorage.removeItem(key);
        }
    });
    console.log("ℹ️ No hay sesión activa")
    showLogin()
  }

  setupEventListeners()
})

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault()
  const username = document.getElementById("login-username").value.trim().toLowerCase()
  const password = document.getElementById("login-password").value

  showAuthMessage("Iniciando sesión...", "info")

  try {
    const internalEmail = `${username}@sonimax.internal`

    const { data, error } = await window.supabaseClient.auth.signInWithPassword({
      email: internalEmail,
      password: password,
    })

    if (error) {
      if (error.message.includes("Invalid login credentials")) {
        throw new Error("Usuario o contraseña incorrectos")
      }
      throw error
    }

    console.log("✅ Login exitoso")
    await loadUserData(data.user.id)
    await loadCartFromSupabase() // [MODIFICADO] Cargar carrito desde la nube
    showApp()
    loadBanners()
  } catch (error) {
    console.error("❌ Error en login:", error)
    showAuthMessage(
      error.message === "Usuario o contraseña incorrectos"
        ? error.message
        : "Error al iniciar sesión. Verifica tus credenciales.",
      "error",
    )
  }
})

document.getElementById("register-form").addEventListener("submit", async (e) => {
  e.preventDefault()
  const name = document.getElementById("register-name").value.trim()
  const username = document.getElementById("register-username").value.trim().toLowerCase()
  const password = document.getElementById("register-password").value

  showAuthMessage("Creando cuenta...", "info")

  try {
    const { data: existingUser } = await window.supabaseClient
      .from("users")
      .select("username")
      .eq("username", username)
      .single()

    if (existingUser) {
      throw new Error("El nombre de usuario ya está en uso")
    }

    const internalEmail = `${username}@sonimax.internal`

    const { data, error } = await window.supabaseClient.auth.signUp({
      email: internalEmail,
      password: password,
      options: {
        data: {
          name: name,
          username: username,
        },
      },
    })

    if (error) throw error

    const { error: updateError } = await window.supabaseClient
      .from("users")
      .update({ username: username, name: name })
      .eq("auth_id", data.user.id)

    if (updateError) {
      console.error("Error actualizando usuario:", updateError)
    }

    console.log("✅ Registro exitoso")
    showAuthMessage("¡Cuenta creada exitosamente! Iniciando sesión...", "success")

    setTimeout(async () => {
      await loadUserData(data.user.id)
      await loadCartFromSupabase() // [NUEVO] Cargar carrito para nuevo usuario
      showApp()
      loadBanners()
    }, 1500)
  } catch (error) {
    console.error("❌ Error en registro:", error)
    showAuthMessage(
      error.message === "El nombre de usuario ya está en uso"
        ? error.message
        : "Error al crear la cuenta. Intenta con otro nombre de usuario.",
      "error",
    )
  }
})

document.getElementById("create-user-form")?.addEventListener("submit", async (e) => {
  e.preventDefault()
  const name = document.getElementById("new-user-name").value.trim()
  const username = document.getElementById("new-user-username").value.trim().toLowerCase()
  const password = document.getElementById("new-user-password").value
  const role = document.getElementById("new-user-role").value
  // [NUEVO] Leer si el usuario puede ver cantidades de stock
  const canSeeStockCheckbox = document.getElementById("new-user-can-see-stock");
  const canSeeStock = canSeeStockCheckbox ? canSeeStockCheckbox.checked : true;

  showCreateUserMessage("Creando usuario...", "info")

  try {
    const { data: existingUser } = await window.supabaseClient
      .from("users")
      .select("username")
      .eq("username", username)
      .maybeSingle()

    if (existingUser) {
      throw new Error("El nombre de usuario ya está en uso")
    }

    const internalEmail = `${username}@sonimax.internal`

    const { data, error } = await window.supabaseClient.auth.signUp({
      email: internalEmail,
      password: password,
      options: {
        data: {
          name: name,
          username: username,
          role: role,
        },
      },
    })

    if (error) throw error

    await new Promise((resolve) => setTimeout(resolve, 500))

    const { error: updateError } = await window.supabaseClient
      .from("users")
      .update({
        role: role,
        created_by: currentUser.auth_id,
        can_see_stock: canSeeStock,
      })
      .eq("auth_id", data.user.id)

    if (updateError) {
      console.error("Error actualizando rol:", updateError)
      throw new Error("Usuario creado pero no se pudo asignar el rol correctamente")
    }

    console.log(`✅ Usuario creado exitosamente con rol: ${role}, puede ver stock: ${canSeeStock}`)
    showCreateUserMessage(`Usuario "${username}" creado exitosamente con rol de ${role}`, "success")

    document.getElementById("create-user-form").reset()
    // Restaurar el checkbox a su estado por defecto (checked)
    if (canSeeStockCheckbox) canSeeStockCheckbox.checked = true;

    setTimeout(() => {
      document.getElementById("create-user-modal").classList.add("hidden")
    }, 2000)
  } catch (error) {
    console.error("❌ Error al crear usuario:", error)
    showCreateUserMessage(error.message || "Error al crear el usuario. Intenta con otro nombre de usuario.", "error")
  }
})

async function loadUserData(userId) {
  console.log("Cargando datos del usuario:", userId)

  try {
    const { data, error } = await window.supabaseClient.from("users").select("*").eq("auth_id", userId).single()

    if (error) {
      console.error("Error obteniendo datos:", error)
      throw error
    }

    if (!data) {
      console.error("No se encontró el usuario")
      throw new Error("Usuario no encontrado")
    }

    currentUser = data
    currentUserRole = data.role || 'cliente'
    window.currentUserRole = data.role || 'cliente'

    console.log("✅ Datos de usuario cargados:", {
      username: data.username,
      name: data.name,
      role: data.role,
      localRole: currentUserRole,
      globalRole: window.currentUserRole
    })

    await updateUIForRole() // [CORREGIDO] Esperar a que la UI y la config se carguen
  } catch (error) {
    console.error("❌ Error al cargar datos del usuario:", error)
    await window.supabaseClient.auth.signOut()
    showLogin()
  }
}

// [CORREGIDO] Convertida a async para esperar la carga de configuración
async function updateUIForRole() {
  console.log("Actualizando UI para rol:", currentUserRole)

  const roleBadge = document.getElementById("user-role-badge")
  const adminSection = document.getElementById("admin-section")
  const gestorSection = document.getElementById("gestor-section")
  const manageBannersBtn = document.getElementById("manage-banners-btn")
  const inventorySection = document.getElementById("inventory-section")
  const mainGrid = document.getElementById("products-grid") // Grid principal de productos

  if (roleBadge) {
    // Mostrar "MAYORISTA" si el rol es distribuidor
    const displayRole = currentUserRole === 'distribuidor' ? 'MAYORISTA' : currentUserRole;
    roleBadge.textContent = `${currentUser.name} (${displayRole})`
    roleBadge.className = `role-badge-${currentUserRole}`
    roleBadge.classList.remove("hidden")
  }

  // Ocultar todo por defecto
  if(inventorySection) inventorySection.classList.add("hidden");
  if(mainGrid) mainGrid.parentElement.classList.remove("hidden"); // Mostrar grid normal por defecto

    // Inject "Gestionar Visibilidad Stock" button for Admin if it doesn't exist
    if (!document.getElementById('manage-stock-visibility-btn')) {
      const btn = document.createElement('button');
      btn.id = 'manage-stock-visibility-btn';
      btn.className = "w-full bg-gradient-to-r from-purple-600 to-purple-700 text-white font-bold py-3 rounded-xl hover:from-purple-700 hover:to-purple-800 transition-all shadow-lg mb-3 flex items-center justify-center gap-2";
      btn.innerHTML = "👁️ Gestionar Visibilidad de Stock";
      btn.onclick = showStockVisibilityModal;
      
      // Insert in admin section
      if (adminSection) {
        // Try to insert after manage banners or at the end
        const bannersBtn = document.getElementById('manage-banners-btn');
        if (bannersBtn && bannersBtn.parentNode === adminSection) {
            adminSection.insertBefore(btn, bannersBtn.nextSibling);
        } else {
            adminSection.appendChild(btn);
        }
      }
    }

  if (window.currentUserRole === "admin") {
    adminSection?.classList.remove("hidden")
    // Asegurar que todos los botones sean visibles
    const adminButtons = adminSection.querySelectorAll("button")
    adminButtons.forEach((btn) => btn.classList.remove("hidden"))

    gestorSection?.classList.remove("hidden")
    manageBannersBtn?.classList.remove("hidden")
  } else if (window.currentUserRole === "gestor") {
    gestorSection?.classList.remove("hidden")

    // Mostrar admin-section pero solo el botón de PDF
    adminSection?.classList.remove("hidden")
    const adminButtons = adminSection.querySelectorAll("button")
    adminButtons.forEach((btn) => {
      if (btn.id === "export-pdf-button") {
        btn.classList.remove("hidden")
      } else {
        btn.classList.add("hidden")
      }
    })

    manageBannersBtn?.classList.add("hidden")
  } else if (window.currentUserRole === "inventario") {
    // ROL INVENTARIO
    adminSection?.classList.add("hidden")
    gestorSection?.classList.add("hidden")
    manageBannersBtn?.classList.add("hidden")
    if(mainGrid) mainGrid.parentElement.classList.remove("hidden"); // [MODIFICADO] Mostrar grid normal
    inventorySection?.classList.add("hidden"); // [MODIFICADO] Ocultar sección vieja
    // initInventoryRole(); // Ya no usamos la lógica vieja de lista
  } else {
    adminSection?.classList.add("hidden")
    gestorSection?.classList.add("hidden")
    manageBannersBtn?.classList.add("hidden")
  }

  // [CORREGIDO] Cargar la configuración de inventario para TODOS los roles, ya que afecta la visibilidad del stock para todos.
  await fetchInventoryConfig();
}

document.getElementById("logout-button")?.addEventListener("click", async () => {
  await window.supabaseClient.auth.signOut()
  currentUser = null
  window.currentUserRole = null
  cart = []
  showLogin()
})

function logoutFromSidebar() {
  window.supabaseClient.auth.signOut().then(() => {
    currentUser = null
    window.currentUserRole = null
    cart = []
    closeSidebar()
    showLogin()
  })
}

function showLogin() {
  document.getElementById("loading-screen").classList.add("hidden")
  document.getElementById("login-screen").classList.remove("hidden")
  document.getElementById("app-screen").classList.add("hidden")
}

function showApp() {
  console.log("Mostrando app...")
  document.getElementById("loading-screen").classList.add("hidden")
  document.getElementById("login-screen").classList.add("hidden")
  document.getElementById("app-screen").classList.remove("hidden")
  loadProducts()
}

function showAuthMessage(message, type) {
  const errorDiv = document.getElementById("auth-error")
  const successDiv = document.getElementById("auth-success")

  errorDiv.classList.add("hidden")
  successDiv.classList.add("hidden")

  if (type === "error") {
    errorDiv.textContent = message
    errorDiv.classList.remove("hidden")
  } else if (type === "success") {
    successDiv.textContent = message
    successDiv.classList.remove("hidden")
  } else {
    successDiv.textContent = message
    successDiv.classList.remove("hidden")
  }
}

function showCreateUserMessage(message, type) {
  const errorDiv = document.getElementById("create-user-error")
  const successDiv = document.getElementById("create-user-success")

  errorDiv.classList.add("hidden")
  successDiv.classList.add("hidden")

  if (type === "error") {
    errorDiv.textContent = message
    errorDiv.classList.remove("hidden")
  } else if (type === "success") {
    successDiv.textContent = message
    successDiv.classList.remove("hidden")
  } else {
    successDiv.textContent = message
    successDiv.classList.remove("hidden")
  }
}

function showImageModal(imageSrc, productName) {
  let imageModal = document.getElementById("image-modal")
  if (!imageModal) {
    imageModal = document.createElement("div")
    imageModal.id = "image-modal"
    imageModal.className = "fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50 hidden"
    imageModal.innerHTML = `
      <div class="relative max-w-4xl max-h-full p-4">
        <button id="close-image-modal" class="absolute top-2 right-2 text-white bg-black bg-opacity-50 rounded-full w-10 h-10 flex items-center justify-center text-xl font-bold hover:bg-opacity-75 transition-all z-10">
          ×
        </button>
        <img id="modal-image" class="max-w-full max-h-full object-contain rounded-lg shadow-2xl" alt="">
        <div id="modal-image-title" class="text-white text-center mt-4 text-lg font-semibold"></div>
      </div>
    `
    document.body.appendChild(imageModal)

    document.getElementById("close-image-modal").addEventListener("click", closeImageModal)
    imageModal.addEventListener("click", (e) => {
      if (e.target === imageModal) {
        closeImageModal()
      }
    })

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !imageModal.classList.contains("hidden")) {
        closeImageModal()
      }
    })
  }

  document.getElementById("modal-image").src = optimizeImageUrl(imageSrc)
  document.getElementById("modal-image-title").textContent = productName

  imageModal.classList.remove("hidden")
  document.body.style.overflow = "hidden"
}

function closeImageModal() {
  const imageModal = document.getElementById("image-modal")
  if (imageModal) {
    imageModal.classList.add("hidden")
    document.body.style.overflow = "auto"
  }
}

function setupEventListeners() {
  document.getElementById("show-login-btn")?.addEventListener("click", () => {
    document.getElementById("login-form").classList.remove("hidden")
    document.getElementById("register-form").classList.add("hidden")
    document.getElementById("show-login-btn").classList.add("auth-tab-active")
    document.getElementById("show-register-btn").classList.remove("auth-tab-active")
  })

  document.getElementById("show-register-btn")?.addEventListener("click", () => {
    document.getElementById("login-form").classList.add("hidden")
    document.getElementById("register-form").classList.remove("hidden")
    document.getElementById("show-register-btn").classList.add("auth-tab-active")
    document.getElementById("show-login-btn").classList.remove("auth-tab-active")
  })

  document.getElementById("manage-banners-btn")?.addEventListener("click", () => {
    document.getElementById("banners-modal").classList.remove("hidden")
    loadBannersForModal()
  })

  document.getElementById("close-banners-modal")?.addEventListener("click", () => {
    document.getElementById("banners-modal").classList.add("hidden")
  })

  document.getElementById("add-banner-btn")?.addEventListener("click", addBanner)

  document.getElementById("banner-prev")?.addEventListener("click", () => {
    previousBanner()
  })

  document.getElementById("banner-next")?.addEventListener("click", () => {
    nextBanner()
  })

  document.getElementById("create-user-button")?.addEventListener("click", () => {
    const roleSelect = document.getElementById("new-user-role")

    roleSelect.innerHTML = ""

    if (window.currentUserRole === "gestor") {
      roleSelect.innerHTML = `
        <option value="cliente">Cliente</option>
        <option value="distribuidor">Mayorista</option>
        <option value="gestor">Gestor</option>
      `
      // [NUEVO] El gestor no puede ver el toggle
      document.getElementById("can-see-stock-container")?.classList.add("hidden")
    } else if (window.currentUserRole === "admin") {
      roleSelect.innerHTML = `
        <option value="cliente">Cliente</option>
        <option value="distribuidor">Mayorista</option>
        <option value="gestor">Gestor</option>
        <option value="admin">Administrador</option>
        <option value="inventario">Inventario</option>
      `
      // [NUEVO] Solo el admin puede ver el toggle de ver cantidades
      document.getElementById("can-see-stock-container")?.classList.remove("hidden")
    }

    document.getElementById("create-user-modal").classList.remove("hidden")
    document.getElementById("create-user-error").classList.add("hidden")
    document.getElementById("create-user-success").classList.add("hidden")
  })

  document.getElementById("close-create-user-modal")?.addEventListener("click", () => {
    document.getElementById("create-user-modal").classList.add("hidden")
  })

  document.getElementById("open-sidebar")?.addEventListener("click", () => {
    document.getElementById("sidebar-menu").classList.add("open")
    document.getElementById("sidebar-overlay").classList.remove("hidden")
  })

  document.getElementById("close-sidebar")?.addEventListener("click", closeSidebar)
  document.getElementById("sidebar-overlay")?.addEventListener("click", closeSidebar)

  document.getElementById("cart-button")?.addEventListener("click", () => {
    document.getElementById("cart-modal").classList.remove("hidden")
    renderCart()
  })

  document.getElementById("close-cart")?.addEventListener("click", () => {
    document.getElementById("cart-modal").classList.add("hidden")
  })

  document.getElementById("clear-cart-btn")?.addEventListener("click", async () => {
    if (confirm("¿Estás seguro de que deseas vaciar todo el carrito?")) {
      await clearCart()
    }
  })

  document.getElementById("global-search")?.addEventListener("input", handleGlobalSearch)
  document.getElementById("dept-search")?.addEventListener("input", handleDeptSearch)

  document.getElementById("send-whatsapp")?.addEventListener("click", () => {
    if (window.currentUserRole === "admin") {
      showOrderDetailsModal()
    } else {
      sendWhatsAppOrder() // Esto se ha convertido en una función async
    }
  })

  document.getElementById("close-order-details-modal")?.addEventListener("click", () => {
    document.getElementById("order-details-modal").classList.add("hidden")
  })

  document.getElementById("cancel-order-details")?.addEventListener("click", () => {
    document.getElementById("order-details-modal").classList.add("hidden")
  })

  document.getElementById("confirm-order-details")?.addEventListener("click", async () => await confirmOrderDetails())

  document.getElementById("upload-csv-button")?.addEventListener("click", () => {
    // Limpiar estado de carga de CSV
    const statusDiv = document.getElementById("csv-status");
    if (statusDiv) statusDiv.classList.add("hidden");
    document.getElementById("csv-file-name").classList.add("hidden");
    document.getElementById("csv-modal").classList.remove("hidden")
  })

  document.getElementById("close-csv-modal")?.addEventListener("click", () => {
    document.getElementById("csv-modal").classList.add("hidden")
  })

  document.getElementById("csv-file-input")?.addEventListener("change", handleCSVFileSelect)
  document.getElementById("upload-csv-submit")?.addEventListener("click", handleCSVUpload)

  /* El listener para exportar PDF ahora está en app-features.js para evitar duplicados
  document.getElementById("export-pdf-button")?.addEventListener("click", ...)
  document.getElementById("close-pdf-modal")?.addEventListener("click", ...)
  document.getElementById("generate-pdf-button")?.addEventListener("click", ...)
  */
  document.getElementById("close-quantity-modal")?.addEventListener("click", () => {
    document.getElementById("quantity-modal").classList.add("hidden")
  })

  document.getElementById("cancel-quantity")?.addEventListener("click", () => {
    document.getElementById("quantity-modal").classList.add("hidden")
  })

  document.getElementById("confirm-quantity")?.addEventListener("click", async () => await confirmQuantity())

  // [NUEVO] Event listeners para filtros de precio
  document.getElementById("price-filter-btn")?.addEventListener("click", () => filterByDepartment(currentDepartment));

  // [NUEVO] Event listener para botón de favoritos
  document.getElementById("favorites-button")?.addEventListener("click", () => filterByDepartment("favorites"));

}

function closeSidebar() {
  document.getElementById("sidebar-menu").classList.remove("open")
  document.getElementById("sidebar-overlay").classList.add("hidden")
}

// [NUEVO] Cargar el snapshot de precios para la comparación de "Bajó de precio"
async function loadPriceSnapshot() {
    console.log("[PRICE-CHECK] Cargando snapshot de precios anterior...");
    const previousSnapshot = await getPreviousCSVSnapshot();
    if (previousSnapshot && previousSnapshot.length > 0) {
        previousSnapshot.forEach(p => {
            const key = (p.codigo || p.nombre || '').toLowerCase().trim();
            if (key) {
                priceSnapshotMap.set(key, p);
            }
        });
        console.log(`[PRICE-CHECK] ✅ Snapshot cargado con ${priceSnapshotMap.size} productos para comparación.`);
    } else {
        console.log("[PRICE-CHECK] ⓘ No se encontró snapshot de precios anterior.");
    }
}

// [NUEVO] Cargar favoritos desde Supabase (Por Usuario)
async function loadFavorites() {
    if (!currentUser) return;
    
    try {
        const { data, error } = await window.supabaseClient
            .from('favorites')
            .select('product_id')
            .eq('user_id', currentUser.auth_id);
            
        if (error) throw error;
        
        if (data) {
            favorites = data.map(f => f.product_id);
            console.log(`[FAVORITES] ✅ ${favorites.length} favoritos cargados de la nube.`);
        }
    } catch (error) {
        console.error("[FAVORITES] Error cargando favoritos:", error);
        // Fallback a local si falla la red, aunque idealmente queremos la nube
        const savedFavorites = localStorage.getItem(FAVORITES_KEY);
        if (savedFavorites) favorites = JSON.parse(savedFavorites);
    }
}

// [NUEVO] Guardar favoritos (Ya no se usa localStorage globalmente, se maneja en toggleFavorite)
function saveFavoritesLocalBackup() { 
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites)); 
}

async function loadProducts() {
  console.log("Iniciando carga de productos...")

  try {
    document.getElementById("products-loading").classList.remove("hidden")
    document.getElementById("products-grid").innerHTML = ""

    allProducts = []
    let start = 0
    const batchSize = 500
    let hasMore = true

    while (hasMore) {
      const { data, error } = await window.supabaseClient
        .from("products")
        .select("*")
        .order("nombre", { ascending: true })
        .range(start, start + batchSize - 1)

      if (error) throw error

      if (data && data.length > 0) {
        allProducts = [...allProducts, ...data]
        console.log(`📦 Cargados ${allProducts.length} productos...`)

        if (data.length < batchSize) {
          hasMore = false
        } else {
          start += batchSize
        }
      } else {
        hasMore = false
      }
    }

    // Los productos ya vienen con is_new desde Supabase
    const newProductsCount = allProducts.filter((p) => p.is_new).length
    console.log(`[PRODUCTOS] ${newProductsCount} productos marcados como nuevos en la base de datos`)

    // [MODIFICADO] Ordenar productos: Primero con stock, luego sin stock (al final), manteniendo orden alfabético
    allProducts.sort((a, b) => {
      const stockA = (a.stock || 0) > 0 ? 1 : 0;
      const stockB = (b.stock || 0) > 0 ? 1 : 0;
      
      if (stockA !== stockB) {
        return stockB - stockA; // 1 (con stock) antes que 0 (sin stock)
      }
      return (a.nombre || '').localeCompare(b.nombre || '');
    });

    // [NUEVO] Inicializar Fuse.js para búsqueda difusa
    const fuseOptions = {
        keys: ['nombre', 'codigo', 'descripcion'],
        includeScore: true,
        threshold: 0.4, // Umbral de "flexibilidad" (0 es exacto, 1 es todo) - Más flexible
        ignoreLocation: true,
        useExtendedSearch: true, // Permite búsqueda multi-palabra
    };
    fuse = new Fuse(allProducts, fuseOptions);
    console.log(`[FUSE] ✅ Búsqueda difusa inicializada con ${allProducts.length} productos.`);

    await loadPriceSnapshot(); // Cargar precios antiguos
    await loadFavorites(); // Cargar favoritos desde la nube

    // [NUEVO] Si es rol inventario, cargar datos de inventory_products
    if (window.currentUserRole === 'inventario') {
        console.log("📦 Cargando datos de inventario físico...");
        
        let allInvData = [];
        let invStart = 0;
        const invBatchSize = 1000;
        let invHasMore = true;

        while (invHasMore) {
             const { data: invData, error: invError } = await window.supabaseClient
                .from('inventory_products')
                .select('*')
                .range(invStart, invStart + invBatchSize - 1);
            
            if (invError) {
                console.error("Error loading inventory data", invError);
                break;
            }

            if (invData && invData.length > 0) {
                allInvData = [...allInvData, ...invData];
                if (invData.length < invBatchSize) {
                    invHasMore = false;
                } else {
                    invStart += invBatchSize;
                }
            } else {
                invHasMore = false;
            }
        }
        
        inventoryDataMap.clear();
        allInvData.forEach(item => {
            if (item.codigo) inventoryDataMap.set(item.codigo.trim().toUpperCase(), item);
        });
        console.log(`📦 Datos de inventario cargados: ${inventoryDataMap.size} registros`);
    }

    filteredProducts = allProducts
    currentPage = 1

    console.log("Renderizando departamentos...")
    renderDepartments()

    console.log("Renderizando productos...")
    renderProducts()

    console.log(`✅ ${allProducts.length} productos cargados en total`)

    setTimeout(() => {
      preloadAllImages()
    }, 2000)
  } catch (error) {
    console.error("❌ Error al cargar productos:", error)
  } finally {
    document.getElementById("products-loading").classList.add("hidden")
  }
}

// EXPORTAR loadProducts AL WINDOW para que app-features.js pueda acceder
window.loadProducts = loadProducts;

function renderDepartments() {
  const navContainer = document.getElementById("departments-nav")
  const sidebarContainer = document.getElementById("sidebar-departments")

  navContainer.innerHTML = ""
  sidebarContainer.innerHTML = ""

  // [NUEVO] Renderizado especial para ROL INVENTARIO
  if (window.currentUserRole === 'inventario') {
      const inventoryTabs = [
          { id: 'inv_unassigned', label: '⚠️ Por Asignar', icon: '⚠️' },
          { id: 'inv_A', label: 'Depósito A', icon: '🏢' },
          { id: 'inv_B', label: 'Depósito B', icon: '🏢' },
          { id: 'inv_C', label: 'Depósito C', icon: '🏢' },
          { id: 'inv_D', label: 'Depósito D', icon: '🏢' },
          { id: 'inv_E', label: 'Depósito E', icon: '🏢' },
          { id: 'inv_PLANTA BAJA', label: 'Planta Baja', icon: '⬇️' },
          { id: 'inv_PISO VENTA', label: 'Piso Venta', icon: '⬆️' }
      ];

      inventoryTabs.forEach(tab => {
          // Botón Nav Superior
          const btn = document.createElement("button");
          btn.className = "dept-button whitespace-nowrap px-5 py-2.5 rounded-xl font-semibold transition-all text-sm";
          btn.innerHTML = `${tab.icon} ${tab.label}`;
          btn.dataset.dept = tab.id;
          btn.addEventListener("click", () => filterByDepartment(tab.id));
          navContainer.appendChild(btn);

          // Botón Sidebar
          const sidebarBtn = document.createElement("button");
          sidebarBtn.className = "sidebar-dept-btn w-full text-left px-4 py-3 rounded-xl hover:bg-white/10 transition-all font-semibold";
          sidebarBtn.innerHTML = `${tab.icon} ${tab.label}`;
          sidebarBtn.dataset.dept = tab.id;
          sidebarBtn.addEventListener("click", () => {
              filterByDepartment(tab.id);
              closeSidebar();
          });
          sidebarContainer.appendChild(sidebarBtn);
      });
      
      // Seleccionar "Por Asignar" por defecto si no hay selección
      if (currentDepartment === 'all') {
          setTimeout(() => filterByDepartment('inv_unassigned'), 100);
      }
      return; // Salir para no renderizar departamentos normales
  }

  // Botón para Mercancía Recién Llegada
  const newProductsBtn = document.createElement("button")
  newProductsBtn.className = "dept-button whitespace-nowrap px-5 py-2.5 rounded-xl font-semibold transition-all text-sm"
  newProductsBtn.innerHTML = "🆕 Mercancía Recién Llegada"
  newProductsBtn.dataset.dept = "new"
  newProductsBtn.addEventListener("click", () => filterByDepartment("new"))
  navContainer.appendChild(newProductsBtn)

  // Botón para Mercancía Más Vendida
  const bestSellingBtn = document.createElement("button")
  bestSellingBtn.className = "dept-button whitespace-nowrap px-5 py-2.5 rounded-xl font-semibold transition-all text-sm"
  bestSellingBtn.innerHTML = "🔥 Mercancía Más Vendida"
  bestSellingBtn.dataset.dept = "bestselling"
  bestSellingBtn.addEventListener("click", () => filterByDepartment("bestselling"))
  navContainer.appendChild(bestSellingBtn)

  // [NUEVO] Botón para Favoritos
  const favoritesBtn = document.createElement("button");
  favoritesBtn.className = "dept-button whitespace-nowrap px-5 py-2.5 rounded-xl font-semibold transition-all text-sm";
  favoritesBtn.innerHTML = "❤️ Favoritos";
  favoritesBtn.dataset.dept = "favorites";
  favoritesBtn.addEventListener("click", () => filterByDepartment("favorites"));
  navContainer.appendChild(favoritesBtn);

  // Agregar todos los departamentos al sidebar
  const departments = [...new Set(allProducts.map((p) => p.departamento).filter(Boolean))]

  const sidebarNewBtn = document.createElement("button")
  sidebarNewBtn.className =
    "sidebar-dept-btn w-full text-left px-4 py-3 rounded-xl hover:bg-white/10 transition-all font-semibold"
  sidebarNewBtn.innerHTML = "🆕 Mercancía Recién Llegada"
  sidebarNewBtn.dataset.dept = "new"
  sidebarNewBtn.addEventListener("click", () => {
    filterByDepartment("new")
    closeSidebar()
  })
  sidebarContainer.appendChild(sidebarNewBtn)

  const sidebarBestBtn = document.createElement("button")
  sidebarBestBtn.className =
    "sidebar-dept-btn w-full text-left px-4 py-3 rounded-xl hover:bg-white/10 transition-all font-semibold"
  sidebarBestBtn.innerHTML = "🔥 Mercancía Más Vendida"
  sidebarBestBtn.dataset.dept = "bestselling"
  sidebarBestBtn.addEventListener("click", () => {
    filterByDepartment("bestselling")
    closeSidebar()
  })
  sidebarContainer.appendChild(sidebarBestBtn)

  // [NUEVO] Botón de Favoritos en Sidebar
  const sidebarFavoritesBtn = document.createElement("button");
  sidebarFavoritesBtn.className = "sidebar-dept-btn w-full text-left px-4 py-3 rounded-xl hover:bg-white/10 transition-all font-semibold";
  sidebarFavoritesBtn.innerHTML = "❤️ Mis Favoritos";
  sidebarFavoritesBtn.dataset.dept = "favorites";
  sidebarFavoritesBtn.addEventListener("click", () => {
      filterByDepartment("favorites");
      closeSidebar();
  });
  sidebarContainer.appendChild(sidebarFavoritesBtn);

  departments.forEach((dept) => {
    const sidebarBtn = document.createElement("button")
    sidebarBtn.className =
      "sidebar-dept-btn w-full text-left px-4 py-3 rounded-xl hover:bg-white/10 transition-all font-semibold"
    sidebarBtn.textContent = `📁 ${dept}`
    sidebarBtn.dataset.dept = dept
    sidebarBtn.addEventListener("click", () => {
      filterByDepartment(dept)
      closeSidebar()
    })
    sidebarContainer.appendChild(sidebarBtn)
  })

  const logoutBtn = document.createElement("button")
  logoutBtn.className =
    "w-full text-left px-4 py-3 rounded-xl hover:bg-red-600/20 transition-all font-semibold text-red-400 border-t border-white/10 mt-4"
  logoutBtn.innerHTML = `🚪 Cerrar Sesión`
  logoutBtn.addEventListener("click", logoutFromSidebar)
  sidebarContainer.appendChild(logoutBtn)

  document.querySelectorAll('[data-dept="all"]').forEach((btn) => {
    btn.addEventListener("click", () => filterByDepartment("all"))
  })
}

function filterByDepartment(dept, keepSearch = false) {
  currentDepartment = dept

  document.querySelectorAll(".dept-button, .sidebar-dept-btn").forEach((btn) => {
    btn.classList.remove("active")
    if (btn.dataset.dept === dept) {
      btn.classList.add("active")
    }
  })

  // [NUEVO] Lógica de filtro de precios
  const minPrice = parseFloat(document.getElementById("price-min").value) || 0;
  const maxPrice = parseFloat(document.getElementById("price-max").value) || Infinity;

  const priceFilter = (product) => {
      const priceInfo = getPriceForRole(product);
      let priceToCompare = 0;
      if (priceInfo.display === 'single') priceToCompare = priceInfo.price;
      else priceToCompare = priceInfo.priceCliente; // Usar precio cliente como base para el filtro

      return priceToCompare >= minPrice && priceToCompare <= maxPrice;
  };

  const deptSearchContainer = document.getElementById("dept-search-container")
  if (dept === "all") {
    deptSearchContainer.classList.add("hidden")
  } else {
    deptSearchContainer.classList.remove("hidden")
  }

  let baseProducts = allProducts;

  // [NUEVO] Filtro Global para Rol Inventario: Ocultar agotados (Stock 0)
  if (window.currentUserRole === 'inventario') {
      baseProducts = baseProducts.filter(p => (p.stock || 0) > 0);
  }

  // [NUEVO] Lógica de filtrado para INVENTARIO
  if (window.currentUserRole === 'inventario' && dept.startsWith('inv_')) {
      const targetDeposit = dept.replace('inv_', ''); // 'unassigned', 'A', 'B'...
      
      filteredProducts = baseProducts.filter(p => {
          const pCode = (p.codigo || '').trim().toUpperCase();
          const invData = inventoryDataMap.get(pCode);
          
          // Si no hay datos de inventario, se asume sin asignar (si tiene stock > 0)
          // OJO: Si inventory_products no tiene el registro, lo tratamos como unassigned
          const currentDep = invData ? invData.deposito : null;
          const stock = p.stock || 0;

          // Solo mostrar productos con stock > 0 en inventario
          if (stock <= 0) return false;

          if (targetDeposit === 'unassigned') {
              return !currentDep; // Mostrar si no tiene depósito
          } else {
              return currentDep === targetDeposit; // Mostrar si coincide el depósito
          }
      });

      // Aplicar filtro de búsqueda local si existe (usando Fuse o texto simple)
      // Nota: handleDeptSearch se encarga de refiltrar filteredProducts, así que aquí solo filtramos por depósito
      
      currentPage = 1;
      renderProducts();
      return;
  }

  if (dept === "all") {
    filteredProducts = baseProducts.filter(priceFilter);
  } else if (dept === "new") {
    // Usar el nuevo campo is_new para filtrar
    filteredProducts = baseProducts.filter((p) => p.is_new && priceFilter(p));
    // [MODIFICADO] Limitar a 50 productos nuevos
    filteredProducts = filteredProducts.slice(0, 50);
  } else if (dept === "favorites") {
    const favoriteIds = new Set(favorites);
    filteredProducts = baseProducts.filter(p => favoriteIds.has(p.id) && priceFilter(p));
  } else if (dept === "bestselling") {
    getBestSellingProducts().then((salesData) => {
      console.log("[SALES-DB] Intentando mapear ", salesData.length, " productos")
      console.log("[SALES-DB] Primer item de sales:", salesData[0])
      console.log("[SALES-DB] Primer producto en allProducts:", allProducts[0])

      filteredProducts = salesData
        .map((sale) => {
          // Try to find using both possible field names
          const productId = sale.product_id || sale.id
          const fullProduct = allProducts.find((p) => p.id === productId || p.id === sale.product_id)

          if (!fullProduct) {
            console.log("[SALES-DB] ⚠️ Producto no encontrado para ID:", productId)
          }

          return fullProduct ? { ...fullProduct, total_sold: sale.total_sold } : null
        })
        .filter((p) => p !== null)

      filteredProducts = filteredProducts.filter(priceFilter);

      // [MODIFICADO] Asegurar que los productos sin stock salgan al final también en más vendidos
      filteredProducts.sort((a, b) => {
        const stockA = (a.stock || 0) > 0 ? 1 : 0;
        const stockB = (b.stock || 0) > 0 ? 1 : 0;
        if (stockA !== stockB) return stockB - stockA;
        return 0; // Mantener orden de ventas
      });

      console.log("[SALES-DB] Productos después del map:", filteredProducts.length)
      currentPage = 1
      renderProducts()
      document.getElementById("products-grid").scrollIntoView({ behavior: "smooth", block: "start" })
    })
    return
  } else {
    filteredProducts = baseProducts.filter((p) => p.departamento === dept && priceFilter(p));
  }

  currentPage = 1
  renderProducts()
}

function renderProducts() {
  console.log("Renderizando productos, página:", currentPage)

  const grid = document.getElementById("products-grid")
  const noProducts = document.getElementById("no-products")

  if (currentPage === 1) {
    grid.innerHTML = ""
  }

  if (filteredProducts.length === 0) {
    noProducts.classList.remove("hidden")
    return
  }

  noProducts.classList.add("hidden")

  const startIndex = (currentPage - 1) * PRODUCTS_PER_PAGE
  const endIndex = startIndex + PRODUCTS_PER_PAGE
  const productsToRender = filteredProducts.slice(startIndex, endIndex)

  const fragment = document.createDocumentFragment()

  productsToRender.forEach((product) => {
    try {
      const card = createProductCard(product)
      fragment.appendChild(card)
    } catch (error) {
      console.error("Error creando tarjeta para producto:", product.nombre, error)
    }
  })

  grid.appendChild(fragment)

  updateLoadMoreButton()

  console.log("Productos renderizados:", productsToRender.length)
}

// EXPORTAR renderProducts AL WINDOW para que app-features.js pueda acceder
window.renderProducts = renderProducts;

function updateLoadMoreButton() {
  const totalPages = Math.ceil(filteredProducts.length / PRODUCTS_PER_PAGE)
  let loadMoreBtn = document.getElementById("load-more-btn")

  if (!loadMoreBtn) {
    loadMoreBtn = document.createElement("button")
    loadMoreBtn.id = "load-more-btn"
    loadMoreBtn.className =
      "w-full max-w-md mx-auto mt-8 bg-gradient-to-r from-red-600 to-red-700 text-white font-bold py-4 rounded-xl hover:from-red-700 hover:to-red-800 transition-all shadow-lg"
    loadMoreBtn.textContent = "Cargar más productos"
    loadMoreBtn.addEventListener("click", loadMoreProducts)

    const grid = document.getElementById("products-grid")
    grid.parentElement.appendChild(loadMoreBtn)
  }

  if (currentPage >= totalPages) {
    loadMoreBtn.classList.add("hidden")
  } else {
    loadMoreBtn.classList.remove("hidden")
    loadMoreBtn.textContent = `Cargar más productos (${filteredProducts.length - currentPage * PRODUCTS_PER_PAGE} restantes)`
  }
}

function loadMoreProducts() {
  if (isLoadingMore) return

  isLoadingMore = true
  currentPage++
  renderProducts()
  isLoadingMore = false
}

function createProductCard(product) {
  const card = document.createElement("div")
  card.className = "product-card"
  const cleanCode = (product.codigo || '').trim().toUpperCase();
  card.dataset.productCode = cleanCode;
  
  // [NUEVO] Datos de inventario para este producto
  const pCode = (product.codigo || '').trim().toUpperCase();
  const invData = inventoryDataMap.get(pCode);

  const priceInfo = getPriceForRole(product)

  let priceHTML = ""
  if (priceInfo.display === "single") {
    const priceColorClass = currentUserRole === 'distribuidor' ? 'main-price-mayor' : 'main-price-detal';
    priceHTML = `<span class="main-price ${priceColorClass}">$${priceInfo.price.toFixed(2)}</span>`
  } else if (priceInfo.display === "dual") {
    priceHTML = `
      <div class="space-y-3">
        <div class="flex items-baseline justify-between">
          <span class="text-sm font-medium text-gray-500">${priceInfo.labelCliente}</span>
          <span class="main-price main-price-detal">$${priceInfo.priceCliente.toFixed(2)}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium text-gray-500">${priceInfo.labelMayor}</span>
          <span class="price-pill pill-green">$${priceInfo.priceMayor.toFixed(2)}</span>
        </div>
      </div>
    `
  } else if (priceInfo.display === "triple") {
    priceHTML = `
      <div class="space-y-3">
        <div class="flex items-baseline justify-between">
          <span class="text-sm font-medium text-gray-500">${priceInfo.labelCliente}</span>
          <span class="main-price main-price-detal">$${priceInfo.priceCliente.toFixed(2)}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium text-gray-500">${priceInfo.labelMayor}</span>
          <span class="price-pill pill-green">$${priceInfo.priceMayor.toFixed(2)}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-sm font-medium text-gray-500">${priceInfo.labelGmayor}</span>
          <span class="price-pill pill-blue">$${priceInfo.priceGmayor.toFixed(2)}</span>
        </div>
      </div>
    `
  }

  const imageUrl = product.imagen_url || "/images/ProductImages.jpg"
  const optimizedUrl = optimizeImageUrl(imageUrl)
  const placeholderUrl = createImagePlaceholder(imageUrl)

  // Determinar el estado del stock
  // [MODIFICADO] Mostrar siempre el stock
  let stockBadge = '';
  const stock = product.stock || 0;
  
  // [MODIFICADO] Lógica de visibilidad de stock
  // Ahora depende de la configuración global por rol Y del permiso individual del usuario
  const userRole = window.currentUserRole || 'cliente';
  // Verificar permiso en config global. Si no existe la key, por defecto true salvo inventario.
  const roleCanSeeStock = (stockVisibilityConfig && typeof stockVisibilityConfig[userRole] !== 'undefined') 
                      ? stockVisibilityConfig[userRole] 
                      : (userRole !== 'inventario');
  // [NUEVO] Verificar permiso individual del usuario (can_see_stock). Si el campo no existe, se asume true.
  const userCanSeeStock = (currentUser && typeof currentUser.can_see_stock !== 'undefined') 
                      ? currentUser.can_see_stock 
                      : true;
  // El usuario ve stock SOLO si ambas condiciones se cumplen
  const canSeeStock = roleCanSeeStock && userCanSeeStock;

  // LOG PARA DEPURACIÓN (Solo visible en consola)
  if (stock > 0 && !canSeeStock) {
    console.log(`[DEBUG-STOCK] Producto ${product.nombre}: Oculto. roleCanSeeStock=${roleCanSeeStock}, userCanSeeStock=${userCanSeeStock}, role=${userRole}`);
  }

  if (stock === 0) {
    // Siempre mostrar AGOTADO independientemente del rol
    stockBadge = '<span class="absolute bottom-3 right-3 z-20 bg-red-600 text-white text-xs font-extrabold px-3 py-2 rounded-lg animate-pulse">AGOTADO</span>';
  } else if (canSeeStock) {
    // Solo mostrar cantidad si tiene permiso
    const stockColor = stock <= 5 ? 'bg-yellow-500 text-black' : 'bg-emerald-600 dark:bg-emerald-500 text-black';
    stockBadge = `<span class="absolute bottom-3 right-3 z-20 ${stockColor} text-xs font-extrabold px-3 py-2 rounded-lg">Stock: ${stock}</span>`;
  }

  // [NUEVO] Lógica para badge de "Bajó de Precio"
  let priceDropBadge = '';
  const oldProduct = priceSnapshotMap.get((product.codigo || '').toLowerCase().trim());
  if (oldProduct) {
      const oldPrice = parseFloat(oldProduct.precio_cliente || 0);
      const newPrice = parseFloat(product.precio_cliente || 0);
      if (newPrice > 0 && oldPrice > 0 && newPrice < oldPrice) {
          priceDropBadge = '<span class="price-drop-badge absolute top-3 left-3 z-20">¡BAJÓ DE PRECIO!</span>';
      }
  }

  // [MODIFICADO] Badge de nuevo producto, con animación y z-index
  const newBadge = product.is_new ? '<span class="absolute top-3 right-3 z-20 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full animate-pulse">¡NUEVO!</span>' : '';
  
  if (window.currentUserRole === 'inventario') {
      const currentDep = invData ? invData.deposito : null;
      
      if (!currentDep) {
          // VISTA: POR ASIGNAR (Botones A-E)
          actionButtonsHTML = `
            <div class="mt-3">
                <p class="text-xs font-bold text-gray-500 mb-2 text-center uppercase tracking-wider">Asignar a Depósito:</p>
                <div class="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-7 gap-1">
                    ${['A','B','C','D','E','PLANTA BAJA','PISO VENTA'].map(d => `
                        <button class="deposito-assign-btn w-full h-auto min-h-[2.5rem] py-1 rounded-lg font-bold text-[10px] sm:text-xs bg-gray-100 hover:bg-blue-600 hover:text-white border border-gray-200 transition-all shadow-sm flex items-center justify-center text-center leading-tight" 
                            onclick="window.assignProductDeposit('${product.id}', '${product.codigo}', '${d}')">
                            ${d}
                        </button>
                    `).join('')}
                </div>
            </div>
          `;
      } else {
          // VISTA: EN DEPÓSITO (Input Cantidad + Botones Cambiar Depósito)
          // Lógica de bloqueo: Bloqueado si !inventoryEditMode Y ya tiene cantidad > 0
          const currentQty = invData ? (invData.cantidad_fisica || 0) : 0;
          const isLocked = !inventoryEditMode && currentQty > 0;
          
          actionButtonsHTML = `
            <div class="mt-3">
                <div class="flex justify-between items-center mb-1">
                    <p class="text-xs font-bold text-gray-500 uppercase">Conteo Físico:</p>
                    <span class="text-xs font-mono bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-bold">Dep: ${currentDep}</span>
                </div>
                <div class="relative">
                    <input type="number" 
                        value="${currentQty}" 
                        min="0"
                        class="w-full p-3 text-center text-xl font-bold border-2 rounded-xl outline-none transition-all ${isLocked ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed' : 'bg-white text-blue-600 border-blue-200 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20'}"
                        ${isLocked ? 'disabled' : ''}
                        onchange="window.updateInventoryQuantity('${product.codigo}', this)"
                        onfocus="this.select()"
                    >
                    ${isLocked ? '<div class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg></div>' : ''}
                </div>
                ${!isLocked ? '<p class="text-[10px] text-center text-gray-400 mt-1">Ingresa la cantidad y presiona Enter o sal del campo</p>' : '<p class="text-[10px] text-center text-red-400 mt-1 font-medium">Edición bloqueada por Admin</p>'}
                
                <!-- [NUEVO] Botones para cambiar depósito -->
                <div class="mt-3 pt-3 border-t border-gray-200">
                    <p class="text-[10px] font-bold text-gray-400 mb-1.5 text-center uppercase tracking-wider">Cambiar Depósito:</p>
                    <div class="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-1">
                        ${['A','B','C','D','E','PLANTA BAJA','PISO VENTA'].map(d => `
                            <button class="deposito-change-btn w-full h-auto min-h-[2rem] py-1 rounded-lg font-bold text-[9px] sm:text-[10px] ${
                                d === currentDep 
                                ? 'bg-blue-600 text-white border-blue-700 shadow-md cursor-default' 
                                : 'bg-gray-100 hover:bg-orange-500 hover:text-white border border-gray-200 transition-all shadow-sm'
                            } flex items-center justify-center text-center leading-tight" 
                                ${d === currentDep ? 'disabled' : ''}
                                onclick="window.assignProductDeposit('${product.id}', '${product.codigo}', '${d}')">
                                ${d === currentDep ? '✓ ' + d : d}
                            </button>
                        `).join('')}
                    </div>
                </div>
            </div>
          `;
      }
  } else {
      // VISTA NORMAL (Botón Carrito)
      const isAgotado = product.stock === 0;
      actionButtonsHTML = `
        <button class="add-to-cart-btn relative z-0 w-full ${isAgotado ? 'bg-gray-400 cursor-not-allowed text-gray-200' : 'bg-gradient-to-r from-red-600 via-orange-500 to-red-700 text-white hover:from-red-700 hover:to-red-800'} font-bold py-3 rounded-xl transition-all shadow-lg" ${isAgotado ? 'disabled' : ''}>
            ${isAgotado ? 'Agotado' : 'Agregar al Carrito'}
        </button>
      `;
  }

  card.innerHTML = `
    <div class="product-image-container">
      <!-- [NUEVO] Botón de Favoritos -->
      <button class="favorite-btn" data-product-id="${product.id}">
        <svg class="w-6 h-6 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 016.364 0L12 7.5l1.318-1.182a4.5 4.5 0 116.364 6.364L12 20.273l-7.682-7.682a4.5 4.5 0 010-6.364z"></path>
        </svg>
      </button>
      <img src="${placeholderUrl}"
           data-src="${optimizedUrl}"
           alt="${product.nombre}"
           class="product-image image-loading cursor-pointer hover:opacity-90 transition-opacity"
           loading="lazy"
           onerror="this.src='/images/ProductImages.jpg'">
      <!-- [MODIFICADO] Badges movidos aquí para correcta superposición y visibilidad -->
      ${priceDropBadge}
      ${newBadge}
      ${stockBadge}
    </div>
    <div class="p-5">
      <h3 class="font-bold text-lg text-gray-800 mb-2 line-clamp-2">${product.nombre}</h3>
      ${product.codigo ? `<p class="text-xs text-gray-500 mb-1 font-semibold">Código: ${product.codigo}</p>` : ""}
      <div class="mb-4">
        ${priceHTML}
      </div>
      ${product.departamento ? `<span class="text-xs bg-gray-100 dark:bg-gray-700 px-3 py-1 rounded-full text-gray-600 dark:text-gray-300 font-semibold block mb-3">${product.departamento}</span>` : ""}
      ${actionButtonsHTML}
    </div>
  `

  const productImage = card.querySelector(".product-image")
  if (imageObserver && productImage) {
    imageObserver.observe(productImage)
  }

  productImage.addEventListener("click", (e) => {
    e.stopPropagation()
    showImageModal(imageUrl, product.nombre)
  })

  // [NUEVO] Lógica de Favoritos
  const favBtn = card.querySelector('.favorite-btn');
  if (isFavorite(product.id)) {
      favBtn.classList.add('active');
  }
  favBtn.addEventListener('click', (e) => {
      toggleFavorite(product.id, e.currentTarget);
  });
  // DEBUG: confirmar que los productos que se renderizan traen 'codigo' y 'descripcion'
  try {
    console.debug(`[RENDER] product id=${product.id} codigo=${product.codigo || ''} nombre=${product.nombre || ''} descripcion=${product.descripcion || ''}`)
  } catch (err) {
    /* noop */
  }

  // Event listener solo si existe el botón de carrito (no es inventario)
  const addToCartBtn = card.querySelector(".add-to-cart-btn");
  if (addToCartBtn) {
      addToCartBtn.addEventListener("click", () => {
        if (product.stock === 0) {
          alert("Este producto está agotado y no se puede agregar al carrito.");
          return;
        }
        openQuantityModal(product)
      })
  }

  return card
}

// [NUEVO] Funciones globales para acciones de inventario
window.assignProductDeposit = async function(productId, productCode, deposito) {
    try {
        // Actualización Optimista
        const pCode = productCode.trim().toUpperCase();
        let itemData = inventoryDataMap.get(pCode);
        
        if (!itemData) {
            // Si no existe en inventory_products, creamos estructura base
            itemData = { codigo: pCode, deposito: deposito };
        } else {
            itemData.deposito = deposito;
        }
        inventoryDataMap.set(pCode, itemData);

        // [MODIFICADO] NO llamar a filterByDepartment para evitar reinicio de scroll
        // filterByDepartment(currentDepartment);
        
        // Buscamos la tarjeta en el DOM
        const productCard = document.querySelector(`.product-card[data-product-code="${pCode}"]`);
        
        if (productCard) {
            // Verificamos si el producto aún coincide con el filtro actual
            let matches = true;
            if (currentDepartment.startsWith('inv_')) {
                const targetDeposit = currentDepartment.replace('inv_', '');
                if (targetDeposit === 'unassigned') {
                    matches = !deposito;
                } else {
                    matches = deposito === targetDeposit;
                }
            }
            
            if (!matches) {
                // Si ya no coincide, lo removemos con una animación suave
                productCard.style.transition = 'all 0.4s ease';
                productCard.style.opacity = '0';
                productCard.style.transform = 'scale(0.8)';
                
                setTimeout(() => {
                    productCard.remove();
                    // También actualizar filteredProducts en memoria para consistencia
                    const idx = filteredProducts.findIndex(p => (p.codigo || '').trim().toUpperCase() === pCode);
                    if (idx > -1) filteredProducts.splice(idx, 1);
                    
                    // Si no quedan productos en el grid por el filtrado, mostrar el mensaje de "no hay productos"
                    const grid = document.getElementById("products-grid");
                    if (grid && grid.children.length === 0) {
                        document.getElementById("no-products")?.classList.remove("hidden");
                    }
                }, 400);
            } else {
                // Si aún coincide (ej: rol admin editando), actualizamos el contenido in-place
                // Pero en el rol inventario, normalmente desaparecerá porque el botón de su depósito actual está disabled
                // y los demás lo mueven a otra vista.
                console.log(`[INVENTARIO] Producto ${pCode} actualizado in-place.`);
            }
        }

        // Guardar en BD
        const { error } = await window.supabaseClient
            .from('inventory_products')
            .update({ deposito: deposito })
            .eq('codigo', pCode); // Usar código es más seguro para sync

        if (error) throw error;
        console.log(`✅ Producto ${pCode} asignado a ${deposito}`);

    } catch (error) {
        console.error("Error asignando depósito:", error);
        alert("Error al asignar depósito. Recarga la página.");
    }
};

window.updateInventoryQuantity = async function(productCode, inputElement) {
    const val = parseInt(inputElement.value) || 0;
    const pCode = productCode.trim().toUpperCase();
    
    // Feedback visual
    inputElement.classList.add('bg-green-50', 'border-green-500', 'text-green-700');
    
    // Actualizar mapa local
    const itemData = inventoryDataMap.get(pCode);
    if (itemData) itemData.cantidad_fisica = val;

    // Guardar en BD
    await window.supabaseClient
        .from('inventory_products')
        .update({ cantidad_fisica: val })
        .eq('codigo', pCode);
        
    setTimeout(() => {
        inputElement.classList.remove('bg-green-50', 'border-green-500', 'text-green-700');
        // Re-aplicar estilos base según estado
        if (!inventoryEditMode && val > 0) {
            inputElement.disabled = true;
            inputElement.classList.add('bg-gray-100', 'text-gray-400', 'cursor-not-allowed');
            inputElement.classList.remove('bg-white', 'text-blue-600');
        } else {
            inputElement.classList.add('bg-white', 'text-blue-600');
        }
    }, 500);
};

function getPriceForRole(product) {
  const userRole = currentUserRole || window.currentUserRole || 'cliente'
  console.log(`[PRICE-ROLE] Mostrando precios para rol: ${userRole}, producto: ${product.nombre}`)
  
  switch (userRole) {
  case "admin":
  return {
  display: "triple",
  priceCliente: product.precio_cliente || 0,
  priceMayor: product.precio_mayor || 0,
  priceGmayor: product.precio_gmayor || 0,
  labelCliente: "Detal",
  labelMayor: "Mayor",
  labelGmayor: "G.Mayor",
  }
  case "gestor":
  return {
  display: "triple",
  priceCliente: product.precio_cliente || 0,
  priceMayor: product.precio_mayor || 0,
  priceGmayor: product.precio_gmayor || 0,
  labelCliente: "Detal",
  labelMayor: "Mayor",
  labelGmayor: "G.Mayor",
  }
  case "distribuidor":
  return {
  display: "single",
  price: product.precio_mayor || 0,
  label: "Mayor",
  }
  case "cliente":
  default:
  return {
  display: "single",
  price: product.precio_cliente || 0,
  label: "Detal",
  }
  }
  }

// [NUEVO] Funciones para sistema de favoritos
function isFavorite(productId) {
    return favorites.includes(productId);
}

async function toggleFavorite(productId, buttonElement) {
    if (!currentUser) return;

    const index = favorites.indexOf(productId);
    const isAdding = index === -1;

    // Actualización Optimista (UI primero)
    if (index > -1) {
        favorites.splice(index, 1); // Quitar de favoritos
        buttonElement.classList.remove('active');
    } else {
        favorites.push(productId); // Agregar a favoritos
        buttonElement.classList.add('active');
    }
    
    // Sincronizar con Supabase
    try {
        if (isAdding) {
            await window.supabaseClient.from('favorites').insert({ user_id: currentUser.auth_id, product_id: productId });
            console.log(`[FAVORITES] ❤️ Guardado en nube.`);
        } else {
            await window.supabaseClient.from('favorites').delete().eq('user_id', currentUser.auth_id).eq('product_id', productId);
            console.log(`[FAVORITES] 💔 Eliminado de nube.`);
        }
    } catch (error) {
        console.error("[FAVORITES] Error sincronizando:", error);
    }

    saveFavoritesLocalBackup(); // Backup local por si acaso
    if (currentDepartment === 'favorites') filterByDepartment('favorites'); // Re-renderizar si estamos en la vista de favoritos
}

// [NUEVO] Guardar carrito en Supabase
async function saveCartToSupabase() {
  if (!currentUser) return;

  console.log(`[CARRITO-NUBE] ☁️ Guardando carrito en Supabase para ${currentUser.username}...`);
  try {
    const { error } = await window.supabaseClient
      .from('user_carts')
      .upsert({
        user_id: currentUser.auth_id,
        cart_data: cart,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id' // Asume que user_id es UNIQUE o PK
      });

    if (error) {
      console.error('[CARRITO-NUBE] ❌ Error guardando carrito en la nube:', error);
    } else {
      console.log(`[CARRITO-NUBE] ✅ Carrito guardado en la nube con ${cart.length} items.`);
    }
  } catch (error) {
    console.error('[CARRITO-NUBE] ❌ Error inesperado al guardar en la nube:', error);
  }
}

// [NUEVO] Cargar carrito desde Supabase
async function loadCartFromSupabase() {
  if (!currentUser) return;

  console.log(`[CARRITO-NUBE] ☁️ Cargando carrito desde Supabase para ${currentUser.username}...`);
  try {
    const { data, error } = await window.supabaseClient
      .from('user_carts')
      .select('cart_data')
      .eq('user_id', currentUser.auth_id)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows found, no es un error
      console.error('[CARRITO-NUBE] ❌ Error cargando carrito desde la nube:', error);
      cart = []
    } else if (data && data.cart_data) {
      cart = data.cart_data;
      console.log(`[CARRITO-NUBE] ✅ Carrito cargado desde la nube: ${cart.length} items.`);
    } else {
      cart = [];
      console.log('[CARRITO-NUBE] ⓘ No se encontró carrito en la nube, iniciando uno nuevo.');
    }
  } catch (error) {
    console.error('[CARRITO-NUBE] ❌ Error inesperado al cargar desde la nube:', error);
    cart = [];
  }
  updateCartCount();
}

async function clearCart() {
  cart = []
  updateCartCount()
  renderCart()
  console.log("🗑️ Carrito limpiado, actualizando la nube...")

  if (currentUser) {
    await saveCartToSupabase();
  }
}

function openQuantityModal(product) {
  if (product.stock === 0) {
    alert("Este producto está agotado y no se puede agregar al carrito.");
    return;
  }

  selectedProductForQuantity = product
  const modal = document.getElementById("quantity-modal")
  const productInfo = document.getElementById("quantity-product-info")
  const quantityInput = document.getElementById("quantity-input")
  const observationInput = document.getElementById("observation-input")

  const priceInfo = getPriceForRole(product)

  let priceHTML = ""
  if (priceInfo.display === "single") {
    priceHTML = `<p class="text-green-600 font-black text-xl">$${priceInfo.price.toFixed(2)}</p>`
  } else if (priceInfo.display === "dual") {
    priceHTML = `
      <div class="space-y-2 mb-4">
        <label class="flex items-center justify-between p-3 border-2 border-gray-200 rounded-lg cursor-pointer hover:border-red-500 transition-all">
          <div>
            <span class="font-semibold text-gray-700">Precio Detal</span>
            <span class="text-red-600 font-black text-lg ml-3">$${priceInfo.priceCliente.toFixed(2)}</span>
          </div>
          <input type="radio" name="price-option" value="cliente" checked class="w-5 h-5">
        </label>
        <label class="flex items-center justify-between p-3 border-2 border-gray-200 rounded-lg cursor-pointer hover:border-green-500 transition-all">
          <div>
            <span class="font-semibold text-gray-700">Precio Mayor</span>
            <span class="text-green-600 font-black text-lg ml-3">$${priceInfo.priceMayor.toFixed(2)}</span>
          </div>
          <input type="radio" name="price-option" value="mayor" class="w-5 h-5">
        </label>
      </div>
    `
  } else if (priceInfo.display === "triple") {
    priceHTML = `
      <div class="space-y-2 mb-4">
        <label class="flex items-center justify-between p-3 border-2 border-gray-200 rounded-lg cursor-pointer hover:border-red-500 transition-all">
          <div>
            <span class="font-semibold text-gray-700">Precio Detal</span>
            <span class="text-red-600 font-black text-lg ml-3">$${priceInfo.priceCliente.toFixed(2)}</span>
          </div>
          <input type="radio" name="price-option" value="cliente" checked class="w-5 h-5">
        </label>
        <label class="flex items-center justify-between p-3 border-2 border-gray-200 rounded-lg cursor-pointer hover:border-green-500 transition-all">
          <div>
            <span class="font-semibold text-gray-700">Precio Mayor</span>
            <span class="text-green-600 font-black text-lg ml-3">$${priceInfo.priceMayor.toFixed(2)}</span>
          </div>
          <input type="radio" name="price-option" value="mayor" class="w-5 h-5">
        </label>
        <label class="flex items-center justify-between p-3 border-2 border-gray-200 rounded-lg cursor-pointer hover:border-blue-500 transition-all">
          <div>
            <span class="font-semibold text-gray-700">Precio G.Mayor</span>
            <span class="text-blue-600 font-black text-lg ml-3">$${priceInfo.priceGmayor.toFixed(2)}</span>
          </div>
          <input type="radio" name="price-option" value="gmayor" class="w-5 h-5">
        </label>
      </div>
    `
  }

  productInfo.innerHTML = `
    <h3 class="font-bold text-lg text-gray-800 mb-2">${product.nombre}</h3>
    <p class="text-gray-600 text-sm mb-3">${product.descripcion || ""}</p>
    ${priceHTML}
  `

  quantityInput.value = 1
  observationInput.value = ""
  modal.classList.remove("hidden")
  quantityInput.focus()
}

async function confirmQuantity() {
  const quantity = Number.parseInt(document.getElementById("quantity-input").value)
  const observation = document.getElementById("observation-input").value.trim()

  if (quantity < 1) {
    alert("La cantidad debe ser al menos 1")
    return
  }

  if (selectedProductForQuantity.stock === 0) {
    alert("Este producto está agotado y no se puede agregar al carrito.");
    return;
  }

  if (quantity > selectedProductForQuantity.stock) {
    alert(`Cantidad no disponible. Stock máximo: ${selectedProductForQuantity.stock}`)
    return
  }

  const priceInfo = getPriceForRole(selectedProductForQuantity)
  let selectedPrice

  if (priceInfo.display === "dual" || priceInfo.display === "triple") {
    const priceOption = document.querySelector('input[name="price-option"]:checked')?.value
    if (priceOption === "mayor") {
      selectedPrice = priceInfo.priceMayor
    } else if (priceOption === "gmayor") {
      selectedPrice = priceInfo.priceGmayor
    } else {
      selectedPrice = priceInfo.priceCliente
    }
  } else {
    selectedPrice = priceInfo.price
  }

  await addToCart(selectedProductForQuantity, quantity, selectedPrice, observation)
  document.getElementById("quantity-modal").classList.add("hidden")
}

async function addToCart(product, quantity, price, observation = "") {
  const existingItemIndex = cart.findIndex(
    (item) => item.id === product.id && item.price === price && item.observation === observation,
  )

  if (existingItemIndex !== -1) {
    cart[existingItemIndex].quantity += quantity
  } else {
    cart.push({
      ...product,
      quantity: quantity,
      price: price,
      observation: observation,
    })
  }

  // Registrar venta para estadísticas con el precio
  await recordSaleToDatabase(product.id, quantity, price)

  await saveCartToSupabase()
  updateCartCount()
  animateCartButton()

  console.log(
    `✅ Agregado al carrito: ${product.nombre} x${quantity} a $${price.toFixed(2)}${observation ? ` (${observation})` : ""}`,
  )
}

function updateCartCount() {
  const count = cart.reduce((sum, item) => sum + item.quantity, 0)
  document.getElementById("cart-count").textContent = count
}

function animateCartButton() {
  const cartBtn = document.getElementById("cart-button")
  cartBtn.classList.add("cart-pulse")
  setTimeout(() => cartBtn.classList.remove("cart-pulse"), 300)
}

function renderCart() {
  console.log("Renderizando carrito con", cart.length, "items")

  const cartItems = document.getElementById("cart-items")
  const cartTotal = document.getElementById("cart-total")

  if (!cartItems || !cartTotal) {
    console.error("Error: elementos del carrito no encontrados")
    return
  }

  if (cart.length === 0) {
    cartItems.innerHTML = `
      <div class="text-center py-12">
        <svg class="w-24 h-24 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"></path>
        </svg>
        <p class="text-gray-500 text-lg font-medium">Tu carrito está vacío</p>
      </div>
    `
    cartTotal.textContent = "$0.00"
    return
  }

  cartItems.innerHTML = ""

  let totalDetal = 0
  let totalMayor = 0
  let totalGmayor = 0

  cart.forEach((item, index) => {
    const cartItemDiv = document.createElement("div")
    cartItemDiv.className = "cart-item"

    const product = allProducts.find((p) => p.id === item.id)
    if (product) {
      totalDetal += (product.precio_cliente || 0) * item.quantity
      totalMayor += (product.precio_mayor || 0) * item.quantity
      totalGmayor += (product.precio_gmayor || 0) * item.quantity
    }

    const optimizedCartImage = optimizeImageUrl(item.imagen_url || "/images/ProductImages.jpg")

    cartItemDiv.innerHTML = `
      <div class="flex items-center space-x-4">
        <img src="${optimizedCartImage}"
             alt="${item.nombre}"
             class="w-20 h-20 object-cover rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
             loading="lazy"
             onerror="this.src='/images/ProductImages.jpg'">
        <div class="flex-1">
          <h4 class="font-bold text-gray-800">${item.nombre}</h4>
          <p class="text-gray-600 text-sm">Cantidad: ${item.quantity}</p>
          ${item.observation ? `<p class="text-blue-600 text-sm font-medium mt-1">📝 ${item.observation}</p>` : ""}
        </div>
      </div>
      <div class="flex items-center justify-between mt-4">
        <div class="flex items-center space-x-3">
          <button class="quantity-button cart-decrease-btn">-</button>
          <span class="text-xl font-bold text-gray-800 min-w-[40px] text-center">${item.quantity}</span>
          <button class="quantity-button cart-increase-btn">+</button>
        </div>
        <button class="text-red-600 hover:text-red-700 font-semibold cart-remove-btn">
          Eliminar
        </button>
      </div>
    `

    const cartImage = cartItemDiv.querySelector("img")
    cartImage.addEventListener("click", (e) => {
      e.stopPropagation()
      showImageModal(item.imagen_url || "/images/ProductImages.jpg", item.nombre)
    })

    cartItemDiv.querySelector(".cart-decrease-btn").addEventListener("click", async () => {
      console.log("Disminuyendo cantidad del item", index)
      await updateCartItemQuantityByIndex(index, -1)
    })

    cartItemDiv.querySelector(".cart-increase-btn").addEventListener("click", async () => {
      console.log("Aumentando cantidad del item", index)
      await updateCartItemQuantityByIndex(index, 1)
    })

    cartItemDiv.querySelector(".cart-remove-btn").addEventListener("click", async () => {
      console.log("Eliminando item", index)
      await removeFromCartByIndex(index)
    })

    cartItems.appendChild(cartItemDiv)
  })

  let totalHTML = ""

  if (window.currentUserRole === "gestor") {
    totalHTML = `
      <div class="space-y-2">
        <div class="flex justify-between items-center">
          <span class="text-sm font-semibold text-gray-600">Total Detal:</span>
          <span class="text-lg font-black text-red-600">$${totalDetal.toFixed(2)}</span>
        </div>
        <div class="flex justify-between items-center">
          <span class="text-sm font-semibold text-gray-600">Total Mayor:</span>
          <span class="text-lg font-black text-green-600">$${totalMayor.toFixed(2)}</span>
        </div>
        <div class="flex justify-between items-center">
          <span class="text-sm font-semibold text-gray-600">Total G.Mayor:</span>
          <span class="text-lg font-black text-blue-600">$${totalGmayor.toFixed(2)}</span>
        </div>
      </div>
    `
    cartTotal.innerHTML = totalHTML
  } else if (window.currentUserRole === "distribuidor") {
    totalHTML = `$${totalMayor.toFixed(2)}`
    cartTotal.textContent = totalHTML
  } else if (window.currentUserRole === "admin") {
    totalHTML = `$${totalGmayor.toFixed(2)}`
    cartTotal.textContent = totalHTML
  } else {
    totalHTML = `$${totalDetal.toFixed(2)}`
    cartTotal.textContent = totalHTML
  }

  console.log("Carrito renderizado exitosamente")
}

async function updateCartItemQuantityByIndex(index, change) {
  if (index < 0 || index >= cart.length) return

  cart[index].quantity += change

  if (cart[index].quantity <= 0) {
    await removeFromCartByIndex(index)
  } else {
    await saveCartToSupabase()
    updateCartCount()
    renderCart()
  }
}

async function removeFromCartByIndex(index) {
  if (index < 0 || index >= cart.length) return

  cart.splice(index, 1)
  await saveCartToSupabase()
  updateCartCount()
  renderCart()
}

function showOrderDetailsModal() {
  if (cart.length === 0) {
    alert("El carrito está vacío")
    return
  }

  let orderModal = document.getElementById("order-details-modal")
  if (!orderModal) {
    orderModal = document.createElement("div")
    orderModal.id = "order-details-modal"
    orderModal.className = "fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 hidden"
    orderModal.innerHTML = `
      <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div class="p-6">
          <div class="flex items-center justify-between mb-6">
            <h2 class="text-2xl font-bold text-gray-800">Detalles del Pedido</h2>
            <button id="close-order-details-modal" class="text-gray-400 hover:text-gray-600 text-2xl font-bold">×</button>
          </div>
          
          <div class="space-y-4">
            <div>
              <label for="order-responsables" class="block text-sm font-semibold text-gray-700 mb-2">Responsables:</label>
              <input type="text" id="order-responsables" class="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-transparent" placeholder="Ingrese los responsables">
            </div>
            
            <div>
              <label for="order-sitio" class="block text-sm font-semibold text-gray-700 mb-2">Sitio:</label>
              <input type="text" id="order-sitio" class="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-transparent" placeholder="Ingrese el sitio" required>
            </div>
          </div>
          
          <div id="order-details-error" class="hidden mt-4 p-4 bg-red-100 border border-red-300 text-red-700 rounded-xl text-sm font-medium"></div>
          
          <div class="flex space-x-3 mt-6">
            <button id="cancel-order-details" class="flex-1 bg-gray-200 text-gray-800 font-bold py-3 rounded-xl hover:bg-gray-300 transition-all">
              Cancelar
            </button>
            <button id="confirm-order-details" class="flex-1 bg-gradient-to-r from-red-600 to-red-700 text-white font-bold py-3 rounded-xl hover:from-red-700 hover:to-red-800 transition-all">
              Enviar Pedido
            </button>
          </div>
        </div>
      </div>
    `
    document.body.appendChild(orderModal)

    document.getElementById("close-order-details-modal").addEventListener("click", () => {
      orderModal.classList.add("hidden")
    })

    document.getElementById("cancel-order-details").addEventListener("click", () => {
      orderModal.classList.add("hidden")
    })

    document.getElementById("confirm-order-details").addEventListener("click", confirmOrderDetails)

    orderModal.addEventListener("click", (e) => {
      if (e.target === orderModal) {
        orderModal.classList.add("hidden")
      }
    })
  }

  document.getElementById("order-responsables").value = ""
  document.getElementById("order-sitio").value = ""
  document.getElementById("order-details-error").classList.add("hidden")
  orderModal.classList.remove("hidden")
  document.getElementById("order-responsables").focus()
}

async function confirmOrderDetails() {
  const orderModal = document.getElementById("order-details-modal")
  if (orderModal) {
    orderModal.classList.add("hidden")
  }

  const responsables = document.getElementById("order-responsables").value.trim()
  const sitio = document.getElementById("order-sitio").value.trim()
  const errorDiv = document.getElementById("order-details-error")

  if (!sitio) {
    errorDiv.textContent = "El campo 'Sitio' es obligatorio"
    errorDiv.classList.remove("hidden")
    return
  }

  errorDiv.classList.add("hidden")

  await generateExcelAndSendOrder(responsables, sitio)
}

async function generateExcelAndSendOrder(responsables, sitio) {
  console.log("Generando Excel y enviando pedido para admin...")

  try {
    const wb = window.XLSX.utils.book_new()

    const excelData = []

    excelData.push(["PEDIDO SONIMAX MÓVIL"])
    excelData.push([])
    excelData.push(["Cliente:", currentUser.name])
    if (responsables) {
      excelData.push(["Responsables:", responsables])
    }
    excelData.push(["Sitio:", sitio])
    excelData.push(["Fecha:", new Date().toLocaleDateString()])
    excelData.push([])

    excelData.push(["CANTIDAD", "CÓDIGO", "DESCRIPCIÓN", "PRECIO UNITARIO", "SUBTOTAL", "OBSERVACIÓN"])

    let totalGmayor = 0

    cart.forEach((item) => {
      const product = allProducts.find((p) => p.id === item.id)
      const codigo = product ? product.codigo || "S/C" : "S/C"
      const precioUnitario = product ? product.precio_gmayor || 0 : 0
      const subtotal = precioUnitario * item.quantity

      totalGmayor += subtotal

      excelData.push([
        item.quantity,
        codigo,
        item.nombre,
        `$${precioUnitario.toFixed(2)}`,
        `$${subtotal.toFixed(2)}`,
        item.observation || "",
      ])

      recordSaleToDatabase(item.id, item.quantity, precioUnitario)
    })

    excelData.push([])
    excelData.push(["", "", "", "", "TOTAL:", `$${totalGmayor.toFixed(2)}`])

    const ws = window.XLSX.utils.aoa_to_sheet(excelData)

    const colWidths = [{ wch: 10 }, { wch: 15 }, { wch: 40 }, { wch: 15 }, { wch: 15 }, { wch: 30 }]
    ws["!cols"] = colWidths

    window.XLSX.utils.book_append_sheet(wb, ws, "Pedido")

    const fileName = `${sitio.replace(/[^a-zA-Z0-9]/g, "_")}_${new Date().toISOString().split("T")[0]}.xlsx`

    window.XLSX.writeFile(wb, fileName)

    console.log(`✅ Excel generado: ${fileName}`)

    let message = `*PEDIDO SONIMAX MÓVIL*\n\n`
    message += `*Cliente:* ${currentUser.name}\n`
    if (responsables) {
      message += `*Responsables:* ${responsables}\n`
    }
    message += `*Sitio:* ${sitio}\n\n`
    message += `*PRODUCTOS:*\n`

    cart.forEach((item, index) => {
      const product = allProducts.find((p) => p.id === item.id)
    const codigo = product ? product.codigo || "S/C" : "S/C"
      const precioUnitario = product ? product.precio_gmayor || 0 : 0
      const subtotal = precioUnitario * item.quantity

      message += `${item.quantity} - *${codigo}* - ${item.nombre} - $${subtotal.toFixed(2)}`
      if (item.observation) {
        message += `\n   📝 _${item.observation}_`
      }
      message += `\n`

      if (index < cart.length - 1) {
        message += `\n`
      }
    })

    message += `\n\n*TOTAL G.MAYOR:* $${totalGmayor.toFixed(2)}`
    message += `\n\n📊 *Archivo Excel adjunto con detalles completos*`

    console.log("Mensaje generado:", message)

    const encodedMessage = encodeURIComponent(message)
    const whatsappURL = `https://api.whatsapp.com/send?text=${encodedMessage}`

    console.log("Abriendo WhatsApp...")
    window.open(whatsappURL, "_blank")

    await clearCart()

    document.getElementById("cart-modal").classList.add("hidden")

    alert(`Pedido enviado por WhatsApp y Excel descargado como: ${fileName}\nEl carrito ha sido limpiado.`)
  } catch (error) {
    console.error("❌ Error al generar Excel:", error)
    alert("Error al generar el archivo Excel. Se enviará solo el mensaje de WhatsApp.")

    await sendWhatsAppOrderFallback(responsables, sitio)
  }
}

async function sendWhatsAppOrderFallback(responsables, sitio) {
  let message = `*PEDIDO SONIMAX MÓVIL*\n\n`
  message += `*Cliente:* ${currentUser.name}\n`
  if (responsables) {
    message += `*Responsables:* ${responsables}\n`
  }
  message += `*Sitio:* ${sitio}\n\n`
  message += `*PRODUCTOS:*\n`

  const totalGmayor = 0

  cart.forEach((item, index) => {
    const product = allProducts.find((p) => p.id === item.id)
    const codigo = product ? product.codigo || "S/C" : "S/C"
    const precioUnitario = product ? product.precio_gmayor || 0 : 0
    const subtotal = precioUnitario * item.quantity

    message += `${item.quantity} - *${codigo}* - ${item.nombre} - $${subtotal.toFixed(2)}`
    if (item.observation) {
      message += `\n   📝 _${item.observation}_`
    }
    message += `\n`

    if (index < cart.length - 1) {
      message += `\n`
    }

    recordSaleToDatabase(item.id, item.quantity, precioUnitario)
  })

  message += `\n\n*TOTAL G.MAYOR:* $${totalGmayor.toFixed(2)}`

  const encodedMessage = encodeURIComponent(message)
  const whatsappURL = `https://api.whatsapp.com/send?text=${encodedMessage}`

  window.open(whatsappURL, "_blank")

  const onFocus = async () => {
    window.removeEventListener("focus", onFocus)
    if (confirm("Pedido enviado, ¿Desea vaciar el carrito?")) {
      await clearCart()
      document.getElementById("cart-modal").classList.add("hidden")
    }
  }
  setTimeout(() => window.addEventListener("focus", onFocus), 500)
}

async function sendWhatsAppOrder() {
  console.log("Enviando pedido por WhatsApp...")

  if (cart.length === 0) {
    alert("El carrito está vacío")
    return
  }

  let message = `*PEDIDO SONIMAX MÓVIL*\n\n`
  message += `*Cliente:* ${currentUser.name}\n\n`
  message += `*PRODUCTOS:*\n`

  let totalDetal = 0
  let totalMayor = 0
  let totalGmayor = 0

  cart.forEach((item, index) => {
    const product = allProducts.find((p) => p.id === item.id)
    const codigo = product ? product.codigo || "S/C" : "S/C"
    const subtotal = item.price * item.quantity

    message += `${item.quantity} - *${codigo}* - ${item.nombre} - $${subtotal.toFixed(2)}`
    if (item.observation) {
      message += `\n   📝 _${item.observation}_`
    }
    message += `\n`

    if (index < cart.length - 1) {
      message += `\n`
    }

    if (product) {
      totalDetal += (product.precio_cliente || 0) * item.quantity
      totalMayor += (product.precio_mayor || 0) * item.quantity
      totalGmayor += (product.precio_gmayor || 0) * item.quantity
    }

    const salePrice =
      currentUserRole === "gestor"
        ? item.price
        : currentUserRole === "distribuidor"
          ? product?.precio_mayor || 0
          : product?.precio_gmayor || 0
    recordSaleToDatabase(item.id, item.quantity, salePrice)
  })

  message += `\n\n*TOTALES:*\n`

  if (window.currentUserRole === "gestor") {
    message += `Total Detal: $${totalDetal.toFixed(2)}\n`
    message += `Total Mayor: $${totalMayor.toFixed(2)}\n`
    message += `Total G.Mayor: $${totalGmayor.toFixed(2)}`
  } else if (window.currentUserRole === "distribuidor") {
    message += `Total Mayor: $${totalMayor.toFixed(2)}`
  } else {
    message += `Total Detal: $${totalDetal.toFixed(2)}`
  }

  console.log("Mensaje generado:", message)

  const encodedMessage = encodeURIComponent(message)
  const whatsappURL = `https://api.whatsapp.com/send?text=${encodedMessage}`

  console.log("Abriendo WhatsApp...")
  window.open(whatsappURL, "_blank")

  const onFocus = async () => {
    window.removeEventListener("focus", onFocus)
    if (confirm("Pedido enviado, ¿Desea vaciar el carrito?")) {
      await clearCart()
      document.getElementById("cart-modal").classList.add("hidden")
    }
  }
  setTimeout(() => window.addEventListener("focus", onFocus), 500)
}

function normalizeText(text) {
  if (!text) return ""
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
}

function getSearchWords(query) {
  return query
    .split(/\s+/)
    .map((word) => normalizeText(word))
    .filter((word) => word.length > 0)
}

let searchTimeout // Declare searchTimeout
let deptSearchTimeout // Declare deptSearchTimeout

function handleGlobalSearch(e) {
  const query = e.target.value.trim()

  clearTimeout(searchTimeout)

  const searchLoading = document.getElementById("search-loading")
  
  if (query === "") {
    filteredProducts = allProducts
    currentPage = 1
    renderProducts()
    if (searchLoading) searchLoading.classList.add("hidden")
    resumeBackgroundDownloads()
    return
  }

  if (searchLoading) searchLoading.classList.remove("hidden")

  searchTimeout = setTimeout(() => {
    console.log("[SEARCH] Búsqueda global:", query)
    
    // [MODIFICADO] Usar Fuse.js para búsqueda difusa
    if (!fuse) {
        console.warn("[FUSE] Fuse.js no está inicializado.");
        filteredProducts = [];
    } else {
        // [NUEVO] Formatear query para búsqueda extendida (multi-palabra)
        const formattedQuery = query.split(' ').filter(term => term.length > 0).map(term => `'${term}`).join(' ');
        filteredProducts = fuse.search(formattedQuery).map(result => result.item);
    }

    // [NUEVO] Filtrar agotados para rol inventario en búsqueda global
    if (window.currentUserRole === 'inventario') {
        filteredProducts = filteredProducts.filter(p => (p.stock || 0) > 0);
    }

    console.log(`[SEARCH] Resultados: ${filteredProducts.length} de ${allProducts.length} productos`)

    const searchResultUrls = filteredProducts
      .slice(0, 20)
      .map((p) => optimizeImageUrl(p.imagen_url))
      .filter((url) => url && url !== "/images/ProductImages.jpg")

    console.log(`[SEARCH] 🔍 Priorizando ${searchResultUrls.length} imágenes de búsqueda`)
    loadPriorityImages(searchResultUrls)

    currentPage = 1
    renderProducts()
    if (searchLoading) searchLoading.classList.add("hidden")
  }, 300)
}

function handleDeptSearch(e) {
  const query = e.target.value.trim()

  clearTimeout(deptSearchTimeout)

  if (query === "") {
    filterByDepartment(currentDepartment)
    return
  }

  deptSearchTimeout = setTimeout(() => {
    console.log("[SEARCH] Búsqueda en departamento:", currentDepartment, "Query:", query)

    let productsInDept
    if (currentDepartment === "all") {
      productsInDept = allProducts
    } else if (currentDepartment === "new") {
      productsInDept = allProducts.filter((p) => p.is_new)
    } else if (currentDepartment === "bestselling") {
      // Aquí se podría considerar re-ejecutar getBestSellingProducts si la lista se actualiza dinámicamente
      // o usar una versión cacheada si es apropiado. Por ahora, asumimos que filteredProducts ya contiene los más vendidos si ese es el departamento.
      productsInDept = filteredProducts // Usar los ya filtrados si 'bestselling' ya ha sido llamado
    } else {
      productsInDept = allProducts.filter((p) => p.departamento === currentDepartment)
    }

    // [MODIFICADO] Usar Fuse.js para búsqueda difusa en departamento
    const deptFuse = new Fuse(productsInDept, {
        keys: ['nombre', 'codigo', 'descripcion'],
        threshold: 0.4,
        ignoreLocation: true,
        useExtendedSearch: true,
    });
    const formattedQuery = query.split(' ').filter(term => term.length > 0).map(term => `'${term}`).join(' ');
    filteredProducts = deptFuse.search(formattedQuery).map(result => result.item);

    // [NUEVO] Filtrar agotados para rol inventario en búsqueda por departamento
    if (window.currentUserRole === 'inventario') {
        filteredProducts = filteredProducts.filter(p => (p.stock || 0) > 0);
    }

    console.log(`[SEARCH] Resultados en ${currentDepartment}: ${filteredProducts.length} productos`)

    currentPage = 1
    renderProducts()
  }, 300)
}

let selectedCSVFile = null

function handleCSVFileSelect(e) {
  selectedCSVFile = e.target.files[0]
  if (selectedCSVFile) {
    document.getElementById("csv-file-name").textContent = `Archivo seleccionado: ${selectedCSVFile.name}`
    document.getElementById("csv-file-name").classList.remove("hidden")
  }
}

// FUNCIÓN CORREGIDA PARA MANEJAR LA SUBIDA DE CSV
async function handleCSVUpload() {
  if (!selectedCSVFile) {
    showCSVStatus("Por favor selecciona un archivo CSV", "error")
    return
  }

  if (window.currentUserRole !== "admin") {
    showCSVStatus("Solo los administradores pueden subir productos", "error")
    return
  }

  const reader = new FileReader()

  reader.onload = async (e) => {
    try {
      const text = e.target.result
      const lines = text.split("\n").filter((line) => line.trim())

      if (lines.length < 2) {
        throw new Error("El archivo CSV está vacío o no tiene datos")
      }

      const headers = lines[0].split(",").map((h) => h.trim().toUpperCase())

      const colIndexes = {
        descripcion: headers.indexOf("DESCRIPCION"),
        codigo: headers.indexOf("CODIGO"),
        detal: headers.indexOf("DETAL"),
        mayor: headers.indexOf("MAYOR"),
        gmayor: headers.indexOf("GMAYOR"),
        url: headers.indexOf("URL"),
        departamento: headers.indexOf("DEPARTAMENTO"),
        stock: headers.indexOf("STOCK"),
      }

      if (
        colIndexes.descripcion === -1 ||
        colIndexes.detal === -1 ||
        colIndexes.mayor === -1 ||
        colIndexes.gmayor === -1
      ) {
        throw new Error("El CSV debe contener las columnas: DESCRIPCION, DETAL, MAYOR, GMAYOR")
      }

      const previousSnapshot = await getPreviousCSVSnapshot()
      console.log(`[CSV-COMPARISON] Productos en snapshot anterior: ${previousSnapshot.length}`)

      const products = []

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue

        const values = parseCSVLine(line)

        if (values.length < headers.length) continue

        const descripcion = values[colIndexes.descripcion]?.trim() || ""
        const codigo = colIndexes.codigo !== -1 ? values[colIndexes.codigo]?.trim() || "" : ""
        const detal = values[colIndexes.detal]?.trim() || "0"
        const mayor = values[colIndexes.mayor]?.trim() || "0"
        const gmayor = values[colIndexes.gmayor]?.trim() || "0"
        const url = colIndexes.url !== -1 ? values[colIndexes.url]?.trim() || null : null
        const departamento =
          colIndexes.departamento !== -1 ? values[colIndexes.departamento]?.trim() || "Sin categoría" : "Sin categoría"
        const stock = colIndexes.stock !== -1 ? values[colIndexes.stock]?.trim() || "0" : "0"

        if (!descripcion) continue

        const precioCliente = Number.parseFloat(detal) || 0
        const precioMayor = Number.parseFloat(mayor) || 0
        const precioGmayor = Number.parseFloat(gmayor) || 0
        const stockValue = Number.parseInt(stock) || 0

        // Validar que al menos un precio no sea 0
        if (precioCliente === 0 && precioMayor === 0 && precioGmayor === 0) {
          console.log(`[CSV] ⚠️ Fila ignorada - todos los precios son 0: ${descripcion}`)
          continue
        }

        const product = {
          codigo: codigo || "",
          nombre: descripcion,
          descripcion: codigo || "",
          precio_cliente: precioCliente,
          precio_mayor: precioMayor,
          precio_gmayor: precioGmayor,
          departamento: departamento,
          imagen_url: url,
          is_new: false, // Inicialmente todos son false
          stock: stockValue
        }

        products.push(product)
      }

      if (products.length === 0) {
        throw new Error("No se encontraron productos válidos en el CSV")
      }

      showCSVStatus(`Procesando ${products.length} productos (Sincronizando)...`, "info")

      // OBTENER PRODUCTOS EXISTENTES PARA SINCRONIZACIÓN
      const { data: existingProducts, error: fetchError } = await window.supabaseClient
        .from("products")
        .select("id, codigo, nombre")
      
      if (fetchError) throw new Error("Error al obtener productos existentes: " + fetchError.message)

      const existingMap = new Map()
      existingProducts.forEach(p => {
          const key = (p.codigo || p.nombre).toLowerCase().trim()
          existingMap.set(key, p.id)
      })

      const processedIds = new Set()
      const productsToUpsert = products.map(p => {
          const key = (p.codigo || p.nombre).toLowerCase().trim()
          const existingId = existingMap.get(key)
          if (existingId) {
              p.id = existingId
              processedIds.add(existingId)
          }
          return p
      })

      // MARCAR COMO AGOTADOS (STOCK 0) LOS QUE NO ESTÁN EN EL CSV
      const missingIds = existingProducts.map(p => p.id).filter(id => !processedIds.has(id))
      
      if (missingIds.length > 0) {
          await window.supabaseClient.from("products").update({ stock: 0 }).in("id", missingIds)
          console.log(`[CSV] 📉 ${missingIds.length} productos faltantes marcados con stock 0`)
      }

      // UPSERT DE PRODUCTOS DEL CSV (Actualizar existentes o Insertar nuevos)
      const { data: insertedProducts, error } = await window.supabaseClient.from("products").upsert(productsToUpsert).select()

      if (error) throw error

      console.log(`[CSV] ✅ ${insertedProducts.length} productos insertados`)

      let comparisonResult = { newProductIds: [], modifiedProductIds: [], deletedCount: 0, deletedProducts: [] }

      if (insertedProducts && insertedProducts.length > 0) {
        if (previousSnapshot.length > 0) {
          comparisonResult = compareProductsAndDetectNew(insertedProducts, previousSnapshot)

          if (comparisonResult.newProductIds.length > 0) {
            const { error: updateError } = await window.supabaseClient
              .from("products")
              .update({ is_new: true })
              .in("id", comparisonResult.newProductIds)

            if (updateError) {
              console.error("[NEW-PRODUCTS] Error marcando productos como nuevos:", updateError)
            } else {
              console.log(
                `[NEW-PRODUCTS] ✅ ${comparisonResult.newProductIds.length} productos marcados como nuevos en BD`,
              )

              // [NUEVO] Gestionar lista rotativa (Límite 100)
              try {
                const { data: allNewlyMarked } = await window.supabaseClient
                  .from('products')
                  .select('id')
                  .eq('is_new', true)
                  .order('created_at', { ascending: false });
                
                if (allNewlyMarked && allNewlyMarked.length > 100) {
                    const idsToRemove = allNewlyMarked.slice(100).map(p => p.id);
                    await window.supabaseClient.from('products').update({ is_new: false }).in('id', idsToRemove);
                    console.log(`[NEW-PRODUCTS] 🔄 Rotación: Se quitó la marca 'nuevo' a ${idsToRemove.length} productos antiguos.`);
                }
              } catch (rotErr) {
                console.error("[NEW-PRODUCTS] Error en rotación:", rotErr);
              }
            }

            // También guardar en localStorage para compatibilidad
            const limitedNewIds = comparisonResult.newProductIds.slice(0, 100)
            saveNewProducts(limitedNewIds)
          } else {
            // Si no hay productos nuevos, limpiar la lista de nuevos
            saveNewProducts([])
            console.log(`[NEW-PRODUCTS] No se detectaron productos nuevos - lista limpiada`)
          }
        } else {
          const firstProducts = insertedProducts.slice(0, 100)
          const firstProductIds = firstProducts.map((p) => p.id)

          const { error: updateError } = await window.supabaseClient
            .from("products")
            .update({ is_new: true })
            .in("id", firstProductIds)

          if (updateError) {
            console.error("[NEW-PRODUCTS] Error marcando productos como nuevos:", updateError)
          } else {
            console.log(
              `[NEW-PRODUCTS] ✅ Primera carga: ${firstProductIds.length} productos marcados como nuevos en BD`,
            )
          }

          saveNewProducts(firstProductIds)
        }

        await saveCSVSnapshot(insertedProducts)
      }

      // Mostrar resumen detallado
      let summaryMessage = `✅ ${products.length} productos cargados exitosamente.\n\n`

      if (previousSnapshot.length > 0) {
        summaryMessage += `📊 Resumen de cambios:\n`
        summaryMessage += `• Productos nuevos: ${comparisonResult.newProductIds.length}\n`
        summaryMessage += `• Productos modificados: ${comparisonResult.modifiedProductIds.length}\n`
        summaryMessage += `• Productos eliminados: ${comparisonResult.deletedCount}\n`

        if (comparisonResult.deletedProducts.length > 0) {
          summaryMessage += `\nEjemplos de productos eliminados:\n`
          comparisonResult.deletedProducts.forEach((name) => {
            summaryMessage += `  - ${name}\n`
          })
        }
      }

      showCSVStatus(summaryMessage, "success")

      setTimeout(() => {
        const clearSales = confirm(
          `Se han cargado ${products.length} productos.\n\n¿Desea limpiar el historial de ventas anteriores?\n\nEsto es útil si estos productos ya no son los mismos que antes.`,
        )

        if (clearSales) {
          // Limpiar datos de ventas en BD
          window.supabaseClient
            .from("product_sales")
            .delete()
            .not("product_id", "is", null)
            .then(() => {
              console.log("[SALES-DB] ✅ Historial de ventas limpiado")
              alert("Historial de ventas limpiado exitosamente")
            })
            .catch((err) => {
              console.error("[SALES-DB] ❌ Error limpiando ventas:", err)
            })
        }

        // Limpiar estado de imágenes para nuevo CSV
        localStorage.removeItem(IMAGE_LOAD_STATE_KEY)
        localStorage.removeItem(PRODUCTS_HASH_KEY)
        console.log("[CSV] Estado de imágenes limpiado para nuevo CSV")

        document.getElementById("csv-modal").classList.add("hidden")
        loadProducts()
      }, 2000)
    } catch (error) {
      console.error("❌ Error al procesar CSV:", error)
      showCSVStatus(`Error: ${error.message}`, "error")
    }
  }

  reader.readAsText(selectedCSVFile)
}

function parseCSVLine(line) {
  const values = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]

    if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === "," && !inQuotes) {
      values.push(current)
      current = ""
    } else {
      current += char
    }
  }

  values.push(current)
  return values
}

function showCSVStatus(message, type) {
  const statusDiv = document.getElementById("csv-status")
  statusDiv.textContent = message
  statusDiv.className = `mt-4 p-4 rounded-xl text-sm font-medium ${
    type === "error"
      ? "bg-red-100 border border-red-300 text-red-700"
      : type === "success"
        ? "bg-green-100 border border-green-300 text-green-700"
        : "bg-blue-100 border border-blue-300 text-blue-700"
  }`
  statusDiv.classList.remove("hidden")
}

async function loadDepartmentsForPDF() {
  const select = document.getElementById("pdf-department-select")
  const departments = [...new Set(allProducts.map((p) => p.departamento).filter(Boolean))]

  select.innerHTML = '<option value="">Selecciona un departamento...</option>'

  departments.forEach((dept) => {
    const option = document.createElement("option")
    option.value = dept
    option.textContent = dept
    select.appendChild(option)
  })
}

async function generatePDF() {
  const department = document.getElementById("pdf-department-select").value

  if (!department) {
    showPDFStatus("Por favor selecciona un departamento", "error")
    return
  }

  if (window.currentUserRole !== "admin" && window.currentUserRole !== "gestor") {
    showPDFStatus("Solo los administradores y gestores pueden exportar PDF", "error")
    return
  }

  try {
    showPDFStatus("Generando PDF...", "info")
    
    const { jsPDF } = window.jspdf
    const doc = new jsPDF('p', 'mm', 'a4') // Portrait, mm, A4
    
    const productsInDept = allProducts.filter((p) => p.departamento === department)
    const productsPerPage = 9 // 3x3 grid
    const totalPages = Math.ceil(productsInDept.length / productsPerPage)
    
    // Colors
    const bgColor = [45, 55, 72] // #2D3748 dark gray
    const cardBgColor = [55, 65, 81] // #374151 darker gray
    const cardBorderColor = [220, 38, 38] // #DC2626 red
    const orangeColor = [234, 88, 12] // #EA580C orange
    const greenNeon = [16, 185, 129] // #10B981 green
    const blueNeon = [59, 130, 246] // #3B82F6 blue
    const white = [255, 255, 255]
    
    // Load logo
    const logoUrl = 'https://i.ibb.co/RkyBVXBP/LOGO-SONIMAX-PNG-2.png'
    
    for (let page = 0; page < totalPages; page++) {
      if (page > 0) doc.addPage()
      
      // Background
      doc.setFillColor(...bgColor)
      doc.rect(0, 0, 210, 297, 'F')
      
      // Header
      doc.setFillColor(...bgColor)
      doc.rect(0, 0, 210, 30, 'F')
      
      // Logo
      try {
        doc.addImage(logoUrl, 'PNG', 10, 5, 30, 20)
      } catch (e) {
        console.log('Logo not loaded')
      }
      
      // Header text container
      doc.setFillColor(...orangeColor)
      doc.roundedRect(50, 5, 150, 20, 5, 5, 'F')
      doc.setTextColor(...white)
      doc.setFontSize(12)
      doc.setFont('helvetica', 'bold')
      doc.text(`Catálogo de Productos - ${department}`, 55, 12)
      doc.setFontSize(10)
      doc.text(`Fecha: ${new Date().toLocaleDateString('es-ES')}`, 55, 18)
      
      // Products grid
      const startY = 40
      const cardWidth = 60
      const cardHeight = 70
      const marginX = 10
      const marginY = 10
      
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) {
          const productIndex = page * productsPerPage + i * 3 + j
          if (productIndex >= productsInDept.length) break
          
          const product = productsInDept[productIndex]
          const x = marginX + j * (cardWidth + marginX)
          const y = startY + i * (cardHeight + marginY)
          
          // Card background
          doc.setFillColor(...cardBgColor)
          doc.roundedRect(x, y, cardWidth, cardHeight, 5, 5, 'F')
          
          // Card border
          doc.setDrawColor(...cardBorderColor)
          doc.setLineWidth(0.5)
          doc.roundedRect(x, y, cardWidth, cardHeight, 5, 5, 'S')
          
          // Product image
          if (product.imagen) {
            try {
              doc.addImage(product.imagen, 'JPEG', x + 5, y + 5, 30, 30)
            } catch (e) {
              console.log('Image not loaded for', product.codigo)
            }
          }
          
          // Code label
          doc.setFillColor(...orangeColor)
          doc.roundedRect(x + 5, y + 38, 30, 8, 2, 2, 'F')
          doc.setTextColor(...white)
          doc.setFontSize(8)
          doc.setFont('helvetica', 'bold')
          doc.text(product.codigo || 'N/A', x + 7, y + 43)
          
          // Stock
          // [MODIFICADO] Ocultar Stock en PDF
          // const stock = inventoryDataMap.get(product.codigo)?.stock || 0
          // doc.setTextColor(...greenNeon)
          // doc.setFontSize(7)
          // doc.text(`En Stock: ${stock} uds.`, x + 5, y + 50)
          
          // Description
          doc.setTextColor(...white)
          doc.setFontSize(6)
          const desc = product.nombre || ''
          const descLines = doc.splitTextToSize(desc, cardWidth - 10)
          doc.text(descLines.slice(0, 2), x + 5, y + 55)
          
          // Price Detal
          doc.setTextColor(...orangeColor)
          doc.setFontSize(10)
          doc.setFont('helvetica', 'bold')
          doc.text(`$${product.precio_cliente?.toFixed(2) || '0.00'}`, x + 5, y + 62)
          
          // Price Mayor
          doc.setTextColor(...blueNeon)
          doc.setFontSize(8)
          doc.text(`Mayor: $${product.precio_mayor?.toFixed(2) || '0.00'}`, x + 5, y + 68)
        }
      }
      
      // Footer
      doc.setFillColor(...bgColor)
      doc.rect(0, 270, 210, 27, 'F')
      doc.setTextColor(...white)
      doc.setFontSize(8)
      doc.setFont('helvetica', 'normal')
      doc.text('Tecnología al alcance de tus manos. Los mejores productos con la mejor calidad.', 10, 275)
      doc.text('© 2026 SONIMAX MÓVIL - Todos los derechos reservados.', 10, 280)
      doc.text('Precios y disponibilidad sujetos a cambios sin previo aviso.', 10, 285)
    }
    
    doc.save(`SONIMAX_${department}_${new Date().toISOString().split("T")[0]}.pdf`)

    showPDFStatus("✅ PDF generado exitosamente", "success")

    setTimeout(() => {
      document.getElementById("pdf-modal").classList.add("hidden")
    }, 2000)
  } catch (error) {
    console.error("❌ Error al generar PDF:", error)
    showPDFStatus(`Error: ${error.message}`, "error")
  }
}

function showPDFStatus(message, type) {
  const statusDiv = document.getElementById("pdf-status")
  statusDiv.textContent = message
  statusDiv.className = `mb-4 p-4 rounded-xl text-sm font-medium ${
    type === "error"
      ? "bg-red-100 border border-red-300 text-red-700"
      : type === "success"
        ? "bg-green-100 border border-green-300 text-green-700"
        : "bg-blue-100 border border-blue-300 text-blue-700"
  }`
  statusDiv.classList.remove("hidden")
}

// Nueva función para rastrear ventas de productos
function trackProductSale(productId) {
  console.log(`[SALES-TRACKER] Rastreando venta para producto: ${productId}`)
  // Implementación real podría implicar enviar a Analytics, o simplemente registrar en localStorage temporalmente
  // para una posterior sincronización si es necesario.
  // Por ahora, solo registramos en consola.
  // Si se necesita una implementación más robusta, se podría usar recordSaleToDatabase aquí.
}

// ============================================
// FUNCIONES PARA AGREGAR Y ELIMINAR PRODUCTOS
// ============================================

// Cargar departamentos disponibles en el select
async function loadDepartmentsForProduct() {
  const select = document.getElementById("product-departamento")
  const departments = [...new Set(allProducts.map((p) => p.departamento).filter(Boolean))].sort()

  // Limpiar opciones existentes (mantener la primera)
  while (select.options.length > 1) {
    select.remove(1)
  }

  departments.forEach((dept) => {
    const option = document.createElement("option")
    option.value = dept
    option.textContent = dept
    select.appendChild(option)
  })
}

// Mostrar estado en el modal de agregar producto
function showAddProductStatus(message, type = "info") {
  const statusDiv = document.getElementById("add-product-status")
  statusDiv.className = "p-4 rounded-xl text-sm font-medium"

  if (type === "success") {
    statusDiv.className += " bg-green-50 border border-green-500 text-green-700"
  } else if (type === "error") {
    statusDiv.className += " bg-red-50 border border-red-500 text-red-700"
  } else {
    statusDiv.className += " bg-blue-50 border border-blue-500 text-blue-700"
  }

  statusDiv.textContent = message
  statusDiv.classList.remove("hidden")
}

// Manejar agregar producto individual
async function handleAddProduct(e) {
  e.preventDefault()

  if (window.currentUserRole !== "admin") {
    showAddProductStatus("Solo los administradores pueden agregar productos", "error")
    return
  }

  const codigo = document.getElementById("product-codigo").value.trim()
  const descripcion = document.getElementById("product-descripcion").value.trim()
  const detal = Number.parseFloat(document.getElementById("product-detal").value)
  const mayor = Number.parseFloat(document.getElementById("product-mayor").value)
  const gmayor = Number.parseFloat(document.getElementById("product-gmayor").value)
  const departamento = document.getElementById("product-departamento").value.trim()
  const url = document.getElementById("product-url").value.trim() || null

  if (!descripcion || !departamento || isNaN(detal) || isNaN(mayor) || isNaN(gmayor)) {
    showAddProductStatus("Por favor completa todos los campos requeridos", "error")
    return
  }

  if (detal <= 0 || mayor <= 0 || gmayor <= 0) {
    showAddProductStatus("Los precios deben ser mayores a 0", "error")
    return
  }

  showAddProductStatus("Agregando producto...", "info")

  try {
    const newProduct = {
      nombre: descripcion,
      descripcion: codigo || "",
      precio_cliente: detal,
      precio_mayor: mayor,
      precio_gmayor: gmayor,
      departamento: departamento,
      imagen_url: url,
      is_new: true, // Marcar como producto nuevo
    }

    const { data, error } = await window.supabaseClient.from("products").insert([newProduct]).select()

    if (error) {
      console.error("[ADD-PRODUCT] Error:", error)
      throw error
    }

    showAddProductStatus(`✅ Producto "${descripcion}" agregado exitosamente`, "success")

    // Limpiar formulario
    document.getElementById("add-product-form").reset()

    setTimeout(() => {
      document.getElementById("add-product-modal").classList.add("hidden")
      loadProducts()
    }, 1500)
  } catch (error) {
    console.error("[ADD-PRODUCT] Error inesperado:", error)
    showAddProductStatus(`Error: ${error.message || "No se pudo agregar el producto"}`, "error")
  }
}

// Buscar productos para eliminar
async function searchProductsToDelete() {
  const searchInput = document.getElementById("delete-product-search").value.trim().toLowerCase()
  const listContainer = document.getElementById("delete-product-list")

  if (searchInput.length === 0) {
    listContainer.innerHTML =
      '<p class="text-gray-500 text-center py-8">Empieza a escribir para buscar productos...</p>'
    return
  }

  const results = allProducts.filter(
    (p) =>
      p.nombre.toLowerCase().includes(searchInput) ||
      p.descripcion.toLowerCase().includes(searchInput) ||
      p.departamento.toLowerCase().includes(searchInput),
  )

  if (results.length === 0) {
    listContainer.innerHTML = '<p class="text-gray-500 text-center py-8">No se encontraron productos</p>'
    return
  }

  listContainer.innerHTML = results
    .map(
      (product) => `
        <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-all">
            <div class="flex-1">
                <p class="font-semibold text-gray-800">${product.nombre}</p>
                <p class="text-xs text-gray-600">
                    ${product.descripcion ? `Código: ${product.descripcion} • ` : ""}
                    Depto: ${product.departamento}
                </p>
            </div>
            <button type="button" class="delete-btn px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-all text-sm font-semibold" data-product-id="${product.id}">
                Eliminar
            </button>
        </div>
      `,
    )
    .join("")

  // Agregar eventos a botones de eliminar
  document.querySelectorAll(".delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => deleteProductById(btn.dataset.productId))
  })
}

// Eliminar producto por ID
async function deleteProductById(productId) {
  if (!confirm("¿Estás seguro de que deseas eliminar este producto? Esta acción no se puede deshacer.")) {
    return
  }

  const statusDiv = document.getElementById("delete-product-status")
  statusDiv.classList.remove("hidden")
  statusDiv.className = "p-4 rounded-xl text-sm font-medium bg-blue-50 border border-blue-500 text-blue-700"
  statusDiv.textContent = "Eliminando producto..."

  try {
    const { error } = await window.supabaseClient.from("products").delete().eq("id", productId)

    if (error) {
      console.error("[DELETE-PRODUCT] Error:", error)
      throw error
    }

    statusDiv.className = "p-4 rounded-xl text-sm font-medium bg-green-50 border border-green-500 text-green-700"
    statusDiv.textContent = "✅ Producto eliminado exitosamente"

    setTimeout(() => {
      document.getElementById("delete-product-modal").classList.add("hidden")
      loadProducts()
    }, 1500)
  } catch (error) {
    console.error("[DELETE-PRODUCT] Error inesperado:", error)
    statusDiv.className = "p-4 rounded-xl text-sm font-medium bg-red-50 border border-red-500 text-red-700"
    statusDiv.textContent = `Error: ${error.message || "No se pudo eliminar el producto"}`
  }
}

// ============================================
// LIMPIAR PRODUCTOS DUPLICADOS
// ============================================

async function cleanDuplicateProducts() {
  const currentUserRole = window.currentUserRole
  
  if (currentUserRole !== 'admin') {
    alert('Solo administradores pueden limpiar duplicados')
    return
  }

  const confirmClean = confirm('¿Estás seguro de que deseas eliminar todos los productos duplicados? Esta acción no se puede deshacer.')
  if (!confirmClean) return

  try {
    console.log('[CLEAN-DUPLICATES] Iniciando limpieza de duplicados...')

    // Obtener TODOS los productos con paginación (igual que loadProducts)
    let allProducts = []
    let start = 0
    const batchSize = 500
    let hasMore = true

    console.log('[CLEAN-DUPLICATES] Obteniendo productos de BD en lotes de 500...')
    
    while (hasMore) {
      console.log(`[CLEAN-DUPLICATES] Cargando productos desde ${start} a ${start + batchSize - 1}...`)
      
      const { data, error } = await window.supabaseClient
        .from('products')
        .select('*')
        .range(start, start + batchSize - 1)

      if (error) {
        console.error('[CLEAN-DUPLICATES] Error en fetch:', error)
        throw error
      }

      if (data && data.length > 0) {
        allProducts = [...allProducts, ...data]
        console.log(`[CLEAN-DUPLICATES] Cargados ${allProducts.length} productos hasta ahora...`)

        if (data.length < batchSize) {
          hasMore = false
        } else {
          start += batchSize
        }
      } else {
        hasMore = false
      }
    }

    if (!allProducts || allProducts.length === 0) {
      alert('No hay productos en la base de datos')
      console.log('[CLEAN-DUPLICATES] BD vacía')
      return
    }

    console.log(`[CLEAN-DUPLICATES] Total de productos en BD: ${allProducts.length}`)
    console.log('[CLEAN-DUPLICATES] Primer producto:', JSON.stringify(allProducts[0]))

    // Agrupar por código (clave principal de duplicación)
    const codigoMap = new Map()
    const toDelete = []
    let processedCount = 0

    allProducts.forEach((product) => {
      const codeKey = String(product.codigo || '').trim()
      
      if (!codeKey) {
        console.log(`[CLEAN-DUPLICATES] Producto ID ${product.id} ignorado: sin código`)
        return
      }

      processedCount++
      
      if (!codigoMap.has(codeKey)) {
        codigoMap.set(codeKey, [])
      }
      codigoMap.get(codeKey).push(product)
    })

    console.log(`[CLEAN-DUPLICATES] Productos procesados: ${processedCount}`)
    console.log(`[CLEAN-DUPLICATES] Códigos únicos encontrados: ${codigoMap.size}`)

    // Encontrar duplicados (dejar el primero, marcar el resto para eliminar)
    codigoMap.forEach((products, codigo) => {
      if (products.length > 1) {
        console.log(`[CLEAN-DUPLICATES] DUPLICADO encontrado - Código "${codigo}": ${products.length} productos`)
        const [first, ...rest] = products
        console.log(`  Manteniendo: ID ${first.id} - ${first.nombre}`)
        rest.forEach(p => {
          console.log(`  Eliminando: ID ${p.id} - ${p.nombre}`)
          toDelete.push(p.id)
        })
      }
    })

    console.log(`[CLEAN-DUPLICATES] Total productos para eliminar: ${toDelete.length}`)

    if (toDelete.length === 0) {
      alert('No se encontraron productos duplicados')
      console.log('[CLEAN-DUPLICATES] No hay duplicados')
      return
    }

    // Mostrar progreso
    let deleted = 0
    const total = toDelete.length
    const deleteStatus = document.createElement('div')
    deleteStatus.className = 'fixed bottom-4 right-4 bg-blue-500 text-white p-4 rounded-lg shadow-lg z-50 max-w-xs'
    deleteStatus.innerHTML = `
      <p class="font-bold mb-2">Eliminando duplicados...</p>
      <div class="w-full bg-white/30 rounded-full h-2">
        <div id="delete-progress" class="bg-white h-2 rounded-full transition-all" style="width: 0%"></div>
      </div>
      <p class="text-sm mt-2"><span id="delete-count">0</span>/${total}</p>
    `
    document.body.appendChild(deleteStatus)

    // Eliminar en lotes de 50 para no sobrecargar
    for (let i = 0; i < toDelete.length; i += 50) {
      const batch = toDelete.slice(i, i + 50)
      console.log(`[CLEAN-DUPLICATES] Eliminando lote de ${batch.length} IDs: ${batch.join(', ')}`)
      
      const { error: deleteError } = await window.supabaseClient
        .from('products')
        .delete()
        .in('id', batch)

      if (deleteError) {
        console.error('[CLEAN-DUPLICATES] Error en eliminación:', deleteError)
        throw deleteError
      }

      deleted += batch.length
      const progress = (deleted / total) * 100
      if (document.getElementById('delete-progress')) {
        document.getElementById('delete-progress').style.width = progress + '%'
        document.getElementById('delete-count').textContent = deleted
      }
      console.log(`[CLEAN-DUPLICATES] Progreso: ${deleted}/${total}`)
    }

    deleteStatus.innerHTML = `
      <p class="font-bold text-green-300">Limpieza completada</p>
      <p class="text-sm mt-2">${deleted} productos duplicados eliminados</p>
    `
    deleteStatus.className = 'fixed bottom-4 right-4 bg-green-500 text-white p-4 rounded-lg shadow-lg z-50 max-w-xs'

    console.log(`[CLEAN-DUPLICATES] ${deleted} productos duplicados eliminados exitosamente`)

    setTimeout(() => {
      deleteStatus.remove()
      alert(`Limpieza completada: ${deleted} productos duplicados eliminados`)
      loadProducts()
    }, 2000)

  } catch (error) {
    console.error('[CLEAN-DUPLICATES] Error:', error)
    alert(`Error al limpiar duplicados: ${error.message}`)
  }
}

// ============================================
// EVENT LISTENERS PARA NUEVOS BOTONES
// ============================================

// Agregar evento al botón de agregar producto
document.addEventListener("DOMContentLoaded", () => {
  const addProductBtn = document.getElementById("add-product-button")
  const addProductModal = document.getElementById("add-product-modal")
  const closeAddProductModal = document.getElementById("close-add-product-modal")
  const addProductForm = document.getElementById("add-product-form")
  const deleteProductBtn = document.getElementById("delete-product-button")
  const deleteProductModal = document.getElementById("delete-product-modal")
  const closeDeleteProductModal = document.getElementById("close-delete-product-modal")
  const deleteProductSearch = document.getElementById("delete-product-search")

  if (addProductBtn) {
    addProductBtn.addEventListener("click", () => {
      loadDepartmentsForProduct()
      addProductModal.classList.remove("hidden")
    })
  }

  if (closeAddProductModal) {
    closeAddProductModal.addEventListener("click", () => {
      addProductModal.classList.add("hidden")
    })
  }

  if (addProductForm) {
    addProductForm.addEventListener("submit", handleAddProduct)
  }

  if (deleteProductBtn) {
    deleteProductBtn.addEventListener("click", () => {
      deleteProductSearch.value = ""
      document.getElementById("delete-product-list").innerHTML =
        '<p class="text-gray-500 text-center py-8">Empieza a escribir para buscar productos...</p>'
      document.getElementById("delete-product-status").classList.add("hidden")
      deleteProductModal.classList.remove("hidden")
    })
  }

  if (closeDeleteProductModal) {
    closeDeleteProductModal.addEventListener("click", () => {
      deleteProductModal.classList.add("hidden")
    })
  }

  if (deleteProductSearch) {
    deleteProductSearch.addEventListener("input", searchProductsToDelete)
  }

  // Agregar evento al botón de limpiar duplicados
  const cleanDuplicatesBtn = document.getElementById("clean-duplicates-button")
  if (cleanDuplicatesBtn) {
    cleanDuplicatesBtn.addEventListener("click", cleanDuplicateProducts)
  }

  // Agregar evento al botón de actualizar inventario
  const updateProductsBtn = document.getElementById("update-products-button")
  if (updateProductsBtn) {
    updateProductsBtn.addEventListener("click", window.showUpdateProductsModal)
  }

  // Evento para el botón de bloqueo de inventario
  document.getElementById("toggle-inventory-lock-btn")?.addEventListener("click", toggleInventoryConfig);

  // NUEVO: Evento para el botón de visibilidad de stock en inventario
  document.getElementById("toggle-inventory-stock-visibility-btn")?.addEventListener("click", toggleInventoryStockVisibility);
})

// ============================================
// LÓGICA ROL INVENTARIO
// ============================================

let currentCountingProducts = []; // Variable para almacenar productos del depósito actual

function initInventoryRole() {
    console.log("📦 Inicializando rol de Inventario");
    fetchInventoryConfig(); // Cargar configuración de bloqueo al iniciar
    
    // Manejo de Tabs
    const tabs = ['assign', 'count', 'search'];
    tabs.forEach(t => {
        document.getElementById(`tab-${t}`).addEventListener('click', () => {
            // Actualizar botones
            tabs.forEach(x => {
                const btn = document.getElementById(`tab-${x}`);
                btn.classList.remove('active', 'text-blue-600', 'border-b-2', 'border-blue-600');
                btn.classList.add('text-gray-500');
            });
            const activeBtn = document.getElementById(`tab-${t}`);
            activeBtn.classList.add('active', 'text-blue-600', 'border-b-2', 'border-blue-600');
            activeBtn.classList.remove('text-gray-500');

            // Mostrar vista
            document.querySelectorAll('.inventory-view').forEach(v => v.classList.add('hidden'));
            document.getElementById(`view-${t}`).classList.remove('hidden');

            if(t === 'assign') loadInventoryForAssignment();
            if(t === 'count') loadInventoryForCounting('A'); // Cargar Deposito A por defecto
        });
    });

    // Filtros de Depósito (Vista Conteo)
    document.querySelectorAll('.deposito-filter-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.deposito-filter-btn').forEach(b => {
                b.classList.remove('bg-gray-800', 'text-white');
                b.classList.add('bg-gray-200', 'text-gray-700');
            });
            e.target.classList.remove('bg-gray-200', 'text-gray-700');
            e.target.classList.add('bg-gray-800', 'text-white');
            loadInventoryForCounting(e.target.dataset.deposito);
        });
    });

    // Buscador Local en Conteo Físico
    document.getElementById('count-search')?.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        if (!currentCountingProducts) return;

        const filtered = currentCountingProducts.filter(p => 
            (p.descripcion && p.descripcion.toLowerCase().includes(query)) || 
            (p.codigo && p.codigo.toLowerCase().includes(query))
        );
        renderCountingList(filtered);
    });

    // Buscador Global Inventario
    let searchTimeout;
    document.getElementById('inventory-global-search').addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();
        const container = document.getElementById('inventory-search-results');

        clearTimeout(searchTimeout);

        if (query.length < 2) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = `<div class="text-center py-5"><div class="loading-spinner mx-auto"></div></div>`;

        searchTimeout = setTimeout(async () => {
            try {
                const { data, error } = await window.supabaseClient
                    .from('inventory_products')
                    .select('*')
                    .or(`codigo.ilike.%${query}%,descripcion.ilike.%${query}%`)
                    .not('existencia_actual', 'is', null)
                    .gt('existencia_actual', 0) // Solo productos en stock
                    .limit(50); // Traer más para filtrar en cliente

                if (error) throw error;

                if (!data || data.length === 0) {
                    container.innerHTML = `<p class="text-center text-gray-500 py-5">No se encontraron productos en stock con ese criterio.</p>`;
                    return;
                }

                // Filtrar productos que no existen en la tabla principal (allProducts)
                // Esto evita mostrar productos "fantasmas" y asegura que tengan imagen
                const validItems = data.filter(item => {
                    const itemCode = String(item.codigo || '').trim().toUpperCase();
                    return allProducts.some(p => String(p.codigo || '').trim().toUpperCase() === itemCode);
                });

                if (validItems.length === 0) {
                    container.innerHTML = `<p class="text-center text-gray-500 py-5">Productos encontrados en inventario pero no en catálogo activo (o catálogo cargando).</p>`;
                    return;
                }

                container.innerHTML = validItems.slice(0, 20).map(createInventorySearchResultCard).join('');

            } catch (err) {
                console.error("Error en búsqueda global de inventario:", err);
                container.innerHTML = `<p class="text-center text-red-500 py-5">Error al realizar la búsqueda: ${err.message}</p>`;
            }
        }, 350);
    });

    // Event listener delegado para los botones de asignación en los resultados de búsqueda
    document.getElementById('inventory-search-results').addEventListener('click', async (e) => {
        if (e.target.classList.contains('deposito-assign-btn')) {
            const id = e.target.dataset.productId;
            const deposito = e.target.dataset.deposito;
            const card = e.target.closest('.search-result-card');
            const depositoSpan = card.querySelector('.deposito-value');

            // Feedback visual inmediato
            depositoSpan.textContent = '...';
            
            const { error } = await window.supabaseClient
                .from('inventory_products')
                .update({ deposito: deposito })
                .eq('id', id);

            if (error) {
                console.error("Error al asignar depósito desde búsqueda:", error);
                depositoSpan.textContent = 'Error';
                depositoSpan.classList.add('text-red-500');
            } else {
                depositoSpan.textContent = deposito;
                depositoSpan.classList.remove('text-red-500');
                depositoSpan.classList.add('text-blue-600');
                console.log(`Producto ${id} asignado al depósito ${deposito}`);
            }
        }
    });

    // Botón Exportar
    document.getElementById('export-inventory-btn').addEventListener('click', exportInventoryExcel);

    // Carga inicial
    loadInventoryForAssignment();
}

function createInventorySearchResultCard(item) {
    // Usamos el ID de la tabla inventory_products, no el de products
    const productId = item.id; 
    
    // Normalizar códigos para búsqueda de imagen
    const itemCode = String(item.codigo || '').trim().toUpperCase();
    const productInCatalog = allProducts.find(p => String(p.codigo || '').trim().toUpperCase() === itemCode);
    const imageUrl = productInCatalog?.imagen_url || '/images/ProductImages.jpg';

    return `
        <div class="bg-gray-50 dark:bg-gray-700/50 p-3 rounded-xl shadow-sm flex flex-col sm:flex-row items-center gap-4 search-result-card">
            <img src="${optimizeImageUrl(imageUrl)}" alt="Imagen del producto" class="w-16 h-16 object-cover rounded-lg flex-shrink-0 border bg-white" onerror="this.src='/images/ProductImages.jpg'">
            <div class="flex-grow text-center sm:text-left">
                <p class="font-semibold text-gray-800 dark:text-white">${item.descripcion}</p>
                <p class="text-sm text-gray-500">Código: <code class="font-mono">${item.codigo}</code></p>
                <p class="text-sm text-gray-600 dark:text-gray-300 mt-1">Depósito Actual: <span class="font-semibold text-blue-600 deposito-value">${item.deposito || 'N/A'}</span></p>
            </div>
            <div class="flex flex-wrap gap-2 justify-center pt-2 sm:pt-0">
                ${['A','B','C','D','E','PLANTA BAJA','PISO VENTA'].map(d => `
                    <button class="deposito-assign-btn px-2 py-1 rounded-lg font-bold text-[10px] sm:text-xs bg-gray-200 hover:bg-blue-500 hover:text-white transition-all" data-product-id="${productId}" data-deposito="${d}">${d}</button>
                `).join('')}
            </div>
        </div>
    `;
}


async function loadInventoryForAssignment() {
    const list = document.getElementById('assign-list');
    const loading = document.getElementById('assign-loading');
    const empty = document.getElementById('assign-empty');
    
    list.innerHTML = '';
    loading.classList.remove('hidden');
    empty.classList.add('hidden');

    try {
        // Obtener TODOS los productos SIN depósito asignado con paginación
        let data = [];
        let page = 0;
        const pageSize = 1000;
        let hasMore = true;

        while(hasMore) {
            const { data: batch, error } = await window.supabaseClient
                .from('inventory_products')
                .select('*')
                .is('deposito', null)
                .gt('existencia_actual', 0) // Filtrar agotados (stock > 0)
                .order('descripcion', { ascending: true })
                .range(page * pageSize, (page + 1) * pageSize - 1);

            if (error) throw error;

            if (batch && batch.length > 0) {
                data = data.concat(batch);
                if (batch.length < pageSize) {
                    hasMore = false;
                } else {
                    page++;
                }
            } else {
                hasMore = false;
            }
        }

        if(!data || data.length === 0) {
            empty.classList.remove('hidden');
        } else {
            data.forEach(item => {
                const div = document.createElement('div');
                div.className = "bg-white p-4 rounded-xl shadow-sm border border-gray-200 flex flex-col sm:flex-row justify-between items-center gap-3";
                div.innerHTML = `
                    <div class="flex-1">
                        <h4 class="font-bold text-gray-800">${item.descripcion}</h4>
                        <p class="text-xs text-gray-500">Código: ${item.codigo} | Dept: ${item.departamento}</p>
                    </div>
                    <div class="flex flex-wrap gap-2 justify-end">
                        ${['A','B','C','D','E','PLANTA BAJA','PISO VENTA'].map(d => `
                            <button class="px-2 py-1 rounded-lg bg-gray-100 hover:bg-blue-600 hover:text-white font-bold text-xs transition-colors assign-btn" 
                                data-id="${item.id}" data-dep="${d}">${d}</button>
                        `).join('')}
                    </div>
                `;
                list.appendChild(div);
            });

            // Event listeners para botones
            document.querySelectorAll('.assign-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const id = e.target.dataset.id;
                    const dep = e.target.dataset.dep;
                    
                    // Optimistic UI update
                    e.target.closest('.bg-white').remove();
                    
                    await window.supabaseClient
                        .from('inventory_products')
                        .update({ deposito: dep })
                        .eq('id', id);
                });
            });
        }
    } catch (err) {
        console.error("Error cargando asignaciones:", err);
    } finally {
        loading.classList.add('hidden');
    }
}

async function loadInventoryForCounting(deposito) {
    const list = document.getElementById('count-list');
    const loading = document.getElementById('count-loading');
    const searchInput = document.getElementById('count-search');
    
    list.innerHTML = '';
    loading.classList.remove('hidden');
    // Limpiar buscador al cambiar de depósito
    if(searchInput) searchInput.value = '';
    
    // Asegurar que tenemos la configuración más reciente
    await fetchInventoryConfig();

    try {
        let data = [];
        let page = 0;
        const pageSize = 1000;
        let hasMore = true;

        while(hasMore) {
            const { data: batch, error } = await window.supabaseClient
                .from('inventory_products')
                .select('*')
                .eq('deposito', deposito)
                .gt('existencia_actual', 0) // Filtrar agotados (stock > 0)
                .order('descripcion', { ascending: true })
                .range(page * pageSize, (page + 1) * pageSize - 1);

            if (error) throw error;

            if (batch && batch.length > 0) {
                data = data.concat(batch);
                if (batch.length < pageSize) {
                    hasMore = false;
                } else {
                    page++;
                }
            } else {
                hasMore = false;
            }
        }

        currentCountingProducts = data; // Guardar en memoria para el buscador
        renderCountingList(data);

    } catch (err) {
        console.error("Error cargando conteo:", err);
    } finally {
        loading.classList.add('hidden');
    }
}

function renderCountingList(data) {
    const list = document.getElementById('count-list');
    list.innerHTML = '';

    if(!data || data.length === 0) {
        list.innerHTML = `<p class="text-center text-gray-500 py-8">No se encontraron productos</p>`;
        return;
    }

    data.forEach(item => {
        // LÓGICA DE BLOQUEO:
        // Si el modo edición global está APAGADO (!inventoryEditMode)
        // Y el producto ya tiene una cantidad asignada (mayor a 0)
        // ENTONCES: Bloquear el input (isLocked = true)
        const hasQuantity = item.cantidad_fisica !== null && item.cantidad_fisica > 0;
        const isLocked = !inventoryEditMode && hasQuantity;

        const div = document.createElement('div');
        div.className = "bg-white p-3 rounded-lg border border-gray-200 flex justify-between items-center";
        div.innerHTML = `
            <div class="w-2/3 pr-2">
                <p class="font-semibold text-sm text-gray-800 truncate">${item.descripcion}</p>
                <p class="text-xs text-gray-500">${item.codigo || ''}</p>
            </div>
            <div class="w-1/3">
                <input type="number" value="${item.cantidad_fisica || 0}" 
                    class="w-full p-2 border rounded text-center font-bold text-blue-600 focus:ring-2 focus:ring-blue-500 outline-none qty-input"
                    class="w-full p-2 border rounded text-center font-bold outline-none qty-input ${isLocked ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : 'bg-white text-blue-600 focus:ring-2 focus:ring-blue-500'}"
                    ${isLocked ? 'disabled' : ''}
                    data-id="${item.id}">
            </div>
        `;
        list.appendChild(div);
    });

    // Auto-guardado al cambiar valor
    list.querySelectorAll('.qty-input').forEach(input => {
        input.addEventListener('change', async (e) => {
            const val = parseInt(e.target.value) || 0;
            const id = e.target.dataset.id;
            
            e.target.classList.add('bg-green-50', 'border-green-500'); // Feedback visual
            
            // Actualizar también en el array local para que persista si se borra la búsqueda
            const product = currentCountingProducts.find(p => p.id == id);
            if(product) product.cantidad_fisica = val;

            await window.supabaseClient
                .from('inventory_products')
                .update({ cantidad_fisica: val })
                .eq('id', id);
                
            setTimeout(() => e.target.classList.remove('bg-green-50', 'border-green-500'), 1000);
            setTimeout(() => {
                e.target.classList.remove('bg-green-50', 'border-green-500');
                // Si no estamos en modo edición, bloquear inmediatamente después de guardar si es > 0
                if (!inventoryEditMode && val > 0) {
                    e.target.disabled = true;
                    e.target.classList.remove('bg-white', 'text-blue-600', 'focus:ring-2', 'focus:ring-blue-500');
                    e.target.classList.add('bg-gray-100', 'text-gray-500', 'cursor-not-allowed');
                }
            }, 1000);
        });
    });
}

async function exportInventoryExcel() {
    try {
        const exportBtn = document.getElementById('export-inventory-btn');
        if(exportBtn) {
            exportBtn.textContent = 'Generando Excel...';
            exportBtn.disabled = true;
        }

        let allData = [];
        let page = 0;
        const pageSize = 1000;
        let hasMore = true;

        while(hasMore) {
            const { data, error } = await window.supabaseClient
                .from('inventory_products')
                .select('codigo, descripcion, precio_detal, precio_mayor, precio_gmayor, existencia_actual, departamento, deposito, cantidad_fisica')
                .range(page * pageSize, (page + 1) * pageSize - 1);
            
            if(error) throw error;

            if (data && data.length > 0) {
                allData = allData.concat(data);
                if (data.length < pageSize) {
                    hasMore = false;
                } else {
                    page++;
                }
            } else {
                hasMore = false;
            }
        }

        if(exportBtn) {
            exportBtn.textContent = 'Exportar Excel';
            exportBtn.disabled = false;
        }

        if (allData.length === 0) {
            alert("No hay datos para exportar");
            return;
        }

        const ws = XLSX.utils.json_to_sheet(allData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Inventario");
        XLSX.writeFile(wb, `Inventario_Fisico_${new Date().toISOString().split('T')[0]}.xlsx`);
    } catch (err) {
        console.error(err);
        alert("Error exportando: " + err.message);
        const exportBtn = document.getElementById('export-inventory-btn');
        if(exportBtn) {
            exportBtn.textContent = 'Exportar Excel';
            exportBtn.disabled = false;
        }
    }
}

// ============================================
// FUNCIONES DE CONFIGURACIÓN DE INVENTARIO (ADMIN)
// ============================================

async function fetchInventoryConfig() {
  try {
    // Intentamos obtener la configuración de la tabla 'inventory_config'
    const { data, error } = await window.supabaseClient
      .from("inventory_config")
      .select("edit_enabled, show_stock_enabled, role_visibility")
      .eq("id", 1)
      .single()

    // [CORREGIDO] Manejar el caso donde la consulta no devuelve datos (data es null),
    // lo que puede ocurrir por RLS o porque la fila no existe.
    if (error) {
      console.error("[CONFIG] Error al obtener la configuración de inventario:", error)
      inventoryEditMode = false
      inventoryShowStockMode = false
    } else if (!data) {
      console.warn(
        "[CONFIG] No se encontró la fila de configuración (id=1) en la base de datos. Usando valores por defecto. (Verifica los permisos RLS para la tabla 'inventory_config')",
      )
      inventoryEditMode = false
      inventoryShowStockMode = false
    } else {
      // La configuración fue encontrada
      inventoryEditMode = data.edit_enabled
      inventoryShowStockMode = data.show_stock_enabled || false

      if (data.role_visibility) {
        stockVisibilityConfig = data.role_visibility
        console.log("✅ Configuración de visibilidad de stock cargada desde la BD:", stockVisibilityConfig)
      } else {
        console.warn("⚠️ La columna `role_visibility` es nula en la BD. Se usarán los valores por defecto.")
      }
    }
    updateInventoryLockButtonUI()
    updateInventoryStockVisibilityButtonUI()
  } catch (e) {
    console.error("Error inesperado en fetchInventoryConfig:", e)
    inventoryEditMode = false
    inventoryShowStockMode = false
  }
}

// ============================================
// GESTIÓN DE VISIBILIDAD DE STOCK (NUEVO)
// ============================================

function showStockVisibilityModal() {
  const roles = ['admin', 'gestor', 'distribuidor', 'cliente', 'inventario'];
  
  const modalDiv = document.createElement('div');
  modalDiv.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4';
  modalDiv.innerHTML = `
    <div class="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden animate-fade-in">
      <div class="bg-gradient-to-r from-purple-600 to-purple-700 p-6 text-white flex justify-between items-center">
        <h2 class="text-xl font-bold">Visibilidad de Stock</h2>
        <button class="text-white hover:bg-white/20 rounded-lg p-1 text-xl font-bold transition-colors" onclick="this.closest('.fixed').remove()">✕</button>
      </div>
      <div class="p-6 space-y-4">
        <div class="bg-purple-50 border-l-4 border-purple-500 p-4 rounded mb-4">
            <p class="text-sm text-purple-800">Selecciona qué roles pueden ver la cantidad numérica de stock. <br><strong>Nota:</strong> Los productos agotados (0) siempre mostrarán la etiqueta "AGOTADO".</p>
        </div>
        <div class="space-y-3 max-h-[60vh] overflow-y-auto" id="roles-visibility-list">
          ${roles.map(role => `
            <div class="flex items-center justify-between p-4 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors border border-gray-100">
              <span class="font-bold text-gray-700 capitalize flex items-center gap-2">
                ${role === 'admin' ? '🛡️' : role === 'inventario' ? '📦' : role === 'cliente' ? '👤' : '👥'} 
                ${role}
              </span>
              <label class="relative inline-flex items-center cursor-pointer">
                <input type="checkbox" class="sr-only peer role-visibility-toggle" data-role="${role}" 
                  ${stockVisibilityConfig[role] ? 'checked' : ''}>
                <div class="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-purple-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
              </label>
            </div>
          `).join('')}
        </div>
        <div class="pt-4">
            <button id="save-visibility-btn" class="w-full bg-gradient-to-r from-purple-600 to-purple-700 text-white font-bold py-3 rounded-xl hover:from-purple-700 hover:to-purple-800 transition-all shadow-lg transform active:scale-95">
                Guardar Configuración
            </button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modalDiv);

  document.getElementById('save-visibility-btn').addEventListener('click', async () => {
      const newConfig = { ...stockVisibilityConfig };
      document.querySelectorAll('.role-visibility-toggle').forEach(toggle => {
          newConfig[toggle.dataset.role] = toggle.checked;
      });
      
      const btn = document.getElementById('save-visibility-btn');
      btn.textContent = 'Guardando...';
      btn.disabled = true;
      
      // Actualizar variable global y base de datos
      stockVisibilityConfig = newConfig;
      
      try {
        // Intentar guardar en Supabase (si existe la columna role_visibility)
        await window.supabaseClient.from('inventory_config').update({ role_visibility: newConfig }).eq('id', 1);
        
        // Si estamos en rol inventario y cambiamos su configuración, actualizar legacy también para consistencia
        if (typeof newConfig.inventario !== 'undefined') {
             await window.supabaseClient.from('inventory_config').update({ show_stock_enabled: newConfig.inventario }).eq('id', 1);
             inventoryShowStockMode = newConfig.inventario;
        }

        alert('✅ Configuración guardada exitosamente');
        modalDiv.remove();
        
        // Recargar productos para aplicar cambios visuales
        renderProducts();
        
      } catch (e) {
        console.error(e);
        alert('⚠️ Configuración aplicada localmente, pero hubo un error guardando en la nube (Verifica si la tabla inventory_config tiene la columna role_visibility).');
        modalDiv.remove();
        renderProducts();
      }
  });
}

async function toggleInventoryConfig() {
    const newStatus = !inventoryEditMode;
    try {
        // Intentar actualizar
        const { error } = await window.supabaseClient
            .from('inventory_config')
            .upsert({ id: 1, edit_enabled: newStatus });
        
        if (error) throw error;
        
        inventoryEditMode = newStatus;
        updateInventoryLockButtonUI();
        alert(`Modo de edición de inventario: ${inventoryEditMode ? 'ACTIVADO (Se pueden modificar cantidades)' : 'DESACTIVADO (Cantidades se bloquean al ingresar)'}`);
        
    } catch (e) {
        console.error(e);
        alert("Error actualizando configuración. Asegúrate de que la tabla 'inventory_config' exista en Supabase.\n\nError: " + e.message);
    }
}

async function toggleInventoryStockVisibility() {
    const newStatus = !inventoryShowStockMode;
    try {
        const { error } = await window.supabaseClient
            .from('inventory_config')
            .upsert({ id: 1, show_stock_enabled: newStatus });
        
        if (error) throw error;
        
        inventoryShowStockMode = newStatus;
        updateInventoryStockVisibilityButtonUI();
        alert(`Visibilidad de stock para Inventario: ${inventoryShowStockMode ? 'ACTIVADO (Pueden ver stock)' : 'DESACTIVADO (No pueden ver stock)'}`);
        
    } catch (e) {
        console.error(e);
        alert("Error actualizando configuración. Error: " + e.message);
    }
}

function updateInventoryLockButtonUI() {
    const btn = document.getElementById('toggle-inventory-lock-btn');
    if(!btn) return;
    const span = btn.querySelector('span');
    if (inventoryEditMode) {
        btn.classList.remove('from-gray-600', 'to-gray-700');
        btn.classList.add('from-green-600', 'to-green-700');
        span.textContent = '🔓 Edición Inventario: ACTIVA';
    } else {
        btn.classList.remove('from-green-600', 'to-green-700');
        btn.classList.add('from-gray-600', 'to-gray-700');
        span.textContent = '🔒 Edición Inventario: BLOQUEADA';
    }
}

function updateInventoryStockVisibilityButtonUI() {
    const btn = document.getElementById('toggle-inventory-stock-visibility-btn');
    if(!btn) return;
    const span = btn.querySelector('span');
    if (inventoryShowStockMode) {
        btn.classList.remove('from-gray-600', 'to-gray-700');
        btn.classList.add('from-blue-600', 'to-blue-700');
        span.textContent = '👁️ Ver Stock (Inv): ACTIVO';
    } else {
        btn.classList.remove('from-blue-600', 'to-blue-700');
        btn.classList.add('from-gray-600', 'to-gray-700');
        span.textContent = '👁️ Ver Stock (Inv): BLOQUEADO';
    }
}
