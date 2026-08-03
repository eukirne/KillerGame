const App = (() => {
  let currentUser = null;
  let currentRoute = null;

  function showAuthScreen() {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('app-shell').classList.add('hidden');
  }

  function showApp() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');
  }

  function renderUserChip() {
    const html = `<span class="avatar avatar-sm" style="background:${currentUser.avatarColor}">${Fmt.initials(currentUser.name)}</span><span class="user-chip-name">${Fmt.escapeHtml(currentUser.name)}</span>`;
    document.getElementById('user-chip').innerHTML = html;
    document.getElementById('mobile-user-chip').innerHTML = html;
  }

  function logout() {
    Api.setToken(null);
    currentUser = null;
    location.hash = '';
    showAuthScreen();
  }

  async function refreshFriendBadge() {
    const badge = document.getElementById('friends-badge');
    if (!badge) return;
    try {
      const { requests } = await Api.get('/users/friend-requests');
      if (requests.length) {
        badge.textContent = requests.length;
        badge.classList.remove('hidden');
      } else {
        badge.classList.add('hidden');
      }
    } catch (e) {
      // non-critical — leave the badge as-is
    }
  }

  async function boot() {
    wireAuthForms();
    wireShell();
    wireGoogleSignIn();
    wireNavDropdown();

    const token = Api.getToken();
    if (!token) {
      showAuthScreen();
      return;
    }
    try {
      const { user } = await Api.get('/auth/me');
      currentUser = user;
      showApp();
      renderUserChip();
      refreshFriendBadge();
      window.addEventListener('hashchange', route);
      route();
    } catch (e) {
      Api.setToken(null);
      showAuthScreen();
    }
  }

  function handleAuthSuccess(token, user) {
    Api.setToken(token);
    currentUser = user;
    showApp();
    renderUserChip();
    refreshFriendBadge();
    window.addEventListener('hashchange', route);
    location.hash = '#/dashboard';
    route();
  }

  async function wireGoogleSignIn() {
    try {
      const { googleClientId } = await Api.get('/auth/config');
      if (!googleClientId || !window.google || !window.google.accounts) return;

      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async ({ credential }) => {
          const errorEl = document.getElementById('auth-error');
          errorEl.classList.add('hidden');
          try {
            const { token, user } = await Api.post('/auth/google', { credential });
            handleAuthSuccess(token, user);
          } catch (err) {
            errorEl.textContent = err.message;
            errorEl.classList.remove('hidden');
          }
        },
      });
      window.google.accounts.id.renderButton(document.getElementById('google-signin-container'), {
        theme: 'outline',
        size: 'large',
        width: 320,
        text: 'continue_with',
      });
      document.getElementById('google-signin-container').classList.remove('hidden');
      document.getElementById('auth-divider').classList.remove('hidden');
    } catch (e) {
      // Google sign-in is optional — if config fetch fails or the script
      // didn't load, the app falls back to email/password only.
    }
  }

  function wireAuthForms() {
    const loginForm = document.getElementById('login-form');
    const signupForm = document.getElementById('signup-form');
    const errorEl = document.getElementById('auth-error');

    document.getElementById('show-signup').addEventListener('click', (e) => {
      e.preventDefault();
      loginForm.classList.add('hidden');
      signupForm.classList.remove('hidden');
      errorEl.classList.add('hidden');
    });
    document.getElementById('show-login').addEventListener('click', (e) => {
      e.preventDefault();
      signupForm.classList.add('hidden');
      loginForm.classList.remove('hidden');
      errorEl.classList.add('hidden');
    });

    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.classList.add('hidden');
      try {
        const { token, user } = await Api.post('/auth/login', {
          email: document.getElementById('login-email').value,
          password: document.getElementById('login-password').value,
        });
        handleAuthSuccess(token, user);
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
      }
    });

    signupForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.classList.add('hidden');
      try {
        const { token, user } = await Api.post('/auth/signup', {
          name: document.getElementById('signup-name').value,
          email: document.getElementById('signup-email').value,
          password: document.getElementById('signup-password').value,
        });
        handleAuthSuccess(token, user);
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.remove('hidden');
      }
    });
  }

  const HAMBURGER_ICON = '☰';
  const CLOSE_ICON = '✕';

  function wireNavDropdown() {
    const toggle = document.getElementById('nav-dropdown-toggle');
    const icon = document.getElementById('nav-dropdown-icon');
    const menu = document.getElementById('side-nav');
    if (!toggle || !menu) return;

    const close = () => {
      menu.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      if (icon) icon.textContent = HAMBURGER_ICON;
    };
    const open = () => {
      menu.classList.add('open');
      toggle.setAttribute('aria-expanded', 'true');
      if (icon) icon.textContent = CLOSE_ICON;
    };

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (menu.classList.contains('open')) close();
      else open();
    });
    menu.addEventListener('click', (e) => {
      if (e.target.tagName === 'A') close();
    });
    document.addEventListener('click', (e) => {
      if (!menu.contains(e.target) && e.target !== toggle && !toggle.contains(e.target)) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
    });
  }

  function wireShell() {
    document.getElementById('logout-btn').addEventListener('click', logout);
    document.getElementById('mobile-logout-btn').addEventListener('click', logout);
    document.getElementById('add-expense-btn').addEventListener('click', () => ExpenseFlow.openChooser());
    document.getElementById('new-group-btn').addEventListener('click', () => Views.openCreateGroupModal());
    document.getElementById('add-friend-btn').addEventListener('click', () => Views.openAddFriendModal());
  }

  const TITLES = { dashboard: 'Dashboard', groups: 'Groups', friends: 'Friends', activity: 'Activity' };

  async function route() {
    const hash = location.hash.replace(/^#\//, '') || 'dashboard';
    const parts = hash.split('/');
    currentRoute = hash;
    const root = document.getElementById('view-root');

    document.querySelectorAll('.side-nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === parts[0]));
    refreshFriendBadge();

    try {
      if (parts[0] === 'dashboard') {
        setTitle('Dashboard');
        await Views.dashboard(root);
      } else if (parts[0] === 'groups' && parts[1]) {
        setTitle('Group');
        await Views.groupDetail(root, Number(parts[1]));
      } else if (parts[0] === 'groups') {
        setTitle('Groups');
        await Views.groups(root);
      } else if (parts[0] === 'friends' && parts[1]) {
        setTitle('Friend');
        await Views.friendDetail(root, Number(parts[1]));
      } else if (parts[0] === 'friends') {
        setTitle('Friends');
        await Views.friends(root);
      } else if (parts[0] === 'activity') {
        setTitle('Activity');
        await Views.activity(root);
      } else {
        setTitle('Dashboard');
        await Views.dashboard(root);
      }
    } catch (e) {
      if (e.status === 401) {
        Api.setToken(null);
        showAuthScreen();
        return;
      }
      root.innerHTML = `<div class="empty-state"><div class="empty-title">Something went wrong</div><div class="empty-body">${Fmt.escapeHtml(e.message)}</div></div>`;
    }
  }

  function setTitle(title) {
    document.getElementById('page-title').textContent = title;
  }

  function refreshCurrentView() {
    route();
  }

  return {
    boot,
    refreshCurrentView,
    refreshFriendBadge,
    get currentUser() {
      return currentUser;
    },
  };
})();

document.addEventListener('DOMContentLoaded', App.boot);
