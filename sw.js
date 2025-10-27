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
            console.log("[SW] Imagen desde caché:", url.pathname)
            return cachedResponse
          }

          // Si no está en caché, descargar y guardar
          return fetch(event.request)
            .then((networkResponse) => {
              // Solo cachear respuestas exitosas
              if (networkResponse && networkResponse.status === 200) {
                cache.put(event.request, networkResponse.clone())
                console.log("[SW] Imagen cacheada:", url.pathname)
              }
              return networkResponse
            })
            .catch((error) => {
              console.error("[SW] Error descargando imagen:", error)
              // Retornar imagen placeholder en caso de error
              return new Response("", { status: 404 })
            })
        })
      }),
    )
  }
})

// Mensaje para precarga de imágenes
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "PRELOAD_IMAGES") {
    const imageUrls = event.data.urls
    console.log("[SW] Precargando", imageUrls.length, "imágenes en lotes")

    event.waitUntil(
      caches.open(IMAGE_CACHE_NAME).then(async (cache) => {
        let loadedCount = 0
        const totalCount = imageUrls.length
        const BATCH_SIZE = 50 // Cargar 50 imágenes por lote
        const DELAY_BETWEEN_BATCHES = 1000 // 1 segundo entre lotes

        // Dividir URLs en lotes
        const batches = []
        for (let i = 0; i < imageUrls.length; i += BATCH_SIZE) {
          batches.push(imageUrls.slice(i, i + BATCH_SIZE))
        }

        console.log(`[SW] Dividido en ${batches.length} lotes de ${BATCH_SIZE} imágenes`)

        // Procesar cada lote
        for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
          const batch = batches[batchIndex]
          console.log(`[SW] Procesando lote ${batchIndex + 1}/${batches.length}`)

          // Cargar todas las imágenes del lote en paralelo
          const batchPromises = batch.map(async (url) => {
            try {
              const response = await fetch(url, {
                mode: "no-cors",
                cache: "force-cache",
              })
              if (response) {
                await cache.put(url, response)
                return { success: true, url }
              }
            } catch (error) {
              console.error("[SW] Error en imagen:", url.substring(0, 50), error.message)
              return { success: false, url, error: error.message }
            }
          })

          // Esperar a que termine el lote
          const results = await Promise.allSettled(batchPromises)

          // Contar exitosas
          const successCount = results.filter((r) => r.status === "fulfilled" && r.value?.success).length
          loadedCount += successCount

          // Reportar progreso
          self.clients.matchAll().then((clients) => {
            clients.forEach((client) => {
              client.postMessage({
                type: "PRELOAD_PROGRESS",
                loaded: loadedCount,
                total: totalCount,
                batch: batchIndex + 1,
                totalBatches: batches.length,
              })
            })
          })

          // Delay entre lotes (excepto el último)
          if (batchIndex < batches.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, DELAY_BETWEEN_BATCHES))
          }
        }

        console.log(`[SW] Precarga completada: ${loadedCount}/${totalCount} imágenes`)

        // Notificar finalización
        self.clients.matchAll().then((clients) => {
          clients.forEach((client) => {
            client.postMessage({
              type: "PRELOAD_COMPLETE",
              count: loadedCount,
              total: totalCount,
            })
          })
        })
      }),
    )
  }
})
