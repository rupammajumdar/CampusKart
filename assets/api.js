/**
 * CampusKart API Client
 * Shared utility for all frontend pages to communicate with the backend.
 * Include this script before any page-specific scripts.
 */

const API = (() => {
  const isLocal = window.location.hostname === 'localhost' || 
                  window.location.hostname === '127.0.0.1' || 
                  window.location.hostname === '' || 
                  window.location.protocol === 'file:';
  const BASE = isLocal ? 'http://localhost:5000/api' : '/api';

  // ─── Auth helpers ────────────────────────────────────────────────────────────
  function getToken() {
    return localStorage.getItem('ck_token');
  }

  function setToken(token) {
    localStorage.setItem('ck_token', token);
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem('ck_user') || 'null');
    } catch {
      return null;
    }
  }

  function setUser(user) {
    localStorage.setItem('ck_user', JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem('ck_token');
    localStorage.removeItem('ck_user');
  }

  function isLoggedIn() {
    return !!getToken();
  }

  function requireAuth(redirectTo = 'index.html') {
    if (!isLoggedIn()) {
      window.location.href = redirectTo;
      return false;
    }
    return true;
  }

  // Check URL params for token (after email verification / magic link)
  function checkUrlToken() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
      setToken(token);
      // Remove token from URL without reload
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      url.searchParams.delete('verified');
      window.history.replaceState({}, '', url.toString());
      return token;
    }
    return null;
  }

  // ─── Core fetch wrapper ──────────────────────────────────────────────────────
  async function request(method, path, body = null, isFormData = false) {
    const headers = {};
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (!isFormData && body) headers['Content-Type'] = 'application/json';

    const opts = { method, headers };
    if (body) {
      opts.body = isFormData ? body : JSON.stringify(body);
    }

    try {
      const res = await fetch(`${BASE}${path}`, opts);
      const data = await res.json().catch(() => ({}));

      if (res.status === 401) {
        clearSession();
        window.location.href = 'index.html';
        return { ok: false, error: 'Session expired' };
      }

      return { ok: res.ok, status: res.status, ...data };
    } catch (err) {
      console.error(`API ${method} ${path} failed:`, err);
      return { ok: false, error: 'Network error — is the server running?' };
    }
  }

  const get = (path) => request('GET', path);
  const post = (path, body) => request('POST', path, body);
  const put = (path, body) => request('PUT', path, body);
  const del = (path) => request('DELETE', path);
  const postForm = (path, formData) => request('POST', path, formData, true);
  const putForm = (path, formData) => request('PUT', path, formData, true);

  // ─── Auth ─────────────────────────────────────────────────────────────────
  const auth = {
    register: (data) => post('/auth/register', data),
    login: (email, password) => post('/auth/login', { email, password }),
    resendVerification: (email) => post('/auth/resend-verification', { email }),
    magicLink: (email) => post('/auth/magic-link', { email }),
    forgotPassword: (email) => post('/auth/forgot-password', { email }),
    resetPassword: (token, newPassword) => post('/auth/reset-password', { token, newPassword }),
    me: () => get('/auth/me'),
    logout: () => {
      clearSession();
      window.location.href = 'index.html';
    },
  };

  // ─── Users ────────────────────────────────────────────────────────────────
  const users = {
    me: () => get('/users/me'),
    update: (formData, isFormData = true) => request('PUT', '/users/me', formData, isFormData),
    updateProfile: (formData, isFormData = true) => request('PUT', '/users/me', formData, isFormData),
    becomeLister: () => post('/users/become-lister'),
    getById: (id) => get(`/users/${id}`),
    toggleWishlist: (listingId) => post(`/users/wishlist/${listingId}`),
    getWishlist: () => get('/users/me/wishlist'),
  };

  // ─── Listings ─────────────────────────────────────────────────────────────
  const listings = {
    browse: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return get(`/listings${qs ? '?' + qs : ''}`);
    },
    create: (formData) => postForm('/listings', formData),
    getById: (id) => get(`/listings/${id}`),
    update: (id, formData) => putForm(`/listings/${id}`, formData),
    delete: (id) => del(`/listings/${id}`),
    interest: (id, message) => post(`/listings/${id}/interest`, { message }),
    reserve: (listingId, buyerId, type, rentalEndDate) =>
      post(`/listings/${listingId}/reserve/${buyerId}`, { type, rentalEndDate }),
    complete: (id) => post(`/listings/${id}/complete`),
    report: (id, reason) => post(`/listings/${id}/report`, { reason }),
    myListings: (status) => get(`/listings/seller/my${status ? '?status=' + status : ''}`),
    stats: () => get('/listings/stats'),
  };

  // ─── Messages ─────────────────────────────────────────────────────────────
  const messages = {
    threads: () => get('/messages'),
    thread: (listingId, otherId) => get(`/messages/${listingId}/${otherId}`),
    send: (listingId, receiverId, text) => post(`/messages/${listingId}/${receiverId}`, { text }),
    unreadCount: () => get('/messages/me/unread'),
  };

  // ─── Transactions ─────────────────────────────────────────────────────────
  const transactions = {
    list: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return get(`/transactions${qs ? '?' + qs : ''}`);
    },
    getById: (id) => get(`/transactions/${id}`),
    rate: (id, rating, review) => post(`/transactions/${id}/rate`, { rating, review }),
    dispute: (id, reason) => post(`/transactions/${id}/dispute`, { reason }),
  };

  // ─── Admin ────────────────────────────────────────────────────────────────
  const admin = {
    queue: (page) => get(`/admin/queue?page=${page || 1}`),
    approve: (id) => post(`/admin/listings/${id}/approve`),
    reject: (id, reason) => post(`/admin/listings/${id}/reject`, { reason }),
    deleteListing: (id) => request('DELETE', `/admin/listings/${id}`),
    updateListing: (id, data) => request('PUT', `/admin/listings/${id}`, data),
    getUserListings: (userId) => get(`/admin/users/${userId}/listings`),
    users: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return get(`/admin/users${qs ? '?' + qs : ''}`);
    },
    suspend: (id, ban, reason) => post(`/admin/users/${id}/suspend`, { ban, reason }),
    reports: (status) => get(`/admin/reports?status=${status || 'open'}`),
    resolveReport: (id, action, note) => post(`/admin/reports/${id}/resolve`, { action, note }),
    analytics: () => get('/admin/analytics'),
  };

  // ─── Toast notification ──────────────────────────────────────────────────
  function toast(msg, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    const icon = type === 'success' ? 'check_circle' : type === 'info' ? 'info' : 'error';
    t.innerHTML = `<span class="material-symbols-outlined" style="font-size:18px">${icon}</span>${msg}`;
    container.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  // ─── Format helpers ──────────────────────────────────────────────────────
  function formatPrice(listing) {
    const parts = [];
    if (listing.price) parts.push(`₹${listing.price.toLocaleString('en-IN')}`);
    if (listing.rentalRate) {
      parts.push(`₹${listing.rentalRate.toLocaleString('en-IN')} ${listing.rentalDuration || '/mo'}`);
    }
    return parts.join(' · ') || '—';
  }

  function timeAgo(date) {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  }

  function listingPhoto(listing, index = 0) {
    if (listing.photos && listing.photos[index]) {
      const photo = listing.photos[index];
      if (photo.startsWith('http') || photo.startsWith('data:')) return photo;
      return `${window.location.origin}${photo}`;
    }
    return `IMAGES/gate_nitrr_2026.jpg`;
  }

  function userAvatar(user) {
    if (user?.profilePhoto) {
      const photo = user.profilePhoto;
      if (photo.startsWith('http')) return photo;
      return `${window.location.origin}${photo}`;
    }
    const name = encodeURIComponent(`${user?.firstName || '?'} ${user?.lastName || ''}`);
    return `https://ui-avatars.com/api/?name=${name}&background=6c47ff&color=fff&size=64`;
  }

  function logout() {
    clearSession();
    toast('Logged out successfully', 'info');
    setTimeout(() => window.location.href = 'index.html', 800);
  }

  // Auto-inject nav items (NITRR Logo, Admin Panel link, Developer Credit & Logout button)
  function initNav() {
    if (typeof document === 'undefined') return;
    document.addEventListener('DOMContentLoaded', () => {
      // Global image error handler: replace broken images with NIT RR gate
      document.addEventListener('error', function(e) {
        if (e.target.tagName === 'IMG' && e.target.src && !e.target.dataset.fallback) {
          e.target.dataset.fallback = '1';
          e.target.src = 'IMAGES/gate_nitrr_2026.jpg';
        }
      }, true);

      // Inject NIT Raipur logo into topnav brand across all pages
      const brand = document.querySelector('.topnav__brand');
      if (brand && !brand.querySelector('.nitrr-logo')) {
        brand.style.display = 'inline-flex';
        brand.style.alignItems = 'center';
        brand.style.gap = '8px';
        brand.insertAdjacentHTML('afterbegin', '<img src="https://www.nitrr.ac.in/images/logo.png" alt="NITRR" class="nitrr-logo" style="height:32px; object-fit:contain;" onerror="this.onerror=null;this.src=\'IMAGES/gate_nitrr_2026.jpg\'"/>');
      }


      if (!isLoggedIn()) return;
      const user = getUser();

      // Inject Admin Panel link for admin users
      if (user?.role === 'admin') {
        const navLinks = document.querySelector('.topnav__links');
        if (navLinks && !navLinks.querySelector('[href="admin.html"]')) {
          const adminLink = document.createElement('a');
          adminLink.href = 'admin.html';
          adminLink.className = 'topnav__link';
          adminLink.style.color = 'var(--primary)';
          adminLink.style.fontWeight = '700';
          adminLink.textContent = 'Admin Panel';
          navLinks.appendChild(adminLink);
        }
      }

      // Inject Logout button
      const actions = document.querySelector('.topnav__actions');
      if (actions && !actions.querySelector('.logout-btn')) {
        const btn = document.createElement('button');
        btn.className = 'topnav__icon-btn logout-btn';
        btn.title = 'Logout';
        btn.onclick = () => logout();
        btn.innerHTML = '<span class="material-symbols-outlined" style="color:var(--error);">logout</span>';
        actions.appendChild(btn);
      }
    });
  }
  initNav();

  return {
    // Session
    getToken, setToken, getUser, setUser, clearSession, isLoggedIn, requireAuth, checkUrlToken, logout,
    // Resources
    auth, users, listings, messages, transactions, admin,
    // Utilities
    toast, formatPrice, timeAgo, listingPhoto, userAvatar,
  };
})();
