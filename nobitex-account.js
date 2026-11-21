(() => {
  'use strict';
  const API_BASE = 'https://apiv2.nobitex.ir';
  const STORE_PUBLIC = 'nobitex_public_key';
  const STORE_PRIVATE = 'nobitex_private_key';
  const bridge = window.NobitexNativeBridge;
  const $ = (id) => document.getElementById(id);
  const modal = $('nbxApiModal');
  const statusText = $('nbxApiStatusText');
  const statusBadge = $('nbxApiStatusBadge');
  const walletSummary = $('nbxWalletSummary');
  const message = $('nbxApiMessage');
  const saveButton = $('nbxApiSaveBtn');
  const refreshButton = $('nbxApiRefreshBtn');
  const forgetButton = $('nbxApiForgetBtn');

  function setMessage(text, kind = '') {
    if (!message) return;
    message.textContent = text;
    message.className = kind;
  }
  function showModal() {
    if (!bridge?.isAndroid) {
      setMessage('اتصال حساب فقط در APK اندروید فعال است. نسخه وب و GitHub Pages امکان نگهداری امن کلید در Android Keystore را ندارند.', 'err');
    } else {
      setMessage('مجوز API در پنل نوبیتکس باید فقط READ باشد. کلیدها باید متعلق به یک جفت باشند.');
    }
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }
  function hideModal() {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    $('nbxApiPublicInput').value = '';
    $('nbxApiPrivateInput').value = '';
  }
  function decodeB64Url(input) {
    const clean = String(input || '').trim().replace(/\s+/g, '');
    if (!clean || !/^[A-Za-z0-9_+\-/=]+$/.test(clean)) throw new Error('فرمت کلید باید Base64 یا Base64URL باشد.');
    let s = clean.replace(/-/g, '+').replace(/_/g, '/');
    s += '='.repeat((4 - (s.length % 4)) % 4);
    let raw;
    try { raw = atob(s); } catch { throw new Error('کلید Base64 قابل خواندن نیست.'); }
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  }
  function base64Url(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_');
  }
  function concatBytes(a, b) {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0); out.set(b, a.length); return out;
  }
  async function signEd25519(privateSeed, messageText) {
    if (!crypto?.subtle) throw new Error('امضای امن در این نسخه WebView در دسترس نیست؛ Android System WebView را به‌روزرسانی کنید.');
    const prefix = Uint8Array.from([0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x04,0x22,0x04,0x20]);
    const pkcs8 = concatBytes(prefix, privateSeed);
    let key;
    try {
      key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
    } catch (e) {
      throw new Error('این WebView از کلید Ed25519 پشتیبانی نمی‌کند. WebView اندروید را به‌روزرسانی کنید.');
    }
    const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(messageText)));
    return base64Url(signature);
  }
  async function signedWalletRequest(publicKey, privateKey) {
    const path = '/users/wallets/list';
    const method = 'GET';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const seed = decodeB64Url(privateKey);
    const publicBytes = decodeB64Url(publicKey);
    if (seed.length !== 32) throw new Error('طول Private Key معتبر نیست؛ کلید خصوصی Ed25519 باید به ۳۲ بایت رمزگشایی شود.');
    if (publicBytes.length !== 32) throw new Error('طول Public Key معتبر نیست؛ کلید عمومی باید به ۳۲ بایت رمزگشایی شود.');
    const signature = await signEd25519(seed, timestamp + method + path);
    const response = await bridge.httpRequest({
      url: API_BASE + path,
      method,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'NobitexScanner/6.3.0 Android',
        'Nobitex-Key': String(publicKey).trim().replace(/\s+/g, ''),
        'Nobitex-Timestamp': timestamp,
        'Nobitex-Signature': signature
      },
      connectTimeout: 15000,
      readTimeout: 20000,
      responseType: 'json'
    });
    const data = response?.data;
    if (response.status < 200 || response.status >= 300 || !data || data.status !== 'ok' || !Array.isArray(data.wallets)) {
      const code = data?.code ? String(data.code) : `HTTP_${response?.status ?? 'UNKNOWN'}`;
      const serverMessage = data?.message || data?.detail || data?.error;
      if (response?.status === 401) throw new Error('احراز هویت ناموفق است. جفت Public/Private را بررسی کنید و تاریخ و ساعت گوشی را روی حالت خودکار بگذارید.');
      if (response?.status === 403) throw new Error('درخواست رد شد. مجوز READ، وضعیت IP و فعال‌بودن API Key را در پنل نوبیتکس بررسی کنید.');
      if (response?.status === 429) throw new Error('محدودیت تعداد درخواست نوبیتکس فعال شده است؛ کمی بعد دوباره تلاش کنید.');
      throw new Error(`اتصال موفق نبود (${code})${serverMessage ? ': ' + String(serverMessage).slice(0, 180) : ''}`);
    }
    return data.wallets;
  }
  function fmt(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return String(value ?? '—');
    return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 8 }).format(n);
  }
  function renderWallets(wallets) {
    walletSummary.replaceChildren();
    const active = (wallets || []).filter(w => Number(w.balance || 0) !== 0 || Number(w.blockedBalance || 0) !== 0);
    const head = document.createElement('div');
    head.className = 'nbxWalletRow head';
    ['ارز', 'موجودی کل', 'موجودی آزاد'].forEach(t => { const s=document.createElement('span');s.textContent=t;head.appendChild(s); });
    walletSummary.appendChild(head);
    if (!active.length) {
      const p = document.createElement('p'); p.textContent = 'کیف‌پول دارای موجودی نمایش‌پذیر نیست.'; p.style.cssText='font-size:.74rem;color:#aab8cc;padding:8px 0'; walletSummary.appendChild(p);
    } else {
      active.sort((a,b) => Math.abs(Number(b.balance||0))-Math.abs(Number(a.balance||0)));
      active.slice(0, 12).forEach(w => {
        const row=document.createElement('div'); row.className='nbxWalletRow';
        const currency=document.createElement('span'); currency.textContent=String(w.currency||'—').toUpperCase();
        const balance=document.createElement('span'); balance.textContent=fmt(w.balance);
        const free=document.createElement('span'); free.textContent=fmt(w.activeBalance ?? w.balance);
        row.append(currency,balance,free); walletSummary.appendChild(row);
      });
      if (active.length > 12) { const note=document.createElement('p'); note.textContent=`${fmt(active.length-12)} کیف‌پول دیگر در فهرست وجود دارد.`; note.style.cssText='font-size:.68rem;color:#93a4bb;padding-top:6px'; walletSummary.appendChild(note); }
    }
    walletSummary.classList.add('visible');
  }
  async function checkSavedKeys() {
    if (!bridge?.isAndroid) {
      statusText.textContent = 'اتصال حساب در نسخه وب فعال نیست؛ برای ذخیره امن کلید باید APK اندروید نصب شود.';
      statusBadge.textContent = 'فقط نسخه اندروید';
      statusBadge.className = 'nbxApiBadge warn';
      refreshButton.disabled = true;
      return;
    }
    try {
      const [pub, priv] = await Promise.all([bridge.secureGet(STORE_PUBLIC), bridge.secureGet(STORE_PRIVATE)]);
      const connected = Boolean(pub && priv);
      statusText.textContent = connected ? 'کلیدها به‌صورت رمزگذاری‌شده روی همین گوشی ذخیره شده‌اند. برای دریافت موجودی، دکمه بروزرسانی را بزنید.' : 'کلید اختصاصی هنوز در این گوشی ثبت نشده است. برای مشاهده موجودی و تطبیق معاملات، اتصال خواندنی را تنظیم کنید.';
      statusBadge.textContent = connected ? 'کلید ذخیره‌شده' : 'اتصال برقرار نشده';
      statusBadge.className = connected ? 'nbxApiBadge ok' : 'nbxApiBadge warn';
      refreshButton.disabled = !connected;
      forgetButton.style.display = connected ? '' : 'none';
    } catch (e) {
      statusText.textContent = 'فضای ذخیره امن اندروید در دسترس نیست. نسخه Capacitor و افزونه Secure Storage باید نصب و همگام‌سازی شوند.';
      statusBadge.textContent = 'نیازمند تنظیم فنی';
      statusBadge.className = 'nbxApiBadge warn';
      refreshButton.disabled = true;
    }
  }
  async function refreshWallets() {
    if (!bridge?.isAndroid) return showModal();
    refreshButton.disabled = true;
    statusText.textContent = 'در حال دریافت موجودی از نوبیتکس…';
    try {
      const [pub, priv] = await Promise.all([bridge.secureGet(STORE_PUBLIC), bridge.secureGet(STORE_PRIVATE)]);
      if (!pub || !priv) throw new Error('کلید API در فضای امن گوشی پیدا نشد.');
      const wallets = await signedWalletRequest(pub, priv);
      renderWallets(wallets);
      statusText.textContent = `اتصال خواندنی برقرار است؛ ${fmt(wallets.length)} کیف‌پول از نوبیتکس دریافت شد.`;
      statusBadge.textContent = 'متصل و فقط خواندنی';
      statusBadge.className = 'nbxApiBadge ok';
    } catch (e) {
      statusText.textContent = e?.message || 'خطا در دریافت موجودی.';
      statusBadge.textContent = 'خطا در اتصال';
      statusBadge.className = 'nbxApiBadge warn';
    } finally {
      refreshButton.disabled = false;
    }
  }
  async function saveKeys() {
    if (!bridge?.isAndroid) return setMessage('این قابلیت فقط در APK اندروید نصب‌شده فعال است؛ از نسخه GitHub Pages برای واردکردن کلید استفاده نکنید.', 'err');
    const publicKey = $('nbxApiPublicInput').value.trim();
    const privateKey = $('nbxApiPrivateInput').value.trim();
    if (!publicKey || !privateKey) return setMessage('هر دو مقدار Public Key و Private Key لازم است.', 'err');
    saveButton.disabled = true;
    saveButton.textContent = 'در حال آزمایش امضا و اتصال…';
    setMessage('در حال ارسال درخواست فقط‌خواندنی به نوبیتکس؛ کلیدها هنوز ذخیره نشده‌اند…');
    try {
      const wallets = await signedWalletRequest(publicKey, privateKey);
      // Persist only after a successful signed READ request.
      await bridge.secureSet(STORE_PUBLIC, publicKey);
      await bridge.secureSet(STORE_PRIVATE, privateKey);
      $('nbxApiPublicInput').value = '';
      $('nbxApiPrivateInput').value = '';
      renderWallets(wallets);
      statusText.textContent = `اتصال خواندنی برقرار و کلیدها در Android Keystore ذخیره شدند؛ ${fmt(wallets.length)} کیف‌پول دریافت شد.`;
      statusBadge.textContent = 'متصل و فقط خواندنی';
      statusBadge.className = 'nbxApiBadge ok';
      refreshButton.disabled = false;
      forgetButton.style.display = '';
      setMessage('اتصال موفق بود و کلیدها در فضای امن همین گوشی ذخیره شدند.', 'ok');
      setTimeout(hideModal, 900);
    } catch (e) {
      setMessage(e?.message || 'آزمایش اتصال ناموفق بود. کلیدی ذخیره نشد.', 'err');
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = 'آزمایش اتصال و ذخیره امن';
    }
  }
  async function forgetKeys() {
    if (!bridge?.isAndroid) return;
    if (!window.confirm('کلیدهای ذخیره‌شده فقط از این گوشی حذف شوند؟ این کار API Key را از پنل نوبیتکس باطل نمی‌کند.')) return;
    try {
      await Promise.all([bridge.secureRemove(STORE_PUBLIC), bridge.secureRemove(STORE_PRIVATE)]);
      walletSummary.replaceChildren(); walletSummary.classList.remove('visible');
      await checkSavedKeys();
      setMessage('کلیدها از فضای امن این گوشی حذف شدند.', 'ok');
    } catch { setMessage('حذف کلید از فضای امن ناموفق بود.', 'err'); }
  }

  $('nbxApiOpenBtn').addEventListener('click', showModal);
  $('nbxApiCloseBtn').addEventListener('click', hideModal);
  $('nbxApiCancelBtn').addEventListener('click', hideModal);
  $('nbxApiSaveBtn').addEventListener('click', saveKeys);
  $('nbxApiRefreshBtn').addEventListener('click', refreshWallets);
  $('nbxApiForgetBtn').addEventListener('click', forgetKeys);
  modal.addEventListener('click', e => { if (e.target === modal) hideModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal.classList.contains('open')) hideModal(); });
  checkSavedKeys();
})();
