// SONIMAx MÓVIL - Aplicación Principal
// Estado Global
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
}

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
// </CHANGE>

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

function normalizeText(text) {
  if (!text) return ""
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
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

const debouncedGlobalSearch = debounce((value) => {
  state.searchQuery = value.toLowerCase()
  renderProducts()
}, 300)

const debouncedDeptSearch = debounce((value) => {
  state.deptSearchQuery = value.toLowerCase()
  renderProducts()
}, 300)
// </CHANGE>

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
  // </CHANGE>

  document.getElementById("cart-button").addEventListener("click", openCart)
  document.getElementById("close-cart").addEventListener("click", closeCart)
  document.getElementById("send-whatsapp").addEventListener("click", sendWhatsAppOrder)

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

async function handleLogin(e) {
  e.preventDefault()

  const email = document.getElementById("login-email").value
  const password = document.getElementById("login-password").value
  const errorDiv = document.getElementById("auth-error")

  try {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    })

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
        data: {
          name: name,
          role: "cliente",
        },
        emailRedirectTo: window.location.origin,
      },
    })

    if (authError) throw authError

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
    let fallbackRole = user.user_metadata?.role || "cliente"
    if (fallbackRole === 1 || fallbackRole === "1") fallbackRole = "cliente"
    if (fallbackRole === 2 || fallbackRole === "2") fallbackRole = "distribuidor"
    if (fallbackRole === 3 || fallbackRole === "3") fallbackRole = "admin"
    state.userRole = fallbackRole
    state.userName = user.user_metadata?.name || "Usuario"
  } else {
    let dbRole = userData.role
    if (dbRole === 1 || dbRole === "1") dbRole = "cliente"
    if (dbRole === 2 || dbRole === "2") dbRole = "distribuidor"
    if (dbRole === 3 || dbRole === "3") dbRole = "admin"
    state.userRole = dbRole
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

  let roleText = ""
  let roleClass = ""

  switch (state.userRole) {
    case "admin":
      roleText = "Administrador"
      roleClass = "role-badge-admin"
      if (adminSection) {
        adminSection.classList.remove("hidden")
      }
      break
    case "distribuidor":
      roleText = "Distribuidor"
      roleClass = "role-badge-distribuidor"
      if (adminSection) {
        adminSection.classList.add("hidden")
      }
      break
    case "cliente":
    default:
      roleText = "Cliente"
      roleClass = "role-badge-cliente"
      if (adminSection) {
        adminSection.classList.add("hidden")
      }
      break
  }

  roleBadge.textContent = roleText
  roleBadge.className = `px-3 py-1 rounded-full text-xs font-semibold ${roleClass}`
}

async function loadDepartments() {
  const { data, error } = await supabaseClient.rpc("get_distinct_departments")

  if (error) {
    console.error("[v0] Error cargando departamentos:", error)
    return
  }

  const uniqueDepts = data.map((row) => row.departamento).filter((d) => d && d.trim() !== "")

  state.departments = uniqueDepts
  renderDepartments()
}

async function loadProducts() {
  try {
    const { data, error } = await supabaseClient.from("products").select("*").order("nombre")

    if (error) {
      console.error("[v0] Error cargando productos:", error)
      return
    }

    // Pre-calcular textos normalizados para búsquedas más rápidas
    state.products = data.map((product) => ({
      ...product,
      _searchText: normalizeText(`${product.nombre} ${product.descripcion} ${product.departamento}`),
    }))

    renderProducts()
  } catch (error) {
    console.error("[v0] Error en loadProducts:", error)
  }
}
// </CHANGE>

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

  let filteredProducts = state.products

  if (state.searchQuery) {
    const normalizedQuery = normalizeText(state.searchQuery)
    filteredProducts = filteredProducts.filter((p) => p._searchText.includes(normalizedQuery))
  } else {
    if (state.currentDepartment !== "all") {
      filteredProducts = filteredProducts.filter((p) => p.departamento === state.currentDepartment)
    }

    if (state.deptSearchQuery && state.currentDepartment !== "all") {
      const normalizedDeptQuery = normalizeText(state.deptSearchQuery)
      filteredProducts = filteredProducts.filter((p) => p._searchText.includes(normalizedDeptQuery))
    }
  }

  if (filteredProducts.length === 0) {
    container.innerHTML = ""
    noProducts.classList.remove("hidden")
    return
  }

  noProducts.classList.add("hidden")
  container.innerHTML = ""

  // Usar DocumentFragment para mejor rendimiento
  const fragment = document.createDocumentFragment()

  filteredProducts.forEach((product) => {
    const card = createProductCard(product)
    fragment.appendChild(card)
  })

  container.appendChild(fragment)
}
// </CHANGE>

