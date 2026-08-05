const Views = (() => {
  const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'INR', 'MXN', 'BRL', 'CHF'];

  function balanceClass(amount) {
    if (amount > 0.004) return 'positive';
    if (amount < -0.004) return 'negative';
    return 'settled';
  }

  function balanceLabel(amount, currency) {
    if (Math.abs(amount) < 0.005) return 'settled up';
    return amount > 0 ? `owes you ${Fmt.money(amount, currency)}` : `you owe ${Fmt.money(-amount, currency)}`;
  }

  function avatar(user, size) {
    const cls = size === 'lg' ? 'avatar avatar-lg' : size === 'sm' ? 'avatar avatar-sm' : 'avatar';
    return `<span class="${cls}" style="background:${user.avatarColor}">${Fmt.initials(user.name)}</span>`;
  }

  // ---------- Dashboard ----------
  async function dashboard(root) {
    root.innerHTML = `<div class="skeleton">Loading…</div>`;
    const [summary, { groups }, { friends }, { activity }] = await Promise.all([
      Api.get('/dashboard'),
      Api.get('/groups'),
      Api.get('/users/friends'),
      Api.get('/activity?limit=8'),
    ]);

    root.innerHTML = `
      <div class="summary-row">
        <div class="summary-card">
          <div class="summary-label">You are owed</div>
          <div class="summary-value positive">${Fmt.money(summary.totalOwedToYou, summary.currency)}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">You owe</div>
          <div class="summary-value negative">${Fmt.money(summary.totalYouOwe, summary.currency)}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">Net balance</div>
          <div class="summary-value ${balanceClass(summary.netBalance)}">${Fmt.money(summary.netBalance, summary.currency)}</div>
        </div>
      </div>
      <div class="fx-note">Converted to ${summary.currency} using the exchange rate on each expense's date.</div>


      <div class="dash-grid">
        <section class="panel">
          <div class="panel-header"><h3>Groups</h3><a href="#/groups" class="panel-link">See all</a></div>
          ${groups.length === 0 ? emptyState('No groups yet', 'Create a group to start splitting bills together.') : groupList(groups)}
        </section>
        <section class="panel">
          <div class="panel-header"><h3>Friends</h3><a href="#/friends" class="panel-link">See all</a></div>
          ${friends.length === 0 ? emptyState('No friends yet', 'Add a friend by email — once they accept, you can split expenses together.') : friendList(friends, summary.currency)}
        </section>
      </div>

      <section class="panel">
        <div class="panel-header"><h3>Recent activity</h3><a href="#/activity" class="panel-link">See all</a></div>
        ${activity.length === 0 ? emptyState('Nothing yet', 'Expenses and settlements will show up here.') : activityList(activity)}
      </section>
    `;
    wireGroupLinks(root);
    wireFriendLinks(root);
  }

  function emptyState(title, body) {
    return `<div class="empty-state"><div class="empty-title">${title}</div><div class="empty-body">${body}</div></div>`;
  }

  function groupList(groups) {
    return `<div class="list">${groups
      .map(
        (g) => `
      <a href="#/groups/${g.id}" class="list-row">
        <span class="list-icon">${groupEmoji(g.type)}</span>
        <span class="list-main">
          <span class="list-title">${Fmt.escapeHtml(g.name)}</span>
          <span class="list-sub">${g.members.length} ${g.members.length === 1 ? 'member' : 'members'}</span>
        </span>
        <span class="list-balance ${balanceClass(g.yourBalanceCents / 100)}">${balanceLabel(g.yourBalanceCents / 100, g.currency)}</span>
      </a>`
      )
      .join('')}</div>`;
  }

  function friendList(friends, currency) {
    return `<div class="list">${friends
      .map(
        (f) => `
      <a href="#/friends/${f.id}" class="list-row">
        ${avatar(f)}
        <span class="list-main">
          <span class="list-title">${Fmt.escapeHtml(f.name)}</span>
          <span class="list-sub">${Fmt.escapeHtml(f.username ? '@' + f.username : f.email || '')}</span>
        </span>
        <span class="list-balance ${balanceClass(f.balance)}">${balanceLabel(f.balance, currency)}</span>
      </a>`
      )
      .join('')}</div>`;
  }

  function activityList(items) {
    return `<div class="list">${items.map(activityRow).join('')}</div>`;
  }

  function activityRow(item) {
    const context = item.groupName ? `in ${Fmt.escapeHtml(item.groupName)}` : '';
    if (item.type === 'expense') {
      return `<div class="list-row activity-row">
        <span class="list-icon">🧾</span>
        <span class="list-main">
          <span class="list-title">${Fmt.escapeHtml(item.paidBy.name)} added "${Fmt.escapeHtml(item.description)}" ${context}</span>
          <span class="list-sub">${Fmt.dateTime(item.createdAt)}</span>
        </span>
        <span class="list-balance">${Fmt.money(item.amount, item.currency)}</span>
      </div>`;
    }
    return `<div class="list-row activity-row">
      <span class="list-icon">💸</span>
      <span class="list-main">
        <span class="list-title">${Fmt.escapeHtml(item.from.name)} paid ${Fmt.escapeHtml(item.to.name)} ${context}</span>
        <span class="list-sub">${Fmt.dateTime(item.createdAt)}</span>
      </span>
      <span class="list-balance positive">${Fmt.money(item.amount, item.currency)}</span>
    </div>`;
  }

  function groupEmoji(type) {
    return { trip: '✈️', home: '🏠', couple: '💞', other: '👥' }[type] || '👥';
  }

  function wireGroupLinks() {}
  function wireFriendLinks() {}

  // ---------- Groups list ----------
  async function groups(root) {
    root.innerHTML = `<div class="skeleton">Loading…</div>`;
    const { groups } = await Api.get('/groups');
    root.innerHTML = `
      <section class="panel">
        ${groups.length === 0 ? emptyState('No groups yet', 'Create a group to start splitting bills together.') : groupList(groups)}
      </section>`;
  }

  // ---------- Group detail ----------
  async function groupDetail(root, id) {
    root.innerHTML = `<div class="skeleton">Loading…</div>`;
    const [{ group, netBalances, pairwiseBalances, simplifiedDebts, currency }, { expenses }] = await Promise.all([
      Api.get(`/groups/${id}`),
      Api.get(`/expenses?groupId=${id}`),
    ]);

    root.innerHTML = `
      <div class="detail-header">
        <div>
          <h2>${Fmt.escapeHtml(group.name)}</h2>
          <div class="member-avatars">${group.members.map((m) => avatar(m, 'sm')).join('')}<span class="member-count">${group.members.length} ${group.members.length === 1 ? 'member' : 'members'}</span></div>
        </div>
        <div class="detail-actions">
          <button class="btn btn-secondary" id="group-invite-btn">Add member</button>
          <button class="btn btn-primary" id="group-add-expense-btn">Add expense</button>
        </div>
      </div>

      <div class="tabs">
        <button class="tab active" data-tab="expenses">Expenses</button>
        <button class="tab" data-tab="balances">Balances</button>
      </div>

      <div id="tab-expenses" class="tab-panel">
        ${expenses.length === 0 ? emptyState('No expenses yet', 'Add the first expense for this group.') : expensesList(expenses)}
      </div>
      <div id="tab-balances" class="tab-panel hidden">
        ${balancesPanel(group, netBalances, pairwiseBalances, simplifiedDebts, id, currency)}
      </div>
    `;

    root.querySelectorAll('.tab').forEach((tab) =>
      tab.addEventListener('click', () => {
        root.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
        root.querySelectorAll('.tab-panel').forEach((p) => p.classList.add('hidden'));
        document.getElementById(`tab-${tab.dataset.tab}`).classList.remove('hidden');
      })
    );

    document.getElementById('group-add-expense-btn').addEventListener('click', () => ExpenseFlow.openForGroup(id));
    document.getElementById('group-invite-btn').addEventListener('click', () =>
      openInviteModal(id, group.members.map((m) => m.id))
    );

    root.querySelectorAll('[data-expense-id]').forEach((row) =>
      row.addEventListener('click', () => openExpenseDetail(Number(row.dataset.expenseId), group.members))
    );
    root.querySelectorAll('[data-settle]').forEach((btn) =>
      btn.addEventListener('click', () => {
        const [fromId, toId, amount] = btn.dataset.settle.split('|');
        openSettleModal({ groupId: id, fromId: Number(fromId), toId: Number(toId), amount: Number(amount), members: group.members, currency });
      })
    );
  }

  function expensesList(expenses) {
    return `<div class="list">${expenses
      .map(
        (e) => `
      <div class="list-row expense-row" data-expense-id="${e.id}">
        <span class="list-icon">${categoryEmoji(e.category)}</span>
        <span class="list-main">
          <span class="list-title">${Fmt.escapeHtml(e.description)}</span>
          <span class="list-sub">${Fmt.date(e.date)} · paid by ${Fmt.escapeHtml(e.paidBy.name)}</span>
        </span>
        <span class="list-balance">${Fmt.money(e.amount, e.currency)}</span>
      </div>`
      )
      .join('')}</div>`;
  }

  function categoryEmoji(cat) {
    return { food: '🍔', home: '🏠', transport: '🚗', utilities: '💡', entertainment: '🎬', travel: '✈️', general: '🧾', other: '📦' }[cat] || '🧾';
  }

  function balancesPanel(group, netBalances, pairwiseBalances, simplifiedDebts, groupId, currency) {
    const byId = Object.fromEntries(group.members.map((m) => [m.id, m]));
    const netRows = group.members
      .map((m) => {
        const amt = netBalances[m.id] || 0;
        return `<div class="list-row">
          ${avatar(m, 'sm')}
          <span class="list-main"><span class="list-title">${Fmt.escapeHtml(m.name)}</span></span>
          <span class="list-balance ${balanceClass(amt)}">${amt >= 0 ? 'gets back ' : 'owes '}${Fmt.money(Math.abs(amt), currency)}</span>
        </div>`;
      })
      .join('');

    const simplified = simplifiedDebts.length
      ? simplifiedDebts
          .map(
            (t) => `<div class="list-row">
        <span class="list-main"><span class="list-title">${Fmt.escapeHtml(t.from.name)} → ${Fmt.escapeHtml(t.to.name)}</span></span>
        <span class="list-balance negative">${Fmt.money(t.amount, currency)}</span>
        <button class="btn btn-tiny" data-settle="${t.from.id}|${t.to.id}|${t.amount}">Settle</button>
      </div>`
          )
          .join('')
      : `<div class="empty-state">${emptyState('All settled up', 'No payments needed within this group.')}</div>`;

    return `
      <div class="fx-note">Expenses in other currencies are converted to ${currency} using the exchange rate on their date.</div>
      <div class="panel-subsection">
        <h4>Net balances</h4>
        <div class="list">${netRows}</div>
      </div>
      <div class="panel-subsection">
        <h4>Suggested settlements</h4>
        <div class="list">${simplified}</div>
      </div>
    `;
  }

  async function friendsPickerHtml(excludeIds = []) {
    const { friends } = await Api.get('/users/friends');
    const eligible = friends.filter((f) => !excludeIds.includes(f.id));
    if (eligible.length === 0) {
      return `<div class="empty-body">No friends to add yet — send a friend request first, or use the email option below.</div>`;
    }
    return `<div class="friends-picker">${eligible
      .map(
        (f) => `
      <label class="friends-picker-row">
        <input type="checkbox" value="${f.id}" class="friend-picker-check"/>
        ${avatar(f, 'sm')}
        <span class="list-main"><span class="list-title">${Fmt.escapeHtml(f.name)}</span><span class="list-sub">${Fmt.escapeHtml(f.username ? '@' + f.username : f.email || '')}</span></span>
      </label>`
      )
      .join('')}</div>`;
  }

  function wireEmailFallbackToggle() {
    const toggle = document.getElementById('toggle-email-invite');
    const field = document.getElementById('email-invite-field');
    if (!toggle || !field) return;
    toggle.addEventListener('click', () => field.classList.toggle('hidden'));
  }

  async function openInviteModal(groupId, existingMemberIds) {
    const pickerHtml = await friendsPickerHtml(existingMemberIds);
    Modal.open(`
      <h2>Add a member</h2>
      <div id="invite-error" class="auth-error hidden"></div>
      <div class="field"><label>Friends</label>${pickerHtml}</div>
      <button type="button" class="btn-link" id="toggle-email-invite">Invite by email instead</button>
      <div class="field hidden" id="email-invite-field"><label>Email address</label><input type="email" id="invite-email" placeholder="friend@example.com"/></div>
      <button class="btn btn-primary btn-block" id="invite-submit">Add to group</button>
    `);
    wireEmailFallbackToggle();
    document.getElementById('invite-submit').addEventListener('click', async () => {
      const userIds = Array.from(document.querySelectorAll('.friend-picker-check:checked')).map((el) => Number(el.value));
      const email = document.getElementById('invite-email').value.trim();
      if (!userIds.length && !email) {
        return showFieldError('invite-error', 'Select at least one friend, or enter an email');
      }
      try {
        await Api.post(`/groups/${groupId}/members`, userIds.length ? { userIds } : { email });
        Modal.close();
        Toast.show('Member added');
        App.refreshCurrentView();
      } catch (e) {
        showFieldError('invite-error', e.message);
      }
    });
  }

  async function openExpenseDetail(expenseId, groupMembers) {
    const { expense, comments } = await Api.get(`/expenses/${expenseId}`);
    Modal.open(`
      <h2>${Fmt.escapeHtml(expense.description)}</h2>
      <div class="expense-detail-amount">${Fmt.money(expense.amount, expense.currency)}</div>
      <div class="expense-detail-meta">${Fmt.date(expense.date)} · paid by ${Fmt.escapeHtml(expense.paidBy.name)} · ${Fmt.escapeHtml(expense.category)}</div>
      <div class="panel-subsection">
        <h4>Split</h4>
        <div class="list">${expense.shares
          .map(
            (s) => `<div class="list-row">${avatar(s.user, 'sm')}<span class="list-main"><span class="list-title">${Fmt.escapeHtml(s.user.name)}</span></span><span class="list-balance">${Fmt.money(s.amount, expense.currency)}</span></div>`
          )
          .join('')}</div>
      </div>
      <div class="panel-subsection">
        <h4>Comments</h4>
        <div class="list" id="comments-list">${comments
          .map((c) => `<div class="comment-row"><b>${Fmt.escapeHtml(c.user.name)}</b> ${Fmt.escapeHtml(c.body)}<span class="list-sub">${Fmt.dateTime(c.createdAt)}</span></div>`)
          .join('') || '<div class="empty-body">No comments yet.</div>'}</div>
        <div class="field-row">
          <input type="text" id="comment-input" placeholder="Add a comment…" class="field-grow"/>
          <button class="btn btn-secondary" id="comment-submit">Post</button>
        </div>
      </div>
      <div class="modal-actions">
        <span></span>
        <button class="btn btn-secondary" id="expense-edit-btn">Edit expense</button>
      </div>
    `, { wide: true });

    document.getElementById('comment-submit').addEventListener('click', async () => {
      const input = document.getElementById('comment-input');
      if (!input.value.trim()) return;
      try {
        await Api.post(`/expenses/${expenseId}/comments`, { body: input.value.trim() });
        Modal.close();
        openExpenseDetail(expenseId, groupMembers);
      } catch (e) {
        Toast.show(e.message, 'error');
      }
    });
    document.getElementById('expense-edit-btn').addEventListener('click', () => {
      Modal.close();
      ExpenseFlow.openForEdit(expense, groupMembers);
    });
  }

  // ---------- Friends ----------
  async function friends(root) {
    root.innerHTML = `<div class="skeleton">Loading…</div>`;
    const [{ friends, currency }, { requests }] = await Promise.all([Api.get('/users/friends'), Api.get('/users/friend-requests')]);

    root.innerHTML = `
      ${requests.length ? `<section class="panel">${friendRequestsPanel(requests)}</section>` : ''}
      <section class="panel">${friends.length === 0 ? emptyState('No friends yet', 'Add a friend by email — once they accept, you can split expenses together.') : friendList(friends, currency)}</section>
    `;
    wireFriendRequestActions(root);
  }

  function friendRequestsPanel(requests) {
    return `
      <h3 class="panel-subheading">Friend requests</h3>
      <div class="list">
        ${requests
          .map(
            (r) => `
          <div class="list-row">
            ${avatar(r.from, 'sm')}
            <span class="list-main"><span class="list-title">${Fmt.escapeHtml(r.from.name)}</span><span class="list-sub">${Fmt.escapeHtml(r.from.username ? '@' + r.from.username : r.from.email || '')}</span></span>
            <button class="btn btn-tiny" data-accept-request="${r.id}">Accept</button>
            <button class="btn btn-tiny btn-ghost" data-decline-request="${r.id}">Decline</button>
          </div>`
          )
          .join('')}
      </div>
    `;
  }

  function wireFriendRequestActions(root) {
    root.querySelectorAll('[data-accept-request]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        try {
          await Api.post(`/users/friend-requests/${btn.dataset.acceptRequest}/accept`);
          Toast.show('Friend request accepted');
          App.refreshFriendBadge();
          App.refreshCurrentView();
        } catch (e) {
          Toast.show(e.message, 'error');
        }
      })
    );
    root.querySelectorAll('[data-decline-request]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        try {
          await Api.post(`/users/friend-requests/${btn.dataset.declineRequest}/decline`);
          App.refreshFriendBadge();
          App.refreshCurrentView();
        } catch (e) {
          Toast.show(e.message, 'error');
        }
      })
    );
  }

  async function friendDetail(root, id) {
    root.innerHTML = `<div class="skeleton">Loading…</div>`;
    const [{ friends, currency }, { expenses }, { settlements }] = await Promise.all([
      Api.get('/users/friends'),
      Api.get(`/expenses?friendId=${id}`),
      Api.get(`/settlements?friendId=${id}`),
    ]);
    const friend = friends.find((f) => f.id === Number(id));
    if (!friend) {
      root.innerHTML = emptyState('Friend not found', '');
      return;
    }

    const combined = [
      ...expenses.map((e) => ({ ...e, kind: 'expense', when: e.createdAt })),
      ...settlements.map((s) => ({ ...s, kind: 'settlement', when: s.createdAt })),
    ].sort((a, b) => (a.when < b.when ? 1 : -1));

    root.innerHTML = `
      <div class="detail-header">
        <div class="friend-heading">
          ${avatar(friend, 'lg')}
          <div>
            <h2>${Fmt.escapeHtml(friend.name)}</h2>
            <div class="list-balance ${balanceClass(friend.balance)}">${balanceLabel(friend.balance, currency)}</div>
          </div>
        </div>
        <div class="detail-actions">
          <button class="btn btn-secondary" id="friend-settle-btn" ${Math.abs(friend.balance) < 0.005 ? 'disabled' : ''}>Settle up</button>
          <button class="btn btn-primary" id="friend-add-expense-btn">Add expense</button>
        </div>
      </div>
      <section class="panel">
        ${combined.length === 0 ? emptyState('No shared history yet', 'Add an expense to split with this friend.') : combined.map((item) => (item.kind === 'expense' ? friendExpenseRow(item) : friendSettlementRow(item))).join('')}
      </section>
    `;

    document.getElementById('friend-add-expense-btn').addEventListener('click', () => ExpenseFlow.openForFriend(friend));
    document.getElementById('friend-settle-btn').addEventListener('click', () => {
      const amount = Math.abs(friend.balance);
      const fromId = friend.balance > 0 ? friend.id : App.currentUser.id;
      const toId = friend.balance > 0 ? App.currentUser.id : friend.id;
      openSettleModal({ fromId, toId, amount, members: [App.currentUser, friend], currency });
    });
  }

  function friendExpenseRow(e) {
    return `<div class="list-row">
      <span class="list-icon">${categoryEmoji(e.category)}</span>
      <span class="list-main"><span class="list-title">${Fmt.escapeHtml(e.description)}</span><span class="list-sub">${Fmt.date(e.date)} · paid by ${Fmt.escapeHtml(e.paidBy.name)}</span></span>
      <span class="list-balance">${Fmt.money(e.amount, e.currency)}</span>
    </div>`;
  }

  function friendSettlementRow(s) {
    return `<div class="list-row">
      <span class="list-icon">💸</span>
      <span class="list-main"><span class="list-title">${Fmt.escapeHtml(s.from.name)} paid ${Fmt.escapeHtml(s.to.name)}</span><span class="list-sub">${Fmt.date(s.date)}</span></span>
      <span class="list-balance positive">${Fmt.money(s.amount, s.currency)}</span>
    </div>`;
  }

  // ---------- Activity ----------
  async function activity(root) {
    root.innerHTML = `<div class="skeleton">Loading…</div>`;
    const { activity } = await Api.get('/activity?limit=100');
    root.innerHTML = `<section class="panel">${activity.length === 0 ? emptyState('Nothing yet', 'Expenses and settlements will show up here.') : activityList(activity)}</section>`;
  }

  // ---------- Shared modals ----------
  async function openCreateGroupModal() {
    const pickerHtml = await friendsPickerHtml();
    Modal.open(
      `
      <h2>Create a group</h2>
      <div id="group-error" class="auth-error hidden"></div>
      <div class="field"><label>Group name</label><input type="text" id="new-group-name" placeholder="e.g. Apartment 4B"/></div>
      <div class="field"><label>Type</label>
        <select id="new-group-type">
          <option value="home">Home</option>
          <option value="trip">Trip</option>
          <option value="couple">Couple</option>
          <option value="other" selected>Other</option>
        </select>
      </div>
      <div class="field"><label>Add friends</label>${pickerHtml}</div>
      <button type="button" class="btn-link" id="toggle-email-invite">Invite by email instead</button>
      <div class="field hidden" id="email-invite-field"><label>Invite by email (comma separated)</label><input type="text" id="new-group-emails" placeholder="a@example.com, b@example.com"/></div>
      <button class="btn btn-primary btn-block" id="new-group-submit">Create group</button>
    `,
      { wide: true }
    );
    wireEmailFallbackToggle();
    document.getElementById('new-group-submit').addEventListener('click', async () => {
      const name = document.getElementById('new-group-name').value.trim();
      const type = document.getElementById('new-group-type').value;
      const memberIds = Array.from(document.querySelectorAll('.friend-picker-check:checked')).map((el) => Number(el.value));
      const emailsField = document.getElementById('new-group-emails');
      const memberEmails = emailsField
        ? emailsField.value.split(',').map((s) => s.trim()).filter(Boolean)
        : [];
      if (!name) {
        showFieldError('group-error', 'Please enter a group name');
        return;
      }
      try {
        const { group, notFound } = await Api.post('/groups', { name, type, memberIds, memberEmails });
        Modal.close();
        Toast.show('Group created');
        if (notFound && notFound.length) Toast.show(`No account found for: ${notFound.join(', ')}`, 'error');
        location.hash = `#/groups/${group.id}`;
      } catch (e) {
        showFieldError('group-error', e.message);
      }
    });
  }

  async function openSettingsModal() {
    const me = App.currentUser;
    const currencyOptions = CURRENCIES.map(
      (c) => `<option value="${c}" ${me.defaultCurrency === c ? 'selected' : ''}>${c}</option>`
    ).join('');
    Modal.open(`
      <h2>Settings</h2>
      <div id="settings-error" class="auth-error hidden"></div>
      <div class="field"><label>Default currency</label><select id="settings-currency">${currencyOptions}</select></div>
      <div class="field"><label>Username</label><input type="text" id="settings-username" value="${Fmt.escapeHtml(me.username)}"/></div>
      <div class="field"><label>Email</label><input type="email" id="settings-email" value="${Fmt.escapeHtml(me.email || '')}" placeholder="optional if phone is set"/></div>
      <div class="field"><label>Phone</label><input type="tel" id="settings-phone" value="${Fmt.escapeHtml(me.phone || '')}" placeholder="optional if email is set"/></div>
      <button class="btn btn-primary btn-block" id="settings-submit">Save changes</button>
    `);
    document.getElementById('settings-submit').addEventListener('click', async () => {
      try {
        const { user } = await Api.put('/auth/me', {
          username: document.getElementById('settings-username').value.trim(),
          email: document.getElementById('settings-email').value.trim(),
          phone: document.getElementById('settings-phone').value.trim(),
          defaultCurrency: document.getElementById('settings-currency').value,
        });
        Modal.close();
        Toast.show('Settings saved');
        App.onProfileUpdated(user);
      } catch (e) {
        showFieldError('settings-error', e.message);
      }
    });
  }

  async function openAddFriendModal() {
    Modal.open(`
      <h2>Add a friend</h2>
      <p class="modal-subtitle">They'll get a friend request to accept before you can split expenses together.</p>
      <div id="friend-error" class="auth-error hidden"></div>
      <div class="field"><label>Username, email or phone</label><input type="text" id="new-friend-identifier" placeholder="e.g. alice_w or alice@example.com"/></div>
      <button class="btn btn-primary btn-block" id="new-friend-submit">Send friend request</button>
    `);
    document.getElementById('new-friend-submit').addEventListener('click', async () => {
      const identifier = document.getElementById('new-friend-identifier').value.trim();
      try {
        const result = await Api.post('/users/friends', { identifier });
        Modal.close();
        Toast.show(result.status === 'accepted' ? 'Friend added' : 'Friend request sent');
        App.refreshFriendBadge();
        App.refreshCurrentView();
      } catch (e) {
        showFieldError('friend-error', e.message);
      }
    });
  }

  function openSettleModal({ groupId, fromId, toId, amount, members, currency }) {
    const byId = Object.fromEntries(members.map((m) => [m.id, m]));
    const cur = currency || 'USD';
    Modal.open(`
      <h2>Settle up</h2>
      <p>${Fmt.escapeHtml(byId[fromId].name)} pays ${Fmt.escapeHtml(byId[toId].name)}</p>
      <div id="settle-error" class="auth-error hidden"></div>
      <div class="field"><label>Amount (${cur})</label><input type="number" min="0.01" step="0.01" id="settle-amount" value="${amount.toFixed(2)}"/></div>
      <button class="btn btn-primary btn-block" id="settle-submit">Record payment</button>
    `);
    document.getElementById('settle-submit').addEventListener('click', async () => {
      const amt = Number(document.getElementById('settle-amount').value);
      try {
        await Api.post('/settlements', { groupId: groupId || null, fromUser: fromId, toUser: toId, amount: amt, currency: cur });
        Modal.close();
        Toast.show('Payment recorded');
        App.refreshCurrentView();
      } catch (e) {
        showFieldError('settle-error', e.message);
      }
    });
  }

  function showFieldError(id, message) {
    const el = document.getElementById(id);
    el.textContent = message;
    el.classList.remove('hidden');
  }

  return { dashboard, groups, groupDetail, friends, friendDetail, activity, openCreateGroupModal, openAddFriendModal, openSettingsModal };
})();
