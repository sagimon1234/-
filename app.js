// ============================================================
// ふたりの家計簿 - フロントエンド JavaScript
// ============================================================

'use strict';

// ===== 定数 =====
const STORAGE_KEY = {
  API_URL: 'kakeibo_api_url',
  TRANSACTIONS: 'kakeibo_transactions',
  CATEGORIES: 'kakeibo_categories',
  PAYMENT_METHODS: 'kakeibo_payment_methods',
  FIXED_COSTS: 'kakeibo_fixed_costs',
  THEME: 'kakeibo_theme',
  CURRENT_MONTH: 'kakeibo_current_month',
};

const TYPE = { INCOME: '収入', EXPENSE: '支出', TRANSFER: '振替' };
const PERSONS = ['ゆみか', 'かんた'];

// ===== アプリ状態 =====
const State = {
  apiUrl: '',
  transactions: [],
  categories: [],
  paymentMethods: [],
  fixedCosts: [],
  currentMonth: '', // YYYY-MM
  currentPage: 'home',
  currentModal: null,
  editingId: null,
  isDark: false,
  syncing: false,
};

// ===== 初期化 =====
async function init() {
  // テーマ読み込み
  const savedTheme = localStorage.getItem(STORAGE_KEY.THEME);
  State.isDark = savedTheme === 'dark' || (!savedTheme && window.matchMedia('(prefers-color-scheme: dark)').matches);
  applyTheme(State.isDark);
  const darkToggle = document.getElementById('dark-mode-toggle');
  if (darkToggle) darkToggle.checked = State.isDark;

  // API URL
  State.apiUrl = localStorage.getItem(STORAGE_KEY.API_URL) || '';
  const urlInput = document.getElementById('api-url-input');
  if (urlInput) urlInput.value = State.apiUrl;

  // 現在月
  const savedMonth = localStorage.getItem(STORAGE_KEY.CURRENT_MONTH);
  State.currentMonth = savedMonth || getTodayMonth();

  // ローカルキャッシュ読み込み
  loadFromCache();

  // 固定費反映日フィルタ
  populateFixedCostDays();

  // UI初期化
  updateMonthDisplay();
  renderAll();

  // APIが設定されていればデータ取得
  if (State.apiUrl) {
    await syncData(true);
  }

  // ローディング終了
  setTimeout(() => {
    const loading = document.getElementById('loading-screen');
    if (loading) {
      loading.style.opacity = '0';
      setTimeout(() => { loading.style.display = 'none'; }, 300);
    }
    const app = document.getElementById('app');
    if (app) app.style.display = '';
  }, 800);
}

function loadFromCache() {
  try {
    State.transactions = JSON.parse(localStorage.getItem(STORAGE_KEY.TRANSACTIONS) || '[]');
    State.categories = JSON.parse(localStorage.getItem(STORAGE_KEY.CATEGORIES) || '[]');
    State.paymentMethods = JSON.parse(localStorage.getItem(STORAGE_KEY.PAYMENT_METHODS) || '[]');
    State.fixedCosts = JSON.parse(localStorage.getItem(STORAGE_KEY.FIXED_COSTS) || '[]');
    if (State.categories.length === 0) setDefaultCategories();
    if (State.paymentMethods.length === 0) setDefaultPaymentMethods();
  } catch (e) {
    setDefaultCategories();
    setDefaultPaymentMethods();
  }
}

function setDefaultCategories() {
  State.categories = [
    { name: '食費', type: '支出', order: 1, active: true },
    { name: '日用品', type: '支出', order: 2, active: true },
    { name: '家賃', type: '支出', order: 3, active: true },
    { name: '光熱費', type: '支出', order: 4, active: true },
    { name: '通信費', type: '支出', order: 5, active: true },
    { name: '車', type: '支出', order: 6, active: true },
    { name: 'ガソリン', type: '支出', order: 7, active: true },
    { name: '保険', type: '支出', order: 8, active: true },
    { name: '娯楽', type: '支出', order: 9, active: true },
    { name: '医療', type: '支出', order: 10, active: true },
    { name: '子ども', type: '支出', order: 11, active: true },
    { name: 'サブスク', type: '支出', order: 12, active: true },
    { name: '給料', type: '収入', order: 13, active: true },
    { name: '副収入', type: '収入', order: 14, active: true },
    { name: 'お小遣い', type: '収入', order: 15, active: true },
    { name: '貯金', type: '振替', order: 16, active: true },
    { name: 'その他', type: '', order: 17, active: true },
  ];
}

function setDefaultPaymentMethods() {
  State.paymentMethods = [
    { name: '現金', type: '口座', initialBalance: 0, order: 1, active: true },
    { name: 'クレカ', type: 'クレジット', initialBalance: 0, order: 2, active: true },
    { name: 'PayPay', type: '電子マネー', initialBalance: 0, order: 3, active: true },
    { name: '銀行口座', type: '口座', initialBalance: 0, order: 4, active: true },
    { name: '貯金口座', type: '貯金', initialBalance: 0, order: 5, active: true },
  ];
}