function createProductCard(product) {
  const card = document.createElement("div")
  card.className = "product-card fade-in"

  let pricesHTML = ""

  if (state.userRole === "cliente") {
    pricesHTML = `
      <div>
        <span class="text-xs text-gray-500">Detal</span>
        <span class="price-badge block mt-1">$${product.precio_cliente.toFixed(2)}</span>
      </div>
    `
  } else if (state.userRole === "distribuidor") {
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
                 loading="lazy"
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
  // </CHANGE>

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
           loading="lazy"
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
                     loading="lazy"
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

  let message = "NUEVO PEDIDO - SONIMAX MOVIL\n\n"
  message += `Cliente: ${state.userName}\n\n`
  message += "PRODUCTOS:\n"

  state.cart.forEach((item, index) => {
    message += `${index + 1}. ${item.nombre}\n`
    if (item.descripcion) {
      message += `   ${item.descripcion}\n`
    }
    message += `   Cantidad: ${item.quantity}\n\n`
  })

  message += "Gracias por tu pedido"

  const encodedMessage = encodeURIComponent(message)
  const whatsappURL = `https://wa.me/?text=${encodedMessage}`

  window.open(whatsappURL, "_blank")

  state.cart = []
  clearCartFromLocalStorage()

  updateCartUI()
  closeCart()
}
// </CHANGE>

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
    fileNameDiv.textContent = `Archivo seleccionado: ${file.name}`
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
    const text = await file.text()
    const lines = text.split("\n").filter((line) => line.trim())

    if (lines.length < 2) {
      throw new Error("El archivo CSV está vacío o no tiene datos")
    }

    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase())

    const codigoIdx = headers.findIndex((h) => h === "codigo")
    const descripcionIdx = headers.findIndex((h) => h === "descripcion")
    const detalIdx = headers.findIndex((h) => h === "detal")
    const mayorIdx = headers.findIndex((h) => h === "mayor")
    const gmayorIdx = headers.findIndex((h) => h === "gmayor")
    const departamentoIdx = headers.findIndex((h) => h === "departamento")
    const urlIdx = headers.findIndex((h) => h === "url")

    if (codigoIdx === -1 || descripcionIdx === -1 || detalIdx === -1 || mayorIdx === -1 || gmayorIdx === -1) {
      throw new Error("El CSV debe contener las columnas: codigo, descripcion, detal, mayor, gmayor")
    }

    const products = []

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",").map((v) => v.trim())

      if (values.length < Math.max(codigoIdx, descripcionIdx, detalIdx, mayorIdx, gmayorIdx) + 1) {
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

    if (products.length === 0) {
      throw new Error("No se pudieron parsear productos del CSV")
    }

    const { error: deleteError } = await supabaseClient.from("products").delete().neq("id", 0)

    if (deleteError) {
      throw new Error("Error al eliminar productos existentes: " + deleteError.message)
    }

    const batchSize = 100
    for (let i = 0; i < products.length; i += batchSize) {
      const batch = products.slice(i, i + batchSize)
      const { error } = await supabaseClient.from("products").insert(batch)

      if (error) throw error
    }

    statusDiv.textContent = `Éxito! ${products.length} productos cargados correctamente`
    statusDiv.className = "mt-4 p-4 rounded-lg text-sm bg-green-50 text-green-700 border border-green-200"
    statusDiv.classList.remove("hidden")

    await loadDepartments()
    await loadProducts()

    setTimeout(() => {
      closeCSVModal()
    }, 2000)
  } catch (error) {
    console.error("[v0] Error procesando CSV:", error)
    statusDiv.textContent = `Error: ${error.message}`
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
