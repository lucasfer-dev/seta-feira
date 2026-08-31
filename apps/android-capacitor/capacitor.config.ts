import type { CapacitorConfig } from '@capacitor/cli';

const url = process.env.SEXTA_WEB_URL || 'http://10.0.2.2:3000';

const config: CapacitorConfig = {
  appId: 'com.sexta.assistant',
  appName: 'SEXTA',
  webDir: 'www',
  server: {
    url,
    cleartext: url.startsWith('http://')
  },
  android: {
    allowMixedContent: false
  }
};

export default config;
