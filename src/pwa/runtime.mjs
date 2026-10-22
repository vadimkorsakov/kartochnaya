// Included only by the Netlify build; no automatic reloads, including other tabs.
export function waitForOfflineWorker(registration, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const workers = new Set();
    const timer = setTimeout(() => finish(Error('Подготовка офлайн-копии не завершилась за 30 секунд. Проверьте подключение и повторите попытку.')), timeoutMs);
    function finish(error) {
      clearTimeout(timer);
      registration.removeEventListener('updatefound', changed);
      for (const worker of workers) worker.removeEventListener('statechange', changed);
      error ? reject(error) : resolve();
    }
    function changed() {
      const worker = registration.installing;
      if (worker && !workers.has(worker)) {
        workers.add(worker); worker.addEventListener('statechange', changed);
      }
      if ([...workers].some(worker => worker.state === 'redundant')) {
        finish(Error('Не удалось установить офлайн-копию. Возможны ошибка сети или несовпадение SHA-256 ресурсов. Повторите попытку; подробности — в консоли браузера.'));
      } else if (registration.waiting || (!registration.installing && registration.active?.state === 'activated')) finish();
    }
    registration.addEventListener('updatefound', changed); changed();
  });
}

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
  const retry = document.createElement('button');
  retry.id = 'pwaRetry'; retry.textContent = 'Повторить подготовку'; retry.hidden = true;
  retry.style.cssText = button.style.cssText;
  panel.append(label, button, retry); document.body.append(panel);
  let preparing = false;
  const registrationDisplay = new WeakMap();
  function failed(error) {
    panel.dataset.offlineReady = 'false';
    label.textContent = error.message;
    retry.hidden = false;
  }
  function status(worker) {
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); reject(Error('Проверка офлайн-копии не завершена')); }, 10000);
      channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data); };
      worker.postMessage({ type: 'OFFLINE_STATUS' }, [channel.port2]);
    });
  }
  async function start() {
    if (preparing) return;
    preparing = true; retry.disabled = true; retry.hidden = true;
    label.textContent = 'Подготовка офлайн-версии…';
    let timer;
    try {
      const registration = await Promise.race([
        navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Регистрация офлайн-копии не завершилась за 30 секунд. Повторите попытку.')), 30000); }),
      ]);
      clearTimeout(timer);
      if (registrationDisplay.has(registration)) {
        await Promise.race([
          registration.update(),
          new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Проверка обновления не завершилась за 30 секунд. Повторите попытку.')), 30000); }),
        ]);
        clearTimeout(timer);
        await waitForOfflineWorker(registration);
        await registrationDisplay.get(registration)();
        return;
      }
      let busy = false;
      async function display() {
        if (busy) return;
        if (registration.waiting) { label.textContent = 'Доступна новая версия'; button.hidden = false; retry.hidden = true; return; }
        button.hidden = true;
        const worker = navigator.serviceWorker.controller || registration.active;
        if (worker) {
          try {
            const result = await status(worker);
            panel.dataset.offlineReady = String(result.ready);
            panel.dataset.version = result.version;
            label.textContent = result.ready ? 'Готово к работе офлайн' : 'Офлайн-копия ещё не готова';
            retry.hidden = result.ready;
          } catch (error) { failed(error); }
        }
      }
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'redundant') failed(Error('Не удалось установить обновление офлайн-копии. Проверьте сеть и SHA-256 ресурсов в консоли браузера. Прежняя рабочая копия сохранена.'));
          else void display();
        });
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => { void display(); });
      registrationDisplay.set(registration, display);
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
      await waitForOfflineWorker(registration);
      await display();
    } catch (error) { failed(error); }
    finally { clearTimeout(timer); preparing = false; retry.disabled = false; }
  }
  retry.onclick = () => { void start(); };
  void start();
}
