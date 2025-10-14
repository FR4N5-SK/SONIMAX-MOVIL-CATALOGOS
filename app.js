// SONIMAX MÓVIL - Aplicación Optimizada

const state = {
  user: null,
  userRole: null,
  userName: null,
  products: [],
  departments: [],
  currentDepartment: "all",
  cart: [],
  searchQuery: "",
  deptSearchQuery: "",
  pendingProduct: null,
  isLoading: false,
}

// Función de debounce mejorada
function debounce(func, wait) {
  let timeout
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout)
      func(...args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}

// Normalización de texto mejorada para búsqueda
function normalizeText(text) {
  if (!text) return ""
  return text
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

// Parser CSV mejorado que maneja comillas y comas dentro de campos
function parseCSVLine(line) {
  const result = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    const nextChar = line[i + 1]

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim())
      current = ""
    } else {
      current += char
    }
  }

  result.push(current.trim())
  return result
}

// Gestión del carrito en localStorage
function saveCartToLocalStorage() {
  try {
    localStorage.setItem("sonimax_cart", JSON.stringify(state.cart))
  } catch (error) {
    console.error("[v0] Error guardando carrito:", error)
  }
}

function loadCartFromLocalStorage() {
  try {
    const savedCart = localStorage.getItem("sonimax_cart")
    if (savedCart) {
      state.cart = JSON.parse(savedCart)
      updateCartUI()
    }
  } catch (error) {
    console.error("[v0] Error cargando carrito:", error)
    state.cart = []
  }
}

function clearCartFromLocalStorage() {
  try {
    localStorage.removeItem("sonimax_cart")
  } catch (error) {
    console.error("[v0] Error eliminando carrito:", error)
  }
}

const supabaseClient = window.supabaseClient

async function handleLogout() {
  const { error } = await supabaseClient.auth.signOut()
  if (error) {
    console.error("[v0] Error cerrando sesión:", error)
  } else {
    state.user = null
    state.userRole = null
    state.userName = null
    showLoginScreen()
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  loadCartFromLocalStorage()
  await initApp()
})

async function initApp() {
  const {
    data: { session },
  } = await supabaseClient.auth.getSession()

  if (session) {
    await handleUserSession(session.user)
  } else {
    showLoginScreen()
  }

  setupEventListeners()
}

// Búsquedas con debounce
const debouncedGlobalSearch = debounce((value) => {
  state.searchQuery = normalizeText(value)
  renderProducts()
}, 300)

const debouncedDeptSearch = debounce((value) => {
  state.deptSearchQuery = normalizeText(value)
  renderProducts()
}, 300)

function setupEventListeners() {
  document.getElementById("show-login-btn").addEventListener("click", showLoginForm)
  document.getElementById("show-register-btn").addEventListener("click", showRegisterForm)
  document.getElementById("login-form").addEventListener("submit", handleLogin)
  document.getElementById("register-form").addEventListener("submit", handleRegister)
  document.getElementById("logout-button").addEventListener("click", handleLogout)

  document.getElementById("global-search").addEventListener("input", (e) => {
    debouncedGlobalSearch(e.target.value)
  })

  document.getElementById("dept-search").addEventListener("input", (e) => {
    debouncedDeptSearch(e.target.value)
  })

  document.getElementById("cart-button").addEventListener("click", openCart)
  document.getElementById("close-cart").addEventListener("click", closeCart)
  document.getElementById("send-whatsapp").addEventListener("click", sendWhatsAppOrder)

  document.getElementById("upload-csv-button")?.addEventListener("click", openCSVModal)
  document.getElementById("close-csv-modal")?.addEventListener("click", closeCSVModal)
  document.getElementById("csv-file-input")?.addEventListener("change", handleCSVFileSelect)
  document.getElementById("upload-csv-submit")?.addEventListener("click", handleCSVUpload)

  document.getElementById("export-pdf-button")?.addEventListener("click", openPDFModal)
  document.getElementById("close-pdf-modal")?.addEventListener("click", closePDFModal)
  document.getElementById("generate-pdf-button")?.addEventListener("click", generatePDF)

  document.getElementById("open-sidebar").addEventListener("click", openSidebar)
  document.getElementById("close-sidebar").addEventListener("click", closeSidebar)
  document.getElementById("sidebar-overlay").addEventListener("click", closeSidebar)

  document.getElementById("close-quantity-modal").addEventListener("click", closeQuantityModal)
  document.getElementById("cancel-quantity").addEventListener("click", closeQuantityModal)
  document.getElementById("confirm-quantity").addEventListener("click", confirmQuantity)

  document.getElementById("quantity-input").addEventListener("keypress", (e) => {
    if (e.key === "Enter") confirmQuantity()
  })
}

function showLoginForm() {
  document.getElementById("login-form").classList.remove("hidden")
  document.getElementById("register-form").classList.add("hidden")
  document.getElementById("show-login-btn").classList.add("auth-tab-active")
  document.getElementById("show-register-btn").classList.remove("auth-tab-active")
  hideAuthMessages()
}

