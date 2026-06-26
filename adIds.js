// adIds.js
import { Platform } from 'react-native';
import { TestIds } from 'react-native-google-mobile-ads';

// --- RAW PRODUCTION AD UNITS (per platform) ---
const RAW_PROD_UNITS = {
  android: {
    BANNER: 'ca-app-pub-8778090938099386/5700033054',
    INTERSTITIAL: 'ca-app-pub-8778090938099386/1920570147',
    REWARDED: 'ca-app-pub-8778090938099386/8214515756',
    REWARDED_INTERSTITIAL: 'ca-app-pub-8778090938099386/3073869718',
  },
  ios: {
    BANNER: 'ca-app-pub-8778090938099386/9649104399',
    INTERSTITIAL: 'ca-app-pub-8778090938099386/1655064306',
    REWARDED: 'ca-app-pub-8778090938099386/3285616841',
    REWARDED_INTERSTITIAL: 'ca-app-pub-8778090938099386/8823107886',
  },
};

// Flattened map for the *current* platform.
// This is what App.js expects as PROD_AD_UNITS.
export const PROD_AD_UNITS =
  Platform.OS === 'ios'
    ? RAW_PROD_UNITS.ios
    : Platform.OS === 'android'
    ? RAW_PROD_UNITS.android
    : {};

// Full set getter (kept for flexibility / tests)
export const getAdUnits = (isTester) => {
  if (isTester) {
    return {
      BANNER: TestIds.BANNER,
      INTERSTITIAL: TestIds.INTERSTITIAL,
      REWARDED: TestIds.REWARDED,
      REWARDED_INTERSTITIAL: TestIds.REWARDED_INTERSTITIAL,
    };
  }
  return PROD_AD_UNITS;
};

// Safe single getter
export const getAdUnit = (name, isTester) => {
  try {
    const units = getAdUnits(!!isTester) || {};
    const id = units[name];
    return id ?? TestIds[name] ?? TestIds.BANNER;
  } catch {
    return TestIds[name] ?? TestIds.BANNER;
  }
};
