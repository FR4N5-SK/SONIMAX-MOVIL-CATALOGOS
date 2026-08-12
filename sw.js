// ============================================================
// SONIMAX MÓVIL - Service Worker con Soporte Offline Completo
// ============================================================

const CACHE_VERSION = "v7"
const APP_CACHE = "sonimax-app-" + CACHE_VERSION
const IMAGE_CACHE = "sonimax-images-" + CACHE_VERSION
const API_CACHE = "sonimax-api-" + CACHE_VERSION

// Función para limitar el tamaño de una caché (LRU Eviction)
async function trimCache(cacheName, maxItems) {
  try {
    const cache = await caches.open(cacheName)
    const keys = await cache.keys()
    if (keys.length > maxItems) {
      await cache.delete(keys[0])
      trimCache(cacheName, maxItems)
    }
  } catch (err) {
    console.warn("[SW] Error en trimCache:", err)
  }
}


// Recursos del "App Shell" que siempre deben estar disponibles offline
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./app-features.js",
  "./app-update-products.js",
  "./supabase-config.js",
]

// ============================================================
// INSTALAR: Guarda los recursos del App Shell en caché
// ============================================================
self.addEventListener("install", (event) => {
  console.log("[SW] ✅ Service Worker v6 instalándose...")
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) => {
        console.log("[SW] 📦 Guardando App Shell en caché...")
        // Usamos addAll con manejo de errores para no fallar si uno falla
        return Promise.allSettled(APP_SHELL.map((url) => cache.add(url)))
      })
      .then(() => {
        console.log("[SW] ✅ App Shell guardado. Activando inmediatamente...")
        return self.skipWaiting()
      })
      .catch((err) => {
        console.error("[SW] ❌ Error guardando App Shell:", err)
        return self.skipWaiting()
      })
  )
})

// ============================================================
// ACTIVAR: Limpiar cachés antiguas
// ============================================================
self.addEventListener("activate", (event) => {
  console.log("[SW] 🚀 Service Worker v6 activado")
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            // Eliminar cachés que NO sean de la versión actual
            if (cacheName !== APP_CACHE && cacheName !== IMAGE_CACHE && cacheName !== API_CACHE) {
              console.log("[SW] 🗑️ Eliminando caché antigua:", cacheName)
              return caches.delete(cacheName)
            }
          })
        )
      })
      .then(() => self.clients.claim())
  )
})