function showRegisterForm() {
  document.getElementById("login-form").classList.add("hidden")
  document.getElementById("register-form").classList.remove("hidden")
  document.getElementById("show-register-btn").classList.add("auth-tab-active")
  document.getElementById("show-login-btn").classList.remove("auth-tab-active")
  hideAuthMessages()
}

function hideAuthMessages() {
  document.getElementById("auth-error").classList.add("hidden")
  document.getElementById("auth-success").classList.add("hidden")
}

async function handleLogin(e) {
  e.preventDefault()
  const email = document.getElementById("login-email").value
  const password = document.getElementById("login-password").value
  const errorDiv = document.getElementById("auth-error")

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password })
    if (error) throw error
    await handleUserSession(data.user)
  } catch (error) {
    console.error("[v0] Error en login:", error)
    errorDiv.textContent = "Error: " + error.message
    errorDiv.classList.remove("hidden")
  }
}

async function handleRegister(e) {
  e.preventDefault()
  const name = document.getElementById("register-name").value
  const email = document.getElementById("register-email").value
  const password = document.getElementById("register-password").value
  const errorDiv = document.getElementById("auth-error")
  const successDiv = document.getElementById("auth-success")

  try {
    const { data: authData, error: authError } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: { name, role: "cliente" },
        emailRedirectTo: window.location.origin,
      },
    })

    if (authError) throw authError

    const { error: dbError } = await supabaseClient.from("users").insert([
      {
        id: authData.user.id,
        email,
        name,
        role: "cliente",
      },
    ])

    if (dbError) console.error("[v0] Error insertando en users:", dbError)

    successDiv.textContent = "¡Cuenta creada exitosamente! Iniciando sesión..."
    successDiv.classList.remove("hidden")
    errorDiv.classList.add("hidden")

    setTimeout(async () => {
      await handleUserSession(authData.user)
    }, 1500)
  } catch (error) {
    console.error("[v0] Error en registro:", error)
    errorDiv.textContent = "Error al crear cuenta: " + error.message
    errorDiv.classList.remove("hidden")
    successDiv.classList.add("hidden")
  }
}

async function handleUserSession(user) {
  state.user = user

  const { data: userData, error } = await supabaseClient.from("users").select("role, name").eq("id", user.id).single()

  if (error) {
    console.error("[v0] Error obteniendo datos:", error)
    state.userRole = user.user_metadata?.role || "cliente"
    state.userName = user.user_metadata?.name || "Usuario"
  } else {
    state.userRole = userData.role
    state.userName = userData.name || "Usuario"
  }

  await loadDepartments()
  await loadProducts()
  showAppScreen()
}

function showLoginScreen() {
  document.getElementById("loading-screen").classList.add("hidden")
  document.getElementById("login-screen").classList.remove("hidden")
  document.getElementById("app-screen").classList.add("hidden")
  showLoginForm()
}

function showAppScreen() {
  document.getElementById("loading-screen").classList.add("hidden")
  document.getElementById("login-screen").classList.add("hidden")
  document.getElementById("app-screen").classList.remove("hidden")
  setupRoleBasedUI()
}

function setupRoleBasedUI() {
  const roleBadge = document.getElementById("user-role-badge")
  const adminSection = document.getElementById("admin-section")

  roleBadge.classList.remove("hidden")

  const roleConfig = {
    admin: { text: "👑 Admin", class: "role-badge-admin", showAdmin: true },
    distribuidor: { text: "📦 Distribuidor", class: "role-badge-distribuidor", showAdmin: false },
    cliente: { text: "🛒 Cliente", class: "role-badge-cliente", showAdmin: false },
  }

  const config = roleConfig[state.userRole] || roleConfig.cliente
  roleBadge.textContent = config.text
  roleBadge.className = config.class

  if (adminSection) {
    adminSection.classList.toggle("hidden", !config.showAdmin)
  }
}

async function loadDepartments() {
  const { data, error } = await supabaseClient.rpc("get_distinct_departments")

  if (error) {
    console.error("[v0] Error cargando departamentos:", error)
    return
  }

  state.departments = data.map((row) => row.departamento).filter((d) => d && d.trim() !== "")

  renderDepartments()
}

