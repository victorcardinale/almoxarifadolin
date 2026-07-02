/**
 * Pedidos Almoxarifado LIN — Instituto Butantan
 * Frontend Logic: OAuth, Form, Validation, Submission
 */

// ==================== CONFIGURATION ====================
// ⚠️ SUBSTITUA ESTES VALORES ANTES DE USAR:

// 1. URL do Google Apps Script (deploy como Web App)
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbyqvpblBJwWDAQ-rxhk0X2C3Qmq541ZYxXmtBjXBfZL6wbTQ3ZgYh0tAPqie80axyo/exec';

// 2. Client ID do Google OAuth (console.cloud.google.com > Credentials)
const GOOGLE_CLIENT_ID = '584320506846-0dci20l0up0g8gvhrjl487b8375ok35h.apps.googleusercontent.com';

// Domínio permitido para login
const ALLOWED_DOMAIN = 'fundacaobutantan.org.br';

// ==================== STATE ====================
let materialsData = []; // Lista de materiais da planilha
let currentOrderId = null;
let userEmail = null;
let toastTimeout = null;

// ==================== INITIALIZATION ====================

document.addEventListener('DOMContentLoaded', () => {
  initGoogleSignIn();
  initEventListeners();
  setMinDate();

  // Verifica sessão existente
  const savedEmail = sessionStorage.getItem('userEmail');
  if (savedEmail) {
    userEmail = savedEmail;
    showFormScreen();
  }
});

// ==================== GOOGLE SIGN-IN ====================

function initGoogleSignIn() {
  // Espera o script do Google carregar
  const checkGoogle = setInterval(() => {
    if (typeof google !== 'undefined' && google.accounts) {
      clearInterval(checkGoogle);

      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleCredentialResponse,
        auto_select: false,
        cancel_on_tap_outside: true
      });

      google.accounts.id.renderButton(
        document.getElementById('google-signin-btn'),
        {
          type: 'standard',
          theme: 'filled_black',
          size: 'large',
          shape: 'pill',
          text: 'signin_with',
          locale: 'pt-BR',
          width: 300
        }
      );
    }
  }, 100);
}

function handleCredentialResponse(response) {
  try {
    // Decodifica o JWT token corretamente (Base64Url para UTF-8)
    const base64Url = response.credential.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    
    const payload = JSON.parse(jsonPayload);
    const email = payload.email || '';
    const hd = payload.hd || ''; // hosted domain

    // Verifica se é do domínio permitido
    if (hd !== ALLOWED_DOMAIN && !email.endsWith('@' + ALLOWED_DOMAIN)) {
      console.warn('Domínio não autorizado:', email, hd);
      showLoginError();
      return;
    }

    // Salva na sessão
    userEmail = email;
    sessionStorage.setItem('userEmail', email);
    sessionStorage.setItem('userName', payload.name || '');

    hideLoginError();
    showFormScreen();
  } catch (err) {
    console.error('Erro ao processar login (JWT decode):', err);
    showToast('Erro ao ler os dados do Google. Tente novamente.', 'error');
  }
}

function showLoginError() {
  document.getElementById('login-error').classList.add('show');
}

function hideLoginError() {
  document.getElementById('login-error').classList.remove('show');
}

function logout() {
  userEmail = null;
  sessionStorage.removeItem('userEmail');
  sessionStorage.removeItem('userName');

  // Revoga o token do Google
  if (typeof google !== 'undefined' && google.accounts) {
    google.accounts.id.disableAutoSelect();
  }

  // Volta para tela de login
  document.getElementById('form-screen').classList.remove('active');
  document.getElementById('login-screen').classList.add('active');
}

// ==================== SCREEN MANAGEMENT ====================

function showFormScreen() {
  document.getElementById('login-screen').classList.remove('active');
  document.getElementById('form-screen').classList.add('active');

  // Preenche o email
  document.getElementById('email-field').value = userEmail;
  document.getElementById('user-email-display').textContent = userEmail;

  // Gera cards de material
  generateMaterialCards();

  // Carrega materiais e ID
  loadInitialData();
}

// ==================== DATA LOADING ====================

