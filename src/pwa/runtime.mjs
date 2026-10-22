// Included only by the Netlify build; no automatic reloads, including other tabs.
export function installNetlifyPWA({ prepare, resume }) {
  if (!('serviceWorker' in navigator)) return;
  const panel = document.createElement('aside');
  panel.id = 'pwaStatus';
  panel.setAttribute('aria-live', 'polite');
  panel.style.cssText = 'position:fixed;bottom:8px;right:8px;z-index:10000;max-width:calc(100vw - 16px);padding:6px 10px;border-radius:8px;background:#242429;color:#fff;font:12px system-ui;box-shadow:0 2px 8px #0005';
  const label = document.createElement('span');
  label.textContent = 'Подготовка офлайн-версии…';
  const button = document.createElement('button');
  button.id = 'pwaUpdate'; button.textContent = 'Обновить'; button.hidden = true;
  button.style.cssText = 'margin-left:8px;padding:4px 8px';
  panel.append(label, button); document.body.append(panel);
  function status(worker) {
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); reject(Error('Проверка офлайн-копии не завершена')); }, 10000);
      channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data); };
      worker.postMessage({ type: 'OFFLINE_STATUS' }, [channel.port2]);
    });
  }
  navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then(async registration => {
    let busy = false;
    async function display() {
      if (busy) return;
      if (registration.waiting) { label.textContent = 'Доступна новая версия'; button.hidden = false; return; }
      button.hidden = true;
      const worker = navigator.serviceWorker.controller || registration.active;
      if (worker) {
        try {
          const result = await status(worker);
          panel.dataset.offlineReady = String(result.ready);
          panel.dataset.version = result.version;
          label.textContent = result.ready ? 'Готово к работе офлайн' : 'Офлайн-копия ещё не готова';
        } catch (error) { label.textContent = error.message; }
      }
    }
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => { void display(); });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => { void display(); });
    await navigator.serviceWorker.ready;
    await display();
    // Detect deploys in long-lived editor sessions; failures leave the cache intact.
    const check = () => { if (navigator.onLine) void registration.update().catch(() => {}); };
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
    setInterval(check, 60 * 60 * 1000);
    button.onclick = async () => {
      const worker = registration.waiting;
      if (!worker || busy) return;
      busy = true; button.disabled = true;
      const overlay = document.createElement('div');
      overlay.style.cssText = 'position:fixed;inset:0;z-index:10001;background:#0003;display:grid;place-items:center;color:white';
      overlay.textContent = 'Сохранение документов перед обновлением…';
      document.body.append(overlay);
      try {
        // Existing snapshot barrier confirms active and inactive documents, fonts,
        // settings and pending resource work. A failure must postpone the update.
        await prepare();
        if (!(await status(worker)).ready) throw Error('Новая офлайн-копия не готова');
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { worker.removeEventListener('statechange', changed); reject(Error('Обновление отложено: нет подтверждения активации')); }, 15000);
          function changed() {
            if (worker.state === 'activated') { clearTimeout(timer); worker.removeEventListener('statechange', changed); resolve(); }
            else if (worker.state === 'redundant') { clearTimeout(timer); worker.removeEventListener('statechange', changed); reject(Error('Обновление недоступно')); }
          }
          worker.addEventListener('statechange', changed);
          worker.postMessage({ type: 'ACTIVATE_UPDATE' }); changed();
        });
        location.reload();
      } catch (error) {
        resume(); overlay.remove(); busy = false; button.disabled = false;
        label.textContent = 'Обновление отложено: ' + error.message;
      }
    };
  }).catch(() => { label.textContent = 'Офлайн-копия не готова. Проверьте подключение и перезагрузите страницу.'; });
}