async function loadProducts() {
  try {
    state.isLoading = true
    showProductsLoading()

    console.log("[v0] 🔄 Iniciando carga de productos desde Supabase...")
    const startTime = performance.now()

    const { count, error: countError } = await supabaseClient
      .from("products")
      .select("*", { count: "exact", head: true })

    if (countError) {
      console.error("[v0] ❌ Error obteniendo conteo:", countError)
      return
    }

    console.log(`[v0] 📊 Total de productos en base de datos: ${count}`)

    const batchSize = 1000
    const allProducts = []
    let currentBatch = 0

    while (allProducts.length < count) {
      const start = currentBatch * batchSize
      const end = start + batchSize - 1

      console.log(`[v0] 📦 Cargando lote ${currentBatch + 1}: productos ${start + 1} a ${Math.min(end + 1, count)}`)

      const { data, error } = await supabaseClient.from("products").select("*").order("nombre").range(start, end)

      if (error) {
        console.error(`[v0] ❌ Error cargando lote ${currentBatch + 1}:`, error)
        break
      }

      allProducts.push(...data)
      console.log(`[v0] ✅ Lote ${currentBatch + 1} cargado: ${data.length} productos`)
      console.log(
        `[v0] 📈 Progreso: ${allProducts.length}/${count} productos (${((allProducts.length / count) * 100).toFixed(1)}%)`,
      )

      currentBatch++

      // Salir si no hay más productos
      if (data.length < batchSize) break
    }

    const fetchTime = performance.now() - startTime
    console.log(`[v0] ✅ Productos obtenidos de Supabase: ${allProducts.length}`)
    console.log(`[v0] ⏱️ Tiempo de carga total: ${fetchTime.toFixed(2)}ms`)

    if (allProducts.length < count) {
      console.warn(`[v0] ⚠️ ADVERTENCIA: Solo se cargaron ${allProducts.length} de ${count} productos`)
    } else {
      console.log(`[v0] 🎉 ¡Todos los productos cargados exitosamente!`)
    }

    // Pre-calcular textos de búsqueda para mejor rendimiento
    console.log("[v0] 🔍 Pre-calculando textos de búsqueda...")
    const processStart = performance.now()

    state.products = allProducts.map((product) => ({
      ...product,
      _searchText: normalizeText(`${product.nombre} ${product.descripcion || ""} ${product.departamento || ""}`),
    }))

    const processTime = performance.now() - processStart
    console.log(`[v0] ✅ Productos procesados: ${state.products.length}`)
    console.log(`[v0] ⏱️ Tiempo de procesamiento: ${processTime.toFixed(2)}ms`)
    console.log(`[v0] 🎉 Carga completa! Total de productos disponibles: ${state.products.length}`)

    state.isLoading = false
    renderProducts()
  } catch (error) {
    console.error("[v0] ❌ Error crítico en loadProducts:", error)
    state.isLoading = false
    hideProductsLoading()
  }
}

function showProductsLoading() {
  document.getElementById("products-loading").classList.remove("hidden")
  document.getElementById("products-grid").classList.add("hidden")
  document.getElementById("no-products").classList.add("hidden")
}

function hideProductsLoading() {
  document.getElementById("products-loading").classList.add("hidden")
}

function renderDepartments() {
  const container = document.getElementById("departments-nav")
  const sidebarContainer = document.getElementById("sidebar-departments")

  container.innerHTML = ""
  sidebarContainer.innerHTML = ""

  state.departments.forEach((dept) => {
    // Botón en navbar
    const button = document.createElement("button")
    button.className = "dept-button whitespace-nowrap px-5 py-2.5 rounded-xl font-semibold transition-all text-sm"
    button.textContent = dept
    button.dataset.dept = dept
    button.addEventListener("click", () => selectDepartment(dept))
    container.appendChild(button)

    // Botón en sidebar
    const sidebarBtn = document.createElement("button")
    sidebarBtn.className =
      "sidebar-dept-btn w-full text-left px-4 py-3 rounded-xl hover:bg-white/10 transition-all font-semibold"
    sidebarBtn.textContent = `📁 ${dept}`
    sidebarBtn.dataset.dept = dept
    sidebarBtn.addEventListener("click", () => {
      selectDepartment(dept)
      closeSidebar()
    })
    sidebarContainer.appendChild(sidebarBtn)
  })

  updateDepartmentButtons()
}

function selectDepartment(dept) {
  state.currentDepartment = dept
  state.deptSearchQuery = ""
  document.getElementById("dept-search").value = ""
  updateDepartmentButtons()
  renderProducts()
}

function updateDepartmentButtons() {
  document.querySelectorAll(".dept-button, .sidebar-dept-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.dept === state.currentDepartment)
  })

  const deptSearchContainer = document.getElementById("dept-search-container")
  deptSearchContainer.classList.toggle("hidden", state.currentDepartment === "all")
}