async function loadInitialData() {
  showLoading('Carregando materiais...');

  try {
    // Tenta carregar materiais via Apps Script
    let materialsLoaded = false;

    try {
      const materialsResponse = await fetchAppsScript('materials');
      if (materialsResponse && materialsResponse.materials && materialsResponse.materials.length > 0) {
        materialsData = materialsResponse.materials;
        materialsLoaded = true;
        console.log('Materiais carregados via Apps Script:', materialsData.length);
      }
    } catch (err) {
      console.warn('Apps Script falhou para materiais, tentando CSV...', err);
    }

    // Fallback: carrega direto da planilha pública via CSV
    if (!materialsLoaded) {
      try {
        materialsData = await loadMaterialsFromCSV();
        materialsLoaded = true;
        console.log('Materiais carregados via CSV:', materialsData.length);
      } catch (err2) {
        console.error('CSV também falhou:', err2);
      }
    }

    if (!materialsLoaded || materialsData.length === 0) {
      throw new Error('Não foi possível carregar os materiais.');
    }

    // Carrega próximo ID
    try {
      const idResponse = await fetchAppsScript('next_id');
      if (idResponse && idResponse.nextId) {
        currentOrderId = idResponse.nextId;
      } else {
        currentOrderId = 1;
      }
    } catch (err) {
      console.warn('Erro ao buscar próximo ID, usando 1:', err);
      currentOrderId = 1;
    }

    // Atualiza UI
    document.getElementById('order-id').textContent = String(currentOrderId).padStart(4, '0');

    // Popula os dropdowns
    populateAllSelects();

    hideLoading();
  } catch (err) {
    hideLoading();
    console.error('Erro ao carregar dados:', err);
    showToast('Erro ao carregar materiais. Verifique a conexão e recarregue a página.', 'error');
  }
}

/**
 * Fetch do Apps Script com tratamento robusto de erros
 */
async function fetchAppsScript(action, data) {
  let url = APPS_SCRIPT_URL + '?action=' + action;

  if (data) {
    url += '&data=' + encodeURIComponent(JSON.stringify(data));
  }

  const response = await fetch(url, { redirect: 'follow' });

  // Lê como texto primeiro para debugar
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch (parseErr) {
    console.error('Resposta não é JSON válido:', text.substring(0, 500));
    throw new Error('Resposta inválida do servidor');
  }
}

/**
 * Fallback: carrega materiais diretamente do CSV público da planilha
 */
async function loadMaterialsFromCSV() {
  const csvUrl = 'https://docs.google.com/spreadsheets/d/1c1ZNN7RVtGxvNd4khXZaVp88CvWOg-Nia-3g55UqMRo/gviz/tq?tqx=out:csv&gid=0';
  const response = await fetch(csvUrl);
  const csvText = await response.text();

  const lines = csvText.split('\n');
  const materials = [];
  const seen = {};

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Parse CSV (campos entre aspas)
    const match = line.match(/^"([^"]*)","([^"]*)"/); 
    if (!match) continue;

    const sap = match[1].trim();
    const descricao = match[2].trim();

    if (!sap || !descricao) continue;

    const key = sap + '|' + descricao;
    if (seen[key]) continue;
    seen[key] = true;

    materials.push({ sap: sap, descricao: descricao });
  }

  return materials;
}

// ==================== MATERIAL CARDS GENERATION ====================

function generateMaterialCards() {
  const container = document.getElementById('materials-container');
  container.innerHTML = '';

  for (let i = 1; i <= 5; i++) {
    const card = document.createElement('div');
    card.className = 'material-card glass-card';
    card.id = 'material-card-' + i;
    card.innerHTML = `
      <div class="material-header">
        <div class="material-number">
          <span class="num-badge">${i}</span>
          Material ${i}
        </div>
        <button class="btn-clear-material" type="button" data-index="${i}" title="Limpar material">✕</button>
      </div>
      <div class="material-fields">
        <div class="field-group">
          <label class="field-label">Descrição do Material</label>
          <div class="custom-select" id="select-material-${i}">
            <div class="select-trigger" data-index="${i}">Selecione o material...</div>
            <div class="select-dropdown">
              <div class="select-search-wrapper">
                <input type="text" class="select-search" placeholder="Buscar material..." data-index="${i}">
              </div>
              <div class="select-options" id="options-${i}"></div>
            </div>
          </div>
        </div>
        <div class="field-group">
          <label class="field-label">Código SAP</label>
          <input type="text" class="sap-field" id="sap-${i}" readonly placeholder="—" tabindex="-1">
        </div>
        <div class="field-group">
          <label class="field-label">Quantidade</label>
          <div class="qty-control">
            <button class="qty-btn minus" type="button" data-index="${i}">−</button>
            <input type="number" class="qty-input" id="qty-${i}" min="1" step="1" placeholder="0" data-index="${i}">
            <button class="qty-btn plus" type="button" data-index="${i}">+</button>
          </div>
        </div>
      </div>
    `;
    container.appendChild(card);
  }

  // Bind events for new cards
  bindMaterialEvents();
}

