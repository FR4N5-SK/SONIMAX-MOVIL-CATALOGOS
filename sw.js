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
            console.log("[SW] ✓ Imagen servida desde caché:", url.pathname)
            return cachedResponse
          }

          console.log("[SW] ⬇ Descargando imagen:", url.pathname)

          // Si no está en caché, descargar y guardar
          return fetch(event.request)
            .then((networkResponse) => {
              // Solo cachear respuestas exitosas
              if (networkResponse && networkResponse.status === 200) {
                cache.put(event.request, networkResponse.clone())
                console.log("[SW] 💾 Imagen guardada en caché:", url.pathname)
              }
              return networkResponse
            })
            .catch((error) => {
              console.error("[SW] ❌ Error descargando imagen:", url.pathname, error)
              return new Response("", { status: 404 })
            })
        })
      }),
    )
  }
})

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "DOWNLOAD_IMAGE") {
    const imageUrl = event.data.url
    console.log("[SW] 📥 Solicitud de descarga en segundo plano:", imageUrl)

    caches.open(IMAGE_CACHE_NAME).then((cache) => {
      fetch(imageUrl)
        .then((response) => {
          if (response && response.status === 200) {
            cache.put(imageUrl, response.clone())
            console.log("[SW] ✓ Descarga en segundo plano completada:", imageUrl)

            // Notificar a la app que la descarga terminó
            self.clients.matchAll().then((clients) => {
              clients.forEach((client) => {
                client.postMessage({
                  type: "DOWNLOAD_COMPLETE",
                  url: imageUrl,
                })
              })
            })
          }
        })
        .catch((error) => {
          console.error("[SW] ❌ Error en descarga en segundo plano:", imageUrl, error)
        })
    })
  }
})