function renderProducts() {
  const container = document.getElementById("products-grid")
  const noProducts = document.getElementById("no-products")

  hideProductsLoading()

  let filteredProducts = state.products

  console.log(`[v0] 🔍 Iniciando filtrado de productos...`)
  console.log(`[v0] 📦 Total de productos antes de filtrar: ${filteredProducts.length}`)

  // Búsqueda global
  if (state.searchQuery) {
    filteredProducts = filteredProducts.filter((p) => p._searchText.includes(state.searchQuery))
    console.log(`[v0] 🔎 Búsqueda global: "${state.searchQuery}" - Resultados: ${filteredProducts.length}`)
  } else {
    // Filtro por departamento
    if (state.currentDepartment !== "all") {
      const beforeDeptFilter = filteredProducts.length
      filteredProducts = filteredProducts.filter((p) => p.departamento === state.currentDepartment)
      console.log(
        `[v0] 📁 Filtro por departamento: "${state.currentDepartment}" - ${beforeDeptFilter} → ${filteredProducts.length}`,
      )
    }

    // Búsqueda dentro del departamento
    if (state.deptSearchQuery && state.currentDepartment !== "all") {
      const beforeDeptSearch = filteredProducts.length
      filteredProducts = filteredProducts.filter((p) => p._searchText.includes(state.deptSearchQuery))
      console.log(
        `[v0] 🔎 Búsqueda en departamento: "${state.deptSearchQuery}" - ${beforeDeptSearch} → ${filteredProducts.length}`,
      )
    }
  }

  console.log(`[v0] ✅ Productos a mostrar: ${filteredProducts.length}`)

  if (filteredProducts.length === 0) {
    container.innerHTML = ""
    container.classList.add("hidden")
    noProducts.classList.remove("hidden")
    console.log("[v0] ℹ️ No hay productos para mostrar")
    return
  }

  noProducts.classList.add("hidden")
  container.classList.remove("hidden")
  container.innerHTML = ""

  const fragment = document.createDocumentFragment()

  filteredProducts.forEach((product) => {
    const card = createProductCard(product)
    fragment.appendChild(card)
  })

  container.appendChild(fragment)
  console.log(`[v0] 🎨 Renderizado completo: ${filteredProducts.length} productos mostrados`)
}

function createProductCard(product) {
  const card = document.createElement("div")
  card.className = "product-card fade-in"

  let pricesHTML = ""
  let cartPrice = 0

  if (state.userRole === "cliente") {
    cartPrice = product.precio_cliente
    pricesHTML = `
      <div>
        <span class="text-xs text-gray-500 font-medium">Precio Detal</span>
        <div class="price-badge mt-1">$${product.precio_cliente.toFixed(2)}</div>
      </div>
    `
  } else if (state.userRole === "distribuidor") {
    cartPrice = product.precio_distribuidor || product.precio_cliente
    pricesHTML = `
      <div class="space-y-1">
        <div class="flex items-center justify-between">
          <span class="text-xs text-gray-500">Detal:</span>
          <span class="text-sm font-bold text-gray-700">$${product.precio_cliente.toFixed(2)}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-xs text-red-600 font-semibold">Mayor:</span>
          <div class="price-badge text-sm">$${(product.precio_distribuidor || product.precio_cliente).toFixed(2)}</div>
        </div>
      </div>
    `
  } else {
    cartPrice = product.precio_gmayor || product.precio_distribuidor || product.precio_cliente
    pricesHTML = `
      <div class="space-y-1 text-xs">
        <div class="flex items-center justify-between">
          <span class="text-gray-500">Detal:</span>
          <span class="font-bold text-gray-700">$${product.precio_cliente.toFixed(2)}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-gray-500">Mayor:</span>
          <span class="font-bold text-gray-700">$${(product.precio_distribuidor || product.precio_cliente).toFixed(2)}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-red-600 font-semibold">GMayor:</span>
          <div class="price-badge text-xs py-1 px-2">$${(product.precio_gmayor || product.precio_distribuidor || product.precio_cliente).toFixed(2)}</div>
        </div>
      </div>
    `
  }

  const placeholderImage =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'%3E%3Crect fill='%23f3f4f6' width='400' height='400'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-family='Arial, sans-serif' font-size='18' fill='%239ca3af'%3EProducto%3C/text%3E%3C/svg%3E"

  card.innerHTML = `
    <div class="product-image-container">
      <img src="${product.imagen_url || placeholderImage}" 
           alt="${product.nombre}" 
           class="product-image"
           loading="lazy"
           onerror="this.src='${placeholderImage}'">
    </div>
    <div class="p-4">
      <div class="mb-2">
        <span class="text-xs font-bold text-red-600 bg-red-50 px-3 py-1 rounded-full">
          ${product.departamento || "General"}
        </span>
      </div>
      <h3 class="text-base font-bold text-gray-900 mb-2 line-clamp-2 min-h-[3rem]">${product.nombre}</h3>
      <p class="text-sm text-gray-600 mb-4 line-clamp-2 min-h-[2.5rem]">${product.descripcion || "Sin descripción disponible"}</p>
      <div class="flex items-end justify-between gap-3">
        ${pricesHTML}
        <button class="add-to-cart-btn bg-gradient-to-r from-red-600 to-red-700 text-white px-4 py-2.5 rounded-xl hover:from-red-700 hover:to-red-800 transition-all font-semibold shadow-lg transform hover:scale-105 text-sm whitespace-nowrap"
                data-product-id="${product.id}"
                data-price="${cartPrice}">
          Agregar
        </button>
      </div>
    </div>
  `

  card.querySelector(".add-to-cart-btn").addEventListener("click", (e) => {
    const price = Number.parseFloat(e.currentTarget.dataset.price)
    openQuantityModal({ ...product, cartPrice: price })
  })

  return card
}

