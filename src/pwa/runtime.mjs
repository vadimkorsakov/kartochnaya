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
  // Reserve space below the tabs instead of covering the canvas or mobile tools.
  const style = document.createElement('style');
  style.textContent = `
    :root{--pwa-notice-height:0px}
    body{padding-top:calc(var(--document-tab-height) + var(--pwa-notice-height))}
    #app{height:calc(var(--v41-visual-height,100dvh) - var(--document-tab-height) - var(--pwa-notice-height))!important}
    .home-screen{top:calc(var(--document-tab-height) + var(--pwa-notice-height))}
    #pwaStatus{position:fixed;top:var(--document-tab-height);left:0;right:0;z-index:13;background:#242429;color:#f3efff;font:12px system-ui;box-shadow:inset 0 -1px #51475f}
    #pwaStatus [hidden],#pwaStatus[hidden]{display:none!important}
    #pwaStatus .pwa-row{height:36px;display:flex;align-items:center;gap:8px;padding:0 8px}
    #pwaMessage{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    #pwaStatus button,#pwaToggle{flex:0 0 auto;border:1px solid #625475;border-radius:6px;background:#37313f;color:#f3efff;font:12px system-ui;min-height:32px;padding:4px 8px}
    #documentTabs #pwaToggle{order:4;border-radius:0;min-width:64px}
    #pwaStatus button:focus-visible,#pwaToggle:focus-visible{outline:2px solid #b99aff;outline-offset:-2px}
    #pwaToggle[hidden]{display:none}
    #pwaDetails{height:60px;overflow:auto;overflow-wrap:anywhere;margin:0;padding:4px 8px;white-space:pre-wrap}
  `;
  document.head.append(style);
  const panel = document.createElement('aside');
  panel.id = 'pwaStatus';
  panel.setAttribute('aria-live', 'polite');
  panel.dataset.offlineReady = 'false';
  const label = document.createElement('span');
  label.id = 'pwaMessage';
  const button = document.createElement('button');
  button.id = 'pwaUpdate'; button.textContent = 'Обновить'; button.hidden = true;
  const retry = document.createElement('button');
  retry.id = 'pwaRetry'; retry.textContent = 'Повторить подготовку'; retry.hidden = true;
  const toggle = document.createElement('button');
  toggle.id = 'pwaToggle'; toggle.setAttribute('aria-controls', panel.id);
  const close = document.createElement('button');
  close.id = 'pwaClose'; close.textContent = '×'; close.setAttribute('aria-label', 'Свернуть уведомление офлайн-копии');
  const detailsToggle = document.createElement('button');
  detailsToggle.id = 'pwaDetailsToggle'; detailsToggle.textContent = 'Подробнее'; detailsToggle.setAttribute('aria-controls', 'pwaDetails');
  const details = document.createElement('p');
  details.id = 'pwaDetails'; details.hidden = true;
  const heading = document.createElement('div'), actions = document.createElement('div');
  heading.className = actions.className = 'pwa-row';
  heading.append(label, close); actions.append(button, retry, detailsToggle);
  panel.append(heading, actions, details); document.body.append(panel);
  document.getElementById('documentTabs').append(toggle);
  const mobile = window.matchMedia('(max-width:760px)');
  let screen = document.getElementById('homeScreen')?.classList.contains('hidden') ? 'editor' : 'home';
  let expanded = false;
  let preparing = false, confirmedReady = false, announceSuccess = false, displayedWorker, collapseTimer;
  const registrationDisplay = new WeakMap();
  function layout() {
    const visible = !mobile.matches || screen === 'home';
    const host = document.getElementById(mobile.matches ? 'homePwaStatus' : 'documentTabs');
    if (host && toggle.parentNode !== host) host.append(toggle);
    toggle.hidden = !visible;
    panel.hidden = !visible || !expanded;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    detailsToggle.setAttribute('aria-expanded', String(!details.hidden));
    document.documentElement.style.setProperty('--pwa-notice-height', (panel.hidden ? 0 : 36 + (actions.hidden ? 0 : 36) + (details.hidden ? 0 : 60)) + 'px');
  }
  document.addEventListener('karto-screen-change', event => { screen = event.detail.screen; layout(); });
  mobile.addEventListener('change', layout);
  function collapse() {
    clearTimeout(collapseTimer); expanded = false; details.hidden = true;
    // Keep keyboard focus on a visible control after closing or auto-collapse.
    if (!toggle.hidden && panel.contains(document.activeElement)) toggle.focus();
    layout();
  }
  close.onclick = collapse;
  toggle.onclick = () => {
    if (!panel.hidden) { collapse(); return; }
    clearTimeout(collapseTimer); expanded = true; layout();
  };
  detailsToggle.onclick = () => { details.hidden = !details.hidden; layout(); };
  function notice(message, { expanded: showExpanded = true, detail = '', retryable = false, update = false, success = false } = {}) {
    clearTimeout(collapseTimer);
    label.textContent = label.title = message;
    details.textContent = detail; details.hidden = true; detailsToggle.hidden = !detail;
    retry.hidden = !retryable; button.hidden = !update;
    actions.hidden = !detail && !retryable && !update;
    toggle.textContent = update ? 'Версия ↑' : retryable ? 'Офлайн !' : confirmedReady ? 'Офлайн ✓' : 'Офлайн …';
    toggle.setAttribute('aria-label', 'Офлайн: ' + message);
    expanded = showExpanded; layout();
    if (success) collapseTimer = setTimeout(() => {
      label.textContent = label.title = 'Готово к работе офлайн'; collapse();
    }, 4000);
  }
  function failed(error) {
    notice(confirmedReady ? 'Не удалось обновить офлайн-копию' : 'Не удалось подготовить офлайн-копию', {
      retryable: true,
      detail: error.message + (confirmedReady ? '\nПрежняя рабочая копия сохранена.' : ''),
    });
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
    preparing = true; retry.disabled = true; displayedWorker = undefined;
    notice('Подготовка офлайн-версии…');
    let timer;
    try {
      const registration = await Promise.race([
        navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Регистрация офлайн-копии не завершилась за 30 секунд. Повторите попытку.')), 30000); }),
      ]);
      clearTimeout(timer);
      announceSuccess = !confirmedReady && !navigator.serviceWorker.controller && !registration.active;
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
        const worker = navigator.serviceWorker.controller || registration.active;
        if (worker) {
          try {
            const result = await status(worker);
            const firstSuccess = !confirmedReady && result.ready && announceSuccess;
            confirmedReady = result.ready === true;
            panel.dataset.offlineReady = String(result.ready);
            panel.dataset.version = result.version;
            if (!registration.waiting && (displayedWorker !== worker || !result.ready)) {
              displayedWorker = worker;
              notice(result.ready ? (firstSuccess ? 'Офлайн-копия готова' : 'Готово к работе офлайн') : 'Офлайн-копия ещё не готова', {
                expanded: firstSuccess || !result.ready, retryable: !result.ready, success: firstSuccess,
              });
            }
          } catch (error) { failed(error); }
        }
        if (registration.waiting) {
          try {
            if (!(await status(registration.waiting)).ready) throw Error('Новая офлайн-копия не готова');
            notice('Доступна новая версия', { update: true });
          } catch (error) { failed(error); }
        }
      }
      function watchCandidate() {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          // A controller alone is not proof of a complete previous offline copy.
          if (worker.state === 'redundant') void display().then(() => failed(Error('Не удалось установить офлайн-копию. Проверьте сеть и SHA-256 ресурсов в консоли браузера.')));
          else if (worker.state === 'installed' || worker.state === 'activated') void display();
        });
      }
      registration.addEventListener('updatefound', watchCandidate);
      watchCandidate();
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
          notice('Обновление отложено', { update: true, detail: error.message });
        }
      };
      // Confirm any working version before watching a candidate installation.
      if (registration.active || registration.waiting) await display();
      if (registration.installing || (!registration.active && !registration.waiting)) {
        await waitForOfflineWorker(registration);
        await display();
      }
    } catch (error) { failed(error); }
    finally { clearTimeout(timer); preparing = false; retry.disabled = false; }
  }
  retry.onclick = () => { void start(); };
  void start();
}