function saveToCache() {
  localStorage.setItem(STORAGE_KEY.TRANSACTIONS, JSON.stringify(State.transactions));
  localStorage.setItem(STORAGE_KEY.CATEGORIES, JSON.stringify(State.categories));
  localStorage.setItem(STORAGE_KEY.PAYMENT_METHODS, JSON.stringify(State.paymentMethods));
  localStorage.setItem(STORAGE_KEY.FIXED_COSTS, JSON.stringify(State.fixedCosts));
}

// ===== API通信 =====
async function apiGet(params) {
  if (!State.apiUrl) throw new Error('API URLが設定されていません');
  const url = new URL(State.apiUrl);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'APIエラー');
  return json.data;
}

async function apiPost(payload) {
  if (!State.apiUrl) throw new Error('API URLが設定されていません');
  const res = await fetch(State.apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'APIエラー');
  return json.data;
}

// ===== データ同期 =====
async function syncData(silent = false) {
  if (State.syncing) return;
  if (!State.apiUrl) {
    if (!silent) showToast('API URLを設定してください', 'error');
    return;
  }
  State.syncing = true;
  const statusEl = document.getElementById('sync-status');
  if (statusEl) statusEl.textContent = '同期中...';
  if (!silent) showToast('同期中...');

  try {
    const data = await apiGet({ action: 'getAllData' });
    State.transactions = data.transactions || [];
    State.categories = data.categories || [];
    State.paymentMethods = data.paymentMethods || [];
    State.fixedCosts = data.fixedCosts || [];
    saveToCache();
    renderAll();
    if (!silent) {
      showToast('同期完了！', 'success');
      if (statusEl) statusEl.textContent = '同期完了: ' + new Date().toLocaleTimeString('ja-JP');
    }
  } catch (e) {
    if (!silent) showToast('同期失敗: ' + e.message, 'error');
    if (statusEl) statusEl.textContent = 'エラー: ' + e.message;
  } finally {
    State.syncing = false;
  }
}

async function forceSync() {
  closeModal();
  await syncData(false);
}

function clearLocalCache() {
  if (confirm('ローカルキャッシュを削除します。APIからデータを再取得します。よろしいですか？')) {
    Object.values(STORAGE_KEY).forEach(k => localStorage.removeItem(k));
    location.reload();
  }
}

// ===== 設定 =====
function saveApiUrl() {
  const input = document.getElementById('api-url-input');
  const url = input ? input.value.trim() : '';
  if (!url) { showToast('URLを入力してください', 'error'); return; }
  State.apiUrl = url;
  localStorage.setItem(STORAGE_KEY.API_URL, url);
  showToast('URLを保存しました', 'success');
  syncData(false);
}

async function testConnection() {
  if (!State.apiUrl) { showToast('URLを先に保存してください', 'error'); return; }
  try {
    showToast('接続テスト中...');
    await apiGet({ action: 'getCategories' });
    showToast('接続成功！', 'success');
  } catch (e) {
    showToast('接続失敗: ' + e.message, 'error');
  }
}

function toggleDarkMode(isDark) {
  State.isDark = isDark;
  applyTheme(isDark);
  localStorage.setItem(STORAGE_KEY.THEME, isDark ? 'dark' : 'light');
}

function applyTheme(isDark) {
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  const metaTheme = document.querySelector('meta[name="theme-color"]:not([media])');
  if (metaTheme) metaTheme.setAttribute('content', isDark ? '#0f1117' : '#f5f4f0');
}

// ===== 月操作 =====
function getTodayMonth() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function changeMonth(delta) {
  const [y, m] = State.currentMonth.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  State.currentMonth = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  localStorage.setItem(STORAGE_KEY.CURRENT_MONTH, State.currentMonth);
  updateMonthDisplay();
  renderAll();
}

function updateMonthDisplay() {
  const [y, m] = State.currentMonth.split('-').map(Number);
  const label = y + '年' + m + '月';
  const el = document.getElementById('month-display');
  if (el) el.textContent = label;
  const header = document.getElementById('header-month');
  if (header) header.textContent = State.currentMonth;
}

// ===== 画面遷移 =====
function showPage(page) {
  State.currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const target = document.getElementById('page-' + page);
  if (target) target.classList.add('active');

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === page);
  });

  if (page === 'stats') renderStats();
  if (page === 'settings') renderSettingsLists();
}

// ===== 全体レンダリング =====
function renderAll() {
  refreshSummary();
  renderRecentTransactions();
  if (State.currentPage === 'transactions') renderTransactions();
  if (State.currentPage === 'stats') renderStats();
  if (State.currentPage === 'settings') renderSettingsLists();
}

