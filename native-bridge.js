// Browser/GitHub Pages fallback only. No credentials are read or stored here.
window.NobitexNativeBridge = Object.freeze({
  platform: 'web',
  isAndroid: false,
  secureGet: async () => { throw new Error('SECURE_STORAGE_ANDROID_ONLY'); },
  secureSet: async () => { throw new Error('SECURE_STORAGE_ANDROID_ONLY'); },
  secureRemove: async () => { throw new Error('SECURE_STORAGE_ANDROID_ONLY'); },
  httpRequest: async () => { throw new Error('NATIVE_HTTP_ANDROID_ONLY'); }
});
