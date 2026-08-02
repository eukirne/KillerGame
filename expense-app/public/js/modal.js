const Modal = (() => {
  const root = () => document.getElementById('modal-root');

  function open(innerHtml, { wide } = {}) {
    root().innerHTML = `
      <div class="modal-overlay" id="modal-overlay">
        <div class="modal-card ${wide ? 'modal-wide' : ''}">
          <button class="modal-close" id="modal-close-btn" aria-label="Close">&times;</button>
          ${innerHtml}
        </div>
      </div>`;
    document.getElementById('modal-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'modal-overlay') close();
    });
    document.getElementById('modal-close-btn').addEventListener('click', close);
  }

  function close() {
    root().innerHTML = '';
  }

  return { open, close };
})();

const Toast = (() => {
  function show(message, type = 'info') {
    const root = document.getElementById('toast-root');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('toast-visible'));
    setTimeout(() => {
      el.classList.remove('toast-visible');
      setTimeout(() => el.remove(), 250);
    }, 3200);
  }
  return { show };
})();