// ===== サマリー ===== 
function refreshSummary() {
  const monthTx = State.transactions.filter(t => t.date && t.date.startsWith(State.currentMonth));
  const includeSavings = document.getElementById('include-savings')?.checked || false;

  let income = 0, expense = 0, savingsTransfer = 0;
  monthTx.forEach(t => {
    if (t.type === TYPE.INCOME) income += t.amount;
    else if (t.type === TYPE.EXPENSE) expense += t.amount;
    else if (t.type === TYPE.TRANSFER && t.category === '貯金') savingsTransfer += t.amount;
  });

  const effectiveExpense = includeSavings ? expense + savingsTransfer : expense;
  const balance = income - effectiveExpense;

  setText('total-income', '¥' + fmt(income));
  setText('total-expense', '¥' + fmt(effectiveExpense));
  const balEl = document.getElementById('total-balance');
  if (balEl) {
    balEl.textContent = (balance < 0 ? '-¥' : '¥') + fmt(Math.abs(balance));
    balEl.style.color = balance < 0 ? 'var(--expense-color)' : balance > 0 ? 'var(--income-color)' : '';
  }

  // 残高計算
  const accountBal = calcAccountBalance(false);
  const savingsBal = calcAccountBalance(true);
  setText('account-balance', '¥' + fmt(accountBal));
  setText('savings-balance', '¥' + fmt(savingsBal));
}

function calcAccountBalance(isSavings) {
  let balance = 0;
  State.paymentMethods
    .filter(pm => isSavings ? pm.type === '貯金' : pm.type !== '貯金')
    .forEach(pm => { balance += pm.initialBalance || 0; });

  State.transactions.forEach(t => {
    const pmFrom = State.paymentMethods.find(p => p.name === t.payment);
    const pmTransferFrom = State.paymentMethods.find(p => p.name === t.transferFrom);
    const pmTransferTo = State.paymentMethods.find(p => p.name === t.transferTo);

    if (t.type === TYPE.INCOME && pmFrom) {
      if ((isSavings && pmFrom.type === '貯金') || (!isSavings && pmFrom.type !== '貯金')) {
        balance += t.amount;
      }
    } else if (t.type === TYPE.EXPENSE && pmFrom) {
      if ((isSavings && pmFrom.type === '貯金') || (!isSavings && pmFrom.type !== '貯金')) {
        balance -= t.amount;
      }
    } else if (t.type === TYPE.TRANSFER) {
      if (pmTransferFrom) {
        if ((isSavings && pmTransferFrom.type === '貯金') || (!isSavings && pmTransferFrom.type !== '貯金')) {
          balance -= t.amount;
        }
      }
      if (pmTransferTo) {
        if ((isSavings && pmTransferTo.type === '貯金') || (!isSavings && pmTransferTo.type !== '貯金')) {
          balance += t.amount;
        }
      }
    }
  });
  return balance;
}

// ===== 取引レンダリング =====
function renderRecentTransactions() {
  const monthTx = State.transactions
    .filter(t => t.date && t.date.startsWith(State.currentMonth))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);
  renderTransactionItems('recent-transactions', monthTx, true);
}

function renderTransactions() {
  const filterType = document.getElementById('filter-type')?.value || '';
  const filterPerson = document.getElementById('filter-person')?.value || '';
  let monthTx = State.transactions
    .filter(t => t.date && t.date.startsWith(State.currentMonth))
    .sort((a, b) => b.date.localeCompare(a.date));
  if (filterType) monthTx = monthTx.filter(t => t.type === filterType);
  if (filterPerson) monthTx = monthTx.filter(t => t.person === filterPerson);
  renderTransactionItems('all-transactions', monthTx, false);
}

function renderTransactionItems(containerId, items, compact) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (items.length === 0) {
    container.innerHTML = '<div class="empty-state">この月の取引はありません</div>';
    return;
  }
  container.innerHTML = items.map(t => renderTxItem(t, compact)).join('');
}

function renderTxItem(t, compact) {
  const label = t.type === TYPE.TRANSFER
    ? (t.transferFrom + ' → ' + t.transferTo)
    : (t.payment || '');
  const sub = [t.person, label, t.memo].filter(Boolean).join(' · ');
  const amountSign = t.type === TYPE.INCOME ? '+' : t.type === TYPE.EXPENSE ? '-' : '';
  const actions = compact ? '' : `
    <div class="tx-actions">
      <button class="tx-action-btn" onclick="event.stopPropagation(); editTransaction('${t.id}')">編集</button>
      <button class="tx-action-btn delete" onclick="event.stopPropagation(); confirmDeleteTransaction('${t.id}')">削除</button>
    </div>`;
  return `
    <div class="transaction-item" onclick="${compact ? "showPage('transactions')" : ''}">
      <div class="tx-type-badge ${t.type}">${t.type}</div>
      <div class="tx-info">
        <div class="tx-category">${esc(t.category || t.type)}</div>
        <div class="tx-sub">${esc(sub)}</div>
        ${actions}
      </div>
      <div class="tx-right">
        <div class="tx-amount ${t.type}">${amountSign}¥${fmt(t.amount)}</div>
        <div class="tx-date">${t.date ? t.date.substring(5) : ''}</div>
      </div>
    </div>`;
}

