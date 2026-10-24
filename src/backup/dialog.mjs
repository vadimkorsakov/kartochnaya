// Presentation only: no storage, authorization or provider lifecycle lives here.
export function storageRow({ id, title, description, icon, status = '' }) {
  const row = document.createElement('button');
  row.type = 'button'; row.id = id; row.className = 'home-data-card';
  row.setAttribute('aria-haspopup', 'dialog');
  row.innerHTML = '<span class="home-data-icon" aria-hidden="true"></span><span class="storage-copy"><strong></strong><span class="storage-description"></span><small class="storage-status"></small></span><svg class="storage-arrow" aria-hidden="true" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg>';
  const paths = { '▣': 'M6 3h9l4 4v14H5V3h1m8 0v5h5M10 5h1m-1 4h1m-1 4h1m-1 3h3v3h-3z', '☁': 'M7 18h11a4 4 0 0 0 0-8 6 6 0 0 0-11-2 5 5 0 0 0 0 10z' };
  if (paths[icon]) row.querySelector('.home-data-icon').innerHTML = `<svg viewBox="0 0 24 24"><path d="${paths[icon]}"/></svg>`;
  else row.querySelector('.home-data-icon').textContent = icon;
  row.querySelector('strong').textContent = title;
  row.querySelector('.storage-description').textContent = description;
  row.querySelector('.storage-status').textContent = status;
  document.querySelector('#homeDataPane .home-data-grid').append(row);
  return row;
}

export function modal(dialog, { opener, close = () => dialog.close() } = {}) {
  dialog.classList.add('backup-dialog');
  if (opener) opener.setAttribute('aria-controls', dialog.id);
  let returnFocus;
  const open = (source = document.activeElement) => {
    if (dialog.open) return;
    // Never stack backup dialogs. In particular, a prepared ZIP replacement must
    // remain owned by its own cancellation handler.
    if (document.querySelector('.backup-dialog[open]')) return;
    returnFocus = source?.closest?.('.home-data-card') || source;
    dialog.showModal(); document.documentElement.classList.add('backup-modal-open');
  };
  dialog.querySelector('[data-backup-close]')?.addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => {
    if (!document.querySelector('.backup-dialog[open]')) document.documentElement.classList.remove('backup-modal-open');
    if (returnFocus?.isConnected && returnFocus.getClientRects().length) returnFocus.focus({ preventScroll: true });
    else opener?.focus({ preventScroll: true });
  });
  return { open };
}

export function tabs(root, changed = () => {}) {
  const buttons = [...root.querySelectorAll('[data-backup-tab]')];
  function select(value, focus = false) {
    for (const button of buttons) {
      const active = button.dataset.backupTab === value;
      button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
      if (active && focus) button.focus();
    }
    for (const panel of root.querySelectorAll('[data-backup-panel]')) panel.hidden = panel.dataset.backupPanel !== value;
    changed(value);
  }
  for (const button of buttons) {
    button.onclick = () => select(button.dataset.backupTab);
    button.addEventListener('keydown', event => {
      let index = buttons.indexOf(button);
      if (event.key === 'ArrowRight') index++;
      else if (event.key === 'ArrowLeft') index--;
      else if (event.key === 'Home') index = 0;
      else if (event.key === 'End') index = buttons.length - 1;
      else return;
      event.preventDefault(); select(buttons[(index + buttons.length) % buttons.length].dataset.backupTab, true);
    });
    const panel = root.querySelector(`[data-backup-panel="${button.dataset.backupTab}"]`);
    button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', panel.id);
    panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', button.id);
  }
  select(buttons[0].dataset.backupTab);
  return { select };
}

// Hide existing nodes rather than rebuilding them: checked values and focus stay
// with the account/project while asynchronous status notifications arrive.
export function pager(container, { size = 3, label = 'Список' } = {}) {
  const nav = document.createElement('nav'); nav.className = 'backup-pagination'; nav.setAttribute('aria-label', label);
  const previous = document.createElement('button'), next = document.createElement('button'), count = document.createElement('span');
  for (const button of [previous, next]) { button.type = 'button'; button.className = 'btn btn-outline'; }
  previous.textContent = '←'; previous.setAttribute('aria-label', 'Предыдущая страница');
  next.textContent = '→'; next.setAttribute('aria-label', 'Следующая страница');
  count.setAttribute('aria-live', 'polite'); nav.append(previous, count, next); container.after(nav);
  let page = 0;
  function update(reset = false) {
    if (reset) page = 0;
    const rows = [...container.children], total = Math.max(1, Math.ceil(rows.length / size));
    page = Math.min(page, total - 1);
    rows.forEach((row, index) => { row.hidden = Math.floor(index / size) !== page; });
    nav.hidden = rows.length <= size; previous.disabled = page === 0; next.disabled = page === total - 1;
    count.textContent = `${page + 1} / ${total}`;
  }
  previous.onclick = () => { page--; update(); }; next.onclick = () => { page++; update(); };
  update(); return { update, nav };
}