function openQuantityModal(product) {
  state.pendingProduct = product

  const modal = document.getElementById("quantity-modal")
  const productInfo = document.getElementById("quantity-product-info")
  const quantityInput = document.getElementById("quantity-input")

  const placeholderImage =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'%3E%3Crect fill='%23f3f4f6' width='400' height='400'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-family='Arial, sans-serif' font-size='18' fill='%239ca3af'%3EProducto%3C/text%3E%3C/svg%3E"

  productInfo.innerHTML = `
    <div class="flex items-center space-x-4">
      <img src="${product.imagen_url || placeholderImage}" 
           alt="${product.nombre}" 
           class="w-20 h-20 object-cover rounded-xl shadow-md"
           loading="lazy"
           onerror="this.src='${placeholderImage}'">
      <div class="flex-1">
        <h3 class="font-bold text-gray-900 mb-1 text-sm">${product.nombre}</h3>
        <p class="text-red-600 font-black text-xl">$${product.cartPrice.toFixed(2)}</p>
      </div>
    </div>
  `

  quantityInput.value = 1
  quantityInput.focus()
  quantityInput.select()

  modal.classList.remove("hidden")
}

function closeQuantityModal() {
  document.getElementById("quantity-modal").classList.add("hidden")
  state.pendingProduct = null
}

function confirmQuantity() {
  const quantity = Number.parseInt(document.getElementById("quantity-input").value)

  if (!state.pendingProduct || quantity < 1) return

  addToCart(state.pendingProduct, quantity)
  closeQuantityModal()
}

function addToCart(product, quantity = 1) {
  const price = product.cartPrice || product.precio_cliente
  const existingItem = state.cart.find((item) => item.id === product.id)

  if (existingItem) {
    existingItem.quantity += quantity
  } else {
    state.cart.push({
      id: product.id,
      nombre: product.nombre,
      descripcion: product.descripcion || "",
      price,
      quantity,
      imagen_url: product.imagen_url,
    })
  }

  saveCartToLocalStorage()
  updateCartUI()

  const cartButton = document.getElementById("cart-button")
  cartButton.classList.add("cart-pulse")
  setTimeout(() => cartButton.classList.remove("cart-pulse"), 300)
}

function openCart() {
  renderCart()
  document.getElementById("cart-modal").classList.remove("hidden")
}

function closeCart() {
  document.getElementById("cart-modal").classList.add("hidden")
}

function renderCart() {
  const container = document.getElementById("cart-items")
  const totalElement = document.getElementById("cart-total")

  if (state.cart.length === 0) {
    container.innerHTML = `
      <div class="text-center py-12">
        <svg class="w-24 h-24 mx-auto text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"></path>
        </svg>
        <p class="text-gray-500 text-lg font-medium">Tu carrito está vacío</p>
      </div>
    `
    totalElement.textContent = "$0.00"
    return
  }

  container.innerHTML = ""
  let total = 0

  const placeholderImage =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400' viewBox='0 0 400 400'%3E%3Crect fill='%23f3f4f6' width='400' height='400'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-family='Arial, sans-serif' font-size='18' fill='%239ca3af'%3EProducto%3C/text%3E%3C/svg%3E"

  state.cart.forEach((item) => {
    const itemTotal = item.price * item.quantity
    total += itemTotal

    const cartItem = document.createElement("div")
    cartItem.className = "cart-item"
    cartItem.innerHTML = `
      <div class="flex items-center space-x-4">
        <img src="${item.imagen_url || placeholderImage}" 
             alt="${item.nombre}" 
             class="w-20 h-20 object-cover rounded-xl shadow-sm"
             loading="lazy"
             onerror="this.src='${placeholderImage}'">
        <div class="flex-1 min-w-0">
          <h4 class="font-bold text-gray-900 mb-1 truncate">${item.nombre}</h4>
          <p class="text-red-600 font-black text-lg">$${item.price.toFixed(2)}</p>
        </div>
        <div class="flex items-center space-x-2">
          <button class="quantity-button decrease-btn" data-product-id="${item.id}">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"></path>
            </svg>
          </button>
          <span class="font-black text-gray-900 w-10 text-center text-lg">${item.quantity}</span>
          <button class="quantity-button increase-btn" data-product-id="${item.id}">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
            </svg>
          </button>
          <button class="ml-2 p-2 text-red-500 hover:bg-red-50 rounded-xl transition-all remove-btn" data-product-id="${item.id}">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
            </svg>
          </button>
        </div>
      </div>
      <div class="mt-3 text-right border-t border-gray-100 pt-2">
        <span class="text-sm text-gray-600 font-medium">Subtotal: </span>
        <span class="font-black text-gray-900 text-lg">$${itemTotal.toFixed(2)}</span>
      </div>
    `
    container.appendChild(cartItem)
  })

  container.querySelectorAll(".increase-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const productId = Number.parseInt(e.currentTarget.dataset.productId)
      changeQuantity(productId, 1)
    })
  })

  container.querySelectorAll(".decrease-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const productId = Number.parseInt(e.currentTarget.dataset.productId)
      changeQuantity(productId, -1)
    })
  })

  container.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const productId = Number.parseInt(e.currentTarget.dataset.productId)
      removeFromCart(productId)
    })
  })

  totalElement.textContent = `$${total.toFixed(2)}`
}

