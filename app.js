// SONIMAx MÓVIL - Aplicación Principal
// Estado Global
const state = {
  user: null,
  userRole: null, // Ahora será texto: "cliente", "distribuidor", "admin"
  userName: null, // Agregando nombre de usuario
  products: [],
  departments: [],
  currentDepartment: "all",
  cart: [],
  searchQuery: "",
  deptSearchQuery: "",
  pendingProduct: null, // Para el modal de cantidad
}

// Obtener el cliente de Supabase desde la configuración global
const supabaseClient = window.supabaseClient

// Función para manejar el cierre de sesión
async function handleLogout() {
  console.log("[v0] Cerrando sesión")
  const { error } = await supabaseClient.auth.signOut()

  if (error) {
    console.error("[v0] Error cerrando sesión:", error)
  } else {
    console.log("[v0] Sesión cerrada exitosamente")
    state.user = null
    state.userRole = null
    state.userName = null // Reiniciar nombre de usuario
    state.cart = []
    showLoginScreen()
  }
}

// Inicialización
document.addEventListener("DOMContentLoaded", async () => {
  console.log("[v0] Iniciando aplicación SONIMAx MÓVIL")
  await initApp()
})

async function initApp() {
  // Verificar sesión existente
  const {
    data: { session },
  } = await supabaseClient.auth.getSession()

  if (session) {
    console.log("[v0] Sesión existente encontrada")
    await handleUserSession(session.user)
  } else {
    showLoginScreen()
  }

  // Event Listeners
  setupEventListeners()
}

function setupEventListeners() {
  document.getElementById("show-login-btn").addEventListener("click", showLoginForm)
  document.getElementById("show-register-btn").addEventListener("click", showRegisterForm)

  // Login y Registro
  document.getElementById("login-form").addEventListener("submit", handleLogin)
  document.getElementById("register-form").addEventListener("submit", handleRegister)

  // Logout
  document.getElementById("logout-button").addEventListener("click", handleLogout)

  // Búsqueda Global
  document.getElementById("global-search").addEventListener("input", (e) => {
    state.searchQuery = e.target.value.toLowerCase()
    renderProducts()
  })

  // Búsqueda por Departamento
  document.getElementById("dept-search").addEventListener("input", (e) => {
    state.deptSearchQuery = e.target.value.toLowerCase()
    renderProducts()
  })

  // Carrito
  document.getElementById("cart-button").addEventListener("click", openCart)
  document.getElementById("close-cart").addEventListener("click", closeCart)
  document.getElementById("send-whatsapp").addEventListener("click", sendWhatsAppOrder)

  // CSV Upload (Admin)
  document.getElementById("upload-csv-button")?.addEventListener("click", openCSVModal)
  document.getElementById("close-csv-modal")?.addEventListener("click", closeCSVModal)
  document.getElementById("csv-file-input")?.addEventListener("change", handleCSVFileSelect)
  document.getElementById("upload-csv-submit")?.addEventListener("click", handleCSVUpload)

  document.getElementById("open-sidebar").addEventListener("click", openSidebar)
  document.getElementById("close-sidebar").addEventListener("click", closeSidebar)
  document.getElementById("sidebar-overlay").addEventListener("click", closeSidebar)

  document.getElementById("close-quantity-modal").addEventListener("click", closeQuantityModal)
  document.getElementById("cancel-quantity").addEventListener("click", closeQuantityModal)
  document.getElementById("confirm-quantity").addEventListener("click", confirmQuantity)

  document.getElementById("quantity-input").addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      confirmQuantity()
    }
  })
}

function showLoginForm() {
  document.getElementById("login-form").classList.remove("hidden")
  document.getElementById("register-form").classList.add("hidden")
  document.getElementById("show-login-btn").classList.add("auth-tab-active")
  document.getElementById("show-register-btn").classList.remove("auth-tab-active")
  document.getElementById("show-login-btn").classList.remove("text-white/70")
  document.getElementById("show-register-btn").classList.add("text-white/70")
  hideAuthMessages()
}

function showRegisterForm() {
  document.getElementById("login-form").classList.add("hidden")
  document.getElementById("register-form").classList.remove("hidden")
  document.getElementById("show-register-btn").classList.add("auth-tab-active")
  document.getElementById("show-login-btn").classList.remove("auth-tab-active")
  document.getElementById("show-register-btn").classList.remove("text-white/70")
  document.getElementById("show-login-btn").classList.add("text-white/70")
  hideAuthMessages()
}

