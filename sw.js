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