function changeQuantity(productId, change) {
  const item = state.cart.find((i) => i.id === productId)
  if (item) {
    item.quantity += change
    if (item.quantity <= 0) {
      removeFromCart(productId)
    } else {
      saveCartToLocalStorage()
      updateCartUI()
      renderCart()
    }
  }
}

function removeFromCart(productId) {
  state.cart = state.cart.filter((item) => item.id !== productId)
  saveCartToLocalStorage()
  updateCartUI()
  renderCart()
}

function sendWhatsAppOrder() {
  if (state.cart.length === 0) {
    alert("El carrito está vacío")
    return
  }

  let message = "Hola, quiero comprar los siguientes productos:\n\n"

  let total = 0
  state.cart.forEach((item) => {
    const itemTotal = item.price * item.quantity
    total += itemTotal
    message += `${item.quantity}x ${item.nombre} - $${itemTotal.toFixed(2)}\n`
  })

  message += `\nTotal: $${total.toFixed(2)}\n\n`
  message += `Mi nombre: ${state.userName}\n\n`
  message += "Por favor, contáctame para el pedido."

  const encodedMessage = encodeURIComponent(message)
  const whatsappURL = `https://wa.me/?text=${encodedMessage}`

  window.open(whatsappURL, "_blank")

  state.cart = []
  clearCartFromLocalStorage()
  updateCartUI()
  closeCart()
}

function openCSVModal() {
  document.getElementById("csv-modal").classList.remove("hidden")
}

function closeCSVModal() {
  document.getElementById("csv-modal").classList.add("hidden")
  document.getElementById("csv-file-input").value = ""
  document.getElementById("csv-file-name").classList.add("hidden")
  document.getElementById("csv-status").classList.add("hidden")
}

function handleCSVFileSelect(e) {
  const file = e.target.files[0]
  if (file) {
    const fileNameDiv = document.getElementById("csv-file-name")
    fileNameDiv.textContent = `📄 Archivo seleccionado: ${file.name}`
    fileNameDiv.classList.remove("hidden")
  }
}

async function handleCSVUpload() {
  if (state.userRole !== "admin") {
    alert("Solo el administrador puede subir archivos CSV")
    return
  }

  const fileInput = document.getElementById("csv-file-input")
  const file = fileInput.files[0]
  const statusDiv = document.getElementById("csv-status")
  const submitBtn = document.getElementById("upload-csv-submit")

  if (!file) {
    alert("Por favor selecciona un archivo CSV")
    return
  }

  submitBtn.disabled = true
  submitBtn.textContent = "Procesando..."

  try {
    console.log("[v0] 📤 Iniciando carga de CSV...")
    console.log(`[v0] 📄 Archivo: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`)

    const text = await file.text()
    const lines = text.split("\n").filter((line) => line.trim())

    console.log(`[v0] 📋 Total de líneas en CSV: ${lines.length}`)

    if (lines.length < 2) {
      throw new Error("El archivo CSV está vacío o no tiene datos")
    }

    const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase())
    console.log(`[v0] 📊 Columnas detectadas: ${headers.join(", ")}`)

    const codigoIdx = headers.indexOf("codigo")
    const descripcionIdx = headers.indexOf("descripcion")
    const detalIdx = headers.indexOf("detal")
    const mayorIdx = headers.indexOf("mayor")
    const gmayorIdx = headers.indexOf("gmayor")
    const departamentoIdx = headers.indexOf("departamento")
    const urlIdx = headers.indexOf("url")

    if (codigoIdx === -1 || descripcionIdx === -1 || detalIdx === -1 || mayorIdx === -1) {
      throw new Error("El CSV debe contener: codigo, descripcion, detal, mayor")
    }

    const products = []
    let skippedLines = 0

    console.log("[v0] 🔄 Procesando productos del CSV...")

    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i])

      if (values.length < 3) {
        skippedLines++
        continue
      }

      const product = {
        nombre: values[codigoIdx] || `Producto ${i}`,
        descripcion: values[descripcionIdx] || "",
        precio_cliente: Number.parseFloat(values[detalIdx]) || 0,
        precio_distribuidor: Number.parseFloat(values[mayorIdx]) || 0,
        precio_gmayor: gmayorIdx !== -1 ? Number.parseFloat(values[gmayorIdx]) || 0 : 0,
        departamento: departamentoIdx !== -1 ? values[departamentoIdx] || "General" : "General",
        imagen_url: urlIdx !== -1 ? values[urlIdx] || null : null,
      }

      if (product.precio_cliente > 0) {
        products.push(product)
      } else {
        skippedLines++
      }
    }

    console.log(`[v0] ✅ Productos válidos parseados: ${products.length}`)
    console.log(`[v0] ⚠️ Líneas omitidas: ${skippedLines}`)

    if (products.length === 0) {
      throw new Error("No se pudieron parsear productos válidos del CSV")
    }

    console.log("[v0] 🗑️ Eliminando productos existentes...")
    const { error: deleteError } = await supabaseClient.from("products").delete().neq("id", 0)

    if (deleteError) {
      throw new Error("Error al eliminar productos: " + deleteError.message)
    }

    console.log("[v0] 💾 Insertando nuevos productos en lotes de 100...")
    const batchSize = 100
    let insertedCount = 0

    for (let i = 0; i < products.length; i += batchSize) {
      const batch = products.slice(i, i + batchSize)
      const { error } = await supabaseClient.from("products").insert(batch)
      if (error) throw error
      insertedCount += batch.length
      console.log(
        `[v0] 📦 Lote ${Math.floor(i / batchSize) + 1}: ${insertedCount}/${products.length} productos insertados`,
      )
    }

    console.log(`[v0] 🎉 ¡Carga completa! Total insertado: ${insertedCount} productos`)

    statusDiv.textContent = `✅ ¡Éxito! ${products.length} productos cargados correctamente`
    statusDiv.className = "mt-4 p-4 rounded-xl text-sm font-medium bg-green-50 text-green-700 border border-green-200"
    statusDiv.classList.remove("hidden")

    console.log("[v0] 🔄 Recargando departamentos y productos...")
    await loadDepartments()
    await loadProducts()

    setTimeout(() => {
      closeCSVModal()
    }, 2000)
  } catch (error) {
    console.error("[v0] ❌ Error procesando CSV:", error)
    statusDiv.textContent = `❌ Error: ${error.message}`
    statusDiv.className = "mt-4 p-4 rounded-xl text-sm font-medium bg-red-50 text-red-700 border border-red-200"
    statusDiv.classList.remove("hidden")
  } finally {
    submitBtn.disabled = false
    submitBtn.textContent = "Subir y Procesar CSV"
  }
}

