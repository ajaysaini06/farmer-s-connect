(() => {
  let crops = [];
  const defaults = {
    role: '', language: 'en', page: 'dashboard', category: 'All produce', query: '',
    location: '', marketFilterState: null, marketFilterDistrict: null, appliedMarketFilters: null,
    listings: [], nearbyListings: [], regionalPrices: [], prices: [],
    requirements: [], orders: [], inquiries: [], activeInquiry: '',
    notifications: true, notificationItems: [], notificationFilter: 'all', editingListingId: '',
    marketPriceRecords: [], marketPriceLoaded: false, marketPriceLoadedState: '', marketPriceLoading: false, marketPriceError: '', marketPriceSetupRequired: false, marketPriceApiVersion: 0, marketPriceSourceRecordCount: 0, marketPriceUnmappedRecordCount: 0, marketPriceFetchedAt: '', marketPriceSourceUpdatedAt: '',
    marketPriceDraft: { state: '', district: '', commodityGroup: '', commodity: '', fromDate: '', toDate: '' }, marketPriceApplied: null, marketPricePage: 1, marketPricePageSize: 10,
    marketPriceChatOpen: false, marketPriceChatMessages: [], helpChatMessages: [],
  };
  const state = Object.assign(structuredCloneSafe(defaults), { authenticated: false, user: null });
  let toastTimer;
  let modalReturnFocus = null;
  let modalHistoryNode = null;
  let modalBackPending = false;
  const APP_HISTORY_KEY = '__farmersConnect';
  let authDraft = { role: 'farmer', language: 'en' };

  let indiaLocations = [];

  function structuredCloneSafe(value) { return JSON.parse(JSON.stringify(value)); }
  function stateOptions(selected = '', placeholder = word('Choose a state', '\u0930\u093e\u091c\u094d\u092f \u091a\u0941\u0928\u0947\u0902')) {
    return '<option value="">' + esc(placeholder) + '</option>' + indiaLocations.slice().sort((a, b) => a.state.localeCompare(b.state)).map((entry) => '<option value="' + esc(entry.state) + '" ' + (entry.state === selected ? 'selected' : '') + '>' + esc(entry.state) + '</option>').join('');
  }
  function districtOptions(stateName, selected = '', placeholder = word('Choose a district', '\u091c\u093f\u0932\u093e \u091a\u0941\u0928\u0947\u0902')) {
    const entry = indiaLocations.find((location) => location.state === stateName);
    return '<option value="">' + esc(placeholder) + '</option>' + (entry?.districts || []).slice().sort((a, b) => a.localeCompare(b)).map((district) => '<option value="' + esc(district) + '" ' + (district === selected ? 'selected' : '') + '>' + esc(district) + '</option>').join('');
  }
  function stateSelectMarkup(id, name, selected = '') {
    return '<select id="' + esc(id) + '" name="' + esc(name) + '" required>' + stateOptions(selected) + '</select>';
  }
  function districtSelectMarkup(id, name, selectedState = '', selectedDistrict = '') {
    return '<select id="' + esc(id) + '" name="' + esc(name) + '" required ' + (selectedState ? '' : 'disabled') + '>' + districtOptions(selectedState, selectedDistrict) + '</select>';
  }
  function bindDistrictDropdown(stateId, districtId) {
    const stateField = document.getElementById(stateId);
    const districtField = document.getElementById(districtId);
    if (!stateField || !districtField) return;
    const update = (clearSelection = false) => {
      const selectedDistrict = clearSelection ? '' : districtField.value;
      districtField.innerHTML = districtOptions(stateField.value, selectedDistrict);
      districtField.disabled = !stateField.value || !indiaLocations.some((entry) => entry.state === stateField.value);
    };
    stateField.addEventListener('change', () => update(true));
    update(false);
  }
  async function api(path, options = {}) {
    const headers = { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers };
    let response;
    try {
      response = await fetch(`/api${path}`, { credentials: 'same-origin', ...options, headers });
    } catch (error) {
      if (error instanceof TypeError) throw new Error(`Cannot reach the Farmer's Connect server at ${location.origin}. Start it with npm start and open this same address again.`);
      throw error;
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
    return payload;
  }
  async function loadWorkspace() {
    const data = await api('/bootstrap');
    state.user = data.user;
    state.role = data.user.role;
    state.language = data.user.language;
    state.location = data.user.location;
    if (!state.marketPriceDraft.state) state.marketPriceDraft.state = data.user.state || marketplaceArea(data.user.location).state || '';
    state.about = data.user.about;
    state.notifications = data.user.notifications;
    state.listings = data.listings;
    state.nearbyListings = data.nearbyListings || data.listings;
    state.orders = data.orders;
    state.notificationItems = data.notifications || [];
    state.inquiries = data.conversations;
    state.prices = data.prices;
    state.regionalPrices = data.regionalPrices || data.prices;
    crops = state.regionalPrices;
    state.requirements = data.requirements;
    state.activeInquiry = data.conversations[0]?.id || '';
    state.authenticated = true;
  }
  async function enterWorkspace(user) {
    state.user = user;
    state.role = user.role;
    state.authenticated = true;
    await loadWorkspace();
    state.page = 'dashboard';
    closeModal({ replaceHistory: true });
    replaceAppHistory('dashboard', false);
    render();
  }
  async function updateProfile(values) {
    const result = await api('/profile', { method: 'PATCH', body: JSON.stringify(values) });
    await loadWorkspace();
    return result.user;
  }
  async function updateOrder(id, values) {
    try {
      await api(`/orders/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(values) });
      await loadWorkspace(); render();
      toast(word('Order updated.','ऑर्डर अपडेट हुआ।'));
    } catch (error) { toast(error.message); }
  }
  async function toggleNotifications() {
    try { await updateProfile({ notifications: !state.notifications }); render(); toast(word('Notification preference saved.', 'सूचना सेटिंग सहेजी गई।')); }
    catch (error) { toast(error.message); }
  }
  async function markNotificationRead(id) {
    try {
      await api(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
      await loadWorkspace(); render();
    } catch (error) { toast(error.message); }
  }
  async function markAllNotificationsRead() {
    try {
      await api('/notifications/read-all', { method: 'PATCH' });
      await loadWorkspace(); render();
    } catch (error) { toast(error.message); }
  }
  async function toggleLanguage() {
    try { await updateProfile({ language: state.language === 'en' ? 'hi' : 'en' }); render(); }
    catch (error) { toast(error.message); }
  }
  async function signOut() {
    try {
      await api('/auth/logout', { method: 'POST' });
      state.authenticated = false; state.user = null; state.role = ''; state.page = 'dashboard';
      state.helpChatMessages = [];
      render(); onboarding();
    } catch (error) { toast(error.message); }
  }
  function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]); }
  function imageToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        const comma = result.indexOf(',');
        if (comma < 0) reject(new Error('Could not read the selected photo.'));
        else resolve(result.slice(comma + 1));
      };
      reader.onerror = () => reject(new Error('Could not read the selected photo.'));
      reader.readAsDataURL(file);
    });
  }
  function money(value) { return `₹${Number(value).toLocaleString('en-IN')}`; }
  function word(en, hi) {
    const value = state.language === 'hi' ? hi : en;
    // Older local data can contain text that was saved with an incorrect character encoding.
    // Show the English label instead of exposing unreadable symbols in the interface.
    return !value || /\?{2,}|[\u00c3\u00c2\u00e0\u00f0]/.test(value) ? en : value;
  }
  function isFarmer() { return state.role === 'farmer'; }
  function isIndustry() { return state.role === 'industry'; }
  function pageTitle() { return ({ dashboard: word('Dashboard','डैशबोर्ड'), marketplace: word('Marketplace','बाज़ार'), 'my-produce': word('My produce','मेरी उपज'), prices: word('Market prices','बाज़ार भाव'), orders: word('Orders & receipts','ऑर्डर और रसीदें'), notifications: word('Notifications','सूचनाएँ'), messages: word('Messages','संदेश'), profile: word('My profile','मेरी प्रोफ़ाइल') })[state.page] || 'Dashboard'; }
  function navItems() {
    return [
      { id: 'dashboard', icon: '⌂', label: word('Dashboard','डैशबोर्ड') },
      { id: isFarmer() ? 'my-produce' : 'marketplace', icon: '▦', label: word(isFarmer() ? 'My produce' : 'Marketplace', isFarmer() ? 'मेरी उपज' : 'बाज़ार'), resetMarketplace: isFarmer() },
      { id: 'prices', icon: '↗', label: word('Market prices','बाज़ार भाव') },
      { id: 'orders', icon: '▤', label: word('Orders & receipts','ऑर्डर और रसीदें') },
      { id: 'notifications', icon: '♧', label: word('Notifications','सूचनाएँ') },
      { id: 'messages', icon: '◌', label: word('Messages','संदेश') },
    ];
  }
  function roleName() { return ({ farmer: word('Farmer','किसान'), consumer: word('Consumer','ग्राहक'), industry: word('Industry buyer','व्यापार खरीदार') })[state.role] || 'Farmer'; }
  function roleIcon() { return ({ farmer:'🌱', consumer:'🧺', industry:'🏪' })[state.role] || '🌱'; }
  function plantAiIcon() {
    return `<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><path d="M9 7.5h30a5.5 5.5 0 0 1 5.5 5.5v15a5.5 5.5 0 0 1-5.5 5.5H25l-9 7v-7H9A5.5 5.5 0 0 1 3.5 28V13A5.5 5.5 0 0 1 9 7.5Z" fill="#fff" stroke="#276f49" stroke-width="2.5" stroke-linejoin="round"/><path d="M24 29v-9" fill="none" stroke="#477d43" stroke-width="2.5" stroke-linecap="round"/><path d="M24 22c-7.5 0-10.5-4.1-10.5-8.5 6.3 0 10.5 2.8 10.5 8.5Z" fill="#8fbd5c"/><path d="M24 25c0-6.2 4.2-10 10.5-10 0 5.3-3.4 9.4-10.5 10Z" fill="#5d9b4c"/></svg>`;
  }
  function openModal(html, wide = false, fullPage = false) {
    const root = document.getElementById('modal-root');
    const isReplacingModal = Boolean(root.firstElementChild);
    if (isReplacingModal) window.history.replaceState(appHistoryState(state.page, true), '', window.location.href);
    else window.history.pushState(appHistoryState(state.page, true), '', window.location.href);
    modalReturnFocus = document.activeElement;
    root.innerHTML = `<div class="modal-backdrop" data-backdrop><section class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">${html}</section></div>`;
    if (fullPage) {
      document.querySelector('.modal-backdrop')?.classList.add('full-page-backdrop');
      const fullPagePanel = document.querySelector('.modal');
      fullPagePanel?.classList.add('full-page');
      if (fullPagePanel?.querySelector('.full-page-content-centered')) fullPagePanel.classList.add('full-page-entry');
    }
    modalHistoryNode = root.firstElementChild;
    modalBackPending = false;
    document.querySelector('.modal-backdrop').addEventListener('click', (e) => { if (e.target.matches('[data-backdrop]')) closeModal(); });
    document.querySelector('.modal').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
    document.querySelector('.modal').addEventListener('click', (e) => {
      const button = e.target.closest('[data-action]');
      if (!button) return;
      if (button.dataset.action === 'close-modal') closeModal();
      if (button.dataset.action === 'print-receipt') window.print();
      if (button.dataset.action === 'auth-back') onboarding();
    });
    document.querySelector('.modal button, .modal input, .modal select')?.focus();
  }
  function openFullPage(html) {
    const centered = ['auth-choice-grid', 'auth-login-form', 'password-setup-request', 'password-setup-verify', 'auth-verify-form'].some((selector) => html.includes(selector));
    const contentClass = centered ? 'full-page-content full-page-content-centered' : 'full-page-content';
    openModal('<div class="' + contentClass + '">' + html + '</div>', false, true);
  }
  function closeModal(options = {}) {
    const root = document.getElementById('modal-root');
    const appEntry = window.history.state?.[APP_HISTORY_KEY];
    if (appEntry?.modal && !options.replaceHistory) {
      if (!modalBackPending) {
        modalBackPending = true;
        window.history.back();
      }
      return;
    }
    if (appEntry?.modal) replaceAppHistory(appEntry.page || state.page, false);
    modalHistoryNode = null;
    modalBackPending = false;
    root.innerHTML = '';
    if (modalReturnFocus?.isConnected) modalReturnFocus.focus();
  }
  function toast(message) {
    const root = document.getElementById('toast-root');
    root.innerHTML = `<div class="toast">${esc(message)}</div>`;
    requestAnimationFrame(() => root.firstElementChild.classList.add('show'));
    clearTimeout(toastTimer); toastTimer = setTimeout(() => root.innerHTML = '', 2600);
  }
  function appHistoryState(page, modal = false, scrollY = window.scrollY) {
    const previousState = window.history.state && typeof window.history.state === 'object' ? window.history.state : {};
    return { ...previousState, [APP_HISTORY_KEY]: { page, modal, scrollY } };
  }
  function replaceAppHistory(page = state.page, modal = false, scrollY = window.scrollY) {
    window.history.replaceState(appHistoryState(page, modal, scrollY), '', window.location.href);
  }
  function handleAppPopState(event) {
    const entry = event.state?.[APP_HISTORY_KEY];
    if (!entry) return;
    const nextPage = ['dashboard', 'marketplace', 'my-produce', 'prices', 'orders', 'notifications', 'messages', 'profile', 'listing-form'].includes(entry.page) ? entry.page : 'dashboard';
    const pageChanged = state.page !== nextPage;
    const root = document.getElementById('modal-root');
    state.page = nextPage;
    if (entry.modal) {
      if (!root.firstElementChild && modalHistoryNode) root.appendChild(modalHistoryNode);
      modalBackPending = false;
      if (pageChanged) render();
      root.querySelector('.modal button, .modal input, .modal select')?.focus();
    } else {
      if (root.firstElementChild) {
        modalHistoryNode = root.firstElementChild;
        root.innerHTML = '';
      }
      modalBackPending = false;
      if (pageChanged) render();
      else if (modalReturnFocus?.isConnected) modalReturnFocus.focus();
    }
    if (Number.isFinite(entry.scrollY)) window.scrollTo(0, entry.scrollY);
  }
  function returnFromListingForm() {
    const appEntry = window.history.state?.[APP_HISTORY_KEY];
    if (appEntry?.page === 'listing-form') window.history.back();
    else setPage(isFarmer() ? 'my-produce' : 'dashboard');
  }
  function setPage(page) {
    if (document.getElementById('modal-root').firstElementChild) closeModal({ replaceHistory: true });
    if (page !== state.page) {
      replaceAppHistory(state.page, false, window.scrollY);
      window.history.pushState(appHistoryState(page, false, 0), '', window.location.href);
    }
    state.page = page;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function priceByName(name) { const cropName = String(name || ''); return crops.find((crop) => cropName.toLowerCase().includes(String(crop.name || '').toLowerCase())) || { icon: '??', name: cropName, hi: cropName }; }
  function currentUser() { return state.user?.name || 'Guest'; }
  function isMyListing(item) {
    const userId = state.user?.id;
    const ownedById = userId != null && item.sellerId != null && String(item.sellerId) === String(userId);
    return ownedById || item.seller === currentUser();
  }
  function initials(name) { return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase(); }
  function dateLabel() { return new Intl.DateTimeFormat(state.language === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date()).toLocaleUpperCase(state.language === 'hi' ? 'hi-IN' : 'en-IN'); }
  function topbar() {
    const unread = state.notificationItems.filter((item) => !item.read).length;
    return `<header class="topbar"><div class="breadcrumb"><span>Farmer's Connect</span> &nbsp;/&nbsp; <b>${pageTitle()}</b></div><div class="mobile-brand"><img src="assets/leaf.svg" alt=""/> Farmer's Connect</div><div class="top-actions"><button class="location-pill" data-action="location">&#x2316; &nbsp;${esc(state.location || word('Choose location','\u091c\u0917\u0939 \u091a\u0941\u0928\u0947\u0902'))}&#x2304;</button><button class="icon-btn top-guide-btn" aria-label="${word('Open Plant AI','Plant AI \u0916\u094b\u0932\u0947\u0902')}" title="${word('Plant AI','Plant AI')}" data-action="help">${plantAiIcon()}</button><button class="icon-btn" aria-label="${word('Notifications','\u0938\u0942\u091a\u0928\u093e\u090f\u0901')}" title="${word('Notifications','\u0938\u0942\u091a\u0928\u093e\u090f\u0901')}" data-page="notifications">&#x2667;${unread ? `<span class="notification-count">${unread > 99 ? '99+' : unread}</span>` : ''}</button><button class="user-mini" aria-label="Open profile" data-page="profile">${esc(initials(currentUser()))}</button></div></header>`;
  }
  function sidebar() {
    const links = navItems().map((item) => `<button class="nav-item ${state.page === item.id ? 'active' : ''}" data-page="${item.id}" ${item.resetMarketplace ? 'data-reset-marketplace' : ''}><span class="nav-icon">${esc(item.icon)}</span>${item.label}</button>`).join('');
    const helpCard = `<button type="button" class="help-card" data-action="help" aria-label="${word('Open Plant AI','Plant AI \u0916\u094b\u0932\u0947\u0902')}"><span class="help-card-heading"><span class="help-bot-icon">${plantAiIcon()}</span><span class="help-card-title"><strong>${word('Plant AI','Plant AI')}</strong><span>${word('FARM GUIDE','\u0916\u0947\u0924\u0940 \u0938\u0939\u093e\u092f\u0915')}</span></span></span><span class="help-card-copy">${word('Ask Plant AI about app features, buying, selling, and orders.','\u0910\u092a \u0915\u0940 \u0938\u0941\u0935\u093f\u0927\u093e\u0913\u0902, \u0916\u0930\u0940\u0926, \u092c\u093f\u0915\u094d\u0930\u0940 \u0914\u0930 \u0911\u0930\u094d\u0921\u0930 \u0915\u0947 \u092c\u093e\u0930\u0947 \u092e\u0947\u0902 \u092a\u0942\u091b\u0947\u0902\u0964')}</span><span class="help-link">${word('Ask Plant AI','Plant AI \u0938\u0947 \u092a\u0942\u091b\u0947\u0902')} &nbsp;&#x2192;</span></button>`;
    return `<aside class="sidebar"><div class="brand"><span class="brand-mark">&#x2767;</span><div><div class="brand-name">Farmer's Connect</div><div class="brand-sub">GROW TOGETHER &middot; TRADE FAIR</div></div></div><div class="role-display" aria-label="${roleName()}"><span class="role-avatar">${roleIcon()}</span><span class="role-copy"><span class="role-value">${roleName()}</span></span></div><div class="side-caption">${word('Workspace','\u0915\u093e\u0930\u094d\u092f\u0938\u094d\u0925\u0932')}</div><nav class="nav-list">${links}<button class="nav-item ${state.page === 'profile' ? 'active' : ''}" data-page="profile"><span class="nav-icon">&#x25C9;</span>${word('My profile','\u092e\u0947\u0930\u0940 \u092a\u094d\u0930\u094b\u092b\u093c\u093e\u0907\u0932')}</button></nav><div class="side-spacer"></div>${helpCard}<div class="sidebar-footer">&copy; 2026 Farmer's Connect<br/>A fairer way to grow.</div></aside>`;
  }
  function mobileNav() {
    const items = [navItems()[0], navItems()[1], navItems()[2], navItems()[3], { id: 'profile', icon: '◉', label: word('Profile','प्रोफ़ाइल') }];
    return `<nav class="mobile-bottom" aria-label="Main navigation">${items.map((item) => `<button class="mobile-nav ${state.page === item.id ? 'active' : ''}" data-page="${item.id}" ${item.resetMarketplace ? 'data-reset-marketplace' : ''}><span>${esc(item.icon)}</span>${item.label}</button>`).join('')}</nav>`;
  }
  function statCard(label, value, note, icon, page = '', resetMarketplace = false) {
    const content = `<div class="stat-top"><span>${label}</span><span class="stat-icon">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-note">${note}</div>`;
    if (!page) return `<article class="stat-card">${content}</article>`;
    return `<button type="button" class="stat-card stat-card-link" data-page="${esc(page)}" ${resetMarketplace ? 'data-reset-marketplace' : ''}>${content}</button>`;
  }
  function priceRows() {
    const prices = Array.isArray(state.regionalPrices) ? state.regionalPrices.slice(0, 4) : [];
    if (!prices.length) return `<div class="empty-state">${word('No market price data is available yet.','No market price data is available yet.')}</div>`;
    return prices.map((crop) => `<div class="price-row" style="grid-template-columns:1fr 1fr"><div class="price-crop"><span class="crop-emoji">${esc(crop.icon || '')}</span><div><div class="crop-name">${esc(state.language === 'hi' ? crop.hi || crop.name : crop.name)}</div><div class="crop-place">${esc(crop.region || '')}</div></div></div><div><div class="price-value">${money(crop.price)}</div><div class="price-unit">${word('Reported price','Reported price')}</div></div></div>`).join('');
  }
  function miniListings() {
    return state.nearbyListings.filter((item)=>item.verified).slice(0, 3).map((item) => `<div class="mini-listing"><span class="produce-thumb">${esc(item.icon)}</span><div><div class="mini-title">${esc(item.crop)}</div><div class="seller-line"><span>${esc(item.seller)}</span><span>·</span><span class="verified">✓ ${word('Verified','सत्यापित')}</span></div><div class="mini-meta">${esc(item.location)}</div></div><div class="mini-price">${money(item.price)}<span>per ${esc(item.unit)}</span></div></div>`).join('');
  }
  function dashboard() {
    const orders = Array.isArray(state.orders) ? state.orders : [];
    const listings = Array.isArray(state.listings) ? state.listings : [];
    const nearby = Array.isArray(state.nearbyListings) ? state.nearbyListings : [];
    const requirements = Array.isArray(state.requirements) ? state.requirements : [];
    const myListings = listings.filter(isMyListing);
    const orderValue = orders.reduce((total, order) => total + Number(order.total || 0), 0);
    const ratedListings = myListings.filter((item) => Number(item.rating) > 0);
    const rating = ratedListings.length ? (ratedListings.reduce((total, item) => total + Number(item.rating), 0) / ratedListings.length).toFixed(1) : '—';
    const stats = isFarmer()
      ? [
          statCard(word('Active listings','सक्रिय लिस्टिंग'), myListings.length, word('Manage your produce','अपनी उपज संभालें'), '▦', 'my-produce', true),
          statCard(word('Your orders','आपके ऑर्डर'), orders.length, word('View order history','ऑर्डर इतिहास देखें'), '▤', 'orders'),
          statCard(word('Order value','ऑर्डर राशि'), money(orderValue), word('Recorded order total','दर्ज ऑर्डर राशि'), '₹', 'orders'),
          statCard(word('Your rating','आपकी रेटिंग'), rating === '—' ? rating : `${rating} ★`, word('Average on your listings','आपकी लिस्टिंग की औसत रेटिंग'), '☆', 'profile'),
        ]
      : [
          statCard(word('Nearby produce','आस-पास की उपज'), nearby.length, word('Browse available listings','उपलब्ध लिस्टिंग देखें'), '▦', 'marketplace', true),
          statCard(word('Your orders','आपके ऑर्डर'), orders.length, word('View order history','ऑर्डर इतिहास देखें'), '▤', 'orders'),
          statCard(word('Order value','ऑर्डर राशि'), money(orderValue), word('Recorded order total','दर्ज ऑर्डर राशि'), '₹', 'orders'),
          statCard(word('Conversations','बातचीत'), state.inquiries.length, word('Open your messages','अपने संदेश खोलें'), '✉', 'messages'),
        ];
    const recentOrders = orders.slice(0, 3).map((order) => `<article class="order-card"><div class="order-product"><span class="produce-thumb">${esc(order.icon)}</span><div><div class="order-name">${esc(order.crop)} · ${esc(order.qty)} ${esc(order.unit)}</div><div class="order-id">${esc(order.id)} · ${esc(order.date)}</div></div></div><div class="order-detail">${word('With','से')}: ${esc(order.other)}<br/>${word('Total','कुल')}: <b>${money(order.total)}</b></div><span class="status ${statusClass(order.status)}">${esc(order.status)}</span></article>`).join('');
    const requirementRows = requirements.map((requirement) => `<div class="requirement-card"><span class="produce-thumb">${esc(priceByName(requirement.crop).icon)}</span><div class="requirement-copy" style="flex:1"><b>${esc(requirement.crop)} · ${esc(requirement.qty)} ${esc(requirement.unit)}</b><span>${word('Delivery by','डिलीवरी')}: ${esc(requirement.date || word('Flexible','लचीली'))} · ${Number(requirement.matches || 0)} ${word('matching growers','मिलते किसान')}</span></div><span class="status ${requirement.status === 'Matching' ? 'transit' : 'pending'}">${esc(requirement.status)}</span></div>`).join('');
    const requirementsPanel = isIndustry() ? `<section class="panel" style="margin-bottom:18px"><div class="panel-head"><div><h2>${word('Your produce requirements','आपकी उपज की ज़रूरतें')}</h2><div class="panel-kicker">${word('Find growers who can supply your business','अपने कारोबार के लिए किसान खोजें')}</div></div><button class="button button-outline button-sm" data-action="new-requirement">＋ ${word('Add requirement','ज़रूरत जोड़ें')}</button></div>${requirementRows || `<div class="empty-state">${word('No requirements yet. Add one to find matching growers.','अभी कोई ज़रूरत नहीं है। किसानों को खोजने के लिए एक ज़रूरत जोड़ें।')}</div>`}</section>` : '';
    const listingRows = miniListings();
    const prices = priceRows();
    return `<div class="welcome-row"><div><div class="eyebrow">${word(isFarmer() ? 'YOUR FARM AT A GLANCE' : 'YOUR MARKET AT A GLANCE', isFarmer() ? 'आपके खेत की झलक' : 'आपके बाज़ार की झलक')}</div><h1>${word(isFarmer() ? 'Farm dashboard' : isIndustry() ? 'Buyer dashboard' : 'Marketplace dashboard', isFarmer() ? 'किसान डैशबोर्ड' : isIndustry() ? 'खरीदार डैशबोर्ड' : 'बाज़ार डैशबोर्ड')}</h1><p class="page-subtitle">${word('Your listings, orders, and local market in one place.','आपकी लिस्टिंग, ऑर्डर और स्थानीय बाज़ार एक जगह।')}</p></div>${isFarmer() ? `<button class="button button-primary" data-action="add-listing">＋ ${word('Add produce','उपज जोड़ें')}</button>` : `<button class="button button-outline" data-page="marketplace" data-reset-marketplace>${word('Browse produce','उपज देखें')} →</button>`}</div><div class="grid grid-stats">${stats.join('')}</div>${requirementsPanel}<div class="dashboard-grid"><section class="panel"><div class="panel-head"><div><h2>${word('Recent orders','हाल के ऑर्डर')}</h2><div class="panel-kicker">${word('Your latest marketplace activity','आपकी हाल की बाज़ार गतिविधि')}</div></div><button class="text-link" data-page="orders">${word('View all','सभी देखें')} →</button></div><div class="order-list">${recentOrders || `<div class="empty-state"><span>🧺</span>${word('Your orders will appear here.','आपके ऑर्डर यहाँ दिखेंगे。')}</div>`}</div></section><aside><section class="panel"><div class="panel-head"><div><h2>${word('Nearby produce','आस-पास की उपज')}</h2><div class="panel-kicker">${esc(state.location || word('Your selected location','आपकी चुनी हुई जगह'))}</div></div><button class="text-link" data-page="marketplace" data-reset-marketplace>${word('Browse','देखें')} →</button></div><div class="listing-list">${listingRows || `<div class="empty-state">${word('No nearby listings yet.','अभी आस-पास कोई लिस्टिंग नहीं है।')}</div>`}</div></section><section class="panel" style="margin-top:14px"><div class="panel-head"><div><h2>${word('Local price watch','स्थानीय बाज़ार भाव')}</h2><div class="panel-kicker">${word('Available market prices','Available market prices')}</div></div><button class="text-link" data-page="prices">${word('View prices','भाव देखें')} →</button></div><div class="price-list">${prices}</div></section></aside></div><p class="market-note" style="margin-top:16px">ⓘ ${word('Market prices appear when data is available. Confirm current details before trading.','Market prices appear when data is available. Confirm current details before trading.')}</p>`;
  }
  const knownMarketAreas = [
    { aliases: ['agra'], district: 'Agra', state: 'Uttar Pradesh' },
    { aliases: ['nashik', 'lasalgaon'], district: 'Nashik', state: 'Maharashtra' },
    { aliases: ['pune'], district: 'Pune', state: 'Maharashtra' },
    { aliases: ['ratnagiri'], district: 'Ratnagiri', state: 'Maharashtra' },
    { aliases: ['indore'], district: 'Indore', state: 'Madhya Pradesh' },
    { aliases: ['karnal'], district: 'Karnal', state: 'Haryana' },
    { aliases: ['ujhani', 'budaun'], district: 'Budaun', state: 'Uttar Pradesh' },
  ];
  const stateNames = Object.fromEntries([...Object.entries({ up: 'Uttar Pradesh', mh: 'Maharashtra', mp: 'Madhya Pradesh', hr: 'Haryana', 'uttar pradesh': 'Uttar Pradesh', maharashtra: 'Maharashtra', 'madhya pradesh': 'Madhya Pradesh', haryana: 'Haryana' }), ...indiaLocations.map((entry) => [entry.state.toLowerCase(), entry.state])]);
  function marketplaceArea(location) {
    const raw = String(location || '').trim();
    const normalized = raw.toLowerCase().replace(/\b\d{6}\b/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const known = knownMarketAreas.find((area) => area.aliases.some((alias) => new RegExp(`(^|\\s)${alias}(?=\\s|$)`).test(normalized)));
    if (known) return { district: known.district, state: known.state };
    const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
    const statePart = (parts.at(-1) || '').toLowerCase().replace(/\b\d{6}\b/g, '').replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const state = stateNames[statePart] || (statePart ? statePart.replace(/\b\w/g, (letter) => letter.toUpperCase()) : '');
    const district = (parts.length > 2 ? parts.at(-2) : parts[0] || '').replace(/\b\d{6}\b/g, '').trim();
    return { district, state };
  }
  function marketplaceAreas(listings) {
    const areas = listings.map((item) => marketplaceArea(item.location)).filter((area) => area.district && area.state);
    return [...new Map(areas.map((area) => [`${area.state.toLowerCase()}|${area.district.toLowerCase()}`, area])).values()];
  }
  function marketplaceFilterToolbar() {
    const profileArea = marketplaceArea(state.location);
    const selectedState = state.marketFilterState ?? state.user?.state ?? profileArea.state;
    const selectedDistrict = state.marketFilterDistrict ?? (selectedState === profileArea.state ? (state.user?.district || profileArea.district) : '');
    const states = indiaLocations.map((entry) => entry.state).sort((a, b) => a.localeCompare(b));
    const districts = (indiaLocations.find((entry) => entry.state === selectedState)?.districts || []).slice().sort((a, b) => a.localeCompare(b));
    return `<form id="marketplace-filter-form" class="marketplace-filter-form"><div class="marketplace-toolbar"><label class="search-box"><span>⌕</span><input id="market-search" name="query" value="${esc(state.query)}" placeholder="${word('Search produce, farmer, location...','उपज, किसान या जगह खोजें...')}" aria-label="Search produce" /></label><label class="market-filter-field"><span>${word('State','राज्य')}</span><select class="filter-select" id="market-state" name="state" aria-label="${word('State','राज्य')}"><option value="">${word('Any state','कोई भी राज्य')}</option>${states.map((marketState) => `<option value="${esc(marketState)}" ${selectedState === marketState ? 'selected' : ''}>${esc(marketState)}</option>`).join('')}</select></label><label class="market-filter-field"><span>${word('District','जिला')}</span><select class="filter-select" id="market-district" name="district" aria-label="${word('District','जिला')}" ${selectedState ? '' : 'disabled'}><option value="">${word('Any district','कोई भी जिला')}</option>${districts.map((district) => `<option value="${esc(district)}" ${selectedDistrict === district ? 'selected' : ''}>${esc(district)}</option>`).join('')}</select></label><select class="filter-select sort-select" data-action="sort" aria-label="${word('Sort listings','लिस्टिंग क्रम')}"><option>${word('Sort: Recommended','क्रम: सुझाए गए')}</option><option>${word('Price: low to high','भाव: कम से ज़्यादा')}</option><option>${word('Price: high to low','भाव: ज़्यादा से कम')}</option></select><button class="button button-primary market-search-button" type="submit">${word('Search','खोजें')}</button></div></form>`;
  }
  function listingCard(item) {
    const ownsListing = isFarmer() && isMyListing(item);
    const fallbackIcon = item.icon || priceByName(item.crop || '').icon;
    const photo = item.photoUrl
      ? `<img class="listing-photo-image" src="${esc(item.photoUrl)}" alt="${esc(item.crop)}" loading="lazy" />`
      : `<span class="listing-emoji" aria-hidden="true">${esc(fallbackIcon)}</span>`;
    const actions = ownsListing
      ? `<button type="button" class="button button-outline" data-action="edit-listing" data-id="${esc(item.id)}">${word('Edit','बदलें')}</button><button type="button" class="button button-light" data-action="delete-listing" data-id="${esc(item.id)}">${word('Remove','हटाएँ')}</button>`
      : `<button type="button" class="button button-outline" data-action="inquire" data-id="${esc(item.id)}">${word('Message','संदेश')}</button><button type="button" class="button button-light" data-action="buy" data-id="${esc(item.id)}">${word('Buy','खरीदें')}</button>`;
    return `<article class="listing-card"><div class="listing-photo" style="background:${esc(item.color || '#eff3e8')}">${photo}<span class="listing-tag">${esc(item.quality || word('Fresh','ताज़ा'))}</span>${ownsListing ? '' : `<button type="button" class="listing-favorite" data-action="favorite" aria-label="${word('Save listing','लिस्टिंग सहेजें')}">♡</button>`}</div><div class="listing-body"><div class="listing-title-row"><h3>${esc(item.crop)}</h3>${item.verified ? `<span class="quality-tag">✓ ${word('Verified','सत्यापित')}</span>` : ''}</div><div class="listing-seller"><span class="seller-avatar">${esc(item.initials || initials(item.seller || 'Farmer'))}</span><span>${esc(item.seller || currentUser())}</span></div><div class="listing-location">⌖ ${esc(item.location || '')}${item.harvest ? ` · ${word('Harvest','कटाई')}: ${esc(item.harvest)}` : ''}</div><div class="listing-info"><div class="listing-price">${money(item.price)} <small>/ ${esc(item.unit || 'kg')}</small></div><div class="listing-qty"><b>${esc(item.qty)} ${esc(item.unit || 'kg')}</b><br/>${word('Available','उपलब्ध')}</div></div><div class="listing-actions">${actions}</div></div></article>`;
  }
  function marketplace() {
    let items = state.listings.slice();
    if (isFarmer()) items = items.filter(isMyListing);
    const appliedFilters = state.appliedMarketFilters;
    if (appliedFilters?.state) items = items.filter((item) => marketplaceArea(item.location).state === appliedFilters.state);
    if (appliedFilters?.district) items = items.filter((item) => marketplaceArea(item.location).district === appliedFilters.district);
    if (appliedFilters?.category && appliedFilters.category !== 'All produce') items = items.filter((item) => item.category === appliedFilters.category);
    if (appliedFilters?.query) items = items.filter((item) => `${item.crop} ${item.seller} ${item.location} ${item.quality}`.toLowerCase().includes(appliedFilters.query.toLowerCase()));
    const cats = ['All produce','Vegetables','Fruits','Grains'];
    return `<div class="welcome-row"><div><div class="eyebrow">${word(isFarmer() ? 'YOUR FARM STALL' : 'FROM OUR FARMERS','सीधे किसानों से')}</div><h1>${word(isFarmer() ? 'Your produce' : 'A fresher way to shop',isFarmer() ? 'आपकी उपज' : 'खरीदारी का ताज़ा तरीका')}</h1><p class="page-subtitle">${word(isFarmer() ? 'Manage your active listings and see how buyers see them.' : 'Good things grow when you know where they come from.',isFarmer() ? 'अपनी लिस्टिंग संभालें और देखें कि खरीदार उन्हें कैसे देखते हैं।' : 'जब आप जानें कि खाना कहाँ से आया है, तो सबका भला होता है।')}</p></div>${isFarmer() ? `<button class="button button-primary" data-action="add-listing">＋ ${word('Add produce','उपज जोड़ें')}</button>` : ''}</div>${marketplaceFilterToolbar()}<div class="category-row">${cats.map((cat) => `<button type="button" class="chip ${state.category === cat ? 'active' : ''}" data-category="${esc(cat)}">${word(cat,({ 'All produce':'सभी उपज','Vegetables':'सब्ज़ियाँ','Fruits':'फल','Grains':'अनाज' })[cat])}</button>`).join('')}</div>${items.length ? `<div class="listing-grid">${items.map(listingCard).join('')}</div>` : `<div class="panel empty-state"><span>🌾</span>${word('No produce matches that search yet. Try another crop or location.','इस खोज से मेल खाती उपज नहीं मिली। दूसरी उपज या जगह खोजें।')}</div>`}<p class="market-note" style="margin-top:17px">ⓘ ${word('Review the seller, price, and availability before trading.','Review the seller, price, and availability before trading.')}</p>`;
  }
  function marketPriceGroup(commodity) {
    const name = String(commodity || '');
    const groups = [
      ['Cereals', /\b(wheat|rice|paddy|dhan|maize|corn|jowar|sorghum|bajra|millet|ragi|barley|oat)\b/i],
      ['Pulses', /\b(gram|chana|arhar|tur|moong|mung|urad|lentil|masur|pea|pulse|cowpea|lobia|bean)\b/i],
      ['Oilseeds', /\b(mustard|rapeseed|groundnut|peanut|soybean|soya|sesame|til|sunflower|castor|linseed|safflower|niger|oilseed)\b/i],
      ['Fruits', /\b(apple|banana|mango|orange|grape|guava|papaya|pineapple|pomegranate|lemon|lime|coconut|watermelon|melon|pear|plum|litchi|jackfruit|ber)\b/i],
      ['Vegetables', /\b(potato|onion|tomato|brinjal|eggplant|cabbage|cauliflower|carrot|radish|okra|bhindi|chilli|chili|pepper|cucumber|pumpkin|gourd|garlic|ginger|spinach|vegetable|drumstick)\b/i],
      ['Spices', /\b(cumin|jeera|coriander|dhania|turmeric|haldi|cardamom|clove|fennel|saunf|fenugreek|methi|ajwain|spice)\b/i],
      ['Commercial crops', /\b(cotton|sugarcane|jute|tobacco|rubber|arecanut|betelnut|copra|coffee|tea|cocoa)\b/i],
    ];
    return groups.find(([, pattern]) => pattern.test(name))?.[0] || 'Other commodities';
  }
  const MARKET_PRICE_GROUPS = ['Cereals', 'Pulses', 'Oilseeds', 'Fruits', 'Vegetables', 'Spices', 'Commercial crops', 'Other commodities'];
  const MARKET_PRICE_CROPS = {
    Cereals: ['Wheat', 'Rice', 'Paddy', 'Maize', 'Jowar', 'Bajra', 'Ragi', 'Barley'],
    Pulses: ['Gram', 'Chana', 'Arhar', 'Tur', 'Moong', 'Urad', 'Lentil', 'Peas'],
    Oilseeds: ['Mustard', 'Groundnut', 'Soybean', 'Sesame', 'Sunflower', 'Castor'],
    Fruits: ['Apple', 'Banana', 'Mango', 'Orange', 'Grapes', 'Guava', 'Papaya', 'Pomegranate'],
    Vegetables: ['Potato', 'Onion', 'Tomato', 'Brinjal', 'Cabbage', 'Cauliflower', 'Carrot', 'Okra', 'Green Chilli'],
    Spices: ['Cumin', 'Coriander', 'Turmeric', 'Fenugreek', 'Fennel'],
    'Commercial crops': ['Cotton', 'Sugarcane', 'Jute', 'Tobacco'],
    'Other commodities': ['Other'],
  };
  function uniqueMarketPriceValues(records, key) {
    return [...new Set(records.map((record) => String(record[key] || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }
  function marketPriceRecordsMatching(filters, ignored = []) {
    return state.marketPriceRecords.filter((record) => {
      if (!ignored.includes('state') && filters.state && record.state !== filters.state) return false;
      if (!ignored.includes('district') && filters.district && record.district !== filters.district) return false;
      if (!ignored.includes('commodityGroup') && filters.commodityGroup && marketPriceGroup(record.commodity) !== filters.commodityGroup) return false;
      if (!ignored.includes('commodity') && filters.commodity && record.commodity !== filters.commodity) return false;
      return true;
    });
  }
  function marketPriceSelect(name, label, options, value, placeholder, disabled = false) {
    const optionMarkup = options.map((option) => `<option value="${esc(option)}" ${option === value ? 'selected' : ''}>${esc(option)}</option>`).join('');
    return `<div class="field"><label for="market-price-${esc(name)}">${esc(label)}</label><select id="market-price-${esc(name)}" name="${esc(name)}" ${disabled ? 'disabled' : ''}><option value="" ${value ? '' : 'selected'}>${esc(placeholder)}</option>${optionMarkup}</select></div>`;
  }
  function marketPriceFilterOptions(draft) {
    const states = [...new Set([...indiaLocations.map((entry) => entry.state), ...uniqueMarketPriceValues(state.marketPriceRecords, 'state')])].sort((a, b) => a.localeCompare(b));
    const stateOnly = marketPriceRecordsMatching(draft, ['district', 'commodityGroup', 'commodity']);
    const regionOnly = marketPriceRecordsMatching(draft, ['commodityGroup', 'commodity']);
    const groupOnly = marketPriceRecordsMatching(draft, ['commodity']);
    const directoryDistricts = indiaLocations.find((entry) => entry.state === draft.state)?.districts || [];
    const hasStateData = state.marketPriceLoaded && state.marketPriceLoadedState === draft.state && !state.marketPriceSetupRequired;
    const fallbackGroups = MARKET_PRICE_GROUPS;
    const fallbackCrops = draft.commodityGroup ? (MARKET_PRICE_CROPS[draft.commodityGroup] || []) : Object.values(MARKET_PRICE_CROPS).flat();
    return {
      states,
      districts: [...new Set([...directoryDistricts, ...uniqueMarketPriceValues(stateOnly, 'district')])].sort((a, b) => a.localeCompare(b)),
      groups: hasStateData ? [...new Set(groupOnly.map((record) => marketPriceGroup(record.commodity)))].sort((a, b) => a.localeCompare(b)) : fallbackGroups,
      commodities: hasStateData ? uniqueMarketPriceValues(regionOnly.filter((record) => !draft.commodityGroup || marketPriceGroup(record.commodity) === draft.commodityGroup), 'commodity') : fallbackCrops,
    };
  }
  function filteredMarketPrices() {
    const filters = state.marketPriceApplied;
    if (!filters) return [];
    return marketPriceRecordsMatching(filters).filter((record) => (!filters.fromDate || record.priceDate >= filters.fromDate) && (!filters.toDate || record.priceDate <= filters.toDate));
  }
  function marketPriceDateLabel(value) {
    if (!value) return 'Not reported';
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-IN');
  }
  function marketPriceAmount(value) {
    return value === null || value === undefined ? 'Not reported' : Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }
  async function loadMarketPrices(forceRefresh = false) {
    if (state.marketPriceLoading) return false;
    const requestedState = state.marketPriceDraft.state;
    if (!requestedState) {
      state.marketPriceError = 'Choose a state to load official market prices.';
      if (state.page === 'prices') render();
      return false;
    }
    if (!forceRefresh && state.marketPriceLoaded && state.marketPriceLoadedState === requestedState) return true;
    state.marketPriceLoading = true;
    state.marketPriceError = '';
    state.marketPriceSetupRequired = false;
    if (state.page === 'prices') render();
    try {
      const query = new URLSearchParams({ state: requestedState });
      if (forceRefresh) query.set('refresh', '1');
      const data = await api(`/market-prices?${query}`);
      if (state.marketPriceDraft.state !== requestedState) return false;
      if (Number(data.marketPriceApiVersion) !== 2) {
        state.marketPriceRecords = [];
        state.marketPriceLoaded = false;
        state.marketPriceLoadedState = '';
        state.marketPriceSetupRequired = false;
        state.marketPriceApiVersion = Number(data.marketPriceApiVersion) || 0;
        throw new Error('The running app server is out of date. Stop the existing Node.js server, start this project again with npm start, then reload the page.');
      }
      state.marketPriceRecords = Array.isArray(data.records) ? data.records : [];
      state.marketPriceApiVersion = Number(data.marketPriceApiVersion);
      state.marketPriceSourceRecordCount = Number(data.sourceRecordCount) || 0;
      state.marketPriceUnmappedRecordCount = Number(data.unmappedRecordCount) || 0;
      state.marketPriceFetchedAt = data.fetchedAt || '';
      state.marketPriceSourceUpdatedAt = data.sourceUpdatedAt || '';
      state.marketPriceLoaded = true;
      state.marketPriceLoadedState = requestedState;
      state.marketPriceSetupRequired = Boolean(data.setupRequired);
      state.marketPriceError = data.message || (state.marketPriceUnmappedRecordCount && !state.marketPriceRecords.length
        ? 'The official feed sent rows, but none contained usable price fields. Refresh the app server to load the latest feed mapping.'
        : '');
      return true;
    } catch (error) {
      if (state.marketPriceDraft.state === requestedState) state.marketPriceError = error.message;
      return false;
    } finally {
      state.marketPriceLoading = false;
      if (state.page === 'prices') render();
    }
  }
  function helpChatReply(question) {
    const raw = String(question || '');
    const text = raw.toLocaleLowerCase();
    const say = (english, hindi) => state.language === 'hi' || /[\u0900-\u097f]/.test(raw) ? hindi : english;
    const has = (...terms) => terms.some((term) => text.includes(term));

    if (/^(hello|hi|hey|नमस्ते|नमस्कार)[\s!?.]*$/u.test(text)) return say(
      'Hello! I’m Plant AI, your agriculture app assistant. Ask me about any feature in English or Hindi.',
      'नमस्ते! मैं Plant AI हूँ। ऐप की किसी भी सुविधा के बारे में हिंदी या अंग्रेज़ी में पूछें।',
    );
    if (has('gstin', 'udyam', 'industry registration', 'industry signup', 'industry sign up', 'industry document', 'authorized person', 'owner name', 'जीएसटी', 'उद्यम')) return say(
      'To register as an industry buyer, choose Industry buyer and enter the industry name, owner or authorized person, mobile number, email, GSTIN, State, and District. Upload the industry registration or Udyam document, then continue to mobile OTP verification. This demo stores the details but does not verify them against government records.',
      'उद्योग खरीदार के रूप में पंजीकरण के लिए Industry buyer चुनें और उद्योग का नाम, मालिक या अधिकृत व्यक्ति, मोबाइल नंबर, ईमेल, GSTIN, राज्य और ज़िला भरें। उद्योग पंजीकरण या उद्यम दस्तावेज़ अपलोड करके मोबाइल OTP सत्यापन जारी रखें। यह डेमो जानकारी सहेजता है, लेकिन सरकारी रिकॉर्ड से उसकी पुष्टि नहीं करता।',
    );
    if (has('otp', 'login', 'log in', 'sign up', 'register', 'password', 'account', 'लॉग इन', 'खाता', 'पंजीकरण', 'पासवर्ड', 'ओटीपी')) return say(
      'New accounts choose Farmer, Consumer, or Industry buyer. Farmers provide location, a government ID, and one farmer record (Farmer Registry ID, KCC, land record, or PM-KISAN); consumers provide location, a government ID, and occupation; industry buyers provide business and authorized-person details, contact information, GSTIN, location, and a registration or Udyam document. New accounts verify their phone with OTP; this demo does not check documents against government records. Existing users log in with phone and password without OTP. Use Set password for an older account that needs password setup.',
      'नया खाता बनाते समय किसान, ग्राहक या उद्योग खरीदार चुनें। किसान जगह, सरकारी पहचान-पत्र और एक किसान रिकॉर्ड (Farmer Registry ID, KCC, भूमि रिकॉर्ड या PM-KISAN) देते हैं; ग्राहक जगह, सरकारी पहचान-पत्र और व्यवसाय देते हैं; उद्योग खरीदार कारोबार और अधिकृत व्यक्ति का विवरण, संपर्क जानकारी, GSTIN, जगह और पंजीकरण या उद्यम दस्तावेज़ देते हैं। नए खाते में OTP से फ़ोन सत्यापित होता है; यह डेमो दस्तावेज़ों की सरकारी रिकॉर्ड से जाँच नहीं करता। पुराने उपयोगकर्ता बिना OTP के फ़ोन और पासवर्ड से लॉग इन करें। पुराने खाते के लिए पासवर्ड सेट करें विकल्प उपयोग करें।',
    );
    if (has('industry', 'bulk', 'requirement', 'purchase requirement', 'sourcing', 'supplier', 'matching growers', '\u0925\u094b\u0915', '\u0906\u0935\u0936\u094d\u092f\u0915\u0924\u093e')) return say(
      'Industry buyers can add a purchase requirement from the dashboard. Enter the crop, quantity, unit, needed-by date, and quality or delivery details, then save it. The request is recorded in the app; automatic supplier matching and contracts are not connected yet.',
      'उद्योग खरीदार डैशबोर्ड से खरीद की ज़रूरत जोड़ सकते हैं। उपज, मात्रा, इकाई, ज़रूरत की तारीख और गुणवत्ता या डिलीवरी का विवरण भरकर सहेजें। अनुरोध ऐप में दर्ज होता है; अपने-आप सप्लायर मिलान और अनुबंध अभी उपलब्ध नहीं हैं।',
    );
    if (has('place an order', 'send order', 'order request', 'how do i buy', 'how to buy', 'buy produce', 'purchase', 'quantity', 'delivery preference', 'buy', 'ऑर्डर अनुरोध', 'खरीद', 'मात्रा', 'डिलीवरी का विकल्प')) return say(
      isFarmer()
        ? 'Buy is for consumer buyers. To receive requests, publish your produce listing and check Orders & receipts. Open Messages to discuss quantity, quality, and delivery with a buyer.'
        : 'In Marketplace, search by crop, farmer, or location and narrow results by State, District, and category. Open a listing and choose Buy. Enter a quantity no greater than the amount available, choose a delivery preference, add an optional message, and send the order request. The request is saved in Orders & receipts. Payment is not processed in this app; coordinate details through Messages.',
      isFarmer()
        ? 'खरीद का विकल्प ग्राहक खरीदारों के लिए है। अनुरोध पाने के लिए अपनी उपज सूची प्रकाशित करें और ऑर्डर और रसीदें देखें। खरीदार से मात्रा, गुणवत्ता और डिलीवरी पर बात करने के लिए संदेश खोलें।'
        : 'बाज़ार में उपज, किसान या जगह खोजें और राज्य, ज़िला व श्रेणी से नतीजे सीमित करें। सूची खोलकर खरीदें चुनें। उपलब्ध मात्रा से ज़्यादा मात्रा न भरें, डिलीवरी का विकल्प चुनें, चाहें तो संदेश लिखें और ऑर्डर अनुरोध भेजें। अनुरोध ऑर्डर और रसीदें में सहेजा जाता है। ऐप भुगतान नहीं करता; बाकी जानकारी संदेशों में तय करें।',
    );
    if (has('add produce', 'list produce', 'my produce', 'sell', 'listing', 'publish', 'उपज जोड़', 'मेरी उपज', 'बेच', 'लिस्टिंग', 'फसल की सूची')) return say(
      'Farmers can select Add produce from the dashboard or My produce. Enter the crop, category, quantity, unit, price, harvest date, quality, location, and optional description or photo, then publish. In My produce, use Edit or Remove to manage a listing.',
      'किसान डैशबोर्ड या मेरी उपज से उपज जोड़ें चुन सकते हैं। उपज, श्रेणी, मात्रा, इकाई, भाव, कटाई की तारीख, गुणवत्ता, जगह और चाहें तो विवरण या तस्वीर भरकर प्रकाशित करें। मेरी उपज में सूची बदलने के लिए संपादित करें या हटाएँ चुनें।',
    );
    if (has('market price', 'price report', 'agmarknet', 'mandi', 'regional price', 'wholesale price', '\u092c\u093e\u091c\u093c\u093e\u0930 \u092d\u093e\u0935', '\u092e\u0902\u0921\u0940 \u092d\u093e\u0935', '\u0915\u094d\u0937\u0947\u0924\u094d\u0930\u0940\u092f \u092d\u093e\u0935', '\u0925\u094b\u0915 \u092d\u093e\u0935')) return say(
      'Regional market prices show daily wholesale reports. Choose State, District, Commodity group, Crop, and an optional date range, then press Search. Reset clears the filters. Market, variety, and grade appear in the results table. These are daily reports, not live trading prices; use Retry if the feed is unavailable.',
      'क्षेत्रीय बाज़ार भाव में रोज़ाना के थोक भाव दिखते हैं। राज्य, ज़िला, उपज समूह, उपज और चाहें तो तारीख की सीमा चुनकर खोजें दबाएँ। रीसेट से फ़िल्टर साफ़ होते हैं। मंडी, किस्म और ग्रेड नतीजों की तालिका में दिखते हैं। ये रोज़ाना की रिपोर्ट हैं, लाइव भाव नहीं; डेटा न मिले तो फिर कोशिश करें।',
    );
    if (has('marketplace', 'browse', 'search', 'find produce', 'buy produce', 'sort', 'price low', 'low to high', 'high to low', 'category', 'filter', 'खोज', 'खरीद', 'बाज़ार', 'श्रेणी', 'फ़िल्टर', 'फिल्टर', 'छाँट', 'कम से ज़्यादा', 'ज़्यादा से कम')) return say(
      'In Marketplace, search by crop, farmer, or location. Narrow results with State, District, and category, then sort by recommended or price. Open a listing to review its seller, location, available quantity, and price. Choose Message to ask the seller or Buy to send an order request.',
      'बाज़ार में उपज, किसान या जगह से खोजें। राज्य, ज़िला और श्रेणी चुनकर नतीजे सीमित करें और सुझाव या भाव के अनुसार क्रम चुनें। सूची खोलकर विक्रेता, जगह, उपलब्ध मात्रा और भाव देखें। विक्रेता से पूछने के लिए संदेश या ऑर्डर अनुरोध भेजने के लिए खरीदें चुनें।',
    );
    if (has('notification', 'alert', 'unread', 'सूचना', 'सूचनाएँ', 'सूचनाएं', 'नोटिफिकेशन', 'अलर्ट')) return say(
      'Open Notifications from the bell icon or the workspace menu. It shows app updates such as new orders, completed orders, and payment status changes. Open an item to read it; use the read controls to clear unread indicators.',
      'घंटी के निशान या कार्यस्थल मेनू से सूचनाएँ खोलें। यहाँ नए ऑर्डर, पूरे हुए ऑर्डर और भुगतान स्थिति में बदलाव जैसे अपडेट दिखते हैं। सूचना पढ़ने के लिए उसे खोलें; अपठित संकेत हटाने के लिए पढ़ने वाले विकल्प चुनें।',
    );
    if (has('message', 'conversation', 'chat with seller', 'contact farmer', 'संदेश', 'बातचीत', 'किसान से बात', 'विक्रेता से बात')) return say(
      'Choose Message on a produce listing to start a conversation with its farmer. You can return to it from Messages, select the conversation, and send a reply. Order questions and delivery details can be discussed there.',
      'किसान से बातचीत शुरू करने के लिए उपज की सूची में संदेश चुनें। बाद में संदेश पृष्ठ खोलें, बातचीत चुनें और जवाब भेजें। ऑर्डर या डिलीवरी के बारे में वहीं बात कर सकते हैं।',
    );
    if (has('order', 'receipt', 'payment', 'pay', 'paid', 'money', 'delivery', 'invoice', 'ऑर्डर', 'रसीद', 'भुगतान', 'पैसा', 'पैसे', 'डिलीवरी')) return say(
      isFarmer()
        ? 'Orders & receipts keeps your trade records. Open an order to view its receipt; mark it In transit and then Delivered as it progresses. You can record a payment manually. The app does not process payments.'
        : 'Orders & receipts keeps your trade records. Open an order to view its receipt. After delivery, confirm completion when the produce arrives. You can download the records as a CSV. The app does not process payments.',
      isFarmer()
        ? 'ऑर्डर और रसीदें आपके व्यापार का रिकॉर्ड रखता है। रसीद देखने के लिए ऑर्डर खोलें; आगे बढ़ने पर उसे रास्ते में और फिर डिलीवर हुआ चिह्नित करें। भुगतान मिलने पर उसे मैन्युअल रूप से दर्ज कर सकते हैं। ऐप भुगतान नहीं करता।'
        : 'ऑर्डर और रसीदें आपके व्यापार का रिकॉर्ड रखता है। रसीद देखने के लिए ऑर्डर खोलें। उपज मिलने के बाद ऑर्डर पूरा होने की पुष्टि करें। रिकॉर्ड CSV में डाउनलोड कर सकते हैं। ऐप भुगतान नहीं करता।',
    );
    if (has('location', 'state', 'district', 'language', 'place', 'लोकेशन', 'जगह', 'राज्य', 'ज़िला', 'जिला', 'भाषा')) return say(
      'Use the location button in the top bar or edit your profile to choose a State and District. This helps the app show nearby produce and regional information. Change the app language in My profile; English and Hindi are supported.',
      'राज्य और ज़िला चुनने के लिए ऊपर जगह वाले बटन का उपयोग करें या अपनी प्रोफ़ाइल बदलें। इससे आसपास की उपज और क्षेत्र की जानकारी दिखाने में मदद मिलती है। मेरी प्रोफ़ाइल में ऐप की भाषा बदलें; अंग्रेज़ी और हिंदी उपलब्ध हैं।',
    );
    if (has('profile', 'name', 'about me', 'details', 'प्रोफ़ाइल', 'नाम', 'विवरण')) return say(
      'Open My profile to update your name, State, District, About details, language, and notification preference. Your registered phone number is shown there but cannot be edited from this page.',
      'नाम, राज्य, ज़िला, अपने बारे में जानकारी, भाषा और सूचना की पसंद बदलने के लिए मेरी प्रोफ़ाइल खोलें। पंजीकृत फ़ोन नंबर वहाँ दिखता है, लेकिन इस पृष्ठ से बदला नहीं जा सकता।',
    );
    if (has('dashboard', 'overview', 'home', 'active listing', 'recent order', 'local price watch', 'डैशबोर्ड', 'मुख्य पृष्ठ', 'शुरुआत', 'सक्रिय सूची', 'हाल के ऑर्डर')) return say(
      isFarmer()
        ? 'Dashboard summarizes your active listings, orders, order value, and listing ratings. Select Active listings to open My produce, and use Recent orders or Local price watch to go to those sections.'
        : isIndustry()
          ? 'Dashboard summarizes nearby marketplace activity, your orders, conversations, and purchase requirements. Use Add requirement to tell growers what your business needs.'
          : 'Dashboard summarizes nearby produce, your orders, order value, and conversations. Use Browse produce to open Marketplace, and Recent orders to review your purchases.',
      isFarmer()
        ? 'डैशबोर्ड आपकी सक्रिय उपज-सूचियाँ, ऑर्डर, ऑर्डर राशि और सूची की रेटिंग का सार दिखाता है। मेरी उपज खोलने के लिए सक्रिय सूचियाँ चुनें; ऑर्डर या भाव देखने के लिए हाल के ऑर्डर या स्थानीय बाज़ार भाव चुनें।'
        : isIndustry()
          ? 'डैशबोर्ड आसपास के बाज़ार, आपके ऑर्डर, बातचीत और खरीद की ज़रूरतों का सार दिखाता है। किसानों को अपनी ज़रूरत बताने के लिए ज़रूरत जोड़ें चुनें।'
          : 'डैशबोर्ड आसपास की उपज, आपके ऑर्डर, ऑर्डर राशि और बातचीत का सार दिखाता है। बाज़ार खोलने के लिए उपज देखें और खरीद देखने के लिए हाल के ऑर्डर चुनें।',
    );
    if (has('favorite', 'save listing', 'verified', 'rating', 'review', 'पसंदीदा', 'सत्यापित', 'रेटिंग', 'समीक्षा')) return say(
      'A Verified badge indicates the listing or account has a verification status in the app. The heart toggles the listing’s saved icon; this demo does not provide a separate saved-list page. Ratings are shown when available.',
      'सत्यापित का निशान ऐप में सूची या खाते की सत्यापन स्थिति बताता है। दिल वाला बटन सूची को पसंदीदा दिखाता या हटाता है; इस डेमो में पसंदीदा सूचियों का अलग पृष्ठ नहीं है। रेटिंग उपलब्ध होने पर दिखाई जाती है।',
    );
    if (has('plant ai', 'what can you do', 'what can you answer', 'chatbot', 'chat bot', 'assistant', 'कृषि सहायक', 'Plant AI', 'क्या कर सकते', 'क्या पूछ सकते')) return say(
      'I’m Plant AI. Ask me how to use a feature or complete a task. I can guide you through your dashboard, buying or listing produce, industry requirements, orders and payments, messages, notifications, profile settings, and market prices.',
      'मैं Plant AI हूँ। किसी सुविधा या काम के बारे में पूछें। मैं डैशबोर्ड, उपज खरीदने या सूचीबद्ध करने, उद्योग की ज़रूरतें, ऑर्डर और भुगतान, संदेश, सूचनाएँ, प्रोफ़ाइल और बाज़ार भाव समझा सकता हूँ।',
    );
    return say(
      'I couldn’t match that question to an app feature yet. Try asking about your dashboard, finding or buying produce, listing produce, industry requirements, orders or payments, messages, notifications, profile, or market prices. You can also tap a suggested topic.',
      'मैं इस सवाल को ऐप की किसी सुविधा से नहीं जोड़ पाया। डैशबोर्ड, उपज खोजने या खरीदने, उपज सूची, उद्योग की ज़रूरत, ऑर्डर या भुगतान, संदेश, सूचनाएँ, प्रोफ़ाइल या बाज़ार भाव के बारे में पूछें। नीचे सुझाया गया विषय भी चुन सकते हैं।',
    );
  }
  function helpChatTranscript() {
    if (!state.helpChatMessages.length) return `<div class="help-chat-bubble">${word('Hello! I’m Plant AI, your agriculture app assistant. Ask in English or Hindi about any app feature.','नमस्ते! मैं Plant AI हूँ। हिंदी या अंग्रेज़ी में पूछें; मैं ऐप का उपयोग समझाऊँगा।')}</div>`;
    return state.helpChatMessages.map((message) => `<div class="help-chat-bubble ${message.from === 'user' ? 'user' : 'assistant'}">${esc(message.text)}</div>`).join('');
  }
  function sendHelpChat(message) {
    const text = String(message || '').trim();
    if (!text) return;
    state.helpChatMessages.push({ from: 'user', text }, { from: 'assistant', text: helpChatReply(text) });
    state.helpChatMessages = state.helpChatMessages.slice(-40);
    const transcript = document.getElementById('help-chat-transcript');
    if (transcript) {
      transcript.innerHTML = helpChatTranscript();
      transcript.scrollTop = transcript.scrollHeight;
    }
    document.querySelector('.help-chat-suggestions')?.remove();
    const input = document.getElementById('help-chat-input');
    if (input) { input.value = ''; input.focus(); }
  }
  function openHelpChat() {
    const topics = [
      ['Dashboard', 'How do I use the dashboard?', 'डैशबोर्ड'],
      ['Find or buy produce', 'How do I find and buy produce?', 'उपज खोजें या खरीदें'],
      ['List produce', 'How do I list my produce?', 'अपनी उपज सूचीबद्ध करें'],
      ['Industry requirements', 'How do industry buyers post a requirement?', 'उद्योग की खरीद ज़रूरत'],
      ['Orders and payments', 'How do orders, receipts, and payments work?', 'ऑर्डर और भुगतान'],
      ['Messages', 'How do I use Messages?', 'संदेश'],
      ['Notifications', 'Where do I find Notifications?', 'सूचनाएँ'],
      ['Market prices', 'How do I use Regional market prices?', 'क्षेत्रीय बाज़ार भाव'],
      ['Profile and language', 'How do I change my profile, location, or language?', 'प्रोफ़ाइल, जगह और भाषा'],
    ];
    const suggestions = state.helpChatMessages.length ? '' : `<div class="help-chat-suggestions" aria-label="${word('Suggested topics','सुझाए गए विषय')}">${topics.map(([label, prompt, hindi]) => `<button type="button" data-help-prompt="${esc(prompt)}">${word(label, hindi)}</button>`).join('')}</div>`;
    const markup = `<div class="help-chat-header"><div><div class="eyebrow">${word('PLANT AI','Plant AI')}</div><h2 id="modal-title">${word('How can I help?','मैं आपकी क्या मदद करूँ?')}</h2><p>${word('Ask Plant AI about any app feature. English and Hindi are supported.','ऐप की किसी भी सुविधा के बारे में पूछें। अंग्रेज़ी और हिंदी उपलब्ध हैं।')}</p></div><button class="close-btn" type="button" data-action="close-modal" aria-label="${word('Close','बंद करें')}">×</button></div><div class="help-chat-main"><div id="help-chat-transcript" class="help-chat-transcript" role="log" aria-live="polite">${helpChatTranscript()}</div>${suggestions}<form id="help-chat-form" class="help-chat-form"><input id="help-chat-input" name="message" maxlength="300" autocomplete="off" placeholder="${word('Ask how to use a feature...','किसी सुविधा के उपयोग के बारे में पूछें...')}" aria-label="${word('Ask Plant AI','Plant AI से पूछें')}" required /><button type="submit">${word('Send','भेजें')}</button></form><div class="help-chat-note">${word('Plant AI · Answers follow your selected language.','Plant AI · जवाब आपकी चुनी हुई भाषा में मिलेंगे।')}</div></div>`;
    openModal(markup, true);
    document.querySelector('.modal')?.classList.add('help-chat-modal');
    document.getElementById('help-chat-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      sendHelpChat(new FormData(event.currentTarget).get('message'));
    });
    document.querySelectorAll('[data-help-prompt]').forEach((button) => button.addEventListener('click', () => sendHelpChat(button.dataset.helpPrompt)));
    document.getElementById('help-chat-input')?.focus();
  }
  function marketPriceChatReply(question) {
    const text = String(question || '').toLowerCase();
    if (text.includes('modal')) return 'Modal price is the price at which the largest quantity was traded in a market on the reported date.';
    if (text.includes('date') || text.includes('today') || text.includes('current') || text.includes('live')) return 'These are the latest daily prices published by AGMARKNET. They refresh when market reports are published, so they are not tick-by-tick quotes.';
    if (text.includes('unit') || text.includes('quintal')) return 'The source reports wholesale prices in rupees per quintal. Check the market and price date before comparing rates.';
    if (text.includes('filter') || text.includes('state') || text.includes('district') || text.includes('crop')) return 'Choose a state, district, crop, or market and press Search. Use Reset to clear all filters.';
    return 'I can help with the filters, price dates, price units, and modal prices shown in this table.';
  }
  function sendMarketPriceChat(message) {
    const text = String(message || '').trim();
    if (!text) return;
    state.marketPriceChatMessages.push({ from: 'user', text }, { from: 'assistant', text: marketPriceChatReply(text) });
    state.marketPriceChatOpen = true;
    render();
    document.getElementById('market-price-chat-input')?.focus();
  }
  function marketPriceChat() {
    if (!state.marketPriceChatOpen) return `<button class="market-price-chat-launch" type="button" data-action="toggle-market-price-chat" aria-label="Open price help chat"><span aria-hidden="true">Help</span><span>Price help</span></button>`;
    const messages = state.marketPriceChatMessages.map((message) => `<div class="market-price-chat-message ${message.from === 'user' ? 'user' : 'assistant'}">${esc(message.text)}</div>`).join('');
    return `<section class="market-price-chat-panel" aria-label="Market price help chat"><div class="market-price-chat-head"><div><b>Market price help</b><span>Ask about filters and prices</span></div><button type="button" data-action="toggle-market-price-chat" aria-label="Close chat">Close</button></div><div class="market-price-chat-messages">${messages || `<div class="market-price-chat-message assistant">Hello! I can explain the price filters, modal price, units, and report dates.</div>`}</div><div class="market-price-chat-prompts"><button type="button" data-price-chat-prompt="What is modal price?">Modal price</button><button type="button" data-price-chat-prompt="How current are these prices?">Price updates</button></div><form id="market-price-chat-form"><input id="market-price-chat-input" name="message" maxlength="300" placeholder="Ask about market prices" aria-label="Ask about market prices" required /><button type="submit" aria-label="Send message">Send</button></form></section>`;
  }
  function pricesPage() {
    const draft = state.marketPriceDraft;
    const options = marketPriceFilterOptions(draft);
    const hasStateData = state.marketPriceLoaded && state.marketPriceLoadedState === draft.state;
    const filters = `<form id="market-price-filter-form" class="market-price-filter-panel"><div class="market-price-filter-grid">${marketPriceSelect('state', 'State / UT', options.states, draft.state, 'Choose a state')}${marketPriceSelect('district', 'District', options.districts, draft.district, 'All districts', !draft.state)}${marketPriceSelect('commodityGroup', 'Commodity group', options.groups, draft.commodityGroup, 'All groups', !draft.state)}${marketPriceSelect('commodity', 'Commodity / crop', options.commodities, draft.commodity, 'All crops', !draft.state || !options.commodities.length)}<div class="field"><label for="market-price-fromDate">From date</label><input id="market-price-fromDate" type="date" name="fromDate" value="${esc(draft.fromDate)}" /></div><div class="field"><label for="market-price-toDate">To date</label><input id="market-price-toDate" type="date" name="toDate" value="${esc(draft.toDate)}" /></div></div><div class="market-price-filter-actions"><span>Choose your filters, then press Search to apply them to the daily price reports.</span><div><button class="button button-outline" type="button" data-action="reset-market-price-filters">Reset</button><button class="button button-primary" type="submit" ${state.marketPriceLoading || !draft.state ? 'disabled' : ''}>${state.marketPriceLoading ? 'Loading...' : 'Search'}</button></div></div></form>`;
    const matching = filteredMarketPrices();
    const pageSize = state.marketPricePageSize;
    const pageCount = Math.max(1, Math.ceil(matching.length / pageSize));
    const page = Math.min(state.marketPricePage, pageCount);
    const visibleRows = matching.slice((page - 1) * pageSize, page * pageSize);
    const body = visibleRows.map((record) => `<tr><td>${esc(record.state)}</td><td>${esc(record.district)}</td><td>${esc(record.market)}</td><td>${esc(marketPriceGroup(record.commodity))}</td><td>${esc(record.commodity)}</td><td>${esc(record.variety || 'Not reported')}</td><td>${esc(record.grade || 'Not reported')}</td><td>${marketPriceAmount(record.minPrice)}</td><td>${marketPriceAmount(record.maxPrice)}</td><td><b>${marketPriceAmount(record.modalPrice)}</b></td><td>${esc(record.priceUnit || 'Rs./Quintal')}</td><td>${marketPriceDateLabel(record.priceDate)}</td></tr>`).join('');
    const latestDate = state.marketPriceRecords[0]?.priceDate || '';
    const sourceDate = marketPriceDateLabel(state.marketPriceSourceUpdatedAt || latestDate);
    const error = state.marketPriceError ? `<div class="market-price-status ${state.marketPriceSetupRequired ? '' : 'error'}" role="status">${esc(state.marketPriceError)} ${state.marketPriceSetupRequired ? '<a class="text-link" href="https://www.data.gov.in/" target="_blank" rel="noopener noreferrer">Get an API key</a>' : '<button class="text-link" data-action="retry-market-prices">Retry</button>'}</div>` : '';
    const loading = state.marketPriceLoading ? `<div class="market-price-status">Loading the latest daily market prices...</div>` : '';
    let results;
    if (state.marketPriceLoading) results = `<div class="empty-state">Loading official prices for ${esc(draft.state)}...</div>`;
    else if (state.marketPriceSetupRequired) results = `<div class="empty-state">Official prices are not loaded yet. Add your data.gov.in API key, restart the server, then choose Refresh prices.</div>`;
    else if (state.marketPriceError && !state.marketPriceSetupRequired) results = '';
    else if (hasStateData && !state.marketPriceRecords.length) results = `<div class="empty-state">The official feed returned no price rows for ${esc(draft.state)}${state.marketPriceSourceRecordCount ? ` (${state.marketPriceSourceRecordCount} source rows had unusable price fields)` : ''}. Check the feed status above or try Refresh prices later.</div>`;
    else if (!hasStateData) results = `<div class="empty-state">Choose your filters and press Search to load the selected state's official prices.</div>`;
    else if (!state.marketPriceApplied) results = `<div class="empty-state">Choose your region or crop filters and press Search to view prices.</div>`;
    else if (!matching.length) results = `<div class="empty-state">No market prices match these filters. Try another region or date range.</div>`;
    else results = `<div class="market-price-table-wrap"><table class="market-price-table"><thead><tr><th>State / UT</th><th>District</th><th>Market</th><th>Commodity group</th><th>Commodity</th><th>Variety</th><th>Grade</th><th>Min price (INR)</th><th>Max price (INR)</th><th>Modal price (INR)</th><th>Price unit</th><th>Price date</th></tr></thead><tbody>${body}</tbody></table></div><div class="market-price-pagination"><label>Rows per page <select id="market-price-page-size"><option value="10" ${pageSize === 10 ? 'selected' : ''}>10</option><option value="25" ${pageSize === 25 ? 'selected' : ''}>25</option><option value="50" ${pageSize === 50 ? 'selected' : ''}>50</option></select></label><span>Showing ${(page - 1) * pageSize + 1} to ${Math.min(page * pageSize, matching.length)} of ${matching.length}</span><div class="market-price-page-buttons"><button type="button" data-price-page="${Math.max(1, page - 1)}" ${page <= 1 ? 'disabled' : ''} aria-label="Previous page">Previous</button><span>${page} / ${pageCount}</span><button type="button" data-price-page="${Math.min(pageCount, page + 1)}" ${page >= pageCount ? 'disabled' : ''} aria-label="Next page">Next</button></div></div>`;
    const fetchedLabel = state.marketPriceFetchedAt ? new Date(state.marketPriceFetchedAt).toLocaleString('en-IN') : '';
    const countLabel = state.marketPriceSetupRequired ? 'API key required' : state.marketPriceError ? 'Feed unavailable' : state.marketPriceApplied ? `${matching.length} records` : '';
    return `<div class="welcome-row"><div><div class="eyebrow">OFFICIAL MARKET INFORMATION</div><h1>Regional market prices</h1><p class="page-subtitle">Compare daily reported wholesale prices by state, crop, and market.</p></div><button type="button" class="button button-outline" data-action="retry-market-prices" ${state.marketPriceLoading ? 'disabled' : ''}>Refresh prices</button></div>${filters}<section class="panel market-price-results"><div class="panel-head"><div><h2>Daily wholesale prices</h2><div class="panel-kicker">Source: <a href="https://data.gov.in/resource/current-daily-price-various-commodities-various-markets-mandi" target="_blank" rel="noopener noreferrer">AGMARKNET / data.gov.in</a>${state.marketPriceLoaded ? ` | Latest report date: ${esc(sourceDate)}` : ''}</div></div><span class="market-price-count">${countLabel}</span></div>${error}${loading}${results}${fetchedLabel ? `<div class="market-price-footnote">Data retrieved: ${esc(fetchedLabel)} | The source publishes daily reports; publication times can vary by market.</div>` : ''}</section>${marketPriceChat()}`;
  }
  function statusClass(status) { return status === 'Delivered' || status === 'Completed' ? 'complete' : status === 'In transit' ? 'transit' : 'pending'; }
  function ordersPage() {
    const orders = state.orders || [];
    const completed = orders.filter((order) => order.status === 'Delivered' || order.status === 'Completed').length;
    const open = orders.length - completed;
    const cards = orders.map((order) => {
      const nextStatus = isFarmer()
        ? order.status === 'Payment pending' ? 'In transit' : order.status === 'In transit' ? 'Delivered' : ''
        : order.status === 'Delivered' ? 'Completed' : '';
      const statusAction = nextStatus
        ? `<button type="button" class="button button-light button-sm" data-action="set-order-status" data-id="${esc(order.id)}" data-status="${nextStatus}">${nextStatus === 'In transit' ? word('Mark in transit','रास्ते में भेजें') : nextStatus === 'Delivered' ? word('Mark delivered','डिलीवर चिह्नित करें') : word('Confirm complete','पूरा होने की पुष्टि करें')}</button>`
        : '';
      const paymentAction = isFarmer() && order.paymentStatus !== 'paid'
        ? `<button type="button" class="button button-outline button-sm" data-action="record-payment" data-id="${esc(order.id)}">${word('Record payment received','भुगतान मिलने का रिकॉर्ड करें')}</button>`
        : '';
      const paymentLabel = order.paymentStatus === 'paid'
        ? word('Payment recorded manually','भुगतान मैन्युअल रूप से दर्ज')
        : word('Not connected','जुड़ा नहीं');
      return `<article class="order-card"><div class="order-product"><span class="produce-thumb">${esc(order.icon)}</span><div><div class="order-name">${esc(order.crop)} · ${esc(order.qty)} ${esc(order.unit)}</div><div class="order-id">${esc(order.id)} · ${esc(order.date)}</div></div></div><div class="order-detail">${word(isFarmer() ? 'Buyer' : 'Farmer',isFarmer() ? 'खरीदार' : 'किसान')}: ${esc(order.other)}<br/>${word('Total','कुल')}: <b>${money(order.total)}</b> · ${word('Payment','भुगतान')}: ${paymentLabel}</div><div class="order-actions"><span class="status ${statusClass(order.status)}">${esc(order.status)}</span><button type="button" class="button button-outline button-sm" data-action="receipt" data-id="${esc(order.id)}">${word('Receipt','रसीद')}</button>${statusAction}${paymentAction}</div></article>`;
    }).join('');
    return `<div class="welcome-row"><div><div class="eyebrow">${word('YOUR TRANSACTION RECORDS','आपके लेन-देन का रिकॉर्ड')}</div><h1>${word('Orders & receipts','ऑर्डर और रसीदें')}</h1><p class="page-subtitle">${word('Keep track of orders, delivery, and recorded payments.','ऑर्डर, डिलीवरी और दर्ज भुगतानों का हाल देखें।')}</p></div><button class="button button-outline" data-action="export-receipts">↓ &nbsp;${word('Download records','रिकॉर्ड डाउनलोड करें')}</button></div><div class="grid grid-stats">${statCard(word('All orders','कुल ऑर्डर'),orders.length,'Since you joined','▤')}${statCard(word('In progress','जारी ऑर्डर'),open,'Keep an eye on delivery','⌖')}${statCard(word('Completed','पूरे हुए'),completed,'Delivery confirmed','✓')}${statCard(word('Payments','भुगतान'),orders.filter((order)=>order.paymentStatus==='paid').length,word('Recorded manually','मैन्युअल रूप से दर्ज'),'₹')}</div><div class="panel"><div class="panel-head"><div><h2>${word('Recent transactions','हाल के लेन-देन')}</h2><div class="panel-kicker">${word('A clear record for every trade','हर सौदे का साफ रिकॉर्ड')}</div></div><span class="market-badge">${word('SAVED RECORDS','सहेजे गए रिकॉर्ड')}</span></div><div class="order-list">${cards || `<div class="empty-state"><span>🧺</span>${word('Your orders will appear here.','आपके ऑर्डर यहाँ दिखेंगे।')}</div>`}</div><p class="market-note" style="margin-top:13px">ⓘ ${word('Payments are not processed by this app. “Record payment received” saves a manual acknowledgment only.','इस ऐप से भुगतान नहीं होता। “भुगतान मिलने का रिकॉर्ड करें” केवल मैन्युअल पुष्टि सहेजता है।')}</p></div>`;
  }  function messagesPage() {
    const active = state.inquiries.find((m) => m.id === state.activeInquiry) || state.inquiries[0];
    return `<div class="welcome-row"><div><div class="eyebrow">${word('DIRECT CONNECTIONS','सीधा संपर्क')}</div><h1>${word('Messages','संदेश')}</h1><p class="page-subtitle">${word('Talk directly, agree clearly, trade confidently.','सीधे बात करें, साफ़ तय करें, भरोसे से व्यापार करें।')}</p></div></div><section class="panel message-layout"><div class="message-list">${state.inquiries.map((m)=>`<div class="message-person ${m.id===active?.id?'active':''}" data-inquiry="${m.id}"><span class="person-circle">${esc(m.initials)}</span><div class="message-preview"><b>${esc(m.name)}</b><span>${esc(m.preview)}</span></div></div>`).join('') || `<div class="empty-state">${word('No messages yet.','अभी कोई संदेश नहीं।')}</div>`}</div><div class="chat-pane">${active ? `<div class="chat-header"><span class="person-circle">${esc(active.initials)}</span><div class="message-preview"><b>${esc(active.name)}</b><span>✓ ${word('Marketplace member','समुदाय का सदस्य')}</span></div><button class="button button-outline button-sm" data-action="contact-note">${word('Trade details','सौदे का विवरण')}</button></div><div class="chat-messages" id="chat-messages">${active.messages.map((m)=>`<div class="bubble ${m.mine?'mine':''}">${esc(m.text)}<span class="bubble-time">${esc(m.time)}</span></div>`).join('')}</div><form class="chat-compose" id="message-form"><input name="message" placeholder="${word('Write a message...','संदेश लिखें...')}" autocomplete="off" required/><button class="button button-primary button-sm" type="submit">➤</button></form>` : `<div class="empty-state">${word('Choose a conversation to get started.','शुरू करने के लिए बातचीत चुनें।')}</div>`}</div></section><p class="market-note" style="margin-top:12px">ⓘ ${word('Messages are stored on the app server for your account. Do not share payment details in chat.','संदेश आपके खाते के लिए ऐप सर्वर पर सहेजे जाते हैं। चैट में भुगतान की जानकारी न भेजें।')}</p>`;
  }
  function notificationText(item) {
    const actor = esc(item.actorName || word('A marketplace member','बाज़ार का सदस्य'));
    const crop = esc(item.crop || word('produce','उपज'));
    const quantity = `${esc(item.quantity ?? '')} ${esc(item.unit || '')}`.trim();
    switch (item.kind) {
      case 'order_placed': return { title: word('Order placed','ऑर्डर भेजा गया'), body: word(`Your order for ${quantity} of ${crop} was sent to ${actor}.`,`आपका ${crop} का ${quantity} ऑर्डर ${actor} को भेजा गया।`), icon: '🧺' };
      case 'order_received': return { title: word('New order received','नया ऑर्डर मिला'), body: word(`${actor} ordered ${quantity} of ${crop}.`,` ${actor} ने ${crop} का ${quantity} ऑर्डर किया।`), icon: '🧺' };
      case 'order_in_transit': return { title: word('Order is on the way','ऑर्डर भेज दिया गया'), body: word(`${actor} marked your ${crop} order as in transit.`,` ${actor} ने आपका ${crop} ऑर्डर रास्ते में बताया है।`), icon: '🚚' };
      case 'order_delivered': return { title: word('Order marked delivered','ऑर्डर डिलीवर बताया गया'), body: word(`${actor} marked your ${crop} order as delivered. Confirm completion after you receive it.`,` ${actor} ने आपका ${crop} ऑर्डर डिलीवर बताया है। मिलने पर पूरा होने की पुष्टि करें।`), icon: '📦' };
      case 'order_completed': return { title: word('Order completed','ऑर्डर पूरा हुआ'), body: word(`${actor} confirmed the ${crop} order is complete.`,` ${actor} ने ${crop} का ऑर्डर पूरा होने की पुष्टि की।`), icon: '✓' };
      case 'payment_recorded': return { title: word('Payment update','भुगतान अपडेट'), body: word(`${actor} recorded ${money(item.amount || 0)} as received for ${crop}. This is a manual record; no online payment was processed.`,` ${actor} ने ${crop} के लिए ${money(item.amount || 0)} भुगतान मिलने का रिकॉर्ड किया। यह मैन्युअल रिकॉर्ड है; ऑनलाइन भुगतान नहीं हुआ।`), icon: '₹' };
      case 'message_received': return { title: word('New message','नया संदेश'), body: item.detail ? `${actor}: “${esc(item.detail)}”` : word(`${actor} sent you a message.`,`${actor} ने आपको संदेश भेजा।`), icon: '✉' };
      default: return { title: word('Account update','खाते का अपडेट'), body: esc(item.detail || ''), icon: '♧' };
    }
  }
  function notificationsPage() {
    const allItems = state.notificationItems || [];
    const unreadCount = allItems.filter((item) => !item.read).length;
    const visibleItems = state.notificationFilter === 'all' ? allItems : allItems.filter((item) => item.category === state.notificationFilter);
    const filters = [
      ['all', word('All','सभी')], ['orders', word('Orders','ऑर्डर')],
      ['payments', word('Payments','भुगतान')], ['messages', word('Messages','संदेश')],
    ];
    const rows = visibleItems.map((item) => {
      const text = notificationText(item);
      return `<article class="notification-card ${item.read ? '' : 'unread'}"><span class="notification-kind-icon">${text.icon}</span><div class="notification-copy"><div class="notification-title-row"><h3>${text.title}</h3>${item.read ? '' : `<span class="unread-label">${word('NEW','नया')}</span>`}</div><p>${text.body}</p><div class="notification-meta"><span>${esc(item.date)}</span>${item.orderId ? `<span>${word('Order','ऑर्डर')} ${esc(item.orderId)}</span>` : ''}</div><div class="notification-actions">${item.orderId ? `<button type="button" class="text-link" data-page="orders">${word('View orders','ऑर्डर देखें')} →</button>` : ''}${item.read ? '' : `<button type="button" class="text-link" data-action="mark-notification-read" data-id="${esc(item.id)}">${word('Mark as read','पढ़ा हुआ चिह्नित करें')}</button>`}</div></div></article>`;
    }).join('');
    return `<div class="welcome-row"><div><div class="eyebrow">${word('ORDER AND ACCOUNT ACTIVITY','ऑर्डर और खाते की गतिविधि')}</div><h1>${word('Notifications','सूचनाएँ')}</h1><p class="page-subtitle">${word('Order, delivery, payment, and message updates for your account.','आपके खाते के ऑर्डर, डिलीवरी, भुगतान और संदेश के अपडेट।')}</p></div>${unreadCount ? `<button type="button" class="button button-outline" data-action="mark-all-notifications-read">${word('Mark all as read','सभी को पढ़ा हुआ करें')}</button>` : ''}</div><section class="panel notification-panel"><div class="notification-filters">${filters.map(([filter, label]) => `<button type="button" class="chip ${state.notificationFilter === filter ? 'active' : ''}" data-notification-filter="${filter}">${label}${filter === 'all' && unreadCount ? ` <span class="filter-count">${unreadCount}</span>` : ''}</button>`).join('')}</div><div class="notification-list">${rows || `<div class="empty-state"><span>♧</span>${allItems.length ? word('There are no updates in this category yet.','इस श्रेणी में अभी कोई अपडेट नहीं है।') : word('You are all caught up. Order and message updates will appear here.','आपके सभी अपडेट देख लिए गए हैं। ऑर्डर और संदेश के अपडेट यहाँ दिखेंगे।')}</div>`}</div></section>`;
  }
  function profilePage() {
    const name = currentUser();
    const profileArea = marketplaceArea(state.location);
    const selectedState = state.user.state || profileArea.state;
    const selectedDistrict = state.user.district || profileArea.district;
    return `<div class="welcome-row"><div><div class="eyebrow">${word('YOUR ACCOUNT, YOUR WAY','आपका खाता, आपकी पसंद')}</div><h1>${word('My profile','मेरी प्रोफ़ाइल')}</h1><p class="page-subtitle">${word('Manage your details, language, and trust settings.','अपना विवरण, भाषा और भरोसे की सेटिंग संभालें।')}</p></div><button class="button button-outline" data-action="logout">↪ ${word('Sign out','साइन आउट')}</button></div><div class="profile-grid"><section class="panel"><div class="profile-hero"><div class="profile-avatar">${esc(initials(currentUser()))}</div><div><div class="profile-name">${esc(name)}</div><div class="profile-meta">${roleName()} · ${esc(state.location || word('Choose location','Choose location'))}</div><div class="profile-meta"><span class="verified">● ${word('Community profile','Community profile')}</span></div></div></div><form id="profile-form" class="profile-fields"><div class="field"><label>${word('Full name','पूरा नाम')}</label><input name="name" value="${esc(name)}" /></div><div class="field"><label>${word('Phone number','फ़ोन नंबर')}</label><input name="phone" value="${esc(state.user.phone)}" readonly /></div><div class="field"><label>${word('State','\u0930\u093e\u091c\u094d\u092f')} *</label>${stateSelectMarkup('profile-state','state',selectedState)}</div><div class="field"><label>${word('District','\u091c\u093f\u0932\u093e')} *</label>${districtSelectMarkup('profile-district','district',selectedState,selectedDistrict)}</div><div class="field"><label>${word('Preferred language','पसंदीदा भाषा')}</label><select name="language"><option value="en" ${state.language==='en'?'selected':''}>English</option><option value="hi" ${state.language==='hi'?'selected':''}>हिन्दी</option></select></div><div class="field full"><label>${word('About you','आपके बारे में')}</label><textarea name="about" placeholder="${word('Tell buyers a little about your farm or business...','खरीदारों को अपने खेत या कारोबार के बारे में थोड़ा बताएँ...')}">${esc(state.about || '')}</textarea></div><div class="full" style="display:flex;justify-content:flex-end"><button class="button button-primary" type="submit">${word('Save profile','प्रोफ़ाइल सहेजें')}</button></div></form></section><aside class="panel"><div class="panel-head"><div><h2>${word('Trust & verification','भरोसा और सत्यापन')}</h2><div class="panel-kicker">${word('Build confidence in every connection','हर संपर्क में भरोसा बढ़ाएँ')}</div></div></div><div class="insight-card"><span class="big-emoji">🛡️</span><h3>${word(state.user.verified ? 'Mobile verified by OTP' : 'Mobile not verified', state.user.verified ? 'मोबाइल OTP से सत्यापित' : 'मोबाइल सत्यापित नहीं')}</h3><p>${word('Phone OTP verifies the mobile number. Documents are encrypted, but government checks are not connected.','मोबाइल OTP फ़ोन की पुष्टि करता है। दस्तावेज़ एन्क्रिप्ट होते हैं, लेकिन सरकारी जाँच जुड़ी नहीं है।')}</p></div><div class="trust-row"><span class="trust-icon">✓</span><div><b>${word('Ratings & reviews','रेटिंग और समीक्षाएँ')}</b><span>${word('Ratings appear after buyer feedback','Ratings appear after buyer feedback')}</span></div></div><div class="trust-row"><span class="trust-icon">🌐</span><div><b>${word('App language','ऐप की भाषा')}</b><span>${state.language==='hi'?'हिन्दी':'English'} · <button class="text-link" data-action="language">${word('Change','बदलें')}</button></span></div></div><div class="trust-row"><span class="trust-icon">☷</span><div><b>${word('Notifications','सूचनाएँ')}</b><span>${word('Price & order updates','भाव और ऑर्डर अपडेट')} · <button class="text-link" data-action="notifications">${state.notifications?word('On','चालू'):word('Off','बंद')}</button></span></div></div></aside></div>`;
  }
  function render() {
    document.documentElement.lang = state.language === 'hi' ? 'hi' : 'en';
    if (!state.authenticated) {
      document.getElementById('app').innerHTML = `<main class="auth-splash"><img src="assets/leaf.svg" alt=""/><div class="eyebrow">FARMER'S CONNECT</div><h1>${word('A fairer way to grow, together.','मिलकर उगाएँ, मिलकर आगे बढ़ें।')}</h1><p>${word('Connect directly with growers and buyers. See clear prices, make clear agreements, and keep a record of every order.','किसानों और खरीदारों से सीधे जुड़ें। साफ़ भाव देखें, सही सौदा करें और हर ऑर्डर का रिकॉर्ड रखें।')}</p><div class="auth-highlights"><span>🌱 ${word('For farmers','किसानों के लिए')}</span><span>🧺 ${word('For households','परिवारों के लिए')}</span><span>🏪 ${word('For businesses','कारोबार के लिए')}</span></div></main>`;
      return;
    }
    if (state.page === 'listing-form') {
      const item = state.listings.find((listing) => listing.id === state.editingListingId) || null;
      document.getElementById('app').innerHTML = `<main class="listing-page"><div class="listing-page-content">${listingForm(item)}</div></main>`;
      bindEvents();
      return;
    }
    let content = state.page === 'marketplace' || state.page === 'my-produce' ? marketplace() : state.page === 'prices' ? pricesPage() : state.page === 'orders' ? ordersPage() : state.page === 'notifications' ? notificationsPage() : state.page === 'messages' ? messagesPage() : state.page === 'profile' ? profilePage() : dashboard();
    document.documentElement.lang = state.language === 'hi' ? 'hi' : 'en';
    document.getElementById('app').innerHTML = `<div class="app-shell">${sidebar()}<main class="main-area">${topbar()}<div class="content">${content}</div></main>${mobileNav()}</div>`;
    bindEvents();
  }
  function onboarding() {
    openFullPage(`<div class="onboard-art">❧</div><div class="eyebrow">WELCOME TO FARMER'S CONNECT</div><h2 id="modal-title">${word('Good things grow together.','मिलकर आगे बढ़ें।')}</h2><p style="color:#879186;font-size:11px;line-height:1.6;margin:7px 0 0">${word('Choose how you want to continue.','आगे बढ़ने का तरीका चुनें।')}</p><div class="role-cards auth-choice-grid"><button type="button" class="role-card auth-choice" data-auth-flow="signup"><span class="role-emoji">🌱</span><b>${word('Create account','नया खाता बनाएँ')}</b><span>${word('Choose a role and verify your phone once','भूमिका चुनें और फ़ोन एक बार सत्यापित करें')}</span></button><button type="button" class="role-card auth-choice" data-auth-flow="login"><span class="role-emoji">↪</span><b>${word('Log in','लॉग इन')}</b><span>${word('For an existing account','पहले से बने खाते के लिए')}</span></button></div><div class="demo-note">${word('New accounts verify their phone with an OTP once. Returning users log in with their phone and password.','नए खाते में OTP से फ़ोन एक बार सत्यापित होगा। पुराने खाते में फ़ोन और पासवर्ड से लॉग इन करें।')}</div>`);
    bindAuthFlowButtons();
  }
  function bindAuthFlowButtons() {
    document.querySelectorAll('[data-auth-flow]').forEach((button) => button.addEventListener('click', () => {
      if (button.dataset.authFlow === 'signup') openSignupStep();
      if (button.dataset.authFlow === 'login') openLoginStep();
      if (button.dataset.authFlow === 'password-setup') openPasswordSetupStep();
    }));
  }
  function openSignupStep() {
    const roleLabels = { farmer: word('Farmer','किसान'), consumer: word('Consumer','ग्राहक'), industry: word('Industry buyer','व्यापार खरीदार') };
    openFullPage(`<div class="modal-head"><div><div class="onboard-art">🌱</div><div class="eyebrow">${word('NEW ACCOUNT','नया खाता')}</div><h2 id="modal-title">${word('Create your account','अपना खाता बनाएँ')}</h2><p>${word('Choose your account role. It stays fixed after registration.','अपने खाते की भूमिका चुनें। पंजीकरण के बाद यह तय रहेगी।')}</p></div></div><form id="auth-signup-form"><div class="role-cards"><button type="button" class="role-card ${authDraft.role==='farmer'?'selected':''}" data-auth-role="farmer"><span class="role-emoji">🌱</span><b>${roleLabels.farmer}</b><span>${word('Sell your harvest','अपनी उपज बेचें')}</span></button><button type="button" class="role-card ${authDraft.role==='consumer'?'selected':''}" data-auth-role="consumer"><span class="role-emoji">🧺</span><b>${roleLabels.consumer}</b><span>${word('Buy farm-fresh','ताज़ी उपज खरीदें')}</span></button><button type="button" class="role-card ${authDraft.role==='industry'?'selected':''}" data-auth-role="industry"><span class="role-emoji">🏪</span><b>${roleLabels.industry}</b><span>${word('Source in bulk','थोक में खरीदें')}</span></button></div><div class="form-grid"><div class="field full"><label for="registration-name" data-registration-name-label></label><input id="registration-name" name="name" autocomplete="name" maxlength="100" required /></div><div class="field full"><label>${word('Mobile number','मोबाइल नंबर')} *</label><input name="phone" type="tel" inputmode="tel" autocomplete="tel" required placeholder="+91 98765 43210" /></div><div class="field full"><label>${word('Password or PIN (8 or more characters)','पासवर्ड या पिन (कम से कम 8 अक्षर)')} *</label><input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required /><small>${word('Use this password whenever you log in.','लॉग इन करते समय इसी पासवर्ड का उपयोग करें।')}</small></div><fieldset class="registration-fields form-grid" data-registration-fields="local"><legend class="registration-legend">${word('Your location','आपकी जगह')}</legend><div class="field"><label>${word('State','राज्य')} *</label><select id="signup-state" name="state" required>${stateOptions()}</select></div><div class="field"><label>${word('District','ज़िला')} *</label><select id="signup-district" name="district" required disabled>${districtOptions('')}</select></div><div class="field full"><label>${word('Village','गाँव')} *</label><input name="village" maxlength="100" required placeholder="${word('Village','गाँव')}" /></div></fieldset><fieldset class="registration-fields form-grid" data-registration-fields="identity"><legend class="registration-legend">${word('Government-issued ID','सरकारी पहचान पत्र')}</legend><div class="field full"><label>${word('ID type','पहचान पत्र का प्रकार')} *</label><select name="govtIdType" required><option value="aadhaar">Aadhaar</option><option value="voter-id">Voter ID</option><option value="pan">PAN</option><option value="driving-license">Driving licence</option><option value="passport">Passport</option><option value="other">${word('Other government ID','अन्य सरकारी पहचान पत्र')}</option></select></div><div class="field full"><label>${word('ID number (or upload the document)','पहचान संख्या (या दस्तावेज़ अपलोड करें)')}</label><input name="govtIdNumber" autocomplete="off" maxlength="60" placeholder="${word('Enter ID number','पहचान संख्या दर्ज करें')}" /></div><div class="field full"><label>${word('Upload ID document (optional if number is entered)','पहचान दस्तावेज़ अपलोड करें (संख्या देने पर वैकल्पिक)')}</label><input name="govtIdDocument" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" /><small>${word('PDF, JPG, PNG, or WebP · 2 MB maximum. Provide a number or a document.','PDF, JPG, PNG या WebP · अधिकतम 2 MB। संख्या या दस्तावेज़ में से एक दें।')}</small></div></fieldset><fieldset class="registration-fields form-grid" data-registration-fields="farmer"><legend class="registration-legend">${word('Farmer verification detail','किसान सत्यापन विवरण')}</legend><div class="field full"><label>${word('Choose one record','एक रिकॉर्ड चुनें')} *</label><select name="farmerProofType" required><option value="farmer-registry">Farmer Registry ID</option><option value="kcc">Kisan Credit Card (KCC)</option><option value="land-record">Land record</option><option value="pm-kisan">PM-KISAN</option></select></div><div class="field full"><label>${word('ID or account details','आईडी या खाते का विवरण')} *</label><input name="farmerProofValue" maxlength="120" required placeholder="${word('Enter the selected record details','चुने गए रिकॉर्ड का विवरण दर्ज करें')}" /></div></fieldset><fieldset class="registration-fields form-grid" data-registration-fields="consumer"><legend class="registration-legend">${word('Consumer details','उपभोक्ता विवरण')}</legend><div class="field full"><label>${word('Occupation','व्यवसाय')} *</label><input name="occupation" maxlength="100" required placeholder="${word('e.g. Teacher, student, shop owner','जैसे शिक्षक, विद्यार्थी, दुकानदार')}" /></div></fieldset><fieldset class="registration-fields form-grid" data-registration-fields="industry"><legend class="registration-legend">${word('Industry verification','Industry verification')}</legend><div class="field"><label>${word('State','\u0930\u093e\u091c\u094d\u092f')} *</label><select id="industry-state" name="industryState" required>${stateOptions()}</select></div><div class="field"><label>${word('District','\u091c\u093f\u0932\u093e')} *</label><select id="industry-district" name="industryDistrict" required disabled>${districtOptions('')}</select></div><div class="field full"><label>${word('Owner / authorized person','मालिक / अधिकृत व्यक्ति')} *</label><input name="ownerName" autocomplete="name" maxlength="100" required /></div><div class="field full"><label>${word('Email address','ईमेल पता')} *</label><input name="email" type="email" autocomplete="email" maxlength="254" required placeholder="name@example.com" /></div><div class="field full"><label>GSTIN *</label><input name="gstin" maxlength="15" minlength="15" required autocapitalize="characters" placeholder="15-character GSTIN" /></div><div class="field full"><label>${word('Industry registration / Udyam document','उद्योग पंजीकरण / उद्यम दस्तावेज़')} *</label><input name="industryDocument" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required /><small>${word('PDF, JPG, PNG, or WebP · 2 MB maximum.','PDF, JPG, PNG या WebP · अधिकतम 2 MB।')}</small></div></fieldset><div class="field full"><label>${word('Preferred language','पसंदीदा भाषा')}</label><select name="language"><option value="en" ${authDraft.language==='en'?'selected':''}>English</option><option value="hi" ${authDraft.language==='hi'?'selected':''}>हिन्दी</option></select></div></div><div class="demo-note">${word('Mobile OTP confirms your phone. Government IDs and business documents are stored encrypted, but are not checked against government records by this demo.','मोबाइल OTP आपके फ़ोन की पुष्टि करता है। सरकारी पहचान और व्यापार दस्तावेज़ एन्क्रिप्ट होकर सहेजे जाते हैं, लेकिन यह डेमो सरकारी रिकॉर्ड से उनकी जाँच नहीं करता।')}</div><div class="modal-footer"><button type="button" class="button button-outline" data-action="auth-back">${word('Back','वापस')}</button><button class="button button-primary" type="submit">${word('Continue to verification','सत्यापन जारी रखें')} →</button></div></form>`);

    bindDistrictDropdown('signup-state', 'signup-district');
    bindDistrictDropdown('industry-state', 'industry-district');
    const form = document.getElementById('auth-signup-form');
    const nameLabel = form.querySelector('[data-registration-name-label]');
    const refreshRoleFields = () => {
      const role = authDraft.role;
      nameLabel.textContent = `${role === 'industry' ? word('Industry name','उद्योग का नाम') : role === 'consumer' ? word('Consumer name','उपभोक्ता का नाम') : word('Farmer name','किसान का नाम')} *`;
      form.querySelectorAll('[data-registration-fields]').forEach((fieldset) => {
        const fieldRole = fieldset.dataset.registrationFields;
        const enabled = fieldRole === 'local' || fieldRole === 'identity' ? role !== 'industry' : fieldRole === role;
        fieldset.disabled = !enabled;
        fieldset.hidden = !enabled;
      });
    };
    document.querySelectorAll('[data-auth-role]').forEach((button) => button.addEventListener('click', () => {
      authDraft.role = button.dataset.authRole;
      document.querySelectorAll('[data-auth-role]').forEach((node) => node.classList.toggle('selected', node === button));
      refreshRoleFields();
    }));
    form.elements.language.addEventListener('change', (event) => { authDraft.language = event.target.value; });
    refreshRoleFields();

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const role = authDraft.role;
      const body = { name: form.elements.name.value.trim(), phone: form.elements.phone.value.trim(), password: form.elements.password.value, role, language: form.elements.language.value };
      const readDocument = async (input, required = false) => {
        const file = input.files[0];
        if (!file) {
          if (required) throw new Error(word('Choose the required registration document.','कृपया आवश्यक पंजीकरण दस्तावेज़ चुनें।'));
          return null;
        }
        if (file.size > 1024 * 1024) throw new Error(word('Each registration document must be 2 MB or smaller.','हर पंजीकरण दस्तावेज़ 2 MB या उससे कम होना चाहिए।'));
        if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error(word('Use a PDF, JPG, PNG, or WebP document.','PDF, JPG, PNG या WebP दस्तावेज़ चुनें।'));
        return { name: file.name, type: file.type, data: await imageToBase64(file) };
      };
      try {
        if (role === 'farmer' || role === 'consumer') {
          const idFile = await readDocument(form.elements.govtIdDocument);
          const idNumber = form.elements.govtIdNumber.value.trim();
          if (!idNumber && !idFile) throw new Error(word('Enter a government ID number or upload its document.','सरकारी पहचान संख्या दर्ज करें या उसका दस्तावेज़ अपलोड करें।'));
          body.state = form.elements.state.value.trim();
          body.district = form.elements.district.value.trim();
          body.village = form.elements.village.value.trim();
          body.govtIdType = form.elements.govtIdType.value;
          body.govtIdNumber = idNumber;
          body.govtIdDocument = idFile;
          if (role === 'farmer') {
            body.farmerProofType = form.elements.farmerProofType.value;
            body.farmerProofValue = form.elements.farmerProofValue.value.trim();
          } else {
            body.occupation = form.elements.occupation.value.trim();
          }
        } else {
          body.ownerName = form.elements.ownerName.value.trim();
          body.email = form.elements.email.value.trim();
          body.gstin = form.elements.gstin.value.trim().toUpperCase();
          body.state = form.elements.industryState.value;
          body.district = form.elements.industryDistrict.value;
          body.industryDocument = await readDocument(form.elements.industryDocument, true);
        }
        const challenge = await api('/auth/request-otp', { method: 'POST', body: JSON.stringify(body) });
        openOtpStep(body.phone, challenge);
      } catch (error) { toast(error.message); }
    });
  }  function openLoginStep() {
    openFullPage(`<div class="modal-head"><div><div class="onboard-art">&rarr;</div><div class="eyebrow">${word('EXISTING ACCOUNT','EXISTING ACCOUNT')}</div><h2 id="modal-title">${word('Log in to your account','Log in to your account')}</h2><p>${word('Your account opens with its saved role. No OTP is needed to log in.','Your account opens with its saved role. No OTP is needed to log in.')}</p></div></div><form id="auth-login-form"><div class="form-grid"><div class="field full"><label>${word('Phone number','Phone number')}</label><input name="phone" type="tel" inputmode="tel" autocomplete="username" required placeholder="+91 98765 43210" /></div><div class="field full"><label>${word('Password','Password')}</label><input name="password" type="password" autocomplete="current-password" required /></div></div><div class="modal-footer"><button type="button" class="button button-outline" data-action="auth-back">${word('Back','Back')}</button><button class="button button-primary" type="submit">${word('Log in','Log in')} &rarr;</button></div></form><div style="text-align:center;margin-top:12px"><button class="text-link" type="button" data-auth-flow="password-setup">${word('Set a password for an older account','Set a password for an older account')}</button><span style="color:#a0a79e"> ? </span><button class="text-link" type="button" data-auth-flow="signup">${word('Create account','Create account')}</button></div>`);
    bindAuthFlowButtons();
    document.getElementById('auth-login-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      try {
        const result = await api('/auth/login', { method: 'POST', body: JSON.stringify({ phone: form.elements.phone.value.trim(), password: form.elements.password.value }) });
        await enterWorkspace(result.user);
      } catch (error) { toast(error.message); }
    });
  }
  function openPasswordSetupStep() {
    openFullPage(`<div class="modal-head"><div><div class="onboard-art">🔐</div><div class="eyebrow">${word('EXISTING ACCOUNT SETUP','पुराने खाते की सेटिंग')}</div><h2 id="modal-title">${word('Set a login password','लॉग इन पासवर्ड बनाएँ')}</h2><p>${word('This one-time verification is only for accounts created before password login was added.','यह एक बार का सत्यापन केवल पुराने खातों के लिए है जिनमें पासवर्ड नहीं था।')}</p></div></div><form id="password-setup-request"><div class="field"><label>${word('Phone number','फ़ोन नंबर')}</label><input name="phone" type="tel" inputmode="tel" autocomplete="tel" required placeholder="+91 98765 43210" /></div><div class="modal-footer"><button type="button" class="button button-outline" data-action="auth-back">${word('Back','वापस')}</button><button class="button button-primary" type="submit">${word('Send setup code','सेटअप कोड भेजें')}</button></div></form>`);
    document.getElementById('password-setup-request').addEventListener('submit', async (event) => {
      event.preventDefault();
      const phone = event.currentTarget.elements.phone.value.trim();
      try {
        const challenge = await api('/auth/request-password-setup-otp', { method: 'POST', body: JSON.stringify({ phone }) });
        openPasswordSetupVerify(phone, challenge);
      } catch (error) { toast(error.message); }
    });
  }
  function openPasswordSetupVerify(phone, challenge) {
    openFullPage(`<div class="modal-head"><div><div class="onboard-art">🔐</div><div class="eyebrow">${word('ACCOUNT SETUP','खाता सेटअप')}</div><h2 id="modal-title">${word('Verify phone and set password','फ़ोन सत्यापित कर पासवर्ड बनाएँ')}</h2><p>${word('One-time code sent to','एक बार का कोड भेजा गया')}: ${esc(phone)}</p></div></div><form id="password-setup-verify"><div class="form-grid"><div class="field full"><label>${word('6-digit code','6 अंकों का कोड')}</label><input name="otp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required value="${esc(challenge.devOtp || '')}" /></div><div class="field full"><label>${word('Create a password','पासवर्ड बनाएँ')}</label><input name="password" type="password" autocomplete="new-password" minlength="8" maxlength="128" required /></div></div>${challenge.devOtp ? `<div class="demo-note">${word('Development OTP','डेवलपमेंट OTP')}: <b>${esc(challenge.devOtp)}</b></div>` : ''}<div class="modal-footer"><button type="button" class="button button-outline" data-action="auth-back">${word('Back','वापस')}</button><button class="button button-primary" type="submit">${word('Save password and log in','पासवर्ड सहेजें और लॉग इन करें')}</button></div></form>`);
    document.getElementById('password-setup-verify').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      try {
        const result = await api('/auth/complete-password-setup', { method: 'POST', body: JSON.stringify({ phone, otp: form.elements.otp.value, password: form.elements.password.value }) });
        await enterWorkspace(result.user);
      } catch (error) { toast(error.message); }
    });
  }
  function openOtpStep(phone, challenge) {
    openFullPage(`<div class="modal-head"><div><div class="onboard-art">✉</div><div class="eyebrow">${word('NEW ACCOUNT VERIFICATION','नए खाते का सत्यापन')}</div><h2 id="modal-title">${word('Verify your phone','अपना फ़ोन सत्यापित करें')}</h2><p>${word('The code is for creating your account:','खाता बनाने के लिए कोड भेजा गया:')} ${esc(phone)}</p></div></div><form id="auth-verify-form"><div class="field"><label>${word('6-digit code','6 अंकों का कोड')}</label><input name="otp" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required value="${esc(challenge.devOtp || '')}" /></div>${challenge.devOtp ? `<div class="demo-note">${word('Development OTP','डेवलपमेंट OTP')}: <b>${esc(challenge.devOtp)}</b> · ${word('This code is shown only in local development.','यह कोड केवल स्थानीय डेवलपमेंट में दिखता है।')}</div>` : ''}<div class="modal-footer"><button type="button" class="button button-outline" data-action="auth-back">${word('Back','वापस')}</button><button class="button button-primary" type="submit">${word('Verify and create account','सत्यापित करें और खाता बनाएँ')}</button></div></form>`);
    document.getElementById('auth-verify-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const result = await api('/auth/verify-otp', { method: 'POST', body: JSON.stringify({ phone, otp: event.currentTarget.elements.otp.value }) });
        await enterWorkspace(result.user);
      } catch (error) { toast(error.message); }
    });
  }
  async function deleteListing(id) {
    try {
      await api(`/listings/${encodeURIComponent(id)}`, { method: 'DELETE' });
      await loadWorkspace(); render(); toast(word('Listing removed.', 'लिस्टिंग हटाई गई।'));
    } catch (error) { toast(error.message); }
  }
  function listingForm(item = null) {
    const editing = Boolean(item);
    const listingArea = marketplaceArea(item?.location || state.location);
    return `<div class="modal-head"><div><div class="eyebrow">${word('YOUR FARM STALL','आपका खेत')}</div><h2 id="modal-title">${word(editing?'Update listing':'List your produce',editing?'लिस्टिंग बदलें':'अपनी उपज बेचें')}</h2><p>${word('Give buyers the details they need to make a confident choice.','खरीदारों को सही निर्णय लेने के लिए ज़रूरी जानकारी दें।')}</p></div><button class="close-btn" data-action="back-from-listing-form" aria-label="Close">×</button></div><form id="listing-form"><div class="form-grid"><div class="field"><label>${word('Produce name','उपज का नाम')} *</label><input name="crop" required value="${esc(item?.crop || '')}" placeholder="e.g. Fresh tomatoes" /></div><div class="field"><label>${word('Category','श्रेणी')}</label><select name="category"><option ${item?.category==='Vegetables'?'selected':''}>Vegetables</option><option ${item?.category==='Fruits'?'selected':''}>Fruits</option><option ${item?.category==='Grains'?'selected':''}>Grains</option></select></div><div class="field"><label>${word('Quantity available','उपलब्ध मात्रा')} *</label><input name="qty" required type="number" min="1" value="${esc(item?.qty || '')}" placeholder="e.g. 120" /></div><div class="field"><label>${word('Unit','इकाई')}</label><select name="unit"><option ${item?.unit==='kg'?'selected':''}>kg</option><option ${item?.unit==='bunch'?'selected':''}>bunch</option><option>crate</option><option>quintal</option></select></div><div class="field"><label>${word('Your price (₹ / unit)','आपका भाव (₹ / इकाई)')} *</label><input name="price" type="number" min="1" required value="${esc(item?.price || '')}" placeholder="e.g. 32" /></div><div class="field"><label>${word('Harvest date','कटाई की तारीख')}</label><select name="harvest"><option>Today</option><option>Yesterday</option><option>This week</option><option>Next week</option></select></div><div class="field"><label>${word('Quality grade','गुणवत्ता')}</label><select name="quality"><option>Fresh</option><option>Grade A</option><option>Premium</option><option>Organic</option></select></div><div class="field"><label>${word('State','\u0930\u093e\u091c\u094d\u092f')} *</label>${stateSelectMarkup('listing-state','listingState',listingArea.state)}</div><div class="field"><label>${word('District','\u091c\u093f\u0932\u093e')} *</label>${districtSelectMarkup('listing-district','listingDistrict',listingArea.state,listingArea.district)}</div><div class="field full"><label>${word('Tell buyers about your produce','खरीदारों को अपनी उपज के बारे में बताएँ')}</label><textarea name="note" placeholder="${word('Growing method, freshness, packing...','उगाने का तरीका, ताज़गी, पैकिंग...')}">${esc(item?.note || '')}</textarea></div><div class="field full"><label>${word('Photo','तस्वीर')}</label><input name="photo" type="file" accept="image/jpeg,image/png,image/webp" /><span class="photo-hint">JPG, PNG, or WebP · 2 MB maximum.</span></div></div><div class="modal-footer"><button type="button" class="button button-outline" data-action="back-from-listing-form">${word('Cancel','रद्द करें')}</button><button class="button button-primary" type="submit">${word(editing?'Save changes':'Publish listing',editing?'बदलाव सहेजें':'लिस्टिंग प्रकाशित करें')}</button></div></form>`;
  }
  function bindListingForm(item) {
    bindDistrictDropdown('listing-state', 'listing-district');
    document.getElementById('listing-form').addEventListener('submit', async (e) => {
      e.preventDefault(); const data = new FormData(e.currentTarget); const crop = data.get('crop').trim();
      const reference = priceByName(crop);
      const listing = { crop, icon: reference.icon, category: data.get('category'), location: data.get('listingDistrict') + ', ' + data.get('listingState'), state: data.get('listingState'), district: data.get('listingDistrict'), price: Number(data.get('price')), unit: data.get('unit'), qty: Number(data.get('qty')), quality: data.get('quality'), harvest: data.get('harvest'), color: reference.category === 'Fruits' ? '#f7efe0' : reference.category === 'Grains' ? '#f2efdf' : '#eff3e4', note: data.get('note').trim() };
      try {
        const photo = data.get('photo');
        if (photo?.size) {
          if (photo.size > 2 * 1024 * 1024) throw new Error('Crop photos must be 2 MB or smaller.');
          if (!['image/jpeg', 'image/png', 'image/webp'].includes(photo.type)) throw new Error('Choose a JPG, PNG, or WebP photo.');
          listing.photoData = await imageToBase64(photo);
          listing.photoType = photo.type;
        }
        await api(item ? `/listings/${encodeURIComponent(item.id)}` : '/listings', { method: item ? 'PATCH' : 'POST', body: JSON.stringify(listing) });
        await loadWorkspace(); returnFromListingForm(); toast(word(item ? 'Listing updated.' : 'Your produce is now listed.', 'लिस्टिंग सहेजी गई।'));
      } catch (error) { toast(error.message); }
    });
  }
  function buyForm(item) {
    openModal(`<div class="modal-head"><div><div class="eyebrow">${word('ORDER FROM A GROWER','किसान से खरीदें')}</div><h2 id="modal-title">${word('Request this produce','इस उपज का अनुरोध करें')}</h2><p>${esc(item.crop)} · ${esc(item.seller)} · ${money(item.price)} / ${esc(item.unit)}</p></div><button class="close-btn" data-action="close-modal" aria-label="Close">×</button></div><form id="buy-form"><div class="form-grid"><div class="field"><span class="quantity-spacer" aria-hidden="true"></span><div class="quantity-field"><input name="qty" type="number" aria-label="${word('Quantity','मात्रा')} (${esc(item.unit)})" placeholder="${word('Quantity','मात्रा')}" min="0.01" step="any" max="${item.qty}" required /><span class="quantity-unit" aria-hidden="true">${esc(item.unit)}</span></div></div><div class="field"><label>${word('Delivery preference','डिलीवरी का विकल्प')}</label><select name="delivery"><option>${word('Coordinate with seller','किसान से बात करें')}</option><option>${word('Self pickup','खुद लेकर जाएँ')}</option></select></div><div class="field full"><label>${word('Message to farmer','किसान के लिए संदेश')}</label><textarea name="message" placeholder="${word('Ask about delivery or quality...','डिलीवरी या गुणवत्ता के बारे में पूछें...')}"></textarea></div></div><div class="demo-note">${word('Payment is not connected; the order request is saved to the app database.','Payment is not connected; the order request is saved to the app database.')}</div><div class="modal-footer"><button type="button" class="button button-outline" data-action="close-modal">${word('Cancel','रद्द करें')}</button><button class="button button-primary" type="submit">${word('Send order request','ऑर्डर अनुरोध भेजें')} &nbsp;→</button></div></form>`);
    document.getElementById('buy-form').addEventListener('submit', async (e) => {
      e.preventDefault(); const data = new FormData(e.currentTarget);
      try {
        await api('/orders', { method: 'POST', body: JSON.stringify({ listingId: item.id, qty: Number(data.get('qty')), delivery: data.get('delivery'), message: data.get('message') }) });
        await loadWorkspace(); closeModal({ replaceHistory: true }); setPage('orders'); toast(word('Order request saved. Payment is not connected.', 'ऑर्डर अनुरोध सहेजा गया। भुगतान जुड़ा नहीं है।'));
      } catch (error) { toast(error.message); }
    });
  }
  async function inquiryFor(item) {
    try {
      await api('/messages', { method: 'POST', body: JSON.stringify({ recipientId: item.sellerId, text: `Hello! I’m interested in your ${item.crop}. Is it available?` }) });
      await loadWorkspace(); state.activeInquiry = String(item.sellerId); setPage('messages');
    } catch (error) { toast(error.message); }
  }
  function newRequirement() {
    openModal(`<div class="modal-head"><div><div class="eyebrow">${word('INDUSTRY SOURCING','थोक खरीद')}</div><h2 id="modal-title">${word('Post a purchase requirement','खरीद अनुरोध डालें')}</h2><p>${word('Tell growers what you need; your request is saved to the app database.','किसानों को अपनी ज़रूरत बताएँ; आपका अनुरोध ऐप डेटाबेस में सहेजा जाएगा।')}</p></div><button class="close-btn" data-action="close-modal">×</button></div><form id="requirement-form"><div class="form-grid"><div class="field"><label>${word('Produce','उपज')}</label><input name="crop" required placeholder="e.g. Tomatoes" /></div><div class="field"><label>${word('Quantity','मात्रा')}</label><input name="qty" required type="number" min="1" placeholder="e.g. 250" /></div><div class="field"><label>${word('Unit','इकाई')}</label><select name="unit"><option>kg</option><option>quintal</option><option>tonne</option><option>crate</option></select></div><div class="field"><label>${word('Needed by','आवश्यक तारीख')}</label><input name="date" type="date" /></div><div class="field full"><label>${word('Quality or delivery requirements','गुणवत्ता या डिलीवरी की ज़रूरत')}</label><textarea name="details" placeholder="${word('Grade, delivery location, recurring volume...','गुणवत्ता, डिलीवरी जगह, नियमित मात्रा...')}"></textarea></div></div><div class="demo-note">${word('Bulk matching, contracts, and supplier notifications are not connected yet.','थोक मिलान, अनुबंध और सप्लायर सूचनाएँ अभी जुड़ी नहीं हैं।')}</div><div class="modal-footer"><button type="button" class="button button-outline" data-action="close-modal">${word('Cancel','रद्द करें')}</button><button type="submit" class="button button-primary">${word('Save requirement','अनुरोध सहेजें')}</button></div></form>`);
    document.getElementById('requirement-form').addEventListener('submit', async (e) => {
      e.preventDefault(); const data = new FormData(e.currentTarget);
      try {
        await api('/requirements', { method: 'POST', body: JSON.stringify({ crop: data.get('crop'), qty: Number(data.get('qty')), unit: data.get('unit'), date: data.get('date'), details: data.get('details') }) });
        await loadWorkspace(); closeModal(); render(); toast(word('Requirement saved.', 'अनुरोध सहेजा गया।'));
      } catch (error) { toast(error.message); }
    });
  }
  function showReceipt(id) {
    const o=state.orders.find((x)=>x.id===id);if(!o)return;
    openModal(`<div class="modal-head"><div><div class="eyebrow">${word('TRANSACTION RECORD','लेन-देन रिकॉर्ड')}</div><h2 id="modal-title">${word('Digital receipt','डिजिटल रसीद')}</h2></div><button class="close-btn" data-action="close-modal">×</button></div><div class="receipt"><div class="receipt-brand">Farmer's Connect</div><div style="color:#97a095;font-size:9px;margin:4px 0 14px">${word('Marketplace transaction record','बाज़ार लेन-देन रिकॉर्ड')}</div><div class="receipt-line"><span>${word('Receipt ID','रसीद आईडी')}</span><b>${esc(o.id)}</b></div><div class="receipt-line"><span>${word('Date','तारीख')}</span><b>${esc(o.date)}</b></div><div class="receipt-line"><span>${word('Produce','उपज')}</span><b>${esc(o.icon)} ${esc(o.crop)}</b></div><div class="receipt-line"><span>${word(isFarmer()?'Buyer':'Seller',isFarmer()?'खरीदार':'किसान')}</span><b>${esc(o.other)}</b></div><div class="receipt-line"><span>${word('Quantity','मात्रा')}</span><b>${o.qty} ${esc(o.unit)}</b></div><div class="receipt-line"><span>${word('Trade total','सौदे की कुल राशि')}</span><b class="receipt-total">${money(o.total)}</b></div><div class="receipt-line"><span>${word('Payment status','भुगतान की स्थिति')}</span><b>${o.paymentStatus==='paid'?word('Recorded manually','मैन्युअल रूप से दर्ज'):word('Not connected','जुड़ा नहीं')}</b></div></div><div class="demo-note">${word('This account record is not a tax invoice or proof of payment.','यह खाता रिकॉर्ड टैक्स इनवॉइस या भुगतान का प्रमाण नहीं है।')}</div><div class="modal-footer"><button class="button button-outline" data-action="print-receipt">⎙ ${word('Print','प्रिंट')}</button><button class="button button-primary" data-action="close-modal">${word('Done','हो गया')}</button></div>`);
  }
  function downloadReceipts() {
    const lines=[['Order ID','Date','Produce','Quantity','Counterparty','Total INR','Status'],...state.orders.map((o)=>[o.id,o.date,o.crop,`${o.qty} ${o.unit}`,o.other,o.total,o.status])];
    const csv=lines.map((row)=>row.map((cell)=>`"${String(cell).replaceAll('"','""')}"`).join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='farmers-connect-orders.csv';a.click();URL.revokeObjectURL(url);toast(word('Order records downloaded.','ऑर्डर रिकॉर्ड डाउनलोड हुए।'));
  }
  function bindEvents() {
    const listingFormElement = document.getElementById('listing-form');
    if (listingFormElement) bindListingForm(state.listings.find((listing) => listing.id === state.editingListingId) || null);
    document.querySelectorAll('[data-category]').forEach((el)=>el.addEventListener('click',()=>{state.category=el.dataset.category;render();}));
    document.querySelectorAll('[data-notification-filter]').forEach((el)=>el.addEventListener('click',()=>{state.notificationFilter=el.dataset.notificationFilter;render();}));
    document.querySelectorAll('[data-inquiry]').forEach((el)=>el.addEventListener('click',()=>{state.activeInquiry=el.dataset.inquiry;render();}));
    const search=document.getElementById('market-search');if(search)search.addEventListener('input',()=>{state.query=search.value;});
    const marketState=document.getElementById('market-state');
    if(marketState) marketState.addEventListener('change',()=>{state.marketFilterState=marketState.value;state.marketFilterDistrict='';render();document.getElementById('market-state')?.focus();});
    const marketDistrict=document.getElementById('market-district');
    if(marketDistrict) marketDistrict.addEventListener('change',()=>{state.marketFilterDistrict=marketDistrict.value;});
    const marketForm=document.getElementById('marketplace-filter-form');
    if(marketForm) marketForm.addEventListener('submit',(event)=>{
      event.preventDefault();
      const data=new FormData(event.currentTarget);
      state.query=String(data.get('query') || '').trim();
      state.marketFilterState=String(data.get('state') || '');
      state.marketFilterDistrict=String(data.get('district') || '');
      state.appliedMarketFilters={query:state.query,category:state.category,state:state.marketFilterState,district:state.marketFilterDistrict};
      render();
    });
    const marketPriceForm = document.getElementById('market-price-filter-form');
    if (marketPriceForm) {
      marketPriceForm.addEventListener('change', (event) => {
        const field = event.target;
        if (!field.name) return;
        const draft = { ...state.marketPriceDraft, [field.name]: field.value };
        if (field.name === 'state') Object.assign(draft, { district: '', commodityGroup: '', commodity: '' });
        if (field.name === 'district') Object.assign(draft, { commodityGroup: '', commodity: '' });
        if (field.name === 'commodityGroup') draft.commodity = '';
        state.marketPriceDraft = draft;
        if (field.name === 'state') {
          state.marketPriceRecords = [];
          state.marketPriceLoaded = false;
          state.marketPriceLoadedState = '';
          state.marketPriceError = '';
          state.marketPriceSetupRequired = false;
          state.marketPriceApplied = null;
          state.marketPricePage = 1;
          render();
          return;
        }
        if (!['fromDate', 'toDate'].includes(field.name)) render();
      });
      marketPriceForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const fromDate = String(data.get('fromDate') || '');
        const toDate = String(data.get('toDate') || '');
        if (fromDate && toDate && fromDate > toDate) { toast(word('From date must be before to date.', 'आरंभ तारीख अंतिम तारीख से पहले होनी चाहिए।')); return; }
        const filters = { ...state.marketPriceDraft, state: String(data.get('state') || ''), district: String(data.get('district') || ''), commodityGroup: String(data.get('commodityGroup') || ''), commodity: String(data.get('commodity') || ''), fromDate, toDate };
        state.marketPriceDraft = filters;
        state.marketPricePage = 1;
        if (filters.state && (!state.marketPriceLoaded || state.marketPriceLoadedState !== filters.state)) await loadMarketPrices();
        if (state.marketPriceDraft.state !== filters.state) return;
        state.marketPriceApplied = filters;
        render();
      });
    }
    const marketPricePageSize = document.getElementById('market-price-page-size');
    if (marketPricePageSize) marketPricePageSize.addEventListener('change', () => { state.marketPricePageSize = Number(marketPricePageSize.value) || 10; state.marketPricePage = 1; render(); });
    document.querySelectorAll('[data-price-page]').forEach((button) => button.addEventListener('click', () => { state.marketPricePage = Number(button.dataset.pricePage) || 1; render(); }));
    document.querySelectorAll('[data-price-chat-prompt]').forEach((button) => button.addEventListener('click', () => sendMarketPriceChat(button.dataset.priceChatPrompt)));
    const marketPriceChatForm = document.getElementById('market-price-chat-form');
    if (marketPriceChatForm) marketPriceChatForm.addEventListener('submit', (event) => { event.preventDefault(); sendMarketPriceChat(new FormData(event.currentTarget).get('message')); });
    document.querySelectorAll('[data-action]').forEach((el)=>el.addEventListener('click',()=>{
      const id=el.dataset.id, item=state.listings.find((x)=>x.id===id);
      switch(el.dataset.action){

        case 'add-listing': state.editingListingId = ''; setPage('listing-form');break;
        case 'edit-listing': if(item){state.editingListingId=item.id;setPage('listing-form');}break;
        case 'delete-listing': if(item) deleteListing(id); break;
        case 'buy': if(item)buyForm(item);break;
        case 'inquire': if(item)inquiryFor(item);break;
        case 'new-requirement': newRequirement();break;
        case 'receipt': showReceipt(id);break;
        case 'set-order-status': updateOrder(id,{status:el.dataset.status});break;
        case 'record-payment': updateOrder(id,{paymentStatus:'paid'});break;
        case 'export-receipts': downloadReceipts();break;
        case 'close-modal': closeModal();break;
        case 'back-from-listing-form': returnFromListingForm();break;
        case 'retry-market-prices': void loadMarketPrices(true);break;
        case 'reset-market-price-filters': state.marketPriceDraft = { state: state.marketPriceDraft.state, district: '', commodityGroup: '', commodity: '', fromDate: '', toDate: '' }; state.marketPriceApplied = null; state.marketPricePage = 1; render();break;
        case 'toggle-market-price-chat': state.marketPriceChatOpen = !state.marketPriceChatOpen; render();break;
        case 'favorite': el.classList.toggle('saved');el.textContent=el.classList.contains('saved')?'♥':'♡';toast(el.classList.contains('saved')?word('Saved to your favorites.','पसंदीदा में जोड़ा।'):word('Removed from favorites.','पसंदीदा से हटाया।'));break;
        case 'location': openLocation();break;
        case 'sort': break;
        case 'notifications': toggleNotifications();break;
        case 'mark-notification-read': markNotificationRead(id);break;
        case 'mark-all-notifications-read': markAllNotificationsRead();break;
        case 'language': toggleLanguage();break;
        case 'logout': signOut();break;
        case 'help': openHelpChat();break;
        case 'contact-note': toast(word('Agree quantity, grade, price, and delivery in writing.','मात्रा, गुणवत्ता, भाव और डिलीवरी लिखित में तय करें।'));break;
        case 'print-receipt': window.print();break;
      }
    }));
    const msgForm=document.getElementById('message-form');
    if(msgForm) msgForm.addEventListener('submit', async (e) => {
      e.preventDefault(); const input=e.currentTarget.elements.message; const text=input.value.trim(); if(!text) return;
      const recipientId=Number(state.activeInquiry);
      try { await api('/messages',{method:'POST',body:JSON.stringify({recipientId,text})}); await loadWorkspace(); state.activeInquiry=String(recipientId); render(); document.getElementById('chat-messages')?.scrollTo(0,9999); }
      catch(error) { toast(error.message); }
    });
    bindDistrictDropdown('profile-state', 'profile-district');
    const profile=document.getElementById('profile-form');
    if(profile) profile.addEventListener('submit', async (e) => {
      e.preventDefault(); const data=new FormData(e.currentTarget);
      try { await updateProfile({name:data.get('name'),state:data.get('state'),district:data.get('district'),language:data.get('language'),about:data.get('about')}); render(); toast(word('Profile saved.','प्रोफ़ाइल सहेजी गई।')); }
      catch(error) { toast(error.message); }
    });
    document.querySelectorAll('select[data-action="sort"]').forEach((select)=>select.addEventListener('change',()=>{if(select.selectedIndex===1)state.listings.sort((a,b)=>a.price-b.price);else if(select.selectedIndex===2)state.listings.sort((a,b)=>b.price-a.price);render();}));
  }
  function openLocation(){
    const currentArea = marketplaceArea(state.location);
    const selectedState = state.user?.state || currentArea.state;
    const selectedDistrict = state.user?.district || currentArea.district;
    openModal(`<div class="modal-head"><div><div class="eyebrow">${word('YOUR LOCAL MARKET','YOUR LOCAL MARKET')}</div><h2 id="modal-title">${word('Choose your location','Choose your location')}</h2><p>${word('Set a region for nearby produce and market information.','Set a region for nearby produce and market information.')}</p></div><button class="close-btn" data-action="close-modal">&times;</button></div><form id="location-form"><div class="form-grid"><div class="field"><label>${word('State','\u0930\u093e\u091c\u094d\u092f')} *</label>${stateSelectMarkup('location-state','state',selectedState)}</div><div class="field"><label>${word('District','\u091c\u093f\u0932\u093e')} *</label>${districtSelectMarkup('location-district','district',selectedState,selectedDistrict)}</div></div><div class="modal-footer"><button type="button" class="button button-outline" data-action="close-modal">${word('Cancel','Cancel')}</button><button class="button button-primary">${word('Use this location','Use this location')}</button></div></form>`);
    bindDistrictDropdown('location-state','location-district');
    document.getElementById('location-form').addEventListener('submit',async(e)=>{e.preventDefault();const data=new FormData(e.currentTarget);try{await updateProfile({state:data.get('state'),district:data.get('district')});closeModal();render();}catch(error){toast(error.message);}});
  }
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-page]');
    if (!button || !document.getElementById('app')?.contains(button)) return;
    if (button.hasAttribute('data-reset-marketplace')) {
      state.category = 'All produce';
      state.query = '';
      state.marketFilterState = null;
      state.marketFilterDistrict = null;
      state.appliedMarketFilters = null;
    }
    setPage(button.dataset.page);
  });

  replaceAppHistory(state.page, false);
  window.addEventListener('popstate', handleAppPopState);
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
  async function start() {
    let session;
    try {
      let directory;
      try {
        directory = await api('/locations');
      } catch (apiError) {
        const response = await fetch('/india-locations.json', { credentials: 'same-origin', cache: 'no-store' });
        if (!response.ok) throw apiError;
        directory = await response.json();
      }
      indiaLocations = Array.isArray(directory.locations) ? directory.locations : Array.isArray(directory) ? directory : [];
      indiaLocations.forEach((entry) => { stateNames[entry.state.toLowerCase()] = entry.state; });
      if (!indiaLocations.length || indiaLocations.some((entry) => !entry.state || !Array.isArray(entry.districts))) {
        throw new Error('The state and district list could not be loaded.');
      }
      let lastError;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          session = await api('/session');
          break;
        } catch (error) {
          lastError = error;
          if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 400));
        }
      }
      if (!session) throw lastError || new Error('No response from the app server.');
    } catch (error) {
      state.role = ''; state.authenticated = false; render(); onboarding();
      console.error('Could not load the session from', location.origin, error);
      const detail = error instanceof Error ? error.message : String(error || 'Unknown network error');
      toast(word(`Cannot reach the app API at ${location.origin}. Keep the server running and open its printed URL. (${detail})`, `${location.origin} पर ऐप API से संपर्क नहीं हो रहा। सर्वर चालू रखें और टर्मिनल में दिया गया URL खोलें। (${detail})`));
      return;
    }
    if (!session.user) {
      state.role = ''; state.authenticated = false; render(); onboarding();
      return;
    }
    try {
      await enterWorkspace(session.user);
    } catch (error) {
      state.role = ''; state.authenticated = false; state.user = null;
      render(); onboarding();
      console.error('Could not load the signed-in workspace', error);
      const detail = error instanceof Error ? error.message : String(error || 'Unknown workspace error');
      toast(word(`Signed in, but the workspace could not load. (${detail})`, `लॉगिन हो गया, लेकिन आपका कार्यस्थल लोड नहीं हुआ। (${detail})`));
    }
  }
  void start();
})();
