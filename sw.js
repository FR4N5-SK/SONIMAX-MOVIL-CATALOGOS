// ============================================================
// SONIMAX MÓVIL - Service Worker con Soporte Offline Completo
// ============================================================

const CACHE_VERSION = "v5"
const APP_CACHE = "sonimax-app-" + CACHE_VERSION
const IMAGE_CACHE = "sonimax-images-" + CACHE_VERSION
const API_CACHE = "sonimax-api-" + CACHE_VERSION

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
  console.log("[SW] ✅ Service Worker v5 instalándose...")
  event.waitUntil(
    caches
      .open(APP_CACHE)
      .then((cache) => {
        console.log("[SW] 📦 Guardando App Shell en caché...")
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
  console.log("[SW] 🚀 Service Worker v5 activado")
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

  // ── 1. IMÁGENES (Supabase Storage, ibb.co, o cualquier imagen de producto) ──
  // Estrategia: Cache First (Ahorra hasta 99% de Supabase Egress)
  const isImageRequest =
    event.request.destination === "image" ||
    url.pathname.match(/\.(jpg|jpeg|png|webp|gif|svg|avif)($|\?)/i) ||
    url.hostname.includes("ibb.co") ||
    url.hostname.includes("i.ibb.co") ||
    ((url.hostname.includes("supabase.co") || url.hostname.includes("supabase.io")) && url.pathname.includes("/storage/"))

  if (isImageRequest) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then(async (cache) => {
        // 1. Intentar servir desde caché local
        const cachedResponse = await cache.match(event.request, { ignoreSearch: false })
        if (cachedResponse) {
          return cachedResponse
        }

        // Si la URL tiene parámetros de timestamp o query, intentar match por URL limpia
        const cleanUrl = url.origin + url.pathname
        const cleanMatch = await cache.match(cleanUrl)
        if (cleanMatch) {
          return cleanMatch
        }

        // 2. Si no está en caché, descargar de la red y guardar copia
        try {
          const networkResponse = await fetch(event.request)
          // Aceptar status 200 y respuestas opacas (cross-origin / no-cors)
          if (networkResponse && (networkResponse.status === 200 || networkResponse.type === "opaque")) {
            cache.put(event.request, networkResponse.clone()).catch(() => {})
          }
          return networkResponse
        } catch (fetchErr) {
          console.warn("[SW] ⚠️ Sin conexión para imagen:", url.pathname)
          // Fallback a imagen por defecto si existe en caché
          const fallback = await caches.match("/images/ProductImages.jpg")
          if (fallback) return fallback
          return new Response("", { status: 503, statusText: "Offline Image" })
        }
      })
    )
    return
  }

  // ── 2. API DE SUPABASE (Base de datos / Auth) ────────────────
  // Estrategia: Network First con fallback a Cache
  if (
    (url.hostname.includes("supabase.co") || url.hostname.includes("supabase.io")) &&
    !url.pathname.includes("/storage/")
  ) {
    event.respondWith(
      fetch(event.request.clone())
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clonedResponse = networkResponse.clone()
            caches.open(API_CACHE).then((cache) => {
              cache.put(event.request, clonedResponse).catch(() => {})
            })
          }
          return networkResponse
        })
        .catch(() => {
          return caches.open(API_CACHE).then((cache) => {
            return cache.match(event.request).then((cachedApiResponse) => {
              if (cachedApiResponse) {
                console.log("[SW] 📱 API offline: sirviendo desde caché:", url.pathname)
                return cachedApiResponse
              }
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

  // ── 3. CDN (Tailwind, Supabase JS, Chart.js, Fuentes, etc.) ─
  // Estrategia: Cache First
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
          return fetch(event.request)
            .then((response) => {
              if (response && (response.status === 200 || response.type === "opaque")) {
                cache.put(event.request, response.clone()).catch(() => {})
              }
              return response
            })
            .catch(() => new Response("", { status: 503 }))
        })
      })
    )
    return
  }

  // ── 4. RECURSOS LOCALES (HTML, CSS, JS) ────────────────────
  // Estrategia: Network First con fallback a caché
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone()
            caches.open(APP_CACHE).then((cache) => {
              cache.put(event.request, responseToCache).catch(() => {})
            })
          }
          return networkResponse
        })
        .catch(() => {
          return caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
              console.log("[SW] 📱 Modo offline: sirviendo desde caché:", url.pathname)
              return cachedResponse
            }
            return caches.match("./index.html")
          })
        })
    )
    return
  }
})

// ============================================================
// MENSAJES: Descargas en segundo plano y limpieza
// ============================================================
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "DOWNLOAD_IMAGE") {
    const imageUrl = event.data.url
    caches.open(IMAGE_CACHE).then((cache) => {
      cache.match(imageUrl).then((cached) => {
        if (cached) return

        fetch(imageUrl)
          .then((response) => {
            if (response && (response.status === 200 || response.type === "opaque")) {
              cache.put(imageUrl, response.clone()).catch(() => {})
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

  if (event.data && event.data.type === "CLEAR_IMAGE_CACHE") {
    caches.delete(IMAGE_CACHE).then(() => {
      console.log("[SW] 🗑️ Caché de imágenes limpiado")
    })
  }
})