function updateCartUI() {
  const cartCount = document.getElementById("cart-count")
  const totalItems = state.cart.reduce((sum, item) => sum + item.quantity, 0)
  cartCount.textContent = totalItems

  if (totalItems > 0) {
    cartCount.classList.add("animate-pulse")
  } else {
    cartCount.classList.remove("animate-pulse")
  }
}

function openSidebar() {
  document.getElementById("sidebar-menu").classList.add("open")
  document.getElementById("sidebar-overlay").classList.remove("hidden")
  document.body.style.overflow = "hidden"
}

function closeSidebar() {
  document.getElementById("sidebar-menu").classList.remove("open")
  document.getElementById("sidebar-overlay").classList.add("hidden")
  document.body.style.overflow = "auto"
}

function openPDFModal() {
  const modal = document.getElementById("pdf-modal")
  const select = document.getElementById("pdf-department-select")

  // Llenar el select con los departamentos
  select.innerHTML = '<option value="">Selecciona un departamento...</option>'
  state.departments.forEach((dept) => {
    const option = document.createElement("option")
    option.value = dept
    option.textContent = dept
    select.appendChild(option)
  })

  modal.classList.remove("hidden")
}

function closePDFModal() {
  document.getElementById("pdf-modal").classList.add("hidden")
  document.getElementById("pdf-status").classList.add("hidden")
}