// ==================== CUSTOM SELECT (SEARCHABLE DROPDOWN) ====================

function populateAllSelects() {
  for (let i = 1; i <= 5; i++) {
    populateSelectOptions(i);
  }
}

function populateSelectOptions(index, filter = '') {
  const container = document.getElementById('options-' + index);
  if (!container) return;

  const filterLower = filter.toLowerCase().trim();

  // Filtra materiais
  const filtered = filterLower
    ? materialsData.filter(m =>
        m.descricao.toLowerCase().includes(filterLower) ||
        m.sap.toLowerCase().includes(filterLower)
      )
    : materialsData;

  // Gera HTML
  if (filtered.length === 0) {
    container.innerHTML = '<div class="select-no-results">Nenhum material encontrado</div>';
    return;
  }

  container.innerHTML = filtered.map(m =>
    `<div class="select-option" data-sap="${escapeHtml(m.sap)}" data-desc="${escapeHtml(m.descricao)}" data-index="${index}">
      ${escapeHtml(m.descricao)}
      <span class="sap-code">${escapeHtml(m.sap)}</span>
    </div>`
  ).join('');

  // Bind option click events
  container.querySelectorAll('.select-option').forEach(opt => {
    opt.addEventListener('click', handleOptionSelect);
  });
}

function handleOptionSelect(e) {
  const option = e.currentTarget;
  const index = option.dataset.index;
  const desc = option.dataset.desc;
  const sap = option.dataset.sap;

  // Atualiza trigger
  const selectEl = document.getElementById('select-material-' + index);
  const trigger = selectEl.querySelector('.select-trigger');
  trigger.textContent = desc;
  trigger.classList.add('has-value');
  trigger.dataset.selectedDesc = desc;
  trigger.dataset.selectedSap = sap;

  // Preenche SAP
  document.getElementById('sap-' + index).value = sap;

  // Marca card como preenchido
  document.getElementById('material-card-' + index).classList.add('filled');

  // Fecha dropdown
  closeAllSelects();

  // Atualiza contador
  updateMaterialsCount();

  // Foca no campo de quantidade
  document.getElementById('qty-' + index).focus();
}

function openSelect(index) {
  closeAllSelects();

  const selectEl = document.getElementById('select-material-' + index);
  selectEl.classList.add('open');

  // Foca na busca
  const searchInput = selectEl.querySelector('.select-search');
  searchInput.value = '';
  searchInput.focus();

  // Popula opções
  populateSelectOptions(index);
}

function closeAllSelects() {
  document.querySelectorAll('.custom-select.open').forEach(el => {
    el.classList.remove('open');
  });
}




// ==================== EVENT LISTENERS ====================

function initEventListeners() {
  // Logout
  document.getElementById('logout-btn').addEventListener('click', logout);

  // Submit
  document.getElementById('submit-btn').addEventListener('click', handleSubmit);

  // New Order
  document.getElementById('new-order-btn').addEventListener('click', handleNewOrder);

  // Date change → update period options
  document.getElementById('pickup-date').addEventListener('change', updatePeriodOptions);

  // Period change → validate
  document.getElementById('period-select').addEventListener('change', validatePeriod);

  // Close selects when clicking outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.custom-select')) {
      closeAllSelects();
    }
  });

  // Close selects on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllSelects();
    }
  });
}

function bindMaterialEvents() {
  // Select triggers
  document.querySelectorAll('.select-trigger').forEach(trigger => {
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const index = trigger.dataset.index;
      const selectEl = trigger.closest('.custom-select');

      if (selectEl.classList.contains('open')) {
        closeAllSelects();
      } else {
        openSelect(index);
      }
    });
  });

  // Search inputs
  document.querySelectorAll('.select-search').forEach(input => {
    input.addEventListener('input', (e) => {
      const index = e.target.dataset.index;
      populateSelectOptions(index, e.target.value);
    });

    input.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  });

  // Quantity buttons
  document.querySelectorAll('.qty-btn.plus').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = btn.dataset.index;
      const input = document.getElementById('qty-' + index);
      const current = parseInt(input.value) || 0;
      input.value = current + 1;
      updateMaterialsCount();
    });
  });

  document.querySelectorAll('.qty-btn.minus').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = btn.dataset.index;
      const input = document.getElementById('qty-' + index);
      const current = parseInt(input.value) || 0;
      if (current > 1) input.value = current - 1;
      else if (current === 1) input.value = '';
      updateMaterialsCount();
    });
  });

  // Quantity input change
  document.querySelectorAll('.qty-input').forEach(input => {
    input.addEventListener('change', updateMaterialsCount);
  });

  // Clear buttons
  document.querySelectorAll('.btn-clear-material').forEach(btn => {
    btn.addEventListener('click', () => {
      const index = btn.dataset.index;
      clearMaterial(index);
    });
  });
}

