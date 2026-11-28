package ir.nobitex.scanner;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.text.TextUtils;
import android.util.Log;

public class MarketMonitorService extends Service {
    public static final String ACTION_STOP = "ir.nobitex.scanner.action.STOP_MARKET_MONITOR";
    private static final String PREFS = "nobitex_background_monitor";
    private static final String KEY_ACTIVE = "active";
    private static final String KEY_USER_STOPPED = "user_stopped";
    private static final int SERVICE_NOTIFICATION_ID = 75801;
    private static final String SERVICE_CHANNEL_ID = "nobitex_background_monitor";
    private static final String ALERT_CHANNEL_ID = "nobitex_entry_alerts";
    private static volatile MarketMonitorService instance;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private PowerManager.WakeLock wakeLock;
    private long lastHeartbeatAt;
    private String statusText = "در حال راه‌اندازی موتور تحلیل";
    private boolean started;

    private final Runnable wakeRenewal = new Runnable() {
        @Override public void run() {
            if (!started) return;
            acquireOrRenewWakeLock();
            handler.postDelayed(this, 4 * 60 * 1000L);
        }
    };

    private final Runnable heartbeatWatch = new Runnable() {
        @Override public void run() {
            if (!started) return;
            long age = System.currentTimeMillis() - lastHeartbeatAt;
            if (age > 120_000L) {
                statusText = "موتور تحلیل پاسخ نمی‌دهد؛ برنامه را باز کنید";
                releaseWakeLock();
            }
            updateServiceNotification();
            handler.postDelayed(this, 30_000L);
        }
    };

    @Override public void onCreate() {
        super.onCreate();
        instance = this;
        createServiceChannel();
        createAlertChannel(this);
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .putBoolean(KEY_USER_STOPPED, true)
                .putBoolean(KEY_ACTIVE, false)
                .apply();
            stopSelf();
            return START_NOT_STICKY;
        }
        try {
            statusText = "در حال پایش بازار؛ منتظر نخستین وضعیت موتور";
            lastHeartbeatAt = System.currentTimeMillis();
            Notification notification = buildServiceNotification();
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(SERVICE_NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
            } else {
                startForeground(SERVICE_NOTIFICATION_ID, notification);
            }
            started = true;
            getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .putBoolean(KEY_ACTIVE, true)
                .putBoolean(KEY_USER_STOPPED, false)
                .apply();
            acquireOrRenewWakeLock();
            handler.removeCallbacks(wakeRenewal);
            handler.removeCallbacks(heartbeatWatch);
            handler.postDelayed(wakeRenewal, 4 * 60 * 1000L);
            handler.postDelayed(heartbeatWatch, 30_000L);
        } catch (Exception error) {
            started = false;
            getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(KEY_ACTIVE, false).apply();
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    private void createServiceChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(SERVICE_CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            SERVICE_CHANNEL_ID, "پایش پس‌زمینه نوبیتکس", NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription("اعلان دائمی وضعیت پایش محلی بازار رمزارزها");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    public static void createAlertChannel(Context context) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(ALERT_CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            ALERT_CHANNEL_ID, "هشدار موقعیت ورود", NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("هشدار هنگام تأیید کامل شروط و ماشه ورود سامانه");
        channel.enableVibration(true);
        channel.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
            new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build());
        manager.createNotificationChannel(channel);
    }

    private Notification buildServiceNotification() {
        Intent open = new Intent(this, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent content = PendingIntent.getActivity(this, 7580, open,
            PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag());
        Intent stop = new Intent(this, MarketMonitorService.class).setAction(ACTION_STOP);
        PendingIntent stopPending = PendingIntent.getService(this, 7581, stop,
            PendingIntent.FLAG_UPDATE_CURRENT | immutableFlag());
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(this, SERVICE_CHANNEL_ID)
            : new Notification.Builder(this);
        builder.setSmallIcon(android.R.drawable.ic_popup_sync)
            .setContentTitle("پایش پس‌زمینه نوبیتکس")
            .setContentText(statusText)
            .setStyle(new Notification.BigTextStyle().bigText(statusText))
            .setContentIntent(content)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_SERVICE)
            .addAction(android.R.drawable.ic_media_pause, "توقف پایش", stopPending);
        return builder.build();
    }

    private int immutableFlag() {
        return Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0;
    }

    private void updateServiceNotification() {
        if (!started) return;
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager != null) manager.notify(SERVICE_NOTIFICATION_ID, buildServiceNotification());
    }

    private void acquireOrRenewWakeLock() {
        try {
            PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
            if (power == null) return;
            if (wakeLock == null) {
                wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, getPackageName() + ":MarketMonitor");
                wakeLock.setReferenceCounted(false);
            }
            if (!wakeLock.isHeld()) wakeLock.acquire(5 * 60 * 1000L);
            else {
                wakeLock.release();
                wakeLock.acquire(5 * 60 * 1000L);
            }
        } catch (Exception error) {
            Log.w("NobitexMonitor", "WakeLock acquire/renew failed", error);
        }
    }

    private void releaseWakeLock() {
        try { if (wakeLock != null && wakeLock.isHeld()) wakeLock.release(); }
        catch (Exception error) {
            Log.w("NobitexMonitor", "WakeLock release failed", error);
        }
    }

    public static boolean isRunning() {
        MarketMonitorService service = instance;
        return service != null && service.started;
    }

    public static boolean wasStoppedByUser(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getBoolean(KEY_USER_STOPPED, false);
    }

    public static void updateStatus(String value) {
        MarketMonitorService service = instance;
        if (service == null || !service.started) return;
        service.handler.post(() -> {
            service.lastHeartbeatAt = System.currentTimeMillis();
            service.statusText = TextUtils.isEmpty(value) ? "پایش بازار فعال است" : value;
            service.acquireOrRenewWakeLock();
            service.updateServiceNotification();
        });
    }

    public static void postEntryNotification(Context context, String title, String body, String tag) {
        createAlertChannel(context);
        if (Build.VERSION.SDK_INT >= 33
            && context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            return;
        }
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        Intent open = new Intent(context, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent content = PendingIntent.getActivity(context, 7582, open,
            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
            ? new Notification.Builder(context, ALERT_CHANNEL_ID)
            : new Notification.Builder(context);
        String safeTitle = TextUtils.isEmpty(title) ? "موقعیت ورود تأیید شد" : title;
        String safeBody = TextUtils.isEmpty(body) ? "شرایط ورود بررسی شود." : body;
        builder.setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentTitle(safeTitle)
            .setContentText(safeBody)
            .setStyle(new Notification.BigTextStyle().bigText(safeBody))
            .setContentIntent(content)
            .setAutoCancel(true)
            .setCategory(Notification.CATEGORY_ALARM)
            .setDefaults(Notification.DEFAULT_SOUND | Notification.DEFAULT_VIBRATE);
        int id = tag == null ? (int)(System.currentTimeMillis() & 0x7fffffff) : (tag.hashCode() & 0x7fffffff);
        if (id == 0) id = 1;
        manager.notify("nobitex-entry", id, builder.build());
    }

    @Override public void onTaskRemoved(Intent rootIntent) {
        // The user may dismiss the task while explicitly enabled monitoring is active.
        // Keep the foreground service alive; the heartbeat reports if the scanner UI engine has stopped.
        super.onTaskRemoved(rootIntent);
    }

    @Override public void onDestroy() {
        started = false;
        handler.removeCallbacksAndMessages(null);
        releaseWakeLock();
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putBoolean(KEY_ACTIVE, false).apply();
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE);
        else stopForeground(true);
        if (instance == this) instance = null;
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
