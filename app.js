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
let cart = []
let currentDepartment = "all"
let selectedProductForQuantity = null

let currentPage = 1
const PRODUCTS_PER_PAGE = 50
let isLoadingMore = false

let imageObserver = null
let serviceWorkerRegistration = null

const IMAGE_LOAD_STATE_KEY = "sonimax_image_load_state"
const PRODUCTS_HASH_KEY = "sonimax_products_hash"
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
      // Verificar si cambió algún dato importante
      const priceChanged =
        previousProduct.precio_cliente !== product.precio_cliente ||
        previousProduct.precio_mayor !== product.precio_mayor ||
        previousProduct.precio_gmayor !== product.precio_gmayor

      const dataChanged =
        previousProduct.nombre !== product.nombre || previousProduct.departamento !== product.departamento

      if (priceChanged || dataChanged) {
        modifiedProductIds.push(product.id)
        console.log(`[COMPARISON] 🔄 Producto MODIFICADO: ${product.nombre}`)
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
      serviceWorkerRegistration = await navigator.serviceWorker.register("/sw.js")
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
    loadCartFromStorage()
    showApp()
    loadBanners()
  } else {
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
    loadCartFromStorage()
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
      })
      .eq("auth_id", data.user.id)

    if (updateError) {
      console.error("Error actualizando rol:", updateError)
      throw new Error("Usuario creado pero no se pudo asignar el rol correctamente")
    }

    console.log("✅ Usuario creado exitosamente con rol:", role)
    showCreateUserMessage(`Usuario "${username}" creado exitosamente con rol de ${role}`, "success")

    document.getElementById("create-user-form").reset()

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

    updateUIForRole()
  } catch (error) {
    console.error("❌ Error al cargar datos del usuario:", error)
    await window.supabaseClient.auth.signOut()
    showLogin()
  }
}

function updateUIForRole() {
  console.log("Actualizando UI para rol:", currentUserRole)

  const roleBadge = document.getElementById("user-role-badge")
  const adminSection = document.getElementById("admin-section")
  const gestorSection = document.getElementById("gestor-section")
  const manageBannersBtn = document.getElementById("manage-banners-btn")

  if (roleBadge) {
    // Mostrar "MAYORISTA" si el rol es distribuidor
    const displayRole = currentUserRole === 'distribuidor' ? 'MAYORISTA' : currentUserRole;
    roleBadge.textContent = `${currentUser.name} (${displayRole})`
    roleBadge.className = `role-badge-${currentUserRole}`
    roleBadge.classList.remove("hidden")
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
  } else {
    adminSection?.classList.add("hidden")
    gestorSection?.classList.add("hidden")
    manageBannersBtn?.classList.add("hidden")
  }
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
    } else if (window.currentUserRole === "admin") {
      roleSelect.innerHTML = `
        <option value="cliente">Cliente</option>
        <option value="distribuidor">Mayorista</option>
        <option value="gestor">Gestor</option>
        <option value="admin">Administrador</option>
      `
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

  document.getElementById("global-search")?.addEventListener("input", handleGlobalSearch)
  document.getElementById("dept-search")?.addEventListener("input", handleDeptSearch)

  document.getElementById("send-whatsapp")?.addEventListener("click", () => {
    if (window.currentUserRole === "admin") {
      showOrderDetailsModal()
    } else {
      sendWhatsAppOrder()
    }
  })

  document.getElementById("close-order-details-modal")?.addEventListener("click", () => {
    document.getElementById("order-details-modal").classList.add("hidden")
  })

  document.getElementById("cancel-order-details")?.addEventListener("click", () => {
    document.getElementById("order-details-modal").classList.add("hidden")
  })

  document.getElementById("confirm-order-details")?.addEventListener("click", confirmOrderDetails)

  document.getElementById("upload-csv-button")?.addEventListener("click", () => {
    document.getElementById("csv-modal").classList.remove("hidden")
  })

  document.getElementById("close-csv-modal")?.addEventListener("click", () => {
    document.getElementById("csv-modal").classList.add("hidden")
  })

  document.getElementById("csv-file-input")?.addEventListener("change", handleCSVFileSelect)
  document.getElementById("upload-csv-submit")?.addEventListener("click", handleCSVUpload)

  document.getElementById("export-pdf-button")?.addEventListener("click", () => {
    document.getElementById("pdf-modal").classList.remove("hidden")
    loadDepartmentsForPDF()
  })

  document.getElementById("close-pdf-modal")?.addEventListener("click", () => {
    document.getElementById("pdf-modal").classList.add("hidden")
  })

  document.getElementById("generate-pdf-button")?.addEventListener("click", generatePDF)

  document.getElementById("close-quantity-modal")?.addEventListener("click", () => {
    document.getElementById("quantity-modal").classList.add("hidden")
  })

  document.getElementById("cancel-quantity")?.addEventListener("click", () => {
    document.getElementById("quantity-modal").classList.add("hidden")
  })

  document.getElementById("confirm-quantity")?.addEventListener("click", confirmQuantity)
}

