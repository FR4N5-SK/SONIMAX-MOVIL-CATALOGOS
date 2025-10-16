// SONIMAX MÓVIL - Aplicación Principal
// Sistema actualizado con USUARIO en lugar de EMAIL

let currentUser = null
let currentUserRole = null
let allProducts = []
let filteredProducts = []
let cart = []
let currentDepartment = "all"
let selectedProductForQuantity = null

// ============================================
// INICIALIZACIÓN
// ============================================

document.addEventListener("DOMContentLoaded", async () => {
  console.log("🚀 Iniciando SONIMAX MÓVIL...")

  // Verificar sesión existente
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

// ============================================
// AUTENTICACIÓN - ACTUALIZADA CON USUARIOS
// ============================================

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault()
  const username = document.getElementById("login-username").value.trim().toLowerCase()
  const password = document.getElementById("login-password").value

  showAuthMessage("Iniciando sesión...", "info")

  try {
    const internalEmail = `${username}@sonimax.internal`

    // Usar el email generado para autenticar
    const { data, error } = await window.supabaseClient.auth.signInWithPassword({
      email: internalEmail,
      password: password,
    })

    if (error) {
      // Si el error es de credenciales inválidas, mostrar mensaje genérico
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
    // Verificar si el username ya existe
    const { data: existingUser } = await window.supabaseClient
      .from("users")
      .select("username")
      .eq("username", username)
      .single()

    if (existingUser) {
      throw new Error("El nombre de usuario ya está en uso")
    }

    // Generar email interno basado en username
    const internalEmail = `${username}@sonimax.internal`

    // Crear usuario en Supabase Auth
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
      console.error("[v0] Error actualizando usuario:", updateError)
    }

    console.log("[v0] ✅ Registro exitoso")
    showAuthMessage("¡Cuenta creada exitosamente! Iniciando sesión...", "success")

    setTimeout(async () => {
      await loadUserData(data.user.id)
      showApp()
    }, 1500)
  } catch (error) {
    console.error("[v0] ❌ Error en registro:", error)
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
    // Verificar si el username ya existe
    const { data: existingUser } = await window.supabaseClient
      .from("users")
      .select("username")
      .eq("username", username)
      .maybeSingle()

    if (existingUser) {
      throw new Error("El nombre de usuario ya está en uso")
    }

    // Generar email interno
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

    // Limpiar formulario
    document.getElementById("create-user-form").reset()

    setTimeout(() => {
      document.getElementById("create-user-modal").classList.add("hidden")
    }, 2000)
  } catch (error) {
    console.error("❌ Error al crear usuario:", error)
    showCreateUserMessage(error.message || "Error al crear el usuario. Intenta con otro nombre de usuario.", "error")
  }
})

// Cargar datos del usuario
async function loadUserData(userId) {
  console.log("[v0] Cargando datos del usuario:", userId)

  try {
    const { data, error } = await window.supabaseClient.from("users").select("*").eq("auth_id", userId).single()

    if (error) {
      console.error("[v0] Error obteniendo datos:", error)
      throw error
    }

    if (!data) {
      console.error("[v0] No se encontró el usuario")
      throw new Error("Usuario no encontrado")
    }

    currentUser = data
    currentUserRole = data.role

    console.log("[v0] ✅ Datos de usuario cargados:", {
      username: data.username,
      name: data.name,
      role: data.role,
    })

    updateUIForRole()
  } catch (error) {
    console.error("[v0] ❌ Error al cargar datos del usuario:", error)
    // Si hay error, cerrar sesión
    await window.supabaseClient.auth.signOut()
    showLogin()
  }
}

function updateUIForRole() {
  const roleBadge = document.getElementById("user-role-badge")
  const adminSection = document.getElementById("admin-section")
  const gestorSection = document.getElementById("gestor-section")

  if (roleBadge) {
    roleBadge.textContent = `${currentUser.name} (${currentUserRole})`
    roleBadge.className = `role-badge-${currentUserRole}`
    roleBadge.classList.remove("hidden")
  }

  // Admin: puede subir CSV, exportar PDF y crear usuarios
  // Gestor: solo puede crear usuarios
  // Distribuidor: solo ve catálogo con precios detal y mayor (NO crea usuarios)
  // Cliente: solo ve catálogo con precios de cliente
  if (currentUserRole === "admin") {
    adminSection?.classList.remove("hidden")
    gestorSection?.classList.remove("hidden")
  } else if (currentUserRole === "gestor") {
    adminSection?.classList.add("hidden")
    gestorSection?.classList.remove("hidden")
  } else {
    // distribuidor y cliente no ven ninguna sección de administración
    adminSection?.classList.add("hidden")
    gestorSection?.classList.add("hidden")
  }
}

