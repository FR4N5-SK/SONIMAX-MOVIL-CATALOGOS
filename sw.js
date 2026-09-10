// ============================================================
// SONIMAX MÓVIL - Service Worker con Soporte Offline Completo
// ============================================================

const CACHE_VERSION = "v9"
const APP_CACHE = "sonimax-app-" + CACHE_VERSION
const IMAGE_CACHE = "sonimax-images-" + CACHE_VERSION
const API_CACHE = "sonimax-api-" + CACHE_VERSION

// Clave anon del Supabase Viejo (Plan Pro) - para autenticar peticiones de imágenes
const SUPABASE_VIEJO_URL = "tuqwzrsgczhgmfnfmryw.supabase.co"
const SUPABASE_VIEJO_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR1cXd6cnNnY3poZ21mbmZtcnl3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxMTc4NTgsImV4cCI6MjA5NTY5Mzg1OH0.-mMR7gaq_TA_PvuZKSP4o_N2sCVaP0N7ihV2Bs94na0"
const SUPABASE_OLD_URL = "gvaitosnfotnkrpjojqn.supabase.co"
const SUPABASE_OLD_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd2YWl0b3NuZm90bmtycGpvanFuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2MjA2NzQsImV4cCI6MjEwMjE5NjY3NH0.QKToCRnPi4GqCOjas55Ihp64hHVjdFScpyZpfJmltrs"

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
  console.log("[SW] ✅ Service Worker v7 instalándose...")
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
  console.log("[SW] 🚀 Service Worker v8 activado")
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

  // ── 1. IMÁGENES (ibb.co y Supabase Storage) ─────────────────
  // Estrategia: Cache First
  const isImageRequest =
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

        // Si la URL tiene parámetros, intentar match por URL limpia
        const cleanUrl = url.origin + url.pathname
        const cleanMatch = await cache.match(cleanUrl)
        if (cleanMatch) {
          return cleanMatch
        }

        // 2. Si no está en caché, descargar de la red y guardar copia
        try {
          // Para URLs de Supabase Storage, añadir cabeceras de autenticación
          let fetchRequest = event.request
          if (url.hostname.includes("supabase.co") || url.hostname.includes("supabase.io")) {
            const anonKey = url.hostname.includes(SUPABASE_VIEJO_URL)
              ? SUPABASE_VIEJO_ANON_KEY
              : SUPABASE_OLD_ANON_KEY
            fetchRequest = new Request(event.request.url, {
              method: "GET",
              headers: {
                "apikey": anonKey,
                "Authorization": `Bearer ${anonKey}`,
              },
              mode: "cors",
              credentials: "omit",
            })
          }

          const networkResponse = await fetch(fetchRequest)
          if (networkResponse && (networkResponse.status === 200 || networkResponse.type === "opaque")) {
            // Guardar en caché tanto la petición original como la URL limpia para CERO consumo redundante
            cache.put(event.request, networkResponse.clone()).catch(() => {})
            const cleanUrl = url.origin + url.pathname
            cache.put(cleanUrl, networkResponse.clone()).catch(() => {})
          }
          return networkResponse
        } catch (fetchErr) {
          console.warn("[SW] ⚠️ Sin conexión para imagen:", url.href)
          return new Response("", { status: 503, statusText: "Offline Image Unavailable" })
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

        // Añadir autenticación si es imagen de Supabase Storage
        let fetchRequest = imageUrl
        try {
          const parsedUrl = new URL(imageUrl)
          if (parsedUrl.hostname.includes("supabase.co") || parsedUrl.hostname.includes("supabase.io")) {
            const anonKey = parsedUrl.hostname.includes(SUPABASE_VIEJO_URL)
              ? SUPABASE_VIEJO_ANON_KEY
              : SUPABASE_OLD_ANON_KEY
            fetchRequest = new Request(imageUrl, {
              method: "GET",
              headers: {
                "apikey": anonKey,
                "Authorization": `Bearer ${anonKey}`,
              },
              mode: "cors",
              credentials: "omit",
            })
          }
        } catch (_) {}

        fetch(fetchRequest)
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