// ===== 集計レンダリング =====
function renderStats() {
  renderStatsContent('category');
}

function switchStatsTab(type, btn) {
  document.querySelectorAll('.stats-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  renderStatsContent(type);
}

function renderStatsContent(type) {
  const container = document.getElementById('stats-content');
  if (!container) return;
  const monthTx = State.transactions.filter(t => t.date && t.date.startsWith(State.currentMonth));

  if (type === 'category') {
    const expMap = {}, incMap = {};
    monthTx.forEach(t => {
      if (t.type === TYPE.EXPENSE) expMap[t.category || 'その他'] = (expMap[t.category || 'その他'] || 0) + t.amount;
      if (t.type === TYPE.INCOME) incMap[t.category || 'その他'] = (incMap[t.category || 'その他'] || 0) + t.amount;
    });
    const expTotal = Object.values(expMap).reduce((a, b) => a + b, 0);
    const incTotal = Object.values(incMap).reduce((a, b) => a + b, 0);
    const expItems = Object.entries(expMap).sort((a, b) => b[1] - a[1]);
    const incItems = Object.entries(incMap).sort((a, b) => b[1] - a[1]);
    container.innerHTML = `
      <div class="stats-section-title">支出 · ¥${fmt(expTotal)}</div>
      ${expItems.map(([cat, amt]) => barHtml(cat, amt, expTotal, 'expense')).join('')}
      <div class="stats-section-title" style="margin-top:20px">収入 · ¥${fmt(incTotal)}</div>
      ${incItems.map(([cat, amt]) => barHtml(cat, amt, incTotal, 'income')).join('')}
    `;
  } else if (type === 'person') {
    const pMap = {};
    PERSONS.forEach(p => { pMap[p] = { income: 0, expense: 0 }; });
    monthTx.forEach(t => {
      if (!pMap[t.person]) pMap[t.person] = { income: 0, expense: 0 };
      if (t.type === TYPE.INCOME) pMap[t.person].income += t.amount;
      if (t.type === TYPE.EXPENSE) pMap[t.person].expense += t.amount;
    });
    const maxAmt = Math.max(...Object.values(pMap).map(v => Math.max(v.income, v.expense)), 1);
    container.innerHTML = Object.entries(pMap).map(([person, data]) => `
      <div style="margin-bottom:20px">
        <div class="stats-section-title">${esc(person)}</div>
        ${barHtml('収入', data.income, maxAmt, 'income')}
        ${barHtml('支出', data.expense, maxAmt, 'expense')}
      </div>`).join('');
  } else if (type === 'monthly') {
    const monthMap = {};
    State.transactions.forEach(t => {
      const ym = t.date ? t.date.substring(0, 7) : '';
      if (!ym) return;
      if (!monthMap[ym]) monthMap[ym] = { income: 0, expense: 0 };
      if (t.type === TYPE.INCOME) monthMap[ym].income += t.amount;
      if (t.type === TYPE.EXPENSE) monthMap[ym].expense += t.amount;
    });
    const sorted = Object.entries(monthMap).sort((a, b) => b[0].localeCompare(a[0]));
    container.innerHTML = sorted.length === 0
      ? '<div class="empty-state">データがありません</div>'
      : sorted.map(([ym, data]) => {
        const balance = data.income - data.expense;
        return `<div class="monthly-row">
          <div class="monthly-row-header">
            <span class="monthly-row-month">${ym}</span>
            <span class="monthly-row-balance" style="color:${balance >= 0 ? 'var(--income-color)' : 'var(--expense-color)'}">${balance >= 0 ? '+' : '-'}¥${fmt(Math.abs(balance))}</span>
          </div>
          <div class="monthly-row-detail">
            <span>収入 ¥${fmt(data.income)}</span>
            <span>支出 ¥${fmt(data.expense)}</span>
          </div>
        </div>`;
      }).join('');
  }
}

function barHtml(cat, amt, total, cls) {
  const pct = total > 0 ? Math.min(100, Math.round(amt / total * 100)) : 0;
  return `<div class="stats-bar-item">
    <div class="stats-bar-label">
      <span class="cat-name">${esc(cat)}</span>
      <span class="cat-amount">¥${fmt(amt)} (${pct}%)</span>
    </div>
    <div class="stats-bar-track"><div class="stats-bar-fill ${cls}" style="width:${pct}%"></div></div>
  </div>`;
}

// ===== 設定リスト =====
function renderSettingsLists() {
  renderCategoryList();
  renderPaymentMethodList();
  renderFixedCostList();
}

function renderCategoryList() {
  const container = document.getElementById('category-list');
  if (!container) return;
  if (State.categories.length === 0) { container.innerHTML = '<div class="empty-state">カテゴリがありません</div>'; return; }
  container.innerHTML = State.categories
    .filter(c => c.active !== false)
    .sort((a, b) => a.order - b.order)
    .map(c => `
      <div class="manage-item">
        <div>
          <div class="manage-item-name">${esc(c.name)}</div>
          <div class="manage-item-type">${esc(c.type || '共通')}</div>
        </div>
        <div class="manage-item-actions">
          <button class="manage-btn" onclick="editCategory('${esc(c.name)}')">編集</button>
          <button class="manage-btn danger" onclick="deleteCategory('${esc(c.name)}')">削除</button>
        </div>
      </div>`).join('');
}

function renderPaymentMethodList() {
  const container = document.getElementById('payment-method-list');
  if (!container) return;
  if (State.paymentMethods.length === 0) { container.innerHTML = '<div class="empty-state">支払い元がありません</div>'; return; }
  container.innerHTML = State.paymentMethods
    .filter(p => p.active !== false)
    .sort((a, b) => a.order - b.order)
    .map(p => `
      <div class="manage-item">
        <div>
          <div class="manage-item-name">${esc(p.name)}</div>
          <div class="manage-item-type">${esc(p.type)} · 初期残高 ¥${fmt(p.initialBalance || 0)}</div>
        </div>
        <div class="manage-item-actions">
          <button class="manage-btn" onclick="editPaymentMethod('${esc(p.name)}')">編集</button>
          <button class="manage-btn danger" onclick="deletePaymentMethod('${esc(p.name)}')">削除</button>
        </div>
      </div>`).join('');
}

function renderFixedCostList() {
  const container = document.getElementById('fixed-cost-list');
  if (!container) return;
  if (State.fixedCosts.length === 0) { container.innerHTML = '<div class="empty-state">固定費がありません</div>'; return; }
  container.innerHTML = State.fixedCosts
    .filter(fc => fc.active !== false)
    .map(fc => `
      <div class="manage-item">
        <div>
          <div class="manage-item-name">${esc(fc.name)}</div>
          <div class="manage-item-type">${esc(fc.category)} · ¥${fmt(fc.amount)} · 毎月${fc.day}日</div>
        </div>
        <div class="manage-item-actions">
          <button class="manage-btn" onclick="editFixedCost('${esc(fc.id)}')">編集</button>
          <button class="manage-btn danger" onclick="deleteFixedCost('${esc(fc.id)}')">削除</button>
        </div>
      </div>`).join('');
}

// ===== モーダル管理 =====
function openModal(id) {
  closeModal();
  State.currentModal = id;
  document.getElementById(id)?.classList.add('active');
  document.getElementById('modal-overlay')?.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  if (State.currentModal) {
    document.getElementById(State.currentModal)?.classList.remove('active');
    State.currentModal = null;
  }
  document.getElementById('modal-overlay')?.classList.remove('active');
  document.body.style.overflow = '';
}

function openSyncModal() { openModal('modal-sync'); }

// ===== 取引フォーム =====
function openAddTransaction() {
  State.editingId = null;
  resetTransactionForm();
  setText('modal-tx-title', '取引を追加');
  setText('tx-submit-btn', '登録する');
  selectType('支出', document.querySelector('.type-tab[data-type="支出"]'));
  openModal('modal-transaction');
  setTimeout(() => document.getElementById('tx-amount')?.focus(), 350);
}

function resetTransactionForm() {
  document.getElementById('tx-id').value = '';
  document.getElementById('tx-amount').value = '';
  document.getElementById('tx-memo').value = '';
  // 今日の日付をセット
  const today = new Date().toISOString().substring(0, 10);
  const dateEl = document.getElementById('tx-date');
  if (dateEl) dateEl.value = today;
  const dateTEl = document.getElementById('tx-date-t');
  if (dateTEl) dateTEl.value = today;
  // カテゴリ・支払い元を再構築
  populateCategorySelect('tx-category', '支出');
  populateCategorySelect('tx-category-t', '振替');
  populatePaymentSelect('tx-payment');
  populatePaymentSelect('tx-transfer-from');
  populatePaymentSelect('tx-transfer-to');
}

function selectType(type, btn) {
  document.querySelectorAll('.type-tab').forEach(t => t.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const isTransfer = type === TYPE.TRANSFER;
  document.getElementById('normal-fields').style.display = isTransfer ? 'none' : '';
  document.getElementById('transfer-fields').style.display = isTransfer ? '' : 'none';
  if (!isTransfer) {
    populateCategorySelect('tx-category', type);
  }
}

function getCurrentType() {
  const activeTab = document.querySelector('.type-tab.active');
  return activeTab ? activeTab.dataset.type : TYPE.EXPENSE;
}

function populateCategorySelect(selectId, type) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const cats = State.categories.filter(c => c.active !== false && (!c.type || !type || c.type === type));
  select.innerHTML = cats.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
}

function populatePaymentSelect(selectId, excludeName) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const pms = State.paymentMethods.filter(p => p.active !== false && p.name !== excludeName);
  select.innerHTML = pms.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
}

