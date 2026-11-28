import { Capacitor, registerPlugin } from '@capacitor/core';
import { App } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';

const Native = registerPlugin('NobitexNative');
const isAndroid = Capacitor.getPlatform() === 'android';

// Keep compatibility with the legacy web application's existing plugin lookups.
const cap = window.Capacitor || Capacitor;
cap.Plugins = cap.Plugins || {};
cap.Plugins.App = App;
cap.Plugins.LocalNotifications = LocalNotifications;

if (isAndroid) {
  window.NobitexNativeBridge = Object.freeze({
    isAndroid: true,
    async secureGet(key) {
      const result = await Native.secureGet({ key });
      return result && typeof result.value === 'string' && result.value.length ? result.value : null;
    },
    async secureSet(key, value) {
      await Native.secureSet({ key, value });
    },
    async secureRemove(key) {
      await Native.secureRemove({ key });
    },
    async signedWalletRequest(options) {
      return Native.signedWalletRequest(options);
    },
    async startBackgroundMonitor() {
      return Native.startBackgroundMonitor();
    },
    async stopBackgroundMonitor() {
      return Native.stopBackgroundMonitor();
    },
    async getBackgroundMonitorStatus() {
      const result = await Native.getBackgroundMonitorStatus();
      return { active: result?.active === true, userStopped: result?.userStopped === true };
    },
    async updateBackgroundMonitorStatus(status) {
      return Native.updateBackgroundMonitorStatus({ status: String(status || '').slice(0, 180) });
    },
    async notifyEntry({ title, body, tag }) {
      return Native.notifyEntry({ title, body, tag });
    }
  });

  // Back is page-local: close the topmost overlay or expanded mobile panel.
  // At the root screen it intentionally does nothing; it never exits/minimizes the app.
  App.addListener('backButton', () => {
    if (window.history.state && window.history.state.nobitexOverlay) {
      window.history.back();
      return;
    }
    window.dispatchEvent(new CustomEvent('nobitex:back'));
  }).catch((error) => console.warn('ثبت مدیریت Back اندروید ناموفق بود', error));
} else {
  window.NobitexNativeBridge = Object.freeze({ isAndroid: false });
}