function closeSidebar() {
  document.getElementById("sidebar-menu").classList.remove("open")
  document.getElementById("sidebar-overlay").classList.add("hidden")
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

function filterByDepartment(dept) {
  currentDepartment = dept

  document.querySelectorAll(".dept-button, .sidebar-dept-btn").forEach((btn) => {
    btn.classList.remove("active")
    if (btn.dataset.dept === dept) {
      btn.classList.add("active")
    }
  })

  const deptSearchContainer = document.getElementById("dept-search-container")
  if (dept === "all") {
    deptSearchContainer.classList.add("hidden")
  } else {
    deptSearchContainer.classList.remove("hidden")
  }

  if (dept === "all") {
    filteredProducts = allProducts
  } else if (dept === "new") {
    // Usar el nuevo campo is_new para filtrar
    filteredProducts = allProducts.filter((p) => p.is_new)
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

      console.log("[SALES-DB] Productos después del map:", filteredProducts.length)
      currentPage = 1
      renderProducts()
      document.getElementById("products-grid").scrollIntoView({ behavior: "smooth", block: "start" })
    })
    return
  } else {
    filteredProducts = allProducts.filter((p) => p.departamento === dept)
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

  const priceInfo = getPriceForRole(product)

  let priceHTML = ""
  if (priceInfo.display === "single") {
    priceHTML = `<span class="price-badge">$${priceInfo.price.toFixed(2)}</span>`
  } else if (priceInfo.display === "dual") {
    priceHTML = `
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-gray-600">${priceInfo.labelCliente}:</span>
          <span class="text-lg font-black text-red-600">$${priceInfo.priceCliente.toFixed(2)}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-gray-600">${priceInfo.labelMayor}:</span>
          <span class="text-lg font-black text-green-600">$${priceInfo.priceMayor.toFixed(2)}</span>
        </div>
      </div>
    `
  } else if (priceInfo.display === "triple") {
    priceHTML = `
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-gray-600">${priceInfo.labelCliente}:</span>
          <span class="text-lg font-black text-red-600">$${priceInfo.priceCliente.toFixed(2)}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-gray-600">${priceInfo.labelMayor}:</span>
          <span class="text-lg font-black text-green-600">$${priceInfo.priceMayor.toFixed(2)}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-xs font-semibold text-gray-600">${priceInfo.labelGmayor}:</span>
          <span class="text-lg font-black text-blue-600">$${priceInfo.priceGmayor.toFixed(2)}</span>
        </div>
      </div>
    `
  }

  const imageUrl = product.imagen_url || "/images/ProductImages.jpg"
  const optimizedUrl = optimizeImageUrl(imageUrl)
  const placeholderUrl = createImagePlaceholder(imageUrl)

  // Determinar el estado del stock
  let stockBadge = ''
  if (product.stock === 0) {
    stockBadge = '<span class="absolute bottom-3 right-3 z-20 bg-red-600 text-white text-xs font-bold px-3 py-2 rounded-lg animate-pulse">❌ AGOTADO</span>'
  } else if (product.stock <= 5) {
    stockBadge = `<span class="absolute bottom-3 right-3 z-20 bg-yellow-500 text-white text-xs font-bold px-3 py-2 rounded-lg">⚠️ ${product.stock} unid.</span>`
  }

  card.innerHTML = `
    <div class="product-image-container">
      <img src="${placeholderUrl}"
           data-src="${optimizedUrl}"
           alt="${product.nombre}"
           class="product-image image-loading cursor-pointer hover:opacity-90 transition-opacity"
           loading="lazy"
           onerror="this.src='/images/ProductImages.jpg'">
    </div>
    <div class="p-5">
      <h3 class="font-bold text-lg text-gray-800 mb-2 line-clamp-2">${product.nombre}</h3>
      ${product.codigo ? `<p class="text-xs text-gray-500 mb-1 font-semibold">Código: ${product.codigo}</p>` : ""}
      <div class="mb-4">
        ${priceHTML}
      </div>
      ${product.departamento ? `<span class="text-xs bg-gray-100 px-3 py-1 rounded-full text-gray-600 font-semibold block mb-3">${product.departamento}</span>` : ""}
      ${product.is_new ? '<span class="absolute top-3 right-3 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full">¡NUEVO!</span>' : ""}
      ${stockBadge}
      <button class="add-to-cart-btn relative z-0 w-full bg-gradient-to-r from-red-600 to-red-700 text-white font-bold py-3 rounded-xl hover:from-red-700 hover:to-red-800 transition-all shadow-lg">
        Agregar al Carrito
      </button>
    </div>
  `

  // Añadir indicación visual para productos nuevos
  if (product.is_new) {
    const newProductBadge = document.createElement("span")
    newProductBadge.className =
      "absolute top-3 right-3 bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full z-10"
    newProductBadge.textContent = "¡NUEVO!"
    card.querySelector(".product-image-container").appendChild(newProductBadge)
  }

  const productImage = card.querySelector(".product-image")
  if (imageObserver && productImage) {
    imageObserver.observe(productImage)
  }

  productImage.addEventListener("click", (e) => {
    e.stopPropagation()
    showImageModal(imageUrl, product.nombre)
  })

  // DEBUG: confirmar que los productos que se renderizan traen 'codigo' y 'descripcion'
  try {
    console.debug(`[RENDER] product id=${product.id} codigo=${product.codigo || ''} nombre=${product.nombre || ''} descripcion=${product.descripcion || ''}`)
  } catch (err) {
    /* noop */
  }

  card.querySelector(".add-to-cart-btn").addEventListener("click", () => {
    openQuantityModal(product)
  })

  return card
}

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

