package ir.nobitex.scanner.plugins;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;
import org.bouncycastle.jce.provider.BouncyCastleProvider;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.Provider;
import java.security.Signature;
import java.util.Arrays;
import java.security.spec.PKCS8EncodedKeySpec;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "NobitexNative")
public class NobitexNativePlugin extends Plugin {
    // Legacy storage identifiers are intentionally retained so existing 7.5.x
    // installations do not lose credentials when updating the application.
    private static final String PREFS = "nobitex_secure_v756";
    private static final String KEY_ALIAS = "nobitex_scanner_v756_aes_gcm";
    private static final String PUBLIC_KEY = "nobitex_public_key";
    private static final String PRIVATE_KEY = "nobitex_private_key";
    private static final ExecutorService NETWORK = Executors.newSingleThreadExecutor();

    private boolean allowedStorageKey(String key) {
        return PUBLIC_KEY.equals(key) || PRIVATE_KEY.equals(key);
    }

    private SecretKey getOrCreateSecretKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        if (keyStore.containsAlias(KEY_ALIAS)) {
            return (SecretKey) keyStore.getKey(KEY_ALIAS, null);
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setRandomizedEncryptionRequired(true)
            .build();
        generator.init(spec);
        return generator.generateKey();
    }

    private String encrypt(String plainText) throws Exception {
        byte[] plainBytes = plainText.getBytes(StandardCharsets.UTF_8);
        byte[] iv = null;
        byte[] encrypted = null;
        byte[] packed = null;
        try {
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecretKey());
            iv = cipher.getIV();
            encrypted = cipher.doFinal(plainBytes);
            ByteBuffer buffer = ByteBuffer.allocate(4 + iv.length + encrypted.length);
            buffer.putInt(iv.length);
            buffer.put(iv);
            buffer.put(encrypted);
            packed = buffer.array();
            return Base64.encodeToString(packed, Base64.NO_WRAP);
        } finally {
            Arrays.fill(plainBytes, (byte) 0);
            if (iv != null) Arrays.fill(iv, (byte) 0);
            if (encrypted != null) Arrays.fill(encrypted, (byte) 0);
            if (packed != null) Arrays.fill(packed, (byte) 0);
        }
    }

    private String decrypt(String payload) throws Exception {
        byte[] bytes = Base64.decode(payload, Base64.NO_WRAP);
        ByteBuffer buffer = ByteBuffer.wrap(bytes);
        int ivLength = buffer.getInt();
        if (ivLength < 12 || ivLength > 16 || buffer.remaining() <= ivLength) {
            throw new IllegalArgumentException("Encrypted value is malformed");
        }
        byte[] iv = new byte[ivLength];
        buffer.get(iv);
        byte[] encrypted = new byte[buffer.remaining()];
        buffer.get(encrypted);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateSecretKey(), new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
    }

    @PluginMethod
    public void secureGet(PluginCall call) {
        String key = call.getString("key", "");
        if (!PUBLIC_KEY.equals(key)) {
            call.reject("فقط کلید عمومی از لایه بومی قابل خواندن است.");
            return;
        }
        try {
            SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String encrypted = prefs.getString(key, null);
            JSObject result = new JSObject();
            result.put("value", encrypted == null ? "" : decrypt(encrypted));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("خواندن اطلاعات رمزگذاری‌شده ناموفق بود.");
        }
    }

    @PluginMethod
    public void secureSet(PluginCall call) {
        String key = call.getString("key", "");
        String value = call.getString("value", "");
        if (!allowedStorageKey(key) || value.isEmpty()) {
            call.reject("کلید یا مقدار ذخیره‌سازی معتبر نیست.");
            return;
        }
        try {
            String encrypted = encrypt(value);
            boolean saved = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit().putString(key, encrypted).commit();
            if (!saved) throw new IllegalStateException("Storage commit failed");
            call.resolve();
        } catch (Exception error) {
            call.reject("ذخیره رمزگذاری‌شده اطلاعات API ناموفق بود.");
        }
    }

    @PluginMethod
    public void secureRemove(PluginCall call) {
        String key = call.getString("key", "");
        if (!allowedStorageKey(key)) {
            call.reject("کلید ذخیره‌سازی مجاز نیست.");
            return;
        }
        boolean removed = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().remove(key).commit();
        if (removed) call.resolve();
        else call.reject("حذف اطلاعات ذخیره‌شده ناموفق بود.");
    }

    private String readBody(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder body = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) body.append(line);
        }
        return body.toString();
    }


    private byte[] decryptBytes(String payload) throws Exception {
        byte[] packed = Base64.decode(payload, Base64.NO_WRAP);
        try {
            ByteBuffer buffer = ByteBuffer.wrap(packed);
            int ivLength = buffer.getInt();
            if (ivLength < 12 || ivLength > 16 || buffer.remaining() <= ivLength) {
                throw new IllegalArgumentException("Encrypted value is malformed");
            }
            byte[] iv = new byte[ivLength];
            buffer.get(iv);
            byte[] encrypted = new byte[buffer.remaining()];
            buffer.get(encrypted);
            try {
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, getOrCreateSecretKey(), new GCMParameterSpec(128, iv));
                return cipher.doFinal(encrypted);
            } finally {
                Arrays.fill(iv, (byte) 0);
                Arrays.fill(encrypted, (byte) 0);
            }
        } finally {
            Arrays.fill(packed, (byte) 0);
        }
    }

    private byte[] decodeBase64Url(String value) {
        String clean = value == null ? "" : value.replaceAll("\\s+", "").replace('-', '+').replace('_', '/');
        int padding = (4 - clean.length() % 4) % 4;
        StringBuilder padded = new StringBuilder(clean);
        for (int i = 0; i < padding; i++) padded.append('=');
        return Base64.decode(padded.toString(), Base64.DEFAULT);
    }


    private byte[] decodeBase64Url(byte[] value) {
        byte[] clean = new byte[value.length + 4];
        int length = 0;
        try {
            for (byte raw : value) {
                int c = raw & 0xff;
                if (c == ' ' || c == '\n' || c == '\r' || c == '\t') continue;
                if (c == '-') c = '+';
                else if (c == '_') c = '/';
                clean[length++] = (byte) c;
            }
            while (length % 4 != 0) clean[length++] = '=';
            return Base64.decode(clean, 0, length, Base64.DEFAULT);
        } finally {
            Arrays.fill(clean, (byte) 0);
        }
    }

    @PluginMethod
    public void signedWalletRequest(PluginCall call) {
        final String publicKeyText = call.getString("publicKey", "").trim().replaceAll("\\s+", "");
        if (publicKeyText.isEmpty()) {
            call.reject("کلید عمومی API ثبت نشده است.");
            return;
        }
        NETWORK.execute(() -> {
            HttpURLConnection connection = null;
            byte[] seed = null;
            byte[] pkcs8 = null;
            byte[] signatureBytes = null;
            try {
                byte[] publicBytes = decodeBase64Url(publicKeyText);
                try {
                    if (publicBytes.length != 32) throw new IllegalArgumentException("Public key length invalid");
                } finally {
                    Arrays.fill(publicBytes, (byte) 0);
                }

                // The private key is never returned to JavaScript. Signing always reads
                // the encrypted value from native SharedPreferences and decrypts it in-process.
                SharedPreferences prefs = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
                String encryptedPrivate = prefs.getString(PRIVATE_KEY, null);
                if (encryptedPrivate == null || encryptedPrivate.isEmpty()) throw new IllegalStateException("Private key is not enrolled");
                byte[] encodedPrivate = decryptBytes(encryptedPrivate);
                try {
                    seed = decodeBase64Url(encodedPrivate);
                } finally {
                    Arrays.fill(encodedPrivate, (byte) 0);
                }
                if (seed.length != 32) throw new IllegalArgumentException("Ed25519 private seed must be 32 bytes");

                byte[] prefix = new byte[] {
                    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05,
                    0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20
                };
                pkcs8 = new byte[prefix.length + seed.length];
                System.arraycopy(prefix, 0, pkcs8, 0, prefix.length);
                System.arraycopy(seed, 0, pkcs8, prefix.length, seed.length);
                Arrays.fill(prefix, (byte) 0);

                // Use an explicit provider instance instead of mutating the process-wide
                // security provider list (which may already contain an older Android BC).
                Provider signingProvider = new BouncyCastleProvider();
                PrivateKey privateKey = KeyFactory.getInstance("Ed25519", signingProvider)
                    .generatePrivate(new PKCS8EncodedKeySpec(pkcs8));
                String path = "/users/wallets/list";
                String timestamp = String.valueOf(System.currentTimeMillis() / 1000L);
                Signature signer = Signature.getInstance("Ed25519", signingProvider);
                signer.initSign(privateKey);
                signer.update((timestamp + "GET" + path).getBytes(StandardCharsets.UTF_8));
                signatureBytes = signer.sign();
                String signatureText = Base64.encodeToString(signatureBytes,
                    Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);

                URL url = new URL("https://apiv2.nobitex.ir" + path);
                connection = (HttpURLConnection) url.openConnection();
                connection.setRequestMethod("GET");
                connection.setConnectTimeout(15000);
                connection.setReadTimeout(20000);
                connection.setInstanceFollowRedirects(false);
                connection.setUseCaches(false);
                connection.setDoInput(true);
                connection.setRequestProperty("Accept", "application/json");
                connection.setRequestProperty("User-Agent", "NobitexScanner/7.6.0 Android");
                connection.setRequestProperty("Nobitex-Key", publicKeyText);
                connection.setRequestProperty("Nobitex-Timestamp", timestamp);
                connection.setRequestProperty("Nobitex-Signature", signatureText);
                int status = connection.getResponseCode();
                InputStream stream = status >= 200 && status < 400
                    ? connection.getInputStream()
                    : connection.getErrorStream();
                String body = readBody(stream);
                JSObject result = new JSObject();
                result.put("status", status);
                try {
                    JSONObject json = new JSONObject(body);
                    JSObject data = new JSObject();
                    Iterator<String> keys = json.keys();
                    while (keys.hasNext()) {
                        String key = keys.next();
                        data.put(key, json.get(key));
                    }
                    result.put("data", data);
                } catch (Exception notJsonObject) {
                    result.put("data", body);
                }
                call.resolve(result);
            } catch (Exception error) {
                // Never log or return the private key, seed, PKCS#8 material, or signature.
                call.reject("امضای بومی یا درخواست فقط‌خواندنی کیف‌پول نوبیتکس ناموفق بود.");
            } finally {
                if (connection != null) connection.disconnect();
                if (seed != null) Arrays.fill(seed, (byte) 0);
                if (pkcs8 != null) Arrays.fill(pkcs8, (byte) 0);
                if (signatureBytes != null) Arrays.fill(signatureBytes, (byte) 0);
            }
        });
    }

    @PluginMethod
    public void startBackgroundMonitor(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33
            && getContext().checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            call.reject("برای پایش پس‌زمینه، مجوز اعلان اندروید باید فعال باشد.");
            return;
        }
        try {
            Intent intent = new Intent(getContext(), ir.nobitex.scanner.MarketMonitorService.class);
            if (Build.VERSION.SDK_INT >= 26) getContext().startForegroundService(intent);
            else getContext().startService(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("راه‌اندازی سرویس پایش پس‌زمینه ناموفق بود.");
        }
    }

    @PluginMethod
    public void stopBackgroundMonitor(PluginCall call) {
        try {
            getContext().stopService(new Intent(getContext(), ir.nobitex.scanner.MarketMonitorService.class));
            call.resolve();
        } catch (Exception error) {
            call.reject("توقف سرویس پایش پس‌زمینه ناموفق بود.");
        }
    }

    @PluginMethod
    public void getBackgroundMonitorStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("active", ir.nobitex.scanner.MarketMonitorService.isRunning());
        result.put("userStopped", ir.nobitex.scanner.MarketMonitorService.wasStoppedByUser(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void updateBackgroundMonitorStatus(PluginCall call) {
        ir.nobitex.scanner.MarketMonitorService.updateStatus(call.getString("status", "پایش بازار فعال است"));
        call.resolve();
    }

    @PluginMethod
    public void notifyEntry(PluginCall call) {
        String title = call.getString("title", "موقعیت ورود تأیید شد");
        String body = call.getString("body", "شرایط ورود بررسی شود.");
        String tag = call.getString("tag", "");
        ir.nobitex.scanner.MarketMonitorService.postEntryNotification(getContext(), title, body, tag);
        call.resolve();
    }

}
