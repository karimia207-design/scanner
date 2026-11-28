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
    if (bridge?.isAndroid) {
      setMessage('مجوز API در پنل نوبیتکس باید فقط READ باشد. کلیدها باید متعلق به یک جفت باشند.');
    } else {
      setMessage('نسخه وب نیز پشتیبانی می‌شود؛ کلید خصوصی به CryptoKey غیرقابل‌استخراج تبدیل و فقط در حافظه محلی همین مرورگر ذخیره می‌شود. اتصال مستقیم به پشتیبانی CORS نوبیتکس و HTTPS نیاز دارد.');
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
  async function importPrivateKey(privateKeyText) {
    if (!crypto?.subtle) throw new Error('امضای امن Web Crypto در این مرورگر در دسترس نیست. از Chrome/Android System WebView به‌روز و نشانی HTTPS استفاده کنید.');
    const seed = decodeB64Url(privateKeyText);
    if (seed.length !== 32) throw new Error('طول Private Key معتبر نیست؛ کلید خصوصی Ed25519 باید به ۳۲ بایت رمزگشایی شود.');
    const prefix = Uint8Array.from([0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x04,0x22,0x04,0x20]);
    const pkcs8 = concatBytes(prefix, seed);
    try {
      const key = await crypto.subtle.importKey('pkcs8', pkcs8, { name: 'Ed25519' }, false, ['sign']);
      if (key.extractable) throw new Error('کلید خصوصی به‌صورت غیرقابل‌استخراج ایجاد نشد.');
      return key;
    } catch (e) {
      if (e?.message?.includes('غیرقابل‌استخراج')) throw e;
      throw new Error('این مرورگر از امضای Ed25519 با Web Crypto پشتیبانی نمی‌کند. Chrome یا Android System WebView را به‌روزرسانی کنید.');
    } finally {
      seed.fill(0);
      pkcs8.fill(0);
    }
  }
  function isEd25519PrivateKey(value) {
    return Boolean(value && typeof value === 'object' && value.type === 'private' && value.algorithm?.name === 'Ed25519' && Array.from(value.usages || []).includes('sign'));
  }
  async function signEd25519(privateKey, messageText) {
    if (!crypto?.subtle) throw new Error('امضای امن در این مرورگر در دسترس نیست.');
    const key = isEd25519PrivateKey(privateKey) ? privateKey : await importPrivateKey(privateKey);
    const signature = new Uint8Array(await crypto.subtle.sign('Ed25519', key, new TextEncoder().encode(messageText)));
    return base64Url(signature);
  }

  const WEB_DB_NAME = 'nobitex-account-web-v1';
  const WEB_STORE_NAME = 'credentials';
  function openWebCredentialDb() {
    if (!window.isSecureContext) return Promise.reject(new Error('برای اتصال API در نسخه وب، برنامه باید از نشانی HTTPS (مانند GitHub Pages) باز شود؛ اجرای file:// پشتیبانی نمی‌شود.'));
    if (!window.indexedDB) return Promise.reject(new Error('حافظه امن محلی مرورگر (IndexedDB) در دسترس نیست.'));
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(WEB_DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(WEB_STORE_NAME)) request.result.createObjectStore(WEB_STORE_NAME, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('بازکردن حافظه محلی API ناموفق بود.'));
      request.onblocked = () => reject(new Error('حافظه API در تب دیگری در حال به‌روزرسانی است؛ سایر تب‌های برنامه را ببندید.'));
    });
  }
  async function webCredentialGet() {
    const db = await openWebCredentialDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(WEB_STORE_NAME, 'readonly');
        const req = tx.objectStore(WEB_STORE_NAME).get('active');
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(new Error('خواندن وضعیت API از حافظه مرورگر ناموفق بود.'));
      });
    } finally { db.close(); }
  }
  async function webCredentialSet(record) {
    const db = await openWebCredentialDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(WEB_STORE_NAME, 'readwrite');
        tx.objectStore(WEB_STORE_NAME).put({ id: 'active', ...record, storedAt: Date.now() });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(new Error('ذخیره کلید امضای API در حافظه مرورگر ناموفق بود.'));
        tx.onabort = () => reject(new Error('ذخیره کلید API لغو شد.'));
      });
    } finally { db.close(); }
  }
  async function webCredentialRemove() {
    const db = await openWebCredentialDb();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(WEB_STORE_NAME, 'readwrite');
        tx.objectStore(WEB_STORE_NAME).delete('active');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(new Error('حذف کلید API از حافظه مرورگر ناموفق بود.'));
      });
    } finally { db.close(); }
  }
  async function loadCredentials() {
    if (bridge?.isAndroid) {
      const publicKey = await bridge.secureGet(STORE_PUBLIC);
      return publicKey ? { publicKey, privateKey: null, native: true } : null;
    }
    const record = await webCredentialGet();
    if (!record) return null;
    if (!record.publicKey || !isEd25519PrivateKey(record.privateKey)) throw new Error('اطلاعات کلید ذخیره‌شده در مرورگر معتبر نیست؛ کلید را حذف و دوباره ثبت کنید.');
    return { publicKey: record.publicKey, privateKey: record.privateKey, native: false };
  }
  async function persistCredentials(publicKey, privateKey) {
    if (bridge?.isAndroid) {
      await bridge.secureSet(STORE_PUBLIC, publicKey);
      await bridge.secureSet(STORE_PRIVATE, privateKey);
    } else {
      await webCredentialSet({ publicKey, privateKey });
    }
  }
  async function removeCredentials() {
    if (bridge?.isAndroid) await Promise.all([bridge.secureRemove(STORE_PUBLIC), bridge.secureRemove(STORE_PRIVATE)]);
    else await webCredentialRemove();
  }
  async function signedWalletRequest(publicKey, privateKey) {
    const path = '/users/wallets/list';
    const method = 'GET';
    const timestamp = String(Math.floor(Date.now() / 1000));
    const publicBytes = decodeB64Url(publicKey);
    if (publicBytes.length !== 32) throw new Error('طول Public Key معتبر نیست؛ کلید عمومی باید به ۳۲ بایت رمزگشایی شود.');
    const normalizedPublicKey = String(publicKey).trim().replace(/\s+/g, '');
    let response, data;
    if (bridge?.isAndroid) {
      response = await bridge.signedWalletRequest({ publicKey: normalizedPublicKey });
      if (!response || typeof response.status !== 'number') throw new Error('پاسخ HTTP معتبر از پل اندروید دریافت نشد. اتصال اینترنت و نسخه Android System WebView را بررسی کنید.');
      data = response.data;
    } else {
      const signature = await signEd25519(privateKey, timestamp + method + path);
      if (!window.isSecureContext) throw new Error('اتصال API در نسخه وب فقط از HTTPS امکان‌پذیر است؛ برنامه را از GitHub Pages با نشانی https باز کنید.');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 20000);
      try {
        response = await fetch(API_BASE + path, {
          method,
          mode: 'cors',
          credentials: 'omit',
          cache: 'no-store',
          redirect: 'error',
          signal: controller.signal,
          headers: {
            'Accept': 'application/json',
            'Nobitex-Key': normalizedPublicKey,
            'Nobitex-Timestamp': timestamp,
            'Nobitex-Signature': signature
          }
        });
        data = await response.json().catch(() => null);
      } catch (e) {
        if (e?.name === 'AbortError') throw new Error('مهلت اتصال به API نوبیتکس تمام شد.');
        if (e instanceof TypeError) throw new Error('مرورگر نتوانست به API اختصاصی نوبیتکس دسترسی پیدا کند. ممکن است CORS برای مبدأ GitHub Pages مجاز نباشد یا ارتباط شبکه برقرار نباشد. این محدودیت مرورگر با ذخیره کلید برطرف نمی‌شود.');
        throw e;
      } finally { clearTimeout(timer); }
    }
    if (typeof data === 'string') {
      try { data = JSON.parse(data); } catch { /* keep original response for diagnostics */ }
    }
    if (response.status < 200 || response.status >= 300 || !data || data.status !== 'ok' || !Array.isArray(data.wallets)) {
      const code = data?.code ? String(data.code) : `HTTP_${response.status}`;
      const serverMessage = data?.message || data?.detail || data?.error;
      const detail = serverMessage ? String(serverMessage).slice(0, 240) : (typeof data === 'string' ? data.slice(0, 180) : 'بدون توضیح متنی از سرور');
      if (response.status === 401) throw new Error(`نوبیتکس احراز هویت را نپذیرفت (401 / ${code}). جفت کلید، امضای دیجیتال و ساعت دستگاه را بررسی کنید. پاسخ سرور: ${detail}`);
      if (response.status === 403) throw new Error(`نوبیتکس درخواست را رد کرد (403 / ${code}). مجوز READ و IP مجاز کلید را بررسی کنید. پاسخ سرور: ${detail}`);
      if (response.status === 429) throw new Error(`محدودیت درخواست نوبیتکس (429 / ${code}). ${detail}`);
      throw new Error(`خطای API نوبیتکس: HTTP ${response.status} / ${code}. پاسخ سرور: ${detail}`);
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
    try {
      if (!bridge?.isAndroid && !window.isSecureContext) {
        statusText.textContent = 'برای افزودن API در نسخه وب، برنامه را از نشانی HTTPS باز کنید؛ اجرای فایل HTML به‌صورت file:// پشتیبانی نمی‌شود.';
        statusBadge.textContent = 'نیازمند HTTPS'; statusBadge.className = 'nbxApiBadge warn';
        refreshButton.disabled = true; forgetButton.style.display = 'none'; return;
      }
      const credentials = await loadCredentials();
      const connected = Boolean(credentials);
      statusText.textContent = connected
        ? (bridge?.isAndroid ? 'کلید عمومی ذخیره است؛ کلید خصوصی رمزگذاری‌شده در فضای بومی گوشی می‌ماند و امضا داخل Android Native انجام می‌شود؛ اتصال فقط‌خواندنی فعال است.' : 'کلید عمومی و کلید امضای غیرقابل‌استخراج در حافظه محلی همین مرورگر ذخیره شده‌اند؛ اتصال فقط‌خواندنی فعال است.')
        : 'کلید اختصاصی هنوز در این دستگاه ثبت نشده است. برای دریافت موجودی، کلیدهای API فقط‌خواندنی را اضافه کنید.';
      statusBadge.textContent = connected ? 'کلید ذخیره‌شده؛ آماده بررسی' : 'اتصال برقرار نشده';
      statusBadge.className = connected ? 'nbxApiBadge ok' : 'nbxApiBadge warn';
      refreshButton.disabled = !connected;
      forgetButton.style.display = connected ? '' : 'none';
    } catch (e) {
      statusText.textContent = e?.message || 'حافظه امن محلی برای API در دسترس نیست.';
      statusBadge.textContent = 'نیازمند بررسی'; statusBadge.className = 'nbxApiBadge warn';
      refreshButton.disabled = true; forgetButton.style.display = 'none';
    }
  }
  async function refreshWallets() {
    refreshButton.disabled = true;
    statusText.textContent = 'در حال دریافت موجودی از نوبیتکس…';
    try {
      const credentials = await loadCredentials();
      if (!credentials) throw new Error('کلید API در حافظه امن این دستگاه پیدا نشد.');
      const wallets = await signedWalletRequest(credentials.publicKey, credentials.privateKey);
      renderWallets(wallets);
      statusText.textContent = `اتصال خواندنی برقرار است؛ ${fmt(wallets.length)} کیف‌پول از نوبیتکس دریافت شد.`;
      statusBadge.textContent = 'متصل و فقط خواندنی';
      statusBadge.className = 'nbxApiBadge ok';
    } catch (e) {
      statusText.textContent = e?.message || 'خطا در دریافت موجودی.';
      statusBadge.textContent = 'خطا در اتصال'; statusBadge.className = 'nbxApiBadge warn';
    } finally { refreshButton.disabled = false; }
  }
  async function saveKeys() {
    const publicKey = $('nbxApiPublicInput').value.trim().replace(/\s+/g, '');
    let privateKeyText = $('nbxApiPrivateInput').value.trim();
    if (!publicKey || !privateKeyText) return setMessage('هر دو مقدار Public Key و Private Key لازم است.', 'err');
    if (!bridge?.isAndroid && !window.isSecureContext) return setMessage('نسخه وب باید از نشانی HTTPS اجرا شود؛ از اجرای مستقیم فایل HTML استفاده نکنید.', 'err');
    saveButton.disabled = true;
    saveButton.textContent = 'در حال آزمایش امضا و اتصال…';
    setMessage('در حال ثبت رمزگذاری‌شده موقت در لایه بومی برای امضای درخواست فقط‌خواندنی؛ در صورت شکست آزمون، ثبت موقت حذف می‌شود…');
    let privateKeyForTest = privateKeyText;
    let nativeEnrollmentStarted = false;
    try {
      if (bridge?.isAndroid) {
        // Store encrypted before testing; the native signer decrypts and signs internally.
        // If authentication fails, the temporary enrollment is removed in catch below.
        await bridge.secureSet(STORE_PUBLIC, publicKey);
        nativeEnrollmentStarted = true;
        await bridge.secureSet(STORE_PRIVATE, privateKeyText);
        privateKeyForTest = null;
      } else {
        privateKeyForTest = await importPrivateKey(privateKeyText);
      }
      const wallets = await signedWalletRequest(publicKey, privateKeyForTest);
      if (!bridge?.isAndroid) await persistCredentials(publicKey, privateKeyForTest);
      $('nbxApiPublicInput').value = '';
      $('nbxApiPrivateInput').value = '';
      renderWallets(wallets);
      statusText.textContent = `اتصال خواندنی برقرار و کلید در ${bridge?.isAndroid ? 'ذخیره‌سازی رمزگذاری‌شده با Android Keystore' : 'حافظه محلی مرورگر'} ذخیره شد؛ ${fmt(wallets.length)} کیف‌پول دریافت شد.`;
      statusBadge.textContent = 'متصل و فقط خواندنی'; statusBadge.className = 'nbxApiBadge ok';
      refreshButton.disabled = false; forgetButton.style.display = '';
      setMessage('اتصال موفق بود؛ فقط دسترسی READ استفاده شد و هیچ سفارش یا برداشتی انجام نمی‌شود.', 'ok');
      setTimeout(hideModal, 900);
    } catch (e) {
      if (bridge?.isAndroid && nativeEnrollmentStarted) {
        try { await removeCredentials(); }
        catch (cleanupError) { console.warn('حذف ثبت موقت کلید ناموفق بود', cleanupError); }
      }
      $('nbxApiPrivateInput').value = '';
      setMessage(e?.message ? `آزمایش اتصال ناموفق بود؛ کلید موقت از حافظه بومی حذف شد.\n${e.message}` : 'آزمایش اتصال ناموفق بود؛ کلید موقت از حافظه بومی حذف شد.', 'err');
    } finally {
      privateKeyForTest = null;
      privateKeyText = null;
      saveButton.disabled = false;
      saveButton.textContent = 'آزمایش اتصال و ذخیره امن';
    }
  }
  async function forgetKeys() {
    if (!(await (window.NobitexDialogs?.confirm?.('کلیدهای API فقط از همین دستگاه/مرورگر حذف شوند؟ این کار کلید را از پنل نوبیتکس باطل نمی‌کند.') ?? Promise.resolve(false)))) return;
    try {
      await removeCredentials();
      walletSummary.replaceChildren(); walletSummary.classList.remove('visible');
      await checkSavedKeys();
      setMessage('اطلاعات کلید از حافظه محلی این دستگاه حذف شد. برای ابطال واقعی، کلید را از پنل نوبیتکس حذف کنید.', 'ok');
    } catch (e) { setMessage(e?.message || 'حذف کلید از حافظه محلی ناموفق بود.', 'err'); }
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