// Logout
document.getElementById("logout-button")?.addEventListener("click", async () => {
  await window.supabaseClient.auth.signOut()
  currentUser = null
  currentUserRole = null
  cart = []
  showLogin()
})

// ============================================
// FUNCIONES DE UI
// ============================================

function showLogin() {
  document.getElementById("loading-screen").classList.add("hidden")
  document.getElementById("login-screen").classList.remove("hidden")
  document.getElementById("app-screen").classList.add("hidden")
}

function showApp() {
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

// ============================================
// EVENT LISTENERS
// ============================================

function setupEventListeners() {
  // Tabs de autenticación
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

    // Limpiar opciones anteriores
    roleSelect.innerHTML = ""

    // Gestor puede crear: cliente, distribuidor, gestor
    // Admin puede crear: cliente, distribuidor, gestor, admin
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

  // Sidebar
  document.getElementById("open-sidebar")?.addEventListener("click", () => {
    document.getElementById("sidebar-menu").classList.add("open")
    document.getElementById("sidebar-overlay").classList.remove("hidden")
  })

  document.getElementById("close-sidebar")?.addEventListener("click", closeSidebar)
  document.getElementById("sidebar-overlay")?.addEventListener("click", closeSidebar)

  // Carrito
  document.getElementById("cart-button")?.addEventListener("click", () => {
    document.getElementById("cart-modal").classList.remove("hidden")
    renderCart()
  })

  document.getElementById("close-cart")?.addEventListener("click", () => {
    document.getElementById("cart-modal").classList.add("hidden")
  })

  // Búsqueda
  document.getElementById("global-search")?.addEventListener("input", handleGlobalSearch)
  document.getElementById("dept-search")?.addEventListener("input", handleDeptSearch)

  // WhatsApp
  document.getElementById("send-whatsapp")?.addEventListener("click", sendWhatsAppOrder)

  // CSV Upload
  document.getElementById("upload-csv-button")?.addEventListener("click", () => {
    document.getElementById("csv-modal").classList.remove("hidden")
  })

  document.getElementById("close-csv-modal")?.addEventListener("click", () => {
    document.getElementById("csv-modal").classList.add("hidden")
  })

  document.getElementById("csv-file-input")?.addEventListener("change", handleCSVFileSelect)
  document.getElementById("upload-csv-submit")?.addEventListener("click", handleCSVUpload)

  // PDF Export
  document.getElementById("export-pdf-button")?.addEventListener("click", () => {
    document.getElementById("pdf-modal").classList.remove("hidden")
    loadDepartmentsForPDF()
  })

  document.getElementById("close-pdf-modal")?.addEventListener("click", () => {
    document.getElementById("pdf-modal").classList.add("hidden")
  })

  document.getElementById("generate-pdf-button")?.addEventListener("click", generatePDF)

  // Modal de cantidad
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

// ============================================
// PRODUCTOS
// ============================================

async function loadProducts() {
  try {
    document.getElementById("products-loading").classList.remove("hidden")
    document.getElementById("products-grid").innerHTML = ""

    allProducts = []
    let start = 0
    const batchSize = 1000
    let hasMore = true

    // Cargar productos en lotes hasta obtener todos
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

        // Si recibimos menos de 1000, ya no hay más productos
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

    renderDepartments()
    renderProducts()

    console.log(`✅ ${allProducts.length} productos cargados en total`)
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
    // Botón en navbar
    const navBtn = document.createElement("button")
    navBtn.className = "dept-button whitespace-nowrap px-5 py-2.5 rounded-xl font-semibold transition-all text-sm"
    navBtn.textContent = dept
    navBtn.dataset.dept = dept
    navBtn.addEventListener("click", () => filterByDepartment(dept))
    navContainer.appendChild(navBtn)

    // Botón en sidebar
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

  // Botón "Todos" en navbar
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

  // Actualizar botones activos
  document.querySelectorAll(".dept-button, .sidebar-dept-btn").forEach((btn) => {
    btn.classList.remove("active")
    if (btn.dataset.dept === dept) {
      btn.classList.add("active")
    }
  })

  // Mostrar/ocultar búsqueda por departamento
  const deptSearchContainer = document.getElementById("dept-search-container")
  if (dept === "all") {
    deptSearchContainer.classList.add("hidden")
  } else {
    deptSearchContainer.classList.remove("hidden")
  }

  renderProducts()
}

function renderProducts() {
  const grid = document.getElementById("products-grid")
  const noProducts = document.getElementById("no-products")

  grid.innerHTML = ""

  if (filteredProducts.length === 0) {
    noProducts.classList.remove("hidden")
    return
  }

  noProducts.classList.add("hidden")

  filteredProducts.forEach((product) => {
    const card = createProductCard(product)
    grid.appendChild(card)
  })
}

function createProductCard(product) {
  const card = document.createElement("div")
  card.className = "product-card"

  const priceInfo = getPriceForRole(product)

  let priceHTML = ""
  if (priceInfo.display === "single") {
    priceHTML = `<span class="price-badge">$${priceInfo.price.toFixed(2)}</span>`
  } else {
    // Mostrar ambos precios para distribuidor y gestor
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
  }

  card.innerHTML = `
    <div class="product-image-container">
      <img src="${product.imagen_url || "/generic-product-display.png"}" 
           alt="${product.nombre}" 
           class="product-image"
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
    case "distribuidor":
      return {
        display: "dual",
        priceCliente: product.precio_cliente || 0,
        priceMayor: product.precio_mayor || 0,
        labelCliente: "Detal",
        labelMayor: "Mayor",
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

// ============================================
// CARRITO - ACTUALIZADO CON PERSISTENCIA
// ============================================

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
    priceHTML = `<p class="text-red-600 font-black text-xl">$${priceInfo.price.toFixed(2)}</p>`
  } else {
    // Distribuidor/Gestor: mostrar ambos precios y permitir elegir
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

  if (priceInfo.display === "dual") {
    // Distribuidor/Gestor: obtener el precio seleccionado
    const priceOption = document.querySelector('input[name="price-option"]:checked')?.value
    selectedPrice = priceOption === "mayor" ? priceInfo.priceMayor : priceInfo.priceCliente
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
  const cartItems = document.getElementById("cart-items")
  const cartTotal = document.getElementById("cart-total")

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

  cartItems.innerHTML = cart
    .map(
      (item) => `
    <div class="cart-item">
      <div class="flex items-center space-x-4">
        <img src="${item.imagen_url || "/generic-product-display.png"}" 
             alt="${item.nombre}" 
             class="w-20 h-20 object-cover rounded-lg"
             onerror="this.src='/generic-product-display.png'">
        <div class="flex-1">
          <h4 class="font-bold text-gray-800">${item.nombre}</h4>
          <p class="text-red-600 font-bold text-lg">$${item.price.toFixed(2)}</p>
        </div>
      </div>
      <div class="flex items-center justify-between mt-4">
        <div class="flex items-center space-x-3">
          <button class="quantity-button" onclick="updateCartItemQuantity(${item.id}, -1)">-</button>
          <span class="text-xl font-bold text-gray-800 min-w-[40px] text-center">${item.quantity}</span>
          <button class="quantity-button" onclick="updateCartItemQuantity(${item.id}, 1)">+</button>
        </div>
        <button class="text-red-600 hover:text-red-700 font-semibold" onclick="removeFromCart(${item.id})">
          Eliminar
        </button>
      </div>
    </div>
  `,
    )
    .join("")

  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)
  cartTotal.textContent = `$${total.toFixed(2)}`
}

function updateCartItemQuantity(productId, change) {
  const item = cart.find((i) => i.id === productId)
  if (!item) return

  item.quantity += change

  if (item.quantity <= 0) {
    removeFromCart(productId)
  } else {
    saveCartToStorage()
    updateCartCount()
    renderCart()
  }
}

function removeFromCart(productId) {
  cart = cart.filter((item) => item.id !== productId)
  saveCartToStorage()
  updateCartCount()
  renderCart()
}

// ============================================
// WHATSAPP
// ============================================

function sendWhatsAppOrder() {
  if (cart.length === 0) {
    alert("El carrito está vacío")
    return
  }

  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0)

  let message = `*PEDIDO SONIMAX MÓVIL*\n\n`
  message += `*Cliente:* ${currentUser.name}\n`
  message += `*Usuario:* ${currentUser.username}\n`
  message += `*Rol:* ${currentUserRole}\n\n`
  message += `*PRODUCTOS:*\n`

  cart.forEach((item, index) => {
    message += `\n${index + 1}. *${item.nombre}*\n`
    message += `   Cantidad: ${item.quantity}\n`
    message += `   Precio: $${item.price.toFixed(2)}\n`
    message += `   Subtotal: $${(item.price * item.quantity).toFixed(2)}\n`
  })

  message += `\n*TOTAL: $${total.toFixed(2)}*`

  const whatsappNumber = "1234567890" // Cambiar por el número real
  const encodedMessage = encodeURIComponent(message)
  const whatsappURL = `https://wa.me/${whatsappNumber}?text=${encodedMessage}`

  window.open(whatsappURL, "_blank")

  clearCart()

  // Cerrar modal del carrito
  document.getElementById("cart-modal").classList.add("hidden")

  alert("Pedido enviado por WhatsApp. El carrito ha sido limpiado.")
}

// ============================================
// BÚSQUEDA
// ============================================

let searchTimeout = null

function handleGlobalSearch(e) {
  const query = e.target.value.toLowerCase().trim()

  clearTimeout(searchTimeout)

  if (query === "") {
    filteredProducts = allProducts
    renderProducts()
    return
  }

  document.getElementById("search-loading").classList.remove("hidden")

  searchTimeout = setTimeout(() => {
    filteredProducts = allProducts.filter(
      (p) =>
        p.nombre.toLowerCase().includes(query) ||
        (p.descripcion && p.descripcion.toLowerCase().includes(query)) ||
        (p.departamento && p.departamento.toLowerCase().includes(query)),
    )

    renderProducts()
    document.getElementById("search-loading").classList.add("hidden")
  }, 300)
}

function handleDeptSearch(e) {
  const query = e.target.value.toLowerCase().trim()

  if (query === "") {
    filterByDepartment(currentDepartment)
    return
  }

  filteredProducts = allProducts.filter(
    (p) =>
      p.departamento === currentDepartment &&
      (p.nombre.toLowerCase().includes(query) || (p.descripcion && p.descripcion.toLowerCase().includes(query))),
  )

  renderProducts()
}

// ============================================
// CSV UPLOAD (Solo Admin)
// ============================================

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

      // Parsear headers (primera línea)
      const headers = lines[0].split(",").map((h) => h.trim().toUpperCase())

      // Encontrar índices de las columnas que necesitamos
      const colIndexes = {
        descripcion: headers.indexOf("DESCRIPCION"),
        codigo: headers.indexOf("CODIGO"),
        detal: headers.indexOf("DETAL"),
        mayor: headers.indexOf("MAYOR"),
        gmayor: headers.indexOf("GMAYOR"),
        url: headers.indexOf("URL"),
        departamento: headers.indexOf("DEPARTAMENTO"),
      }

      // Verificar que existan las columnas necesarias
      if (
        colIndexes.descripcion === -1 ||
        colIndexes.detal === -1 ||
        colIndexes.mayor === -1 ||
        colIndexes.gmayor === -1
      ) {
        throw new Error("El CSV debe contener las columnas: DESCRIPCION, DETAL, MAYOR, GMAYOR")
      }

      const products = []

      // Parsear cada línea de datos
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim()
        if (!line) continue

        // Parsear valores respetando comillas
        const values = parseCSVLine(line)

        if (values.length < headers.length) continue

        // Extraer valores de las columnas
        const descripcion = values[colIndexes.descripcion]?.trim() || ""
        const codigo = colIndexes.codigo !== -1 ? values[colIndexes.codigo]?.trim() || "" : ""
        const detal = values[colIndexes.detal]?.trim() || "0"
        const mayor = values[colIndexes.mayor]?.trim() || "0"
        const gmayor = values[colIndexes.gmayor]?.trim() || "0"
        const url = colIndexes.url !== -1 ? values[colIndexes.url]?.trim() || null : null
        const departamento =
          colIndexes.departamento !== -1 ? values[colIndexes.departamento]?.trim() || "Sin categoría" : "Sin categoría"

        // Validar que tenga al menos descripción
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

      // Eliminar productos existentes
      const { error: deleteError } = await window.supabaseClient.from("products").delete().not("id", "is", null)

      if (deleteError) {
        console.error("Error al eliminar productos existentes:", deleteError)
        throw new Error("Error al limpiar productos existentes")
      }

      // Insertar nuevos productos
      const { error } = await window.supabaseClient.from("products").insert(products)

      if (error) throw error

      showCSVStatus(
        `✅ ${products.length} productos subidos exitosamente (productos anteriores reemplazados)`,
        "success",
      )

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

// ============================================
// PDF EXPORT (Solo Admin)
// ============================================

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
