
// PWA shell caching; market APIs remain network-only and are never fabricated offline.
if('serviceWorker' in navigator && /^https?:$/.test(location.protocol)){
  window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(err=>console.warn('ثبت Service Worker ناموفق بود',err)));
}