async function generatePDF() {
  const select = document.getElementById("pdf-department-select")
  const selectedDept = select.value
  const statusDiv = document.getElementById("pdf-status")
  const generateBtn = document.getElementById("generate-pdf-button")

  if (!selectedDept) {
    statusDiv.textContent = "Por favor selecciona un departamento"
    statusDiv.className = "mb-4 p-4 rounded-xl text-sm font-medium bg-red-50 text-red-700 border border-red-200"
    statusDiv.classList.remove("hidden")
    return
  }

  generateBtn.disabled = true
  generateBtn.innerHTML = `
    <div class="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
    <span>Generando PDF...</span>
  `

  try {
    console.log(`[v0] 📄 Iniciando generación de PDF para departamento: ${selectedDept}`)

    // Filtrar productos por departamento
    const deptProducts = state.products.filter((p) => p.departamento === selectedDept)
    console.log(`[v0] 📦 Productos encontrados: ${deptProducts.length}`)

    if (deptProducts.length === 0) {
      throw new Error("No hay productos en este departamento")
    }

    statusDiv.textContent = `Procesando ${deptProducts.length} productos...`
    statusDiv.className = "mb-4 p-4 rounded-xl text-sm font-medium bg-blue-50 text-blue-700 border border-blue-200"
    statusDiv.classList.remove("hidden")

    // Crear el PDF
    const { jsPDF } = window.jspdf
    const doc = new jsPDF()

    // Título
    doc.setFontSize(20)
    doc.setFont(undefined, "bold")
    doc.text("SONIMAX MÓVIL", 105, 15, { align: "center" })

    doc.setFontSize(14)
    doc.text(`Catálogo - ${selectedDept}`, 105, 23, { align: "center" })

    doc.setFontSize(10)
    doc.setFont(undefined, "normal")
    doc.text(`Fecha: ${new Date().toLocaleDateString()}`, 105, 30, { align: "center" })

    let yPosition = 40
    const pageHeight = doc.internal.pageSize.height
    const margin = 15
    const productHeight = 45

    for (let i = 0; i < deptProducts.length; i++) {
      const product = deptProducts[i]

      // Verificar si necesitamos una nueva página
      if (yPosition + productHeight > pageHeight - margin) {
        doc.addPage()
        yPosition = 20
      }

      // Dibujar borde del producto
      doc.setDrawColor(200, 200, 200)
      doc.rect(margin, yPosition, 180, productHeight - 5)

      // Intentar cargar la imagen
      if (product.imagen_url) {
        try {
          const imgData = await loadImageAsBase64(product.imagen_url)
          doc.addImage(imgData, "JPEG", margin + 5, yPosition + 5, 30, 30)
        } catch (error) {
          console.warn(`[v0] ⚠️ No se pudo cargar imagen para ${product.nombre}`)
          // Dibujar placeholder
          doc.setFillColor(240, 240, 240)
          doc.rect(margin + 5, yPosition + 5, 30, 30, "F")
          doc.setFontSize(8)
          doc.text("Sin imagen", margin + 20, yPosition + 22, { align: "center" })
        }
      } else {
        // Dibujar placeholder
        doc.setFillColor(240, 240, 240)
        doc.rect(margin + 5, yPosition + 5, 30, 30, "F")
        doc.setFontSize(8)
        doc.text("Sin imagen", margin + 20, yPosition + 22, { align: "center" })
      }

      // Información del producto
      const textX = margin + 40

      doc.setFontSize(11)
      doc.setFont(undefined, "bold")
      const productName = product.nombre.length > 50 ? product.nombre.substring(0, 50) + "..." : product.nombre
      doc.text(productName, textX, yPosition + 10)

      doc.setFontSize(9)
      doc.setFont(undefined, "normal")
      const description = product.descripcion || "Sin descripción"
      const shortDesc = description.length > 60 ? description.substring(0, 60) + "..." : description
      doc.text(shortDesc, textX, yPosition + 17)

      // Precios
      doc.setFontSize(10)
      doc.setFont(undefined, "bold")
      doc.text(`Detal: $${product.precio_cliente.toFixed(2)}`, textX, yPosition + 25)
      doc.text(`Mayor: $${(product.precio_distribuidor || product.precio_cliente).toFixed(2)}`, textX, yPosition + 31)

      if (product.precio_gmayor && product.precio_gmayor > 0) {
        doc.setTextColor(220, 38, 38)
        doc.text(`GMayor: $${product.precio_gmayor.toFixed(2)}`, textX + 60, yPosition + 31)
        doc.setTextColor(0, 0, 0)
      }

      yPosition += productHeight

      // Actualizar progreso
      if (i % 5 === 0) {
        statusDiv.textContent = `Procesando ${i + 1}/${deptProducts.length} productos...`
      }
    }

    // Guardar el PDF
    const fileName = `SONIMAX_${selectedDept.replace(/\s+/g, "_")}_${new Date().toISOString().split("T")[0]}.pdf`
    doc.save(fileName)

    console.log(`[v0] ✅ PDF generado exitosamente: ${fileName}`)

    statusDiv.textContent = `¡PDF generado exitosamente! (${deptProducts.length} productos)`
    statusDiv.className = "mb-4 p-4 rounded-xl text-sm font-medium bg-green-50 text-green-700 border border-green-200"

    setTimeout(() => {
      closePDFModal()
    }, 2000)
  } catch (error) {
    console.error("[v0] ❌ Error generando PDF:", error)
    statusDiv.textContent = `Error: ${error.message}`
    statusDiv.className = "mb-4 p-4 rounded-xl text-sm font-medium bg-red-50 text-red-700 border border-red-200"
    statusDiv.classList.remove("hidden")
  } finally {
    generateBtn.disabled = false
    generateBtn.innerHTML = `
      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
      </svg>
      <span>Generar y Descargar PDF</span>
    `
  }
}

// Función auxiliar para cargar imágenes como base64
function loadImageAsBase64(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "Anonymous"

    img.onload = () => {
      const canvas = document.createElement("canvas")
      canvas.width = img.width
      canvas.height = img.height

      const ctx = canvas.getContext("2d")
      ctx.drawImage(img, 0, 0)

      try {
        const dataURL = canvas.toDataURL("image/jpeg", 0.8)
        resolve(dataURL)
      } catch (error) {
        reject(error)
      }
    }

    img.onerror = () => {
      reject(new Error("No se pudo cargar la imagen"))
    }

    // Intentar cargar la imagen
    img.src = url

    // Timeout de 5 segundos
    setTimeout(() => {
      reject(new Error("Timeout cargando imagen"))
    }, 5000)
  })
}