function saveCartToStorage() {
  if (!currentUser) return

  const cartKey = `sonimax_cart_${currentUser.auth_id}`
  localStorage.setItem(cartKey, JSON.stringify(cart))
  console.log(`💾 Carrito guardado para usuario ${currentUser.username}`)
}

function loadCartFromStorage() {
  if (!currentUser) return

  const cartKey = `sonimax_cart_${currentUser.auth_id}`
  const savedCart = localStorage.getItem(cartKey)

  if (savedCart) {
    try {
      cart = JSON.parse(savedCart)
      updateCartCount()
      console.log(`📦 Carrito cargado: ${cart.length} items`)
    } catch (error) {
      console.error("Error al cargar carrito:", error)
      cart = []
    }
  }
}

function clearCart() {
  cart = []
  if (currentUser) {
    const cartKey = `sonimax_cart_${currentUser.auth_id}`
    localStorage.removeItem(cartKey)
  }
  updateCartCount()
  renderCart()
  console.log("🗑️ Carrito limpiado")
}

function openQuantityModal(product) {
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

function confirmQuantity() {
  const quantity = Number.parseInt(document.getElementById("quantity-input").value)
  const observation = document.getElementById("observation-input").value.trim()

  if (quantity < 1) {
    alert("La cantidad debe ser al menos 1")
    return
  }

  if (selectedProductForQuantity.stock !== 0 && quantity > selectedProductForQuantity.stock) {
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

  addToCart(selectedProductForQuantity, quantity, selectedPrice, observation)
  document.getElementById("quantity-modal").classList.add("hidden")
}

function addToCart(product, quantity, price, observation = "") {
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
  recordSaleToDatabase(product.id, quantity, price)

  saveCartToStorage()
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

    const decreaseBtn = cartItemDiv.querySelector(".cart-decrease-btn")
    const increaseBtn = cartItemDiv.querySelector(".cart-increase-btn")
    const removeBtn = cartItemDiv.querySelector(".cart-remove-btn")

    decreaseBtn.addEventListener("click", () => {
      console.log("Disminuyendo cantidad del item", index)
      updateCartItemQuantityByIndex(index, -1)
    })

    increaseBtn.addEventListener("click", () => {
      console.log("Aumentando cantidad del item", index)
      updateCartItemQuantityByIndex(index, 1)
    })

    removeBtn.addEventListener("click", () => {
      console.log("Eliminando item", index)
      removeFromCartByIndex(index)
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

function updateCartItemQuantityByIndex(index, change) {
  if (index < 0 || index >= cart.length) return

  cart[index].quantity += change

  if (cart[index].quantity <= 0) {
    removeFromCartByIndex(index)
  } else {
    saveCartToStorage()
    updateCartCount()
    renderCart()
  }
}

function removeFromCartByIndex(index) {
  if (index < 0 || index >= cart.length) return

  cart.splice(index, 1)
  saveCartToStorage()
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

function confirmOrderDetails() {
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

  generateExcelAndSendOrder(responsables, sitio)
}

function generateExcelAndSendOrder(responsables, sitio) {
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

    clearCart()

    document.getElementById("cart-modal").classList.add("hidden")

    alert(`Pedido enviado por WhatsApp y Excel descargado como: ${fileName}\nEl carrito ha sido limpiado.`)
  } catch (error) {
    console.error("❌ Error al generar Excel:", error)
    alert("Error al generar el archivo Excel. Se enviará solo el mensaje de WhatsApp.")

    sendWhatsAppOrderFallback(responsables, sitio)
  }
}

function sendWhatsAppOrderFallback(responsables, sitio) {
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
  clearCart()
  // No se llama a renderCart() aquí porque clearCart() ya lo hace.
}

function sendWhatsAppOrder() {
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

  clearCart()

  document.getElementById("cart-modal").classList.add("hidden")

  alert("Pedido enviado por WhatsApp. El carrito ha sido limpiado.")
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

function searchProducts(products, query) {
  if (!query || query.trim() === "") {
    return products
  }

  const searchWords = getSearchWords(query)
  if (searchWords.length === 0) {
    return products
  }

  console.log("[SEARCH] Buscando palabras:", searchWords)

  return products.filter((product) => {
    const normalizedName = normalizeText(product.nombre)
    const normalizedDescription = normalizeText(product.descripcion)
    const normalizedDepartment = normalizeText(product.departamento)

    const combinedText = `${normalizedName} ${normalizedDescription} ${normalizedDepartment}`

    const allWordsFound = searchWords.every((word) => {
      return (
        normalizedName.includes(word) ||
        normalizedDescription.includes(word) ||
        normalizedDepartment.includes(word) ||
        combinedText.includes(word)
      )
    })

    if (allWordsFound) {
      console.log(`[SEARCH] ✅ Encontrado: ${product.nombre}`)
    }

    return allWordsFound
  })
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

    filteredProducts = searchProducts(allProducts, query)

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

    filteredProducts = searchProducts(productsInDept, query)

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
          stock: 0
        }

        products.push(product)
      }

      if (products.length === 0) {
        throw new Error("No se encontraron productos válidos en el CSV")
      }

      showCSVStatus(`Procesando ${products.length} productos...`, "info")

      // LIMPIAR PRODUCTOS EXISTENTES
      const { error: deleteError } = await window.supabaseClient.from("products").delete().not("id", "is", null)

      if (deleteError) {
        console.error("Error al limpiar productos existentes:", deleteError)
        throw new Error("Error al limpiar productos existentes")
      }

      console.log("[CSV] ✅ Productos anteriores eliminados")

      // INSERTAR NUEVOS PRODUCTOS
      const { data: insertedProducts, error } = await window.supabaseClient.from("products").insert(products).select()

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
  const doc = new jsPDF()
  
  const productsInDept = allProducts.filter((p) => p.departamento === department)
  
  // Encabezado del documento
  doc.setTextColor(0, 0, 0)
  doc.setFontSize(16)
  doc.setFont(undefined, 'bold')
  doc.text(`SONIMAX MÓVIL - ${department}`, 14, 20)
  
  doc.setFontSize(10)
  doc.setFont(undefined, 'normal')
  doc.text(`Fecha: ${new Date().toLocaleDateString()}`, 14, 28)
  doc.text(`Total de productos: ${productsInDept.length}`, 14, 34)

  const tableData = productsInDept.map((p) => [
  p.codigo || "N/A",
  p.nombre,
  `$${p.precio_cliente.toFixed(2)}`,
  `$${p.precio_mayor.toFixed(2)}`,
  `$${p.precio_gmayor.toFixed(2)}`,
  ])

  doc.autoTable({
  startY: 40,
  head: [["Código", "Descripción", "Detal", "Mayor", "G. Mayor"]],
  body: tableData,
  theme: "grid",
  headStyles: { fillColor: [220, 38, 38] },
  })

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
})