function hideAuthMessages() {
  document.getElementById("auth-error").classList.add("hidden")
  document.getElementById("auth-success").classList.add("hidden")
}

// Autenticación
async function handleLogin(e) {
  e.preventDefault()

  const email = document.getElementById("login-email").value
  const password = document.getElementById("login-password").value
  const errorDiv = document.getElementById("auth-error")

  try {
    console.log("[v0] Intentando login...")
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    })

    if (error) throw error

    console.log("[v0] Login exitoso")
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
    console.log("[v0] Intentando registrar usuario...")

    const { data: authData, error: authError } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: {
          name: name,
          role: "cliente",
        },
        emailRedirectTo: window.location.origin,
      },
    })

    if (authError) throw authError

    console.log("[v0] Usuario creado en Auth:", authData.user.id)

    if (authData.user && !authData.user.email_confirmed_at) {
      console.log("[v0] Confirmando email automáticamente...")
      // Nota: La confirmación automática se maneja mejor desde el servidor
      // Por ahora, el usuario puede iniciar sesión inmediatamente
    }

    const { error: dbError } = await supabaseClient.from("users").insert([
      {
        id: authData.user.id,
        email: email,
        name: name,
        role: "cliente",
      },
    ])

    if (dbError) {
      console.error("[v0] Error insertando en tabla users:", dbError)
    }

    successDiv.textContent = "¡Cuenta creada exitosamente como Cliente! Iniciando sesión..."
    successDiv.classList.remove("hidden")
    errorDiv.classList.add("hidden")

    console.log("[v0] Registro exitoso, iniciando sesión automáticamente")

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
  console.log("[v0] ==========================================")
  console.log("[v0] Configurando sesión de usuario")
  console.log("[v0] ID de usuario:", user.id)
  console.log("[v0] Email:", user.email)
  console.log("[v0] ==========================================")

  state.user = user

  console.log("[v0] 🔍 Intentando obtener rol y nombre de la base de datos...")

  const { data: userData, error } = await supabaseClient.from("users").select("role, name").eq("id", user.id).single()

  if (error) {
    console.error("[v0] ❌ Error obteniendo datos de la base de datos:", error)
    console.error("[v0] Código de error:", error.code)
    console.error("[v0] Mensaje:", error.message)
    console.error("[v0] Detalles:", error.details)

    let fallbackRole = user.user_metadata?.role || "cliente"

    if (fallbackRole === 1 || fallbackRole === "1") fallbackRole = "cliente"
    if (fallbackRole === 2 || fallbackRole === "2") fallbackRole = "distribuidor"
    if (fallbackRole === 3 || fallbackRole === "3") fallbackRole = "admin"

    state.userRole = fallbackRole
    state.userName = user.user_metadata?.name || "Usuario"
    console.log("[v0] ⚠️ Usando datos de metadatos como fallback")
  } else {
    let dbRole = userData.role

    if (dbRole === 1 || dbRole === "1") dbRole = "cliente"
    if (dbRole === 2 || dbRole === "2") dbRole = "distribuidor"
    if (dbRole === 3 || dbRole === "3") dbRole = "admin"

    state.userRole = dbRole
    state.userName = userData.name || "Usuario"
    console.log("[v0] ✅ Datos obtenidos exitosamente de la base de datos")
    console.log("[v0] Nombre:", state.userName)
    console.log("[v0] Rol:", state.userRole)
  }

  console.log("[v0] ==========================================")
  console.log("[v0] 📋 ROL FINAL ASIGNADO:", state.userRole)
  console.log("[v0] 👤 NOMBRE FINAL:", state.userName)
  console.log("[v0] ==========================================")

  await loadDepartments()
  await loadProducts()

  showAppScreen()
}

// Pantallas
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

  // Configurar UI según rol
  setupRoleBasedUI()
}