// ==================== DATE & PERIOD VALIDATION ====================

function setMinDate() {
  const dateInput = document.getElementById('pickup-date');
  const today = getBrasiliaDate();
  dateInput.min = today;
}

function getBrasiliaDate() {
  const now = new Date();
  // Converte para horário de Brasília (UTC-3)
  const brasiliaOffset = -3 * 60; // -180 minutos
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const brasiliaTime = new Date(utc + (brasiliaOffset * 60000));
  return brasiliaTime.toISOString().split('T')[0];
}

function getBrasiliaHour() {
  const now = new Date();
  const brasiliaOffset = -3 * 60;
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const brasiliaTime = new Date(utc + (brasiliaOffset * 60000));
  return brasiliaTime.getHours();
}

function updatePeriodOptions() {
  const dateInput = document.getElementById('pickup-date');
  const periodSelect = document.getElementById('period-select');
  const warningEl = document.getElementById('period-warning');
  const warningText = document.getElementById('period-warning-text');

  const selectedDate = dateInput.value;
  if (!selectedDate) return;

  const today = getBrasiliaDate();
  const currentHour = getBrasiliaHour();
  const isToday = selectedDate === today;

  // Habilita todas as opções primeiro
  periodSelect.querySelectorAll('option').forEach(opt => {
    opt.disabled = false;
  });

  warningEl.classList.remove('show');

  if (isToday) {
    const manhaOption = periodSelect.querySelector('option[value="Manhã"]');
    const tardeOption = periodSelect.querySelector('option[value="Tarde"]');

    if (currentHour >= 8) {
      manhaOption.disabled = true;
      if (periodSelect.value === 'Manhã') {
        periodSelect.value = '';
      }
    }

    if (currentHour >= 16) {
      tardeOption.disabled = true;
      if (periodSelect.value === 'Tarde') {
        periodSelect.value = '';
      }
    }

    // Mostra warning se algum período foi bloqueado
    if (currentHour >= 8 && currentHour < 16) {
      warningText.textContent = 'Período da manhã indisponível para hoje (após 08h).';
      warningEl.classList.add('show');
    } else if (currentHour >= 16) {
      warningText.textContent = 'Nenhum período disponível para hoje. Selecione outro dia.';
      warningEl.classList.add('show');
    }
  }
}

function validatePeriod() {
  const dateInput = document.getElementById('pickup-date');
  const periodSelect = document.getElementById('period-select');

  const selectedDate = dateInput.value;
  const selectedPeriod = periodSelect.value;

  if (!selectedDate || !selectedPeriod) return true;

  const today = getBrasiliaDate();
  const currentHour = getBrasiliaHour();
  const isToday = selectedDate === today;

  if (isToday) {
    if (selectedPeriod === 'Manhã' && currentHour >= 8) {
      showToast('Período da manhã não disponível para hoje (após 08h).', 'warning');
      periodSelect.value = '';
      return false;
    }
    if (selectedPeriod === 'Tarde' && currentHour >= 16) {
      showToast('Período da tarde não disponível para hoje (após 16h).', 'warning');
      periodSelect.value = '';
      return false;
    }
  }

  return true;
}

// ==================== MATERIAL HELPERS ====================

function clearMaterial(index) {
  const selectEl = document.getElementById('select-material-' + index);
  const trigger = selectEl.querySelector('.select-trigger');
  trigger.textContent = 'Selecione o material...';
  trigger.classList.remove('has-value');
  delete trigger.dataset.selectedDesc;
  delete trigger.dataset.selectedSap;

  document.getElementById('sap-' + index).value = '';
  document.getElementById('qty-' + index).value = '';
  document.getElementById('material-card-' + index).classList.remove('filled');

  updateMaterialsCount();
}

function updateMaterialsCount() {
  let count = 0;
  for (let i = 1; i <= 5; i++) {
    const trigger = document.querySelector('#select-material-' + i + ' .select-trigger');
    if (trigger && trigger.dataset.selectedDesc) {
      count++;
    }
  }
  document.getElementById('materials-count').textContent = count;
}

// ==================== FORM SUBMISSION ====================

