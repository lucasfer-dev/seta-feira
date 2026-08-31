import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(here, '..');
const androidRoot = path.join(appRoot, 'android');
const appAndroid = path.join(androidRoot, 'app');
const javaTarget = path.join(appAndroid, 'src', 'main', 'java', 'com', 'sexta', 'assistant');
const nativeJava = path.join(appRoot, 'native', 'java');

if (!fs.existsSync(androidRoot)) throw new Error('Projeto Android não existe. Rode `npx cap add android` antes.');
fs.mkdirSync(javaTarget, { recursive: true });

for (const name of ['MainActivity.java', 'AssistantBridgePlugin.java', 'SextaForegroundService.java', 'SextaNotificationListener.java']) {
  fs.copyFileSync(path.join(nativeJava, name), path.join(javaTarget, name));
}

// ContextCompat.registerReceiver keeps the local conversation-state broadcast compatible
// across old and new Android versions without exporting it to other apps.
const servicePath = path.join(javaTarget, 'SextaForegroundService.java');
let service = fs.readFileSync(servicePath, 'utf8');
service = service.replace(
  'registerReceiver(conversationReceiver, new IntentFilter(ACTION_CONVERSATION_STATE), Context.RECEIVER_NOT_EXPORTED);',
  'ContextCompat.registerReceiver(this, conversationReceiver, new IntentFilter(ACTION_CONVERSATION_STATE), ContextCompat.RECEIVER_NOT_EXPORTED);'
);
fs.writeFileSync(servicePath, service);

const manifestPath = path.join(appAndroid, 'src', 'main', 'AndroidManifest.xml');
let manifest = fs.readFileSync(manifestPath, 'utf8');
const permissions = [
  '<uses-permission android:name="android.permission.INTERNET" />',
  '<uses-permission android:name="android.permission.RECORD_AUDIO" />',
  '<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />',
  '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />',
  '<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />',
  '<uses-permission android:name="android.permission.WAKE_LOCK" />',
  '<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />',
  '<uses-permission android:name="android.permission.CAMERA" />',
  '<uses-permission android:name="android.permission.READ_CONTACTS" />',
  '<uses-permission android:name="android.permission.WRITE_CONTACTS" />',
  '<uses-permission android:name="android.permission.READ_CALENDAR" />',
  '<uses-permission android:name="android.permission.WRITE_CALENDAR" />',
  '<uses-permission android:name="android.permission.BLUETOOTH" android:maxSdkVersion="30" />',
  '<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" android:maxSdkVersion="30" />',
  '<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />',
  '<uses-permission android:name="android.permission.BLUETOOTH_SCAN" android:usesPermissionFlags="neverForLocation" />',
  '<uses-feature android:name="android.hardware.microphone" android:required="false" />'
];
for (const line of permissions) {
  const name = line.match(/android:name="([^"]+)"/)?.[1];
  if (name && manifest.includes(`android:name="${name}"`)) continue;
  manifest = manifest.replace(/(<manifest[^>]*>)/, `$1\n    ${line}`);
}

if (!manifest.includes('android:name=".SextaForegroundService"')) {
  manifest = manifest.replace('</application>', `
        <service
            android:name=".SextaForegroundService"
            android:exported="false"
            android:stopWithTask="false"
            android:foregroundServiceType="microphone" />

        <service
            android:name=".SextaNotificationListener"
            android:label="SEXTA — acesso às notificações"
            android:exported="false"
            android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE">
            <intent-filter>
                <action android:name="android.service.notification.NotificationListenerService" />
            </intent-filter>
            <meta-data
                android:name="android.service.notification.default_filter_types"
                android:value="conversations|alerting" />
        </service>
    </application>`);
}
fs.writeFileSync(manifestPath, manifest);

const gradlePath = path.join(appAndroid, 'build.gradle');
let gradle = fs.readFileSync(gradlePath, 'utf8');
const dependencies = [
  "implementation 'com.alphacephei:vosk-android:0.3.75@aar'",
  "implementation 'net.java.dev.jna:jna:5.18.1@aar'",
  "implementation 'com.squareup.okhttp3:okhttp:4.12.0'"
];
for (const dependency of dependencies) {
  if (!gradle.includes(dependency)) gradle = gradle.replace(/dependencies\s*\{/, match => `${match}\n    ${dependency}`);
}
fs.writeFileSync(gradlePath, gradle);

console.log('SEXTA Android preparado: foreground service, wake word local, Gemini Live nativo e permissões opt-in.');
