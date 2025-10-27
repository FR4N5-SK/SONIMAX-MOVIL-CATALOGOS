// Service Worker para caché persistente de imágenes
const CACHE_NAME = "sonimax-images-v1"
const IMAGE_CACHE_NAME = "sonimax-images-store"

// Instalar Service Worker
self.addEventListener("install", (event) => {
  console.log("[SW] Service Worker instalado")
  self.skipWaiting()
})

// Activar Service Worker
self.addEventListener("activate", (event) => {
  console.log("[SW] Service Worker activado")
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== IMAGE_CACHE_NAME) {
            console.log("[SW] Eliminando caché antigua:", cacheName)
            return caches.delete(cacheName)
          }
        }),
      )
    }),
  )
  return self.clients.claim()
})

// Interceptar peticiones de imágenes
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)

  // Solo cachear imágenes de imgbb
  if (url.hostname.includes("ibb.co") || url.hostname.includes("i.ibb.co")) {
    event.respondWith(
      caches.open(IMAGE_CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse
          }

          // Si no está en caché, descargar y guardar
          return fetch(event.request)
            .then((networkResponse) => {
              // Solo cachear respuestas exitosas
              if (networkResponse && networkResponse.status === 200) {
                cache.put(event.request, networkResponse.clone())
              }
              return networkResponse
            })
            .catch((error) => {
              console.error("[SW] Error descargando imagen:", error)
              return new Response("", { status: 404 })
            })
        })
      }),
    )
  }
})

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "PRELOAD_IMAGES") {
    const imageUrls = event.data.urls
    console.log("[SW] Iniciando precarga agresiva de", imageUrls.length, "imágenes")

    // No usar event.waitUntil para evitar timeouts - procesar en background
    preloadImagesAggressive(imageUrls)
  }
})

async function preloadImagesAggressive(imageUrls) {
  const cache = await caches.open(IMAGE_CACHE_NAME)
  let loadedCount = 0
  const totalCount = imageUrls.length
  const BATCH_SIZE = 30 // Lotes más pequeños para evitar sobrecarga
  const CONCURRENT_BATCHES = 3 // Procesar 3 lotes en paralelo

  console.log(`[SW] Procesando ${totalCount} imágenes en lotes de ${BATCH_SIZE}`)

  // Dividir URLs en lotes
  const batches = []
  for (let i = 0; i < imageUrls.length; i += BATCH_SIZE) {
    batches.push(imageUrls.slice(i, i + BATCH_SIZE))
  }

  // Función para procesar un lote
  const processBatch = async (batch, batchIndex) => {
    const batchPromises = batch.map(async (url) => {
      try {
        const response = await fetch(url, {
          mode: "no-cors",
          cache: "force-cache",
        })
        if (response) {
          await cache.put(url, response)
          return true
        }
        return false
      } catch (error) {
        return false
      }
    })

    const results = await Promise.allSettled(batchPromises)
    const successCount = results.filter((r) => r.status === "fulfilled" && r.value).length

    return { batchIndex, successCount }
  }

  // Procesar lotes en grupos concurrentes
  for (let i = 0; i < batches.length; i += CONCURRENT_BATCHES) {
    const batchGroup = []

    // Crear grupo de lotes concurrentes
    for (let j = 0; j < CONCURRENT_BATCHES && i + j < batches.length; j++) {
      const batchIndex = i + j
      batchGroup.push(processBatch(batches[batchIndex], batchIndex))
    }

    // Procesar grupo de lotes en paralelo
    const results = await Promise.allSettled(batchGroup)

    // Contar imágenes cargadas
    results.forEach((result) => {
      if (result.status === "fulfilled") {
        loadedCount += result.value.successCount
      }
    })

    // Reportar progreso cada grupo de lotes
    const currentBatch = Math.min(i + CONCURRENT_BATCHES, batches.length)
    console.log(`[SW] Progreso: ${loadedCount}/${totalCount} (Lote ${currentBatch}/${batches.length})`)

    // Enviar progreso a todos los clientes
    const clients = await self.clients.matchAll()
    clients.forEach((client) => {
      client.postMessage({
        type: "PRELOAD_PROGRESS",
        loaded: loadedCount,
        total: totalCount,
        batch: currentBatch,
        totalBatches: batches.length,
      })
    })
  }

  console.log(`[SW] ✅ Precarga completada: ${loadedCount}/${totalCount} imágenes en caché`)

  // Notificar finalización
  const clients = await self.clients.matchAll()
  clients.forEach((client) => {
    client.postMessage({
      type: "PRELOAD_COMPLETE",
      count: loadedCount,
      total: totalCount,
    })
  })
}