async function handleSubmit() {
  const submitBtn = document.getElementById('submit-btn');

  // Validações
  if (!validateForm()) return;

  // Desabilita botão e mostra loading
  submitBtn.disabled = true;
  submitBtn.classList.add('loading');

  try {
    // Monta dados do pedido
    const orderData = buildOrderData();

    // Envia para Apps Script
    const result = await fetchAppsScript('submit', orderData);

    if (result.error) throw new Error(result.error);

    // Mostra modal de sucesso
    showSuccessModal(orderData.idPedido);

  } catch (err) {
    console.error('Erro ao enviar pedido:', err);
    showToast('Erro ao enviar pedido. Tente novamente.', 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.classList.remove('loading');
  }
}

function validateForm() {
  const dateInput = document.getElementById('pickup-date');
  const periodSelect = document.getElementById('period-select');

  // Data de retirada
  if (!dateInput.value) {
    showToast('Selecione a data de retirada.', 'warning');
    dateInput.focus();
    return false;
  }

  // Período
  if (!periodSelect.value) {
    showToast('Selecione o período (Manhã ou Tarde).', 'warning');
    periodSelect.focus();
    return false;
  }

  // Validação de período vs horário
  if (!validatePeriod()) return false;

  // Pelo menos 1 material
  let hasMaterial = false;
  for (let i = 1; i <= 5; i++) {
    const trigger = document.querySelector('#select-material-' + i + ' .select-trigger');
    const qty = document.getElementById('qty-' + i).value;

    if (trigger.dataset.selectedDesc) {
      if (!qty || parseInt(qty) < 1) {
        showToast(`Informe a quantidade do Material ${i}.`, 'warning');
        document.getElementById('qty-' + i).focus();
        return false;
      }
      hasMaterial = true;
    }
  }

  if (!hasMaterial) {
    showToast('Selecione pelo menos 1 material.', 'warning');
    return false;
  }

  return true;
}

function buildOrderData() {
  const dateInput = document.getElementById('pickup-date');
  const periodSelect = document.getElementById('period-select');

  // Formata a data para DD/MM/YYYY
  const dateParts = dateInput.value.split('-');
  const formattedDate = dateParts[2] + '/' + dateParts[1] + '/' + dateParts[0];

  const data = {
    idPedido: currentOrderId,
    dataRetirada: formattedDate,
    periodo: periodSelect.value,
    email: userEmail
  };

  for (let i = 1; i <= 5; i++) {
    const trigger = document.querySelector('#select-material-' + i + ' .select-trigger');
    const qty = document.getElementById('qty-' + i).value;

    data['desc' + i] = trigger.dataset.selectedDesc || '';
    data['sap' + i] = trigger.dataset.selectedSap || '';
    data['qty' + i] = qty ? parseInt(qty) : '';
  }

  return data;
}

// ==================== SUCCESS MODAL ====================

function showSuccessModal(orderId) {
  document.getElementById('modal-order-id').textContent = String(orderId).padStart(4, '0');
  document.getElementById('success-modal').classList.add('active');
}

function hideSuccessModal() {
  document.getElementById('success-modal').classList.remove('active');
}

async function handleNewOrder() {
  hideSuccessModal();

  // Reseta formulário
  document.getElementById('pickup-date').value = '';
  document.getElementById('period-select').value = '';
  document.getElementById('period-warning').classList.remove('show');

  // Limpa todos os materiais
  for (let i = 1; i <= 5; i++) {
    clearMaterial(i);
  }

  // Carrega novo ID
  try {
    const idResponse = await fetchAppsScript('next_id');
    if (idResponse.nextId) {
      currentOrderId = idResponse.nextId;
      document.getElementById('order-id').textContent = String(currentOrderId).padStart(4, '0');
    }
  } catch (err) {
    // Incrementa localmente se falhar
    currentOrderId++;
    document.getElementById('order-id').textContent = String(currentOrderId).padStart(4, '0');
  }

  // Scroll para o topo
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ==================== TOAST NOTIFICATIONS ====================

function showToast(message, type = 'warning') {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-message');
  const toastIcon = document.getElementById('toast-icon');

  // Limpa timeout anterior
  if (toastTimeout) {
    clearTimeout(toastTimeout);
    toast.classList.remove('show');
  }

  // Define ícone e tipo
  toast.className = 'toast ' + type;
  toastIcon.textContent = type === 'error' ? '❌' : '⚠️';
  toastMsg.textContent = message;

  // Mostra
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  // Auto-hide após 4 segundos
  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 4000);
}

// ==================== LOADING OVERLAY ====================

function showLoading(text) {
  document.getElementById('loading-text').textContent = text || 'Carregando...';
  document.getElementById('loading-overlay').classList.add('active');
}

function hideLoading() {
  document.getElementById('loading-overlay').classList.remove('active');
}

// ==================== UTILITY FUNCTIONS ====================

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
