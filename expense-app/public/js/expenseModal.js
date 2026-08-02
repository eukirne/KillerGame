const ExpenseFlow = (() => {
  const CATEGORIES = [
    ['general', '🧾 General'],
    ['food', '🍔 Food & drink'],
    ['home', '🏠 Home'],
    ['transport', '🚗 Transport'],
    ['utilities', '💡 Utilities'],
    ['entertainment', '🎬 Entertainment'],
    ['travel', '✈️ Travel'],
    ['other', '📦 Other'],
  ];

  async function openChooser() {
    const [{ groups }, { friends }] = await Promise.all([Api.get('/groups'), Api.get('/users/friends')]);
    if (groups.length === 0 && friends.length === 0) {
      Toast.show('Add a friend or create a group first', 'error');
      return;
    }
    const groupOptions = groups.map((g) => `<option value="group:${g.id}">${Fmt.escapeHtml(g.name)}</option>`).join('');
    const friendOptions = friends.map((f) => `<option value="friend:${f.id}">${Fmt.escapeHtml(f.name)}</option>`).join('');

    Modal.open(`
      <h2>Add an expense</h2>
      <div class="field">
        <label>With</label>
        <select id="chooser-select">
          ${groupOptions ? `<optgroup label="Groups">${groupOptions}</optgroup>` : ''}
          ${friendOptions ? `<optgroup label="Friends">${friendOptions}</optgroup>` : ''}
        </select>
      </div>
      <button class="btn btn-primary btn-block" id="chooser-continue">Continue</button>
    `);

    document.getElementById('chooser-continue').addEventListener('click', async () => {
      const [kind, id] = document.getElementById('chooser-select').value.split(':');
      Modal.close();
      if (kind === 'group') await openForGroup(Number(id));
      else await openForFriend(friends.find((f) => f.id === Number(id)));
    });
  }

  async function openForGroup(groupId) {
    const { group } = await Api.get(`/groups/${groupId}`);
    open({ groupId, members: group.members, title: group.name });
  }

  async function openForFriend(friend, currentUser) {
    const me = currentUser || App.currentUser;
    open({ friendId: friend.id, members: [me, friend], title: friend.name });
  }

  function openForEdit(expense, members) {
    open({ groupId: expense.groupId, members, expense, title: expense.groupId ? undefined : undefined });
  }

  function open({ groupId, friendId, members, expense, title }) {
    const me = App.currentUser;
    const splitType = (expense && expense.splitType) || 'equal';
    const model = members.map((m) => {
      const existingShare = expense && expense.shares.find((s) => s.user.id === m.id);
      return {
        id: m.id,
        name: m.id === me.id ? 'You' : m.name,
        avatarColor: m.avatarColor,
        included: !!existingShare || !expense,
        exact: existingShare ? existingShare.amount : 0,
        percent: existingShare && expense.amount ? Math.round((existingShare.amount / expense.amount) * 10000) / 100 : 0,
        shares: 1,
      };
    });

    const state = {
      groupId: groupId || null,
      friendId: friendId || null,
      description: expense ? expense.description : '',
      amount: expense ? expense.amount : '',
      currency: expense ? expense.currency : 'USD',
      category: expense ? expense.category : 'general',
      date: expense ? expense.date : new Date().toISOString().slice(0, 10),
      paidBy: expense ? expense.paidBy.id : me.id,
      splitType,
      model,
    };

    render(state, expense, title);
  }

  function equalPreview(state) {
    const included = state.model.filter((m) => m.included);
    const amt = Number(state.amount) || 0;
    if (included.length === 0) return {};
    const each = amt / included.length;
    const out = {};
    included.forEach((m) => (out[m.id] = each));
    return out;
  }

  function render(state, editingExpense, title) {
    const me = App.currentUser;
    const catOptions = CATEGORIES.map(([v, l]) => `<option value="${v}" ${state.category === v ? 'selected' : ''}>${l}</option>`).join('');
    const payerOptions = state.model
      .map((m) => `<option value="${m.id}" ${state.paidBy === m.id ? 'selected' : ''}>${Fmt.escapeHtml(m.name)}</option>`)
      .join('');

    Modal.open(
      `
      <h2>${editingExpense ? 'Edit expense' : 'Add expense'}${title ? ` <span class="modal-subtitle">with ${Fmt.escapeHtml(title)}</span>` : ''}</h2>
      <div id="expense-form-error" class="auth-error hidden"></div>
      <div class="field-row">
        <div class="field field-grow">
          <label>Description</label>
          <input type="text" id="exp-description" placeholder="e.g. Dinner at Luigi's" value="${Fmt.escapeHtml(state.description)}"/>
        </div>
        <div class="field field-amount">
          <label>Amount</label>
          <div class="amount-input">
            <select id="exp-currency">
              <option value="USD" ${state.currency === 'USD' ? 'selected' : ''}>$</option>
              <option value="EUR" ${state.currency === 'EUR' ? 'selected' : ''}>€</option>
              <option value="GBP" ${state.currency === 'GBP' ? 'selected' : ''}>£</option>
            </select>
            <input type="number" id="exp-amount" min="0.01" step="0.01" placeholder="0.00" value="${state.amount || ''}"/>
          </div>
        </div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>Category</label>
          <select id="exp-category">${catOptions}</select>
        </div>
        <div class="field">
          <label>Date</label>
          <input type="date" id="exp-date" value="${state.date}"/>
        </div>
        <div class="field">
          <label>Paid by</label>
          <select id="exp-paidby">${payerOptions}</select>
        </div>
      </div>

      <div class="split-tabs" id="split-tabs">
        ${['equal', 'exact', 'percent', 'shares']
          .map(
            (t) =>
              `<button type="button" class="split-tab ${state.splitType === t ? 'active' : ''}" data-split="${t}">${
                { equal: 'Equal', exact: 'Exact amounts', percent: 'Percentages', shares: 'Shares' }[t]
              }</button>`
          )
          .join('')}
      </div>

      <div id="participants-list" class="participants-list"></div>
      <div id="split-summary" class="split-summary"></div>

      <div class="modal-actions">
        ${editingExpense ? `<button type="button" class="btn btn-danger" id="exp-delete">Delete</button>` : '<span></span>'}
        <button type="button" class="btn btn-primary" id="exp-save">${editingExpense ? 'Save changes' : 'Add expense'}</button>
      </div>
    `,
      { wide: true }
    );

    renderParticipants(state);
    wireEvents(state, editingExpense);
  }

  function renderParticipants(state) {
    const listEl = document.getElementById('participants-list');
    const amt = Number(state.amount) || 0;
    const preview = state.splitType === 'equal' ? equalPreview(state) : null;

    listEl.innerHTML = state.model
      .map((m) => {
        let inputHtml = '';
        if (state.splitType === 'equal') {
          const share = preview[m.id];
          inputHtml = `<span class="participant-computed">${m.included && share !== undefined ? Fmt.money(share, state.currency) : '—'}</span>`;
        } else if (state.splitType === 'exact') {
          inputHtml = `<input type="number" min="0" step="0.01" class="participant-input" data-field="exact" data-user="${m.id}" value="${m.exact || ''}" placeholder="0.00"/>`;
        } else if (state.splitType === 'percent') {
          inputHtml = `<input type="number" min="0" step="0.01" class="participant-input" data-field="percent" data-user="${m.id}" value="${m.percent || ''}" placeholder="0"/><span class="unit">%</span>`;
        } else if (state.splitType === 'shares') {
          inputHtml = `<input type="number" min="0" step="1" class="participant-input" data-field="shares" data-user="${m.id}" value="${m.shares || 1}"/>`;
        }
        const checkboxDisabled = state.splitType !== 'equal' ? '' : '';
        return `
        <label class="participant-row">
          <span class="participant-name"><span class="avatar avatar-sm" style="background:${m.avatarColor}">${Fmt.initials(m.name === 'You' ? App.currentUser.name : m.name)}</span>${Fmt.escapeHtml(m.name)}</span>
          <input type="checkbox" class="participant-check" data-user="${m.id}" ${m.included ? 'checked' : ''} ${checkboxDisabled}/>
          ${inputHtml}
        </label>`;
      })
      .join('');

    updateSummary(state);
  }

  function updateSummary(state) {
    const summaryEl = document.getElementById('split-summary');
    const amt = Number(state.amount) || 0;
    let text = '';
    if (state.splitType === 'exact') {
      const sum = state.model.filter((m) => m.included).reduce((s, m) => s + (Number(m.exact) || 0), 0);
      const diff = Math.round((amt - sum) * 100) / 100;
      text = diff === 0 ? 'Amounts add up ✓' : `${Fmt.money(Math.abs(diff), state.currency)} ${diff > 0 ? 'left to assign' : 'over the total'}`;
    } else if (state.splitType === 'percent') {
      const sum = state.model.filter((m) => m.included).reduce((s, m) => s + (Number(m.percent) || 0), 0);
      const diff = Math.round((100 - sum) * 100) / 100;
      text = diff === 0 ? 'Percentages add up to 100% ✓' : `${diff}% left to assign`;
    } else if (state.splitType === 'equal') {
      const n = state.model.filter((m) => m.included).length;
      text = n > 0 ? `Split equally between ${n} ${n === 1 ? 'person' : 'people'}` : 'Select at least one person';
    } else if (state.splitType === 'shares') {
      const totalShares = state.model.filter((m) => m.included).reduce((s, m) => s + (Number(m.shares) || 0), 0);
      text = totalShares > 0 ? `${totalShares} total shares` : 'Select at least one person';
    }
    summaryEl.textContent = text;
  }

  function wireEvents(state, editingExpense) {
    document.getElementById('exp-description').addEventListener('input', (e) => (state.description = e.target.value));
    document.getElementById('exp-amount').addEventListener('input', (e) => {
      state.amount = e.target.value;
      renderParticipants(state);
    });
    document.getElementById('exp-currency').addEventListener('change', (e) => (state.currency = e.target.value));
    document.getElementById('exp-category').addEventListener('change', (e) => (state.category = e.target.value));
    document.getElementById('exp-date').addEventListener('change', (e) => (state.date = e.target.value));
    document.getElementById('exp-paidby').addEventListener('change', (e) => (state.paidBy = Number(e.target.value)));

    document.getElementById('split-tabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.split-tab');
      if (!btn) return;
      state.splitType = btn.dataset.split;
      document.querySelectorAll('.split-tab').forEach((b) => b.classList.toggle('active', b === btn));
      renderParticipants(state);
    });

    document.getElementById('participants-list').addEventListener('input', (e) => {
      const userId = Number(e.target.dataset.user);
      const m = state.model.find((x) => x.id === userId);
      if (!m) return;
      if (e.target.classList.contains('participant-check')) {
        m.included = e.target.checked;
        renderParticipants(state);
        return;
      }
      const field = e.target.dataset.field;
      if (field) {
        m[field] = e.target.value;
        updateSummary(state);
      }
    });

    document.getElementById('exp-save').addEventListener('click', () => save(state, editingExpense));
    if (editingExpense) {
      document.getElementById('exp-delete').addEventListener('click', () => remove(editingExpense));
    }
  }

  function showError(msg) {
    const el = document.getElementById('expense-form-error');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function buildParticipants(state) {
    const included = state.model.filter((m) => m.included);
    if (state.splitType === 'equal') return included.map((m) => m.id);
    if (state.splitType === 'exact') return included.map((m) => ({ userId: m.id, amount: Number(m.exact) || 0 }));
    if (state.splitType === 'percent') return included.map((m) => ({ userId: m.id, percent: Number(m.percent) || 0 }));
    if (state.splitType === 'shares') return included.map((m) => ({ userId: m.id, shares: Number(m.shares) || 0 }));
    return [];
  }

  async function save(state, editingExpense) {
    if (!state.description.trim()) return showError('Please enter a description');
    if (!(Number(state.amount) > 0)) return showError('Please enter an amount greater than 0');
    if (state.model.filter((m) => m.included).length === 0) return showError('Select at least one participant');

    const payload = {
      groupId: state.groupId,
      description: state.description,
      amount: Number(state.amount),
      currency: state.currency,
      category: state.category,
      date: state.date,
      paidBy: state.paidBy,
      splitType: state.splitType,
      participants: buildParticipants(state),
    };

    try {
      if (editingExpense) {
        await Api.put(`/expenses/${editingExpense.id}`, payload);
        Toast.show('Expense updated');
      } else {
        await Api.post('/expenses', payload);
        Toast.show('Expense added');
      }
      Modal.close();
      App.refreshCurrentView();
    } catch (e) {
      showError(e.message);
    }
  }

  async function remove(expense) {
    if (!confirm('Delete this expense?')) return;
    try {
      await Api.del(`/expenses/${expense.id}`);
      Modal.close();
      Toast.show('Expense deleted');
      App.refreshCurrentView();
    } catch (e) {
      Toast.show(e.message, 'error');
    }
  }

  return { openChooser, openForGroup, openForFriend, openForEdit };
})();
