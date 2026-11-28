import { access, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const androidDir = path.join(root, 'android');
const javaPackage = path.join(androidDir, 'app', 'src', 'main', 'java', 'ir', 'nobitex', 'scanner');

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} ${args.join(' ')} exited with ${code}`)));
  });
}

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

await run('npm', ['run', 'build:web']);
if (!(await exists(path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml')))) {
  await run('npx', ['cap', 'add', 'android']);
}

await mkdir(javaPackage, { recursive: true });
await mkdir(path.join(javaPackage, 'plugins'), { recursive: true });
await copyFile(
  path.join(root, 'native', 'android', 'NobitexNativePlugin.java'),
  path.join(javaPackage, 'plugins', 'NobitexNativePlugin.java')
);
await copyFile(
  path.join(root, 'native', 'android', 'MarketMonitorService.java'),
  path.join(javaPackage, 'MarketMonitorService.java')
);

// Install launcher icons generated from the supplied v7.7.1 SVG mark.
for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
  const target = path.join(androidDir, 'app', 'src', 'main', 'res', `mipmap-${density}`);
  await mkdir(target, { recursive: true });
  for (const icon of ['ic_launcher.png', 'ic_launcher_round.png']) {
    await copyFile(path.join(root, 'native', 'android', 'icons', `mipmap-${density}`, icon), path.join(target, icon));
  }
}

const mainActivity = `package ir.nobitex.scanner;\n\nimport android.os.Bundle;\nimport com.getcapacitor.BridgeActivity;\nimport ir.nobitex.scanner.plugins.NobitexNativePlugin;\n\npublic class MainActivity extends BridgeActivity {\n    @Override\n    public void onCreate(Bundle savedInstanceState) {\n        registerPlugin(NobitexNativePlugin.class);\n        super.onCreate(savedInstanceState);\n    }\n}\n`;
await writeFile(path.join(javaPackage, 'MainActivity.java'), mainActivity, 'utf8');

const manifestPath = path.join(androidDir, 'app', 'src', 'main', 'AndroidManifest.xml');
let manifest = await readFile(manifestPath, 'utf8');
if (!manifest.includes('android.permission.INTERNET')) {
  manifest = manifest.replace(/(<manifest[^>]*>)/, '$1\n    <uses-permission android:name="android.permission.INTERNET" />');
}
if (!manifest.includes('android.permission.POST_NOTIFICATIONS')) {
  manifest = manifest.replace(/(<manifest[^>]*>)/, '$1\n    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />');
}
for (const permission of [
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_SPECIAL_USE',
  'android.permission.WAKE_LOCK'
]) {
  if (!manifest.includes(permission)) {
    manifest = manifest.replace(/(<manifest[^>]*>)/, `$1\n    <uses-permission android:name="${permission}" />`);
  }
}
manifest = manifest.replace(/<application([^>]*)>/, (match, attrs) => {
  let next = attrs;
  next = /android:usesCleartextTraffic="[^"]*"/.test(next)
    ? next.replace(/android:usesCleartextTraffic="[^"]*"/, 'android:usesCleartextTraffic="false"')
    : next + ' android:usesCleartextTraffic="false"';
  next = /android:allowBackup="[^"]*"/.test(next)
    ? next.replace(/android:allowBackup="[^"]*"/, 'android:allowBackup="false"')
    : next + ' android:allowBackup="false"';
  if (!/android:enableOnBackInvokedCallback=/.test(next)) next += ' android:enableOnBackInvokedCallback="true"';
  next = /android:icon="[^"]*"/.test(next)
    ? next.replace(/android:icon="[^"]*"/, 'android:icon="@mipmap/ic_launcher"')
    : next + ' android:icon="@mipmap/ic_launcher"';
  next = /android:roundIcon="[^"]*"/.test(next)
    ? next.replace(/android:roundIcon="[^"]*"/, 'android:roundIcon="@mipmap/ic_launcher_round"')
    : next + ' android:roundIcon="@mipmap/ic_launcher_round"';
  return `<application${next}>`;
});

if (!manifest.includes('ir.nobitex.scanner.MarketMonitorService')) {
  const serviceDeclaration = `
        <service
            android:name="ir.nobitex.scanner.MarketMonitorService"
            android:enabled="true"
            android:exported="false"
            android:stopWithTask="false"
            android:foregroundServiceType="specialUse">
            <property
                android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
                android:value="User-initiated on-device monitoring of Nobitex market data to detect configured entry conditions and notify the user" />
        </service>