// ============================================================
// FETCH: Interceptar todas las peticiones
// ============================================================
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)
  const method = event.request.method

  // Solo manejar GET
  if (method !== "GET") return

  // ── 1. IMÁGENES (ibb.co o Supabase Storage CDN / Render API) ───────────
  //    Estrategia: Cache First (si está en caché, usa caché; si no, descarga y guarda)
  if (
    url.hostname.includes("ibb.co") ||
    url.hostname.includes("i.ibb.co") ||
    url.pathname.includes("/storage/v1/object/public/") ||
    url.pathname.includes("/storage/v1/render/image/public/") ||
    url.pathname.includes("/storage/v1/object/sign/")
  ) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then((cache) => {
        return cache.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse
          }
          return fetch(event.request)
            .then((networkResponse) => {
              // Aceptar respuestas HTTP 200 y respuestas opaque de CORS
              if (networkResponse && (networkResponse.status === 200 || networkResponse.type === "opaque")) {
                cache.put(event.request, networkResponse.clone())
                // Limitar tamaño de caché para evitar cuota excedida en móviles
                trimCache(IMAGE_CACHE, 300)
              }
              return networkResponse
            })
            .catch(() => {
              console.warn("[SW] ⚠️ Sin conexión para imagen:", url.pathname)
              return new Response("", { status: 503 })
            })
        })
      })
    )
    return
  }

  // ── 2. API DE SUPABASE (REST / Consultas - NO imágenes) ─────
  //    Estrategia: Network First con Cache de respuestas API (para offline)
  if (
    (url.hostname.includes("supabase.co") || url.hostname.includes("supabase.io")) &&
    !url.pathname.includes("/storage/v1/object/public/") &&
    !url.pathname.includes("/storage/v1/render/image/public/") &&
    !url.pathname.includes("/storage/v1/object/sign/")
  ) {
    event.respondWith(
      fetch(event.request.clone())
        .then((networkResponse) => {
          // Guardar respuesta exitosa de la API en caché
          if (networkResponse && networkResponse.status === 200) {
            const clonedResponse = networkResponse.clone()
            caches.open(API_CACHE).then((cache) => {
              cache.put(event.request, clonedResponse)
            })
          }
          return networkResponse
        })
        .catch(() => {
          // Sin red: intentar servir desde caché de API
          return caches.open(API_CACHE).then((cache) => {
            return cache.match(event.request).then((cachedApiResponse) => {
              if (cachedApiResponse) {
                console.log("[SW] 📱 API offline: sirviendo desde caché:", url.pathname)
                return cachedApiResponse
              }
              // Sin caché de API: respuesta de error clara
              return new Response(JSON.stringify({ error: "Sin conexión a internet" }), {
                status: 503,
                headers: { "Content-Type": "application/json" },
              })
            })
          })
        })
    )
    return
  }

  // ── 3. CDN (Tailwind, Supabase JS, Chart.js, etc.) ─────────
  //    Estrategia: Cache First
  if (
    url.hostname.includes("cdn.tailwindcss.com") ||
    url.hostname.includes("cdn.jsdelivr.net") ||
    url.hostname.includes("cdnjs.cloudflare.com") ||
    url.hostname.includes("fonts.googleapis.com") ||
    url.hostname.includes("fonts.gstatic.com")
  ) {
    event.respondWith(
      caches.open(APP_CACHE).then((cache) => {
        return cache.match(event.request).then((cached) => {
          if (cached) return cached
          return fetch(event.request).then((response) => {
            if (response && response.status === 200) {
              cache.put(event.request, response.clone())
            }
            return response
          }).catch(() => new Response("", { status: 503 }))
        })
      })
    )
    return
  }

  // ── 4. RECURSOS LOCALES (HTML, CSS, JS) ────────────────────
  //    Estrategia: Network First con fallback a caché
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          // Si la respuesta es buena, actualizar la caché
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone()
            caches.open(APP_CACHE).then((cache) => {
              cache.put(event.request, responseToCache)
            })
          }
          return networkResponse
        })
        .catch(() => {
          // Sin red: usar la versión en caché
          return caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
              console.log("[SW] 📱 Modo offline: sirviendo desde caché:", url.pathname)
              return cachedResponse
            }
            // Fallback final: index.html (para rutas SPA)
            return caches.match("./index.html")
          })
        })
    )
    return
  }
})

// ============================================================
// MENSAJES: Descargas en segundo plano desde la app
// ============================================================
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "DOWNLOAD_IMAGE") {
    const imageUrl = event.data.url
    console.log("[SW] 📥 Descargando imagen en segundo plano:", imageUrl)

    caches.open(IMAGE_CACHE).then((cache) => {
      // Solo descargar si no está ya en caché
      cache.match(imageUrl).then((cached) => {
        if (cached) return // Ya está en caché, no descargar de nuevo

        fetch(imageUrl)
          .then((response) => {
            if (response && response.status === 200) {
              cache.put(imageUrl, response.clone())
              console.log("[SW] ✅ Imagen guardada en segundo plano:", imageUrl)

              // Notificar a la app
              self.clients.matchAll().then((clients) => {
                clients.forEach((client) => {
                  client.postMessage({ type: "DOWNLOAD_COMPLETE", url: imageUrl })
                })
              })
            }
          })
          .catch((err) => {
            console.error("[SW] ❌ Error descargando imagen:", imageUrl, err)
          })
      })
    })
  }

  // Limpiar caché de imágenes (útil para liberar espacio)
  if (event.data && event.data.type === "CLEAR_IMAGE_CACHE") {
    caches.delete(IMAGE_CACHE).then(() => {
      console.log("[SW] 🗑️ Caché de imágenes limpiado")
    })
  }
})