function setupRoleBasedUI() {
  const roleBadge = document.getElementById("user-role-badge")
  const adminSection = document.getElementById("admin-section")

  roleBadge.classList.remove("hidden")

  let roleText = ""
  let roleClass = ""

  console.log("[v0] ==========================================")
  console.log("[v0] 🎨 Configurando UI para rol:", state.userRole)
  console.log("[v0] 🎨 Comparación con 'admin':", state.userRole === "admin")
  console.log("[v0] 🎨 Comparación con 'distribuidor':", state.userRole === "distribuidor")
  console.log("[v0] 🎨 Comparación con 'cliente':", state.userRole === "cliente")
  console.log("[v0] ==========================================")

  if (!adminSection) {
    console.error("[v0] ❌ ERROR: No se encontró el elemento 'admin-section' en el HTML")
  } else {
    console.log("[v0] ✅ Elemento 'admin-section' encontrado")
  }

  switch (state.userRole) {
    case "admin":
      roleText = "Administrador"
      roleClass = "role-badge-admin"
      console.log("[v0] ✅ ROL ADMIN DETECTADO - Mostrando sección de admin")
      if (adminSection) {
        adminSection.classList.remove("hidden")
        console.log("[v0] ✅ Sección de admin visible")
      }
      break
    case "distribuidor":
      roleText = "Distribuidor"
      roleClass = "role-badge-distribuidor"
      console.log("[v0] 📦 Rol: Distribuidor")
      if (adminSection) {
        adminSection.classList.add("hidden")
      }
      break
    case "cliente":
    default:
      roleText = "Cliente"
      roleClass = "role-badge-cliente"
      console.log("[v0] 👤 Rol: Cliente")
      if (adminSection) {
        adminSection.classList.add("hidden")
      }
      break
  }

  roleBadge.textContent = roleText
  roleBadge.className = `px-3 py-1 rounded-full text-xs font-semibold ${roleClass}`

  console.log("[v0] 🎨 Badge configurado con texto:", roleText)
  console.log("[v0] 🎨 Clases aplicadas:", roleClass)
  console.log("[v0] ==========================================")
}

async function loadDepartments() {
  console.log("[v0] Cargando departamentos usando función SQL...")

  // Usar la función SQL para obtener departamentos únicos directamente
  const { data, error } = await supabaseClient.rpc("get_distinct_departments")

  if (error) {
    console.error("[v0] Error cargando departamentos:", error)
    return
  }

  const uniqueDepts = data.map((row) => row.departamento).filter((d) => d && d.trim() !== "")

  console.log("[v0] Departamentos únicos encontrados:", uniqueDepts.length)
  console.log("[v0] Lista de departamentos:", uniqueDepts)

  state.departments = uniqueDepts
  renderDepartments()
}

async function loadProducts() {
  console.log("[v0] Cargando productos")

  const { data, error } = await supabaseClient.from("products").select("*").order("nombre")

  if (error) {
    console.error("[v0] Error cargando productos:", error)
    return
  }

  state.products = data
  console.log("[v0] Productos cargados:", data.length)
  renderProducts()
}

function renderDepartments() {
  const container = document.getElementById("departments-nav")
  container.innerHTML = ""

  state.departments.forEach((dept) => {
    const button = document.createElement("button")
    button.className = "dept-button whitespace-nowrap px-6 py-3 rounded-lg font-medium transition-all"
    button.textContent = dept
    button.dataset.dept = dept

    button.addEventListener("click", () => {
      state.currentDepartment = dept
      state.deptSearchQuery = ""
      document.getElementById("dept-search").value = ""
      updateDepartmentButtons()
      renderProducts()
    })

    container.appendChild(button)
  })

  // Botón "Todos"
  document.querySelector('[data-dept="all"]').addEventListener("click", () => {
    state.currentDepartment = "all"
    state.deptSearchQuery = ""
    document.getElementById("dept-search").value = ""
    updateDepartmentButtons()
    renderProducts()
  })

  updateDepartmentButtons()

  const sidebarContainer = document.getElementById("sidebar-departments")
  sidebarContainer.innerHTML = ""

  state.departments.forEach((dept) => {
    const button = document.createElement("button")
    button.className =
      "sidebar-dept-btn w-full text-left px-4 py-3 rounded-lg hover:bg-white/10 transition-all font-medium"
    button.textContent = dept
    button.dataset.dept = dept

    button.addEventListener("click", () => {
      state.currentDepartment = dept
      state.deptSearchQuery = ""
      updateSidebarButtons()
      renderProducts()
      closeSidebar()
    })

    sidebarContainer.appendChild(button)
  })

  // Botón "Todos"
  document.querySelector('[data-dept="all"]').addEventListener("click", () => {
    state.currentDepartment = "all"
    state.deptSearchQuery = ""
    updateSidebarButtons()
    renderProducts()
    closeSidebar()
  })

  updateSidebarButtons()
}

function updateDepartmentButtons() {
  document.querySelectorAll(".dept-button").forEach((btn) => {
    btn.classList.remove("active")
    if (btn.dataset.dept === state.currentDepartment) {
      btn.classList.add("active")
    }
  })

  // Mostrar/ocultar búsqueda por departamento
  const deptSearchContainer = document.getElementById("dept-search-container")
  if (state.currentDepartment !== "all") {
    deptSearchContainer.classList.remove("hidden")
  } else {
    deptSearchContainer.classList.add("hidden")
  }
}

