// SONIMAX MÓVIL - Aplicación Principal
// Sistema actualizado con USUARIO en lugar de EMAIL

/* global XLSX */
/* eslint-disable no-undef */

/**
 * @typedef {Object} XLSX
 * @global
 */

let currentUser = null
let currentUserRole = null
let allProducts = []
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
const MAX_RETRY_ATTEMPTS = 5
const RETRY_DELAY = 3000 // 3 segundos entre reintentos

const imageLoadState = {
  loadedImages: new Set(),
  failedImages: new Map(), // url -> attemptCount
  inProgress: false,
  lastUpdate: null,
}

// ============================================
// GESTIÓN DE ESTADO DE CARGA DE IMÁGENES
// ============================================

function loadImageLoadState() {
  try {
    const saved = localStorage.getItem(IMAGE_LOAD_STATE_KEY)
    if (saved) {
      const parsed = JSON.parse(saved)
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
    .filter((url) => url && url !== "/generic-product-display.png")
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
      products
        .map((p) => optimizeImageUrl(p.imagen_url))
        .filter((url) => url && url !== "/generic-product-display.png"),
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

async function preloadAllImages() {
  if (!("caches" in window)) {
    console.log("[IMG-LOAD] ⚠️ Cache API no disponible")
    return
  }

  // Cargar estado previo
  loadImageLoadState()

  // Verificar si los productos cambiaron
  const { changed, newUrls } = checkProductsChanged(allProducts)

  // Obtener todas las URLs optimizadas
  const allImageUrls = allProducts
    .map((p) => p.imagen_url)
    .filter((url) => url && url !== "/generic-product-display.png")
    .map((url) => optimizeImageUrl(url))

  // Determinar qué imágenes cargar
  let urlsToLoad = []

  if (changed && newUrls.length > 0) {
    // Solo cargar las nuevas
    urlsToLoad = newUrls
    console.log(`[IMG-LOAD] 🔄 Cargando solo ${urlsToLoad.length} imágenes nuevas`)
  } else {
    // Cargar las que no están en el estado o fallaron
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

  await loadImagesWithRetry(urlsToLoad)

  imageLoadState.inProgress = false
  saveImageLoadState()
}

async function loadImagesWithRetry(urls) {
  const cache = await caches.open("sonimax-images-store")
  const BATCH_SIZE = 20
  const CONCURRENT_BATCHES = 2

  console.log(`[IMG-LOAD] 🚀 Iniciando carga de ${urls.length} imágenes...`)
  console.log(`[IMG-LOAD] 📊 Ya cargadas: ${imageLoadState.loadedImages.size}`)
  console.log(`[IMG-LOAD] 📊 Con errores previos: ${imageLoadState.failedImages.size}`)
  console.log(`[IMG-LOAD] 📊 Por cargar ahora: ${urls.length}`)

  // Dividir en lotes
  const batches = []
  for (let i = 0; i < urls.length; i += BATCH_SIZE) {
    batches.push(urls.slice(i, i + BATCH_SIZE))
  }

  let totalLoaded = 0
  let totalFailed = 0

  // Procesar lotes
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

    // Guardar estado periódicamente
    saveImageLoadState()

    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  console.log(`[IMG-LOAD] ✅ Carga inicial completada`)
  console.log(`[IMG-LOAD] 📊 Resultado: ${totalLoaded} exitosas, ${totalFailed} fallidas de ${urls.length} totales`)
  console.log(`[IMG-LOAD] 📊 Total acumulado: ${imageLoadState.loadedImages.size} imágenes cargadas en total`)

  // Reintentar las fallidas
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
      // Verificar si ya está en caché
      const cachedResponse = await cache.match(url)
      if (cachedResponse) {
        imageLoadState.loadedImages.add(url)
        imageLoadState.failedImages.delete(url)
        console.log(`[IMG-LOAD] ✅ Ya en caché: ${url.substring(url.lastIndexOf("/") + 1)}`)
        return { success: true, cached: true }
      }

      // Descargar con timeout
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000)

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

  for (let i = 0; i < failedUrls.length; i++) {
    const url = failedUrls[i]
    const currentAttempt = imageLoadState.failedImages.get(url) || 0

    console.log(
      `[IMG-LOAD] 🔄 Reintentando (${i + 1}/${failedUrls.length}) intento ${currentAttempt + 1}/${MAX_RETRY_ATTEMPTS}: ${url.substring(url.lastIndexOf("/") + 1)}`,
    )

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000)

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
        console.log(
          `[IMG-LOAD] ✅ Reintento exitoso (${retrySuccess}/${failedUrls.length}): ${url.substring(url.lastIndexOf("/") + 1)}`,
        )
      } else {
        const attempts = imageLoadState.failedImages.get(url) + 1
        imageLoadState.failedImages.set(url, attempts)
        retryFailed++
        console.log(
          `[IMG-LOAD] ❌ Reintento fallido (${retryFailed}/${failedUrls.length}): ${url.substring(url.lastIndexOf("/") + 1)}`,
        )
      }
    } catch (error) {
      const attempts = imageLoadState.failedImages.get(url) + 1
      imageLoadState.failedImages.set(url, attempts)
      retryFailed++
      console.log(
        `[IMG-LOAD] ❌ Reintento fallido (intento ${attempts}/${MAX_RETRY_ATTEMPTS}): ${url.substring(url.lastIndexOf("/") + 1)} - ${error.message}`,
      )
    }

    // Pequeña pausa entre reintentos
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  console.log(`[IMG-LOAD] 📊 Reintentos completados: ${retrySuccess} exitosos, ${retryFailed} fallidos`)
  console.log(`[IMG-LOAD] 📊 Total acumulado: ${imageLoadState.loadedImages.size} imágenes cargadas`)

  saveImageLoadState()

  // Si aún hay fallidas, reintentar recursivamente
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
  if (!url || url === "/generic-product-display.png") {
    return url
  }

  if (url.includes("ibb.co")) {
    const separator = url.includes("?") ? "&" : "?"
    return `${url}${separator}w=400&quality=70`
  }

  return url
}

function createImagePlaceholder(url) {
  if (!url || url === "/generic-product-display.png") {
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
              const tempImg = new Image()
              tempImg.onload = () => {
                img.src = fullSrc
                img.classList.remove("image-loading")
                img.classList.add("image-loaded")
              }
              tempImg.onerror = () => {
                img.src = "/generic-product-display.png"
                img.classList.remove("image-loading")
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
    currentUserRole = data.role

    console.log("✅ Datos de usuario cargados:", {
      username: data.username,
      name: data.name,
      role: data.role,
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

  if (roleBadge) {
    roleBadge.textContent = `${currentUser.name} (${currentUserRole})`
    roleBadge.className = `role-badge-${currentUserRole}`
    roleBadge.classList.remove("hidden")
  }

  if (currentUserRole === "admin") {
    adminSection?.classList.remove("hidden")
    gestorSection?.classList.remove("hidden")
  } else if (currentUserRole === "gestor") {
    adminSection?.classList.add("hidden")
    gestorSection?.classList.remove("hidden")
  } else {
    adminSection?.classList.add("hidden")
    gestorSection?.classList.add("hidden")
  }
}

document.getElementById("logout-button")?.addEventListener("click", async () => {
  await window.supabaseClient.auth.signOut()
  currentUser = null
  currentUserRole = null
  cart = []
  showLogin()
})

function logoutFromSidebar() {
  window.supabaseClient.auth.signOut().then(() => {
    currentUser = null
    currentUserRole = null
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

  document.getElementById("create-user-button")?.addEventListener("click", () => {
    const roleSelect = document.getElementById("new-user-role")

    roleSelect.innerHTML = ""

    if (currentUserRole === "gestor") {
      roleSelect.innerHTML = `
        <option value="cliente">Cliente</option>
        <option value="distribuidor">Distribuidor</option>
        <option value="gestor">Gestor</option>
      `
    } else if (currentUserRole === "admin") {
      roleSelect.innerHTML = `
        <option value="cliente">Cliente</option>
        <option value="distribuidor">Distribuidor</option>
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
    if (currentUserRole === "admin") {
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

function renderDepartments() {
  const departments = [...new Set(allProducts.map((p) => p.departamento).filter(Boolean))]

  const navContainer = document.getElementById("departments-nav")
  const sidebarContainer = document.getElementById("sidebar-departments")

  navContainer.innerHTML = ""
  sidebarContainer.innerHTML = ""

  departments.forEach((dept) => {
    const navBtn = document.createElement("button")
    navBtn.className = "dept-button whitespace-nowrap px-5 py-2.5 rounded-xl font-semibold transition-all text-sm"
    navBtn.textContent = dept
    navBtn.dataset.dept = dept
    navBtn.addEventListener("click", () => filterByDepartment(dept))
    navContainer.appendChild(navBtn)

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

  if (dept === "all") {
    filteredProducts = allProducts
  } else {
    filteredProducts = allProducts.filter((p) => p.departamento === dept)
  }

  currentPage = 1

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

  const imageUrl = product.imagen_url || "/generic-product-display.png"
  const optimizedUrl = optimizeImageUrl(imageUrl)
  const placeholderUrl = createImagePlaceholder(imageUrl)

  card.innerHTML = `
    <div class="product-image-container">
      <img src="${placeholderUrl}"
           data-src="${optimizedUrl}"
           alt="${product.nombre}"
           class="product-image image-loading cursor-pointer hover:opacity-90 transition-opacity"
           loading="lazy"
           onerror="this.src='/generic-product-display.png'">
    </div>
    <div class="p-5">
      <h3 class="font-bold text-lg text-gray-800 mb-2 line-clamp-2">${product.nombre}</h3>
      ${product.descripcion ? `<p class="text-gray-600 text-sm mb-3 line-clamp-2">${product.descripcion}</p>` : ""}
      <div class="mb-4">
        ${priceHTML}
      </div>
      ${product.departamento ? `<span class="text-xs bg-gray-100 px-3 py-1 rounded-full text-gray-600 font-semibold block mb-3">${product.departamento}</span>` : ""}
      <button class="add-to-cart-btn w-full bg-gradient-to-r from-red-600 to-red-700 text-white font-bold py-3 rounded-xl hover:from-red-700 hover:to-red-800 transition-all shadow-lg">
        Agregar al Carrito
      </button>
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

  card.querySelector(".add-to-cart-btn").addEventListener("click", () => {
    openQuantityModal(product)
  })

  return card
}

function getPriceForRole(product) {
  switch (currentUserRole) {
    case "admin":
      return {
        display: "single",
        price: product.precio_gmayor || 0,
        label: "Gran Mayor",
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
  modal.classList.remove("hidden")
  quantityInput.focus()
}

function confirmQuantity() {
  const quantity = Number.parseInt(document.getElementById("quantity-input").value)

  if (quantity < 1) {
    alert("La cantidad debe ser al menos 1")
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

  addToCart(selectedProductForQuantity, quantity, selectedPrice)
  document.getElementById("quantity-modal").classList.add("hidden")
}

function addToCart(product, quantity, price) {
  const existingItem = cart.find((item) => item.id === product.id && item.price === price)

  if (existingItem) {
    existingItem.quantity += quantity
  } else {
    cart.push({
      ...product,
      quantity: quantity,
      price: price,
    })
  }

  saveCartToStorage()
  updateCartCount()
  animateCartButton()

  console.log(`✅ Agregado al carrito: ${product.nombre} x${quantity} a $${price.toFixed(2)}`)
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

    const optimizedCartImage = optimizeImageUrl(item.imagen_url || "/generic-product-display.png")

    cartItemDiv.innerHTML = `
      <div class="flex items-center space-x-4">
        <img src="${optimizedCartImage}"
             alt="${item.nombre}"
             class="w-20 h-20 object-cover rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
             loading="lazy"
             onerror="this.src='/generic-product-display.png'">
        <div class="flex-1">
          <h4 class="font-bold text-gray-800">${item.nombre}</h4>
          <p class="text-gray-600 text-sm">Cantidad: ${item.quantity}</p>
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
      showImageModal(item.imagen_url || "/generic-product-display.png", item.nombre)
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

  if (currentUserRole === "gestor") {
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
  } else if (currentUserRole === "distribuidor") {
    totalHTML = `$${totalMayor.toFixed(2)}`
  } else if (currentUserRole === "admin") {
    totalHTML = `$${totalGmayor.toFixed(2)}`
  } else {
    totalHTML = `$${totalDetal.toFixed(2)}`
  }

  cartTotal.innerHTML = totalHTML

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

    excelData.push(["CANTIDAD", "CÓDIGO", "DESCRIPCIÓN", "PRECIO UNITARIO", "SUBTOTAL"])

    let totalGmayor = 0

    cart.forEach((item) => {
      const product = allProducts.find((p) => p.id === item.id)
      const codigo = product ? product.descripcion || "S/C" : "S/C"
      const precioUnitario = product ? product.precio_gmayor || 0 : 0
      const subtotal = precioUnitario * item.quantity

      totalGmayor += subtotal

      excelData.push([item.quantity, codigo, item.nombre, `$${precioUnitario.toFixed(2)}`, `$${subtotal.toFixed(2)}`])
    })

    excelData.push([])
    excelData.push(["", "", "", "TOTAL:", `$${totalGmayor.toFixed(2)}`])

    const ws = window.XLSX.utils.aoa_to_sheet(excelData)

    const colWidths = [{ wch: 10 }, { wch: 15 }, { wch: 40 }, { wch: 15 }, { wch: 15 }]
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
      const codigo = product ? product.descripcion || "S/C" : "S/C"
      const precioUnitario = product ? product.precio_gmayor || 0 : 0
      const subtotal = precioUnitario * item.quantity

      message += `${item.quantity} - ${codigo} - ${item.nombre} - $${subtotal.toFixed(2)}\n`

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

  let totalGmayor = 0

  cart.forEach((item, index) => {
    const product = allProducts.find((p) => p.id === item.id)
    const codigo = product ? product.descripcion || "S/C" : "S/C"
    const precioUnitario = product ? product.precio_gmayor || 0 : 0
    const subtotal = precioUnitario * item.quantity

    totalGmayor += subtotal

    message += `${item.quantity} - ${codigo} - ${item.nombre} - $${subtotal.toFixed(2)}\n`

    if (index < cart.length - 1) {
      message += `\n`
    }
  })

  message += `\n\n*TOTAL G.MAYOR:* $${totalGmayor.toFixed(2)}`

  const encodedMessage = encodeURIComponent(message)
  const whatsappURL = `https://api.whatsapp.com/send?text=${encodedMessage}`

  window.open(whatsappURL, "_blank")
  clearCart()
  document.getElementById("cart-modal").classList.add("hidden")
  alert("Pedido enviado por WhatsApp. El carrito ha sido limpiado.")
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
    const codigo = product ? product.descripcion || "S/C" : "S/C"
    const subtotal = item.price * item.quantity

    message += `${item.quantity} - ${codigo} - ${item.nombre} - $${subtotal.toFixed(2)}\n`

    if (index < cart.length - 1) {
      message += `\n`
    }

    if (product) {
      totalDetal += (product.precio_cliente || 0) * item.quantity
      totalMayor += (product.precio_mayor || 0) * item.quantity
      totalGmayor += (product.precio_gmayor || 0) * item.quantity
    }
  })

  message += `\n\n*TOTALES:*\n`

  if (currentUserRole === "gestor") {
    message += `Total Detal: $${totalDetal.toFixed(2)}\n`
    message += `Total Mayor: $${totalMayor.toFixed(2)}\n`
    message += `Total G.Mayor: $${totalGmayor.toFixed(2)}`
  } else if (currentUserRole === "distribuidor") {
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

let searchTimeout = null
let deptSearchTimeout = null

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

function handleGlobalSearch(e) {
  const query = e.target.value.trim()

  clearTimeout(searchTimeout)

  const searchLoading = document.getElementById("search-loading")

  if (query === "") {
    filteredProducts = allProducts
    currentPage = 1
    renderProducts()
    if (searchLoading) searchLoading.classList.add("hidden")
    return
  }

  if (searchLoading) searchLoading.classList.remove("hidden")

  searchTimeout = setTimeout(() => {
    console.log("[SEARCH] Búsqueda global:", query)

    filteredProducts = searchProducts(allProducts, query)

    console.log(`[SEARCH] Resultados: ${filteredProducts.length} de ${allProducts.length} productos`)

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

    const productsInDept =
      currentDepartment === "all" ? allProducts : allProducts.filter((p) => p.departamento === currentDepartment)

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

async function handleCSVUpload() {
  if (!selectedCSVFile) {
    showCSVStatus("Por favor selecciona un archivo CSV", "error")
    return
  }

  if (currentUserRole !== "admin") {
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
      }

      if (
        colIndexes.descripcion === -1 ||
        colIndexes.detal === -1 ||
        colIndexes.mayor === -1 ||
        colIndexes.gmayor === -1
      ) {
        throw new Error("El CSV debe contener las columnas: DESCRIPCION, DETAL, MAYOR, GMAYOR")
      }

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

        if (!descripcion) continue

        const product = {
          nombre: descripcion,
          descripcion: codigo || "",
          precio_cliente: Number.parseFloat(detal) || 0,
          precio_mayor: Number.parseFloat(mayor) || 0,
          precio_gmayor: Number.parseFloat(gmayor) || 0,
          departamento: departamento,
          imagen_url: url,
        }

        products.push(product)
      }

      if (products.length === 0) {
        throw new Error("No se encontraron productos válidos en el CSV")
      }

      showCSVStatus(`Procesando ${products.length} productos...`, "info")

      const { error: deleteError } = await window.supabaseClient.from("products").delete().not("id", "is", null)

      if (deleteError) {
        console.error("Error al limpiar productos existentes:", deleteError)
        throw new Error("Error al limpiar productos existentes")
      }

      const { error } = await window.supabaseClient.from("products").insert(products)

      if (error) throw error

      showCSVStatus(
        `✅ ${products.length} productos subidos exitosamente (productos anteriores reemplazados)`,
        "success",
      )

      localStorage.removeItem(IMAGE_LOAD_STATE_KEY)
      localStorage.removeItem(PRODUCTS_HASH_KEY)
      console.log("[CSV] Estado de imágenes limpiado para nuevo CSV")

      setTimeout(() => {
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

  if (currentUserRole !== "admin") {
    showPDFStatus("Solo los administradores pueden exportar PDF", "error")
    return
  }

  try {
    showPDFStatus("Generando PDF...", "info")

    const { jsPDF } = window.jspdf
    const doc = new jsPDF()

    const productsInDept = allProducts.filter((p) => p.departamento === department)

    doc.setFontSize(18)
    doc.text(`SONIMAX MÓVIL - ${department}`, 14, 20)

    doc.setFontSize(10)
    doc.text(`Fecha: ${new Date().toLocaleDateString()}`, 14, 28)
    doc.text(`Total de productos: ${productsInDept.length}`, 14, 34)

    const tableData = productsInDept.map((p) => [
      p.nombre,
      `$${p.precio_cliente.toFixed(2)}`,
      `$${p.precio_mayor.toFixed(2)}`,
      `$${p.precio_gmayor.toFixed(2)}`,
    ])

    doc.autoTable({
      startY: 40,
      head: [["Producto", "Detal", "Mayor", "G. Mayor"]],
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
