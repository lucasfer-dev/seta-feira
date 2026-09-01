import type { CapacitorConfig } from '@capacitor/cli';

// APKs should work out of the box against the hosted SEXTA Core.
// For local/emulator development, override with e.g.
// SEXTA_WEB_URL=http://10.0.2.2:3000 npx cap sync android
const url = process.env.SEXTA_WEB_URL || 'https://seta-feira.vercel.app';

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