function updateSidebarButtons() {
  document.querySelectorAll(".sidebar-dept-btn").forEach((btn) => {
    btn.classList.remove("active")
    if (btn.dataset.dept === state.currentDepartment) {
      btn.classList.add("active")
    }
  })
}

function renderProducts() {
  const container = document.getElementById("products-grid")
  const noProducts = document.getElementById("no-products")

  // Filtrar productos
  let filteredProducts = state.products

  // Filtro por departamento
  if (state.currentDepartment !== "all") {
    filteredProducts = filteredProducts.filter((p) => p.departamento === state.currentDepartment)
  }

  // Búsqueda global
  if (state.searchQuery) {
    filteredProducts = filteredProducts.filter(
      (p) =>
        p.nombre.toLowerCase().includes(state.searchQuery) ||
        p.descripcion?.toLowerCase().includes(state.searchQuery) ||
        p.departamento?.toLowerCase().includes(state.searchQuery),
    )
  }

  // Búsqueda por departamento
  if (state.deptSearchQuery && state.currentDepartment !== "all") {
    filteredProducts = filteredProducts.filter(
      (p) =>
        p.nombre.toLowerCase().includes(state.deptSearchQuery) ||
        p.descripcion?.toLowerCase().includes(state.deptSearchQuery),
    )
  }

  console.log("[v0] Productos filtrados:", filteredProducts.length)

  if (filteredProducts.length === 0) {
    container.innerHTML = ""
    noProducts.classList.remove("hidden")
    return
  }

  noProducts.classList.add("hidden")
  container.innerHTML = ""

  filteredProducts.forEach((product) => {
    const card = createProductCard(product)
    container.appendChild(card)
  })
}

function createProductCard(product) {
  const card = document.createElement("div")
  card.className = "product-card"

  let pricesHTML = ""

  if (state.userRole === "cliente") {
    // Cliente: Solo precio detal
    pricesHTML = `
      <div>
        <span class="text-xs text-gray-500">Detal</span>
        <span class="price-badge block mt-1">$${product.precio_cliente.toFixed(2)}</span>
      </div>
    `
  } else if (state.userRole === "distribuidor") {
    // Distribuidor: Detal y Mayor
    pricesHTML = `
      <div class="space-y-1">
        <div class="flex items-center justify-between">
          <span class="text-xs text-gray-500">Detal:</span>
          <span class="text-sm font-semibold text-gray-700">$${product.precio_cliente.toFixed(2)}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-xs text-red-600">Mayor:</span>
          <span class="price-badge text-sm">$${product.precio_distribuidor.toFixed(2)}</span>
        </div>
      </div>
    `
  } else {
    pricesHTML = `
      <div class="space-y-1">
        <div class="flex items-center justify-between">
          <span class="text-xs text-gray-500">Detal:</span>
          <span class="text-xs font-semibold text-gray-700">$${product.precio_cliente.toFixed(2)}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-xs text-gray-500">Mayor:</span>
          <span class="text-xs font-semibold text-gray-700">$${product.precio_distribuidor.toFixed(2)}</span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-xs text-red-600">GMayor:</span>
          <span class="price-badge text-sm">$${product.precio_gmayor.toFixed(2)}</span>
        </div>
      </div>
    `
  }

  let cartPrice = 0
  if (state.userRole === "admin") {
    cartPrice = product.precio_gmayor || product.precio_distribuidor || product.precio_cliente
  } else if (state.userRole === "distribuidor") {
    cartPrice = product.precio_distribuidor || product.precio_cliente
  } else {
    cartPrice = product.precio_cliente
  }

  card.innerHTML = `
        <div class="product-image-container">
            <img src="${product.imagen_url || "/generic-product-display.png"}" 
                 alt="${product.nombre}" 
                 class="product-image"
                 onerror="this.src='/generic-product-display.png'">
        </div>
        <div class="p-4">
            <div class="mb-2">
                <span class="text-xs font-semibold text-red-600 bg-red-50 px-2 py-1 rounded">
                    ${product.departamento || "General"}
                </span>
            </div>
            <h3 class="text-lg font-bold text-gray-800 mb-2 line-clamp-2">${product.nombre}</h3>
            <p class="text-sm text-gray-600 mb-4 line-clamp-2">${product.descripcion || "Sin descripción"}</p>
            <div class="flex items-center justify-between">
                ${pricesHTML}
                <button class="add-to-cart-btn bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-all font-medium shadow-lg transform hover:scale-105"
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

  productInfo.innerHTML = `
    <div class="flex items-center space-x-4">
      <img src="${product.imagen_url || "/generic-product-display.png"}" 
           alt="${product.nombre}" 
           class="w-20 h-20 object-cover rounded-lg"
           onerror="this.src='/generic-product-display.png'">
      <div class="flex-1">
        <h3 class="font-bold text-gray-800 mb-1">${product.nombre}</h3>
        <p class="text-red-600 font-bold text-lg">$${product.cartPrice.toFixed(2)}</p>
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

  if (!state.pendingProduct || quantity < 1) {
    return
  }

  addToCart(state.pendingProduct, quantity)
  closeQuantityModal()
}

