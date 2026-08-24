import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.elitedev.turfbooking',
  appName: 'Elite Turf Booking',
  webDir: 'dist',
  // Use native network requests so the iOS app can call the backend without
  // being blocked by CORS inside the WKWebView.
  plugins: {
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