async function submitTransaction() {
  const type = getCurrentType();
  const isTransfer = type === TYPE.TRANSFER;

  const amount = parseFloat(document.getElementById('tx-amount').value);
  if (!amount || amount <= 0) { showToast('金額を入力してください', 'error'); return; }

  const date = isTransfer
    ? document.getElementById('tx-date-t').value
    : document.getElementById('tx-date').value;
  if (!date) { showToast('日付を入力してください', 'error'); return; }

  const person = isTransfer
    ? document.getElementById('tx-person-t').value
    : document.getElementById('tx-person').value;

  const data = {
    date, person, type, amount,
    memo: document.getElementById('tx-memo').value.trim(),
  };

  if (isTransfer) {
    data.transferFrom = document.getElementById('tx-transfer-from').value;
    data.transferTo = document.getElementById('tx-transfer-to').value;
    data.category = document.getElementById('tx-category-t').value;
    if (data.transferFrom === data.transferTo) {
      showToast('振替元と振替先が同じです', 'error'); return;
    }
  } else {
    data.category = document.getElementById('tx-category').value;
    data.payment = document.getElementById('tx-payment').value;
  }

  // 重複チェック（新規登録のみ）
  if (!State.editingId) {
    const isDuplicate = State.transactions.some(t =>
      t.date === data.date &&
      t.type === data.type &&
      t.amount === data.amount &&
      t.category === data.category &&
      t.person === data.person
    );
    if (isDuplicate) {
      showToast('同じ取引が既に登録されています', 'error'); return;
    }
  }

  const submitBtn = document.getElementById('tx-submit-btn');
  if (submitBtn) submitBtn.disabled = true;

  try {
    if (State.editingId) {
      data.id = State.editingId;
      if (State.apiUrl) {
        const result = await apiPost({ action: 'updateTransaction', data });
        const idx = State.transactions.findIndex(t => t.id === State.editingId);
        if (idx !== -1) State.transactions[idx] = result;
      } else {
        const idx = State.transactions.findIndex(t => t.id === State.editingId);
        if (idx !== -1) State.transactions[idx] = { ...data, updatedAt: new Date().toISOString() };
      }
      showToast('更新しました', 'success');
    } else {
      if (State.apiUrl) {
        const result = await apiPost({ action: 'addTransaction', data });
        State.transactions.unshift(result);
      } else {
        const newTx = { ...data, id: Date.now().toString(), createdAt: new Date().toISOString() };
        State.transactions.unshift(newTx);
      }
      showToast('登録しました！', 'success');
    }
    saveToCache();
    closeModal();
    renderAll();
  } catch (e) {
    showToast('エラー: ' + e.message, 'error');
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
}

function editTransaction(id) {
  const tx = State.transactions.find(t => t.id === id);
  if (!tx) return;
  State.editingId = id;
  resetTransactionForm();
  setText('modal-tx-title', '取引を編集');
  setText('tx-submit-btn', '更新する');

  // 種別タブを選択
  const typeBtn = document.querySelector(`.type-tab[data-type="${tx.type}"]`);
  selectType(tx.type, typeBtn);

  document.getElementById('tx-id').value = tx.id;
  document.getElementById('tx-amount').value = tx.amount;
  document.getElementById('tx-memo').value = tx.memo || '';

  if (tx.type === TYPE.TRANSFER) {
    document.getElementById('tx-date-t').value = tx.date;
    document.getElementById('tx-person-t').value = tx.person;
    setSelectValue('tx-transfer-from', tx.transferFrom);
    setSelectValue('tx-transfer-to', tx.transferTo);
    setSelectValue('tx-category-t', tx.category);
  } else {
    document.getElementById('tx-date').value = tx.date;
    document.getElementById('tx-person').value = tx.person;
    setSelectValue('tx-category', tx.category);
    setSelectValue('tx-payment', tx.payment);
  }
  openModal('modal-transaction');
}

function confirmDeleteTransaction(id) {
  const tx = State.transactions.find(t => t.id === id);
  if (!tx) return;
  setText('confirm-title', '取引を削除');
  setText('confirm-message', `「${tx.category || tx.type} ¥${fmt(tx.amount)}」を削除しますか？`);
  const btn = document.getElementById('confirm-ok-btn');
  btn.onclick = () => { closeModal(); deleteTransaction(id); };
  openModal('modal-confirm');
}

async function deleteTransaction(id) {
  try {
    if (State.apiUrl) {
      await apiPost({ action: 'deleteTransaction', id });
    }
    State.transactions = State.transactions.filter(t => t.id !== id);
    saveToCache();
    renderAll();
    showToast('削除しました', 'success');
  } catch (e) {
    showToast('削除失敗: ' + e.message, 'error');
  }
}

// ===== カテゴリ管理 =====
function openAddCategory() {
  document.getElementById('cat-original-name').value = '';
  document.getElementById('cat-name').value = '';
  document.getElementById('cat-type').value = '';
  setText('modal-cat-title', 'カテゴリを追加');
  openModal('modal-category');
}

function editCategory(name) {
  const cat = State.categories.find(c => c.name === name);
  if (!cat) return;
  document.getElementById('cat-original-name').value = name;
  document.getElementById('cat-name').value = cat.name;
  document.getElementById('cat-type').value = cat.type || '';
  setText('modal-cat-title', 'カテゴリを編集');
  openModal('modal-category');
}

async function saveCategory() {
  const name = document.getElementById('cat-name').value.trim();
  const type = document.getElementById('cat-type').value;
  const originalName = document.getElementById('cat-original-name').value;
  if (!name) { showToast('名前を入力してください', 'error'); return; }

  try {
    const data = { name, type, originalName: originalName || name };
    if (originalName) {
      if (State.apiUrl) await apiPost({ action: 'updateCategory', data });
      const idx = State.categories.findIndex(c => c.name === originalName);
      if (idx !== -1) State.categories[idx] = { ...State.categories[idx], name, type };
      showToast('更新しました', 'success');
    } else {
      if (State.categories.some(c => c.name === name)) { showToast('同名のカテゴリがあります', 'error'); return; }
      if (State.apiUrl) await apiPost({ action: 'addCategory', data });
      const maxOrder = Math.max(0, ...State.categories.map(c => c.order || 0));
      State.categories.push({ name, type, order: maxOrder + 1, active: true });
      showToast('追加しました', 'success');
    }
    saveToCache();
    closeModal();
    renderSettingsLists();
  } catch (e) {
    showToast('エラー: ' + e.message, 'error');
  }
}

async function deleteCategory(name) {
  if (!confirm(`「${name}」を削除しますか？`)) return;
  try {
    if (State.apiUrl) await apiPost({ action: 'deleteCategory', name });
    State.categories = State.categories.filter(c => c.name !== name);
    saveToCache();
    renderSettingsLists();
    showToast('削除しました', 'success');
  } catch (e) {
    showToast('削除失敗: ' + e.message, 'error');
  }
}

// ===== 支払い元管理 =====
function openAddPaymentMethod() {
  document.getElementById('pm-original-name').value = '';
  document.getElementById('pm-name').value = '';
  document.getElementById('pm-type').value = '口座';
  document.getElementById('pm-balance').value = '0';
  setText('modal-pm-title', '支払い元を追加');
  openModal('modal-payment');
}

function editPaymentMethod(name) {
  const pm = State.paymentMethods.find(p => p.name === name);
  if (!pm) return;
  document.getElementById('pm-original-name').value = name;
  document.getElementById('pm-name').value = pm.name;
  document.getElementById('pm-type').value = pm.type;
  document.getElementById('pm-balance').value = pm.initialBalance || 0;
  setText('modal-pm-title', '支払い元を編集');
  openModal('modal-payment');
}

async function savePaymentMethod() {
  const name = document.getElementById('pm-name').value.trim();
  const type = document.getElementById('pm-type').value;
  const initialBalance = parseFloat(document.getElementById('pm-balance').value) || 0;
  const originalName = document.getElementById('pm-original-name').value;
  if (!name) { showToast('名前を入力してください', 'error'); return; }

  try {
    const data = { name, type, initialBalance, originalName: originalName || name };
    if (originalName) {
      if (State.apiUrl) await apiPost({ action: 'updatePaymentMethod', data });
      const idx = State.paymentMethods.findIndex(p => p.name === originalName);
      if (idx !== -1) State.paymentMethods[idx] = { ...State.paymentMethods[idx], name, type, initialBalance };
      showToast('更新しました', 'success');
    } else {
      if (State.paymentMethods.some(p => p.name === name)) { showToast('同名の支払い元があります', 'error'); return; }
      if (State.apiUrl) await apiPost({ action: 'addPaymentMethod', data });
      const maxOrder = Math.max(0, ...State.paymentMethods.map(p => p.order || 0));
      State.paymentMethods.push({ name, type, initialBalance, order: maxOrder + 1, active: true });
      showToast('追加しました', 'success');
    }
    saveToCache();
    closeModal();
    renderSettingsLists();
  } catch (e) {
    showToast('エラー: ' + e.message, 'error');
  }
}

async function deletePaymentMethod(name) {
  if (!confirm(`「${name}」を削除しますか？`)) return;
  try {
    if (State.apiUrl) await apiPost({ action: 'deletePaymentMethod', name });
    State.paymentMethods = State.paymentMethods.filter(p => p.name !== name);
    saveToCache();
    renderSettingsLists();
    showToast('削除しました', 'success');
  } catch (e) {
    showToast('削除失敗: ' + e.message, 'error');
  }
}

// ===== 固定費管理 =====
function populateFixedCostDays() {
  const select = document.getElementById('fc-day');
  if (!select) return;
  select.innerHTML = Array.from({ length: 28 }, (_, i) => i + 1)
    .map(d => `<option value="${d}">${d}日</option>`).join('');
}

function openAddFixedCost() {
  document.getElementById('fc-id').value = '';
  document.getElementById('fc-name').value = '';
  document.getElementById('fc-amount').value = '';
  populateCategorySelect('fc-category', '支出');
  populatePaymentSelect('fc-payment');
  setText('modal-fc-title', '固定費を追加');
  openModal('modal-fixed');
}

function editFixedCost(id) {
  const fc = State.fixedCosts.find(f => f.id === id);
  if (!fc) return;
  populateCategorySelect('fc-category', '支出');
  populatePaymentSelect('fc-payment');
  document.getElementById('fc-id').value = fc.id;
  document.getElementById('fc-name').value = fc.name;
  document.getElementById('fc-amount').value = fc.amount;
  setSelectValue('fc-category', fc.category);
  setSelectValue('fc-payment', fc.payment);
  setSelectValue('fc-day', fc.day.toString());
  setText('modal-fc-title', '固定費を編集');
  openModal('modal-fixed');
}

async function saveFixedCost() {
  const id = document.getElementById('fc-id').value;
  const name = document.getElementById('fc-name').value.trim();
  const amount = parseFloat(document.getElementById('fc-amount').value) || 0;
  const category = document.getElementById('fc-category').value;
  const payment = document.getElementById('fc-payment').value;
  const day = parseInt(document.getElementById('fc-day').value) || 1;
  if (!name) { showToast('名称を入力してください', 'error'); return; }
  if (amount <= 0) { showToast('金額を入力してください', 'error'); return; }

  try {
    const data = { id, name, amount, category, payment, day, active: true };
    if (id) {
      if (State.apiUrl) await apiPost({ action: 'updateFixedCost', data });
      const idx = State.fixedCosts.findIndex(f => f.id === id);
      if (idx !== -1) State.fixedCosts[idx] = data;
      showToast('更新しました', 'success');
    } else {
      const result = State.apiUrl ? await apiPost({ action: 'addFixedCost', data }) : { ...data, id: Date.now().toString() };
      State.fixedCosts.push(result);
      showToast('追加しました', 'success');
    }
    saveToCache();
    closeModal();
    renderFixedCostList();
  } catch (e) {
    showToast('エラー: ' + e.message, 'error');
  }
}

async function deleteFixedCost(id) {
  if (!confirm('この固定費を削除しますか？')) return;
  try {
    if (State.apiUrl) await apiPost({ action: 'deleteFixedCost', id });
    State.fixedCosts = State.fixedCosts.filter(f => f.id !== id);
    saveToCache();
    renderFixedCostList();
    showToast('削除しました', 'success');
  } catch (e) {
    showToast('削除失敗: ' + e.message, 'error');
  }
}

async function applyFixedCosts() {
  if (!State.apiUrl) {
    showToast('API URLを設定してください', 'error'); return;
  }
  try {
    showToast('固定費を反映中...');
    const result = await apiGet({ action: 'applyFixedCosts', yearMonth: State.currentMonth });
    await syncData(true);
    showToast(`${result.length}件の固定費を反映しました`, 'success');
  } catch (e) {
    showToast('エラー: ' + e.message, 'error');
  }
}

// ===== ユーティリティ =====
function fmt(n) {
  return Math.round(n || 0).toLocaleString('ja-JP');
}

function esc(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setSelectValue(selectId, value) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const options = Array.from(select.options);
  const match = options.find(o => o.value === value);
  if (match) select.value = value;
}

function showToast(msg, type = '') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => { toast.className = 'toast'; }, 2500);
}

// ===== Service Worker登録 =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

// ===== 起動 =====
document.addEventListener('DOMContentLoaded', init);
