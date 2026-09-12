// ============================================================
// SONIMAX MÓVIL - Service Worker v13 — Cache-First Images
// Optimizado para minimizar consumo de Supabase Egress.
// Las imágenes de Supabase se sirven con Cache-First: se descargan
// una única vez desde el endpoint /render/image/ (ya optimizado)
// y se almacenan indefinidamente en el dispositivo.
// ============================================================

const CACHE_VERSION = "v14"
const APP_CACHE = "sonimax-app-" + CACHE_VERSION
const IMAGE_CACHE = "sonimax-images-" + CACHE_VERSION
const API_CACHE = "sonimax-api-" + CACHE_VERSION

const FALLBACK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><rect width="100%" height="100%" fill="#f1f5f9"/><path d="M100 125a20 20 0 100-40 20 20 0 000 40zm120 75H80l40-55 30 35 40-45 30 65z" fill="#cbd5e1"/></svg>`

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
  console.log("[SW] ✅ Service Worker v13 instalándose...")
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
  console.log("[SW] 🚀 Service Worker v13 activado")
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

  // ── 1. IMÁGENES de Supabase Storage (render/image y object/public) ──
  // Estrategia: Cache-First — se descarga UNA sola vez y se guarda para siempre.
  // Esto evita que Supabase contabilice descargas repetidas de la misma imagen.
  // Las URLs ya vienen optimizadas con Supabase Image Transformation (?width=360&quality=70&format=webp)
  if (
    (url.hostname.includes("supabase.co") || url.hostname.includes("supabase.io")) &&
    (url.pathname.includes("/storage/v1/render/image/") || url.pathname.includes("/storage/v1/object/"))
  ) {
    event.respondWith(
      caches.open(IMAGE_CACHE).then((cache) => {
        // Normalizar URL: quitar query params para que se almacene por su URL limpia original
        const cleanUrl = event.request.url.split("?")[0]
        const normalizedRequest = new Request(cleanUrl, {
          mode: "cors",
          credentials: "omit",
        })
        return cache.match(normalizedRequest).then((cached) => {
          if (cached) {
            // ✅ Cache HIT — no se consume egress de Supabase
            return cached
          }
          // Cache MISS — primera descarga, guardar para no repetir
          return fetch(event.request.url, { mode: "cors", credentials: "omit" })
            .then((response) => {
              if (response && response.status === 200) {
                cache.put(normalizedRequest, response.clone()).catch(() => {})
              }
              return response
            })
            .catch(() => {
              return new Response(FALLBACK_SVG, {
                headers: { "Content-Type": "image/svg+xml" },
              })
            })
        })
      })
    )
    return
  }

  // ── 2. Imágenes de ibb.co — dejar pasar sin cachear (dominio externo) ──
  if (url.hostname.includes("ibb.co") || url.hostname.includes("i.ibb.co")) {
    return
  }

  // ── 3. API DE SUPABASE (Base de datos / Auth) ────────────────
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

  // ── 4. CDN (Tailwind, Supabase JS, Chart.js, Fuentes, etc.) ─
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

  // ── 5. RECURSOS LOCALES (HTML, CSS, JS) ────────────────────
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
// MENSAJES: Limpieza de caché
// ============================================================
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "CLEAR_IMAGE_CACHE") {
    caches.delete(IMAGE_CACHE).then(() => {
      console.log("[SW] 🗑️ Caché de imágenes limpiado")
    })
  }
})