function addToCart(product, quantity = 1) {
  console.log("[v0] Agregando al carrito:", product.nombre, "Cantidad:", quantity)

  const price = product.cartPrice || product.precio_cliente

  const existingItem = state.cart.find((item) => item.id === product.id)

  if (existingItem) {
    existingItem.quantity += quantity
  } else {
    state.cart.push({
      id: product.id,
      nombre: product.nombre,
      descripcion: product.descripcion || "",
      price: price,
      quantity: quantity,
      imagen_url: product.imagen_url,
    })
  }

  updateCartUI()

  const cartButton = document.getElementById("cart-button")
  cartButton.classList.add("cart-pulse")
  setTimeout(() => cartButton.classList.remove("cart-pulse"), 300)
}

function openCart() {
  console.log("[v0] Abriendo carrito")
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
                <p class="text-gray-500 text-lg">Tu carrito está vacío</p>
            </div>
        `
    totalElement.textContent = "$0.00"
    return
  }

  container.innerHTML = ""
  let total = 0

  state.cart.forEach((item) => {
    const itemTotal = item.price * item.quantity
    total += itemTotal

    const cartItem = document.createElement("div")
    cartItem.className = "cart-item"
    cartItem.innerHTML = `
            <div class="flex items-center space-x-4">
                <img src="${item.imagen_url || "/generic-product-display.png"}" 
                     alt="${item.nombre}" 
                     class="w-20 h-20 object-cover rounded-lg"
                     onerror="this.src='/generic-product-display.png'">
                <div class="flex-1">
                    <h4 class="font-semibold text-gray-800 mb-1">${item.nombre}</h4>
                    <p class="text-red-600 font-bold">$${item.price.toFixed(2)}</p>
                </div>
                <div class="flex items-center space-x-3">
                    <button class="quantity-button decrease-btn" data-product-id="${item.id}">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 12H4"></path>
                        </svg>
                    </button>
                    <span class="font-semibold text-gray-800 w-8 text-center">${item.quantity}</span>
                    <button class="quantity-button increase-btn" data-product-id="${item.id}">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
                        </svg>
                    </button>
                    <button class="ml-2 p-2 text-red-500 hover:bg-red-50 rounded-lg transition-all remove-btn" data-product-id="${item.id}">
                        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="mt-2 text-right">
                <span class="text-sm text-gray-600">Subtotal: </span>
                <span class="font-bold text-gray-800">$${itemTotal.toFixed(2)}</span>
            </div>
        `

    container.appendChild(cartItem)
  })

  // Event listeners para botones del carrito
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
      updateCartUI()
      renderCart()
    }
  }
}

function removeFromCart(productId) {
  state.cart = state.cart.filter((item) => item.id !== productId)
  updateCartUI()
  renderCart()
}

function sendWhatsAppOrder() {
  if (state.cart.length === 0) {
    alert("El carrito está vacío")
    return
  }

  console.log("[v0] Generando mensaje de WhatsApp")

  let message = "🛒 *Nuevo Pedido - SONIMAx MÓVIL*\n\n"
  message += `👤 Cliente: ${state.userName}\n\n`
  message += "*Productos:*\n"

  let total = 0
  state.cart.forEach((item, index) => {
    const subtotal = item.price * item.quantity
    total += subtotal
    message += `${index + 1}. *${item.nombre}*\n`
    if (item.descripcion) {
      message += `   📝 ${item.descripcion}\n`
    }
    message += `   📦 Cantidad: ${item.quantity}\n`
    message += `   💵 Precio: $${item.price.toFixed(2)}\n`
    message += `   💰 Subtotal: $${subtotal.toFixed(2)}\n\n`
  })

  message += `*TOTAL: $${total.toFixed(2)}*\n\n`
  message += "¡Gracias por tu pedido! 🎉"

  const encodedMessage = encodeURIComponent(message)
  const whatsappURL = `https://wa.me/?text=${encodedMessage}`

  console.log("[v0] Abriendo WhatsApp para elegir contacto")
  window.open(whatsappURL, "_blank")

  state.cart = []
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

  console.log("[v0] Procesando archivo CSV:", file.name)

  submitBtn.disabled = true
  submitBtn.textContent = "Procesando..."

  try {
    const text = await file.text()
    const lines = text.split("\n").filter((line) => line.trim())

    if (lines.length < 2) {
      throw new Error("El archivo CSV está vacío o no tiene datos")
    }

    // Parsear encabezados
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase())

    const codigoIdx = headers.findIndex((h) => h === "codigo")
    const descripcionIdx = headers.findIndex((h) => h === "descripcion")
    const detalIdx = headers.findIndex((h) => h === "detal")
    const mayorIdx = headers.findIndex((h) => h === "mayor")
    const gmayorIdx = headers.findIndex((h) => h === "gmayor")
    const departamentoIdx = headers.findIndex((h) => h === "departamento")
    const urlIdx = headers.findIndex((h) => h === "url")

    console.log("[v0] Índices de columnas encontrados:", {
      codigo: codigoIdx,
      descripcion: descripcionIdx,
      detal: detalIdx,
      mayor: mayorIdx,
      gmayor: gmayorIdx,
      departamento: departamentoIdx,
      url: urlIdx,
    })

    // Validar que existan las columnas requeridas
    if (codigoIdx === -1 || descripcionIdx === -1 || detalIdx === -1 || mayorIdx === -1 || gmayorIdx === -1) {
      throw new Error("El CSV debe contener las columnas: codigo, descripcion, detal, mayor, gmayor")
    }

    const products = []

    // Procesar cada línea
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",").map((v) => v.trim())

      if (values.length < Math.max(codigoIdx, descripcionIdx, detalIdx, mayorIdx, gmayorIdx) + 1) {
        console.warn(`[v0] Línea ${i + 1} tiene menos columnas de las esperadas, saltando...`)
        continue
      }

      const product = {
        nombre: values[codigoIdx] || `Producto ${i}`,
        descripcion: values[descripcionIdx] || "",
        precio_cliente: Number.parseFloat(values[detalIdx]) || 0,
        precio_distribuidor: Number.parseFloat(values[mayorIdx]) || 0,
        precio_gmayor: Number.parseFloat(values[gmayorIdx]) || 0,
        departamento: departamentoIdx !== -1 ? values[departamentoIdx] || "General" : "General",
        imagen_url: urlIdx !== -1 ? values[urlIdx] || null : null,
      }

      products.push(product)
    }

    console.log("[v0] Productos parseados:", products.length)

    if (products.length === 0) {
      throw new Error("No se pudieron parsear productos del CSV")
    }

    console.log("[v0] Eliminando productos existentes...")
    const { error: deleteError } = await supabaseClient.from("products").delete().neq("id", 0)

    if (deleteError) {
      console.error("[v0] Error eliminando productos:", deleteError)
      throw new Error("Error al eliminar productos existentes: " + deleteError.message)
    }

    console.log("[v0] Productos existentes eliminados, insertando nuevos...")

    const batchSize = 100
    for (let i = 0; i < products.length; i += batchSize) {
      const batch = products.slice(i, i + batchSize)
      const { error } = await supabaseClient.from("products").insert(batch)

      if (error) throw error

      console.log(`[v0] Lote ${Math.floor(i / batchSize) + 1} insertado (${batch.length} productos)`)
    }

    statusDiv.textContent = `✅ ¡Éxito! ${products.length} productos cargados correctamente (productos anteriores reemplazados)`
    statusDiv.className = "mt-4 p-4 rounded-lg text-sm bg-green-50 text-green-700 border border-green-200"
    statusDiv.classList.remove("hidden")

    await loadDepartments()
    await loadProducts()

    setTimeout(() => {
      closeCSVModal()
    }, 2000)
  } catch (error) {
    console.error("[v0] Error procesando CSV:", error)
    statusDiv.textContent = `❌ Error: ${error.message}`
    statusDiv.className = "mt-4 p-4 rounded-lg text-sm bg-red-50 text-red-700 border border-red-200"
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
