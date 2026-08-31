import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sitecheck.qc',
  appName: 'LiDAR Site Check',
  webDir: 'dist',
  ios: {
    contentInset: 'always',
    // Field use: keep the screen readable in sunlight, never dim mid-capture.
    preferredContentMode: 'mobile',
  },
};

export default config;