`;
  manifest = manifest.replace('</application>', serviceDeclaration + '    </application>');
}
await writeFile(manifestPath, manifest, 'utf8');

const stringsPath = path.join(androidDir, 'app', 'src', 'main', 'res', 'values', 'strings.xml');
await mkdir(path.dirname(stringsPath), { recursive: true });
let strings = (await exists(stringsPath)) ? await readFile(stringsPath, 'utf8') : '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n';
if (/<string name="app_name">[\s\S]*?<\/string>/.test(strings)) {
  strings = strings.replace(/<string name="app_name">[\s\S]*?<\/string>/, '<string name="app_name">نوبیتکس ۷٫۷٫۱</string>');
} else {
  strings = strings.replace('</resources>', '    <string name="app_name">نوبیتکس ۷٫۷٫۱</string>\n</resources>');
}
await writeFile(stringsPath, strings, 'utf8');

const gradlePath = path.join(androidDir, 'app', 'build.gradle');
if (await exists(gradlePath)) {
  let gradle = await readFile(gradlePath, 'utf8');
  gradle = gradle.replace(/versionCode\s+\d+/, 'versionCode 771');
  gradle = gradle.replace(/versionName\s+"[^"]+"/, 'versionName "7.7.1"');
  if (!gradle.includes('signingConfigs {')) {
    const signing = `\n    signingConfigs {\n        release {\n            def ksPath = System.getenv("NOBITEX_ANDROID_KEYSTORE_PATH")\n            if (ksPath != null && !ksPath.isEmpty()) {\n                storeFile file(ksPath)\n                storePassword System.getenv("NOBITEX_ANDROID_KEYSTORE_PASSWORD")\n                keyAlias System.getenv("NOBITEX_ANDROID_KEY_ALIAS")\n                keyPassword System.getenv("NOBITEX_ANDROID_KEY_PASSWORD")\n            }\n        }\n    }\n`;
    gradle = gradle.replace(/android\s*\{/, match => match + signing);
  }
  if (!/signingConfig\s+signingConfigs\.release/.test(gradle)) {
    const buildTypes = gradle.match(/buildTypes\s*\{/);
    if (buildTypes) {
      const bodyStart = buildTypes.index + buildTypes[0].length;
      const releaseIndex = gradle.indexOf('release {', bodyStart);
      if (releaseIndex >= 0) {
        const releaseOpenEnd = releaseIndex + 'release {'.length;
        gradle = gradle.slice(0, releaseOpenEnd) + `\n            if (System.getenv("NOBITEX_ANDROID_KEYSTORE_PATH") != null) { signingConfig signingConfigs.release }\n` + gradle.slice(releaseOpenEnd);
      } else {
        gradle = gradle.slice(0, bodyStart) + `\n        release {\n            if (System.getenv("NOBITEX_ANDROID_KEYSTORE_PATH") != null) { signingConfig signingConfigs.release }\n            minifyEnabled false\n        }\n` + gradle.slice(bodyStart);
      }
    } else {
      throw new Error('Android Gradle buildTypes block was not found; cannot configure stable release signing.');
    }
  }
  if (!gradle.includes('bcprov-jdk18on')) {
    gradle = gradle.replace(/dependencies\s*\{/, match => `${match}\n    implementation 'org.bouncycastle:bcprov-jdk18on:1.80'`);
  }
  await writeFile(gradlePath, gradle, 'utf8');
} else {
  throw new Error('فایل android/app/build.gradle پس از ایجاد پروژه پیدا نشد.');
}

await run('npx', ['cap', 'sync', 'android']);
console.log('Android project prepared. Use assembleRelease with NOBITEX_ANDROID_KEYSTORE_PATH, or assembleDebug only for temporary testing.');
