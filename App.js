import 'react-native-gesture-handler';
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  SafeAreaView,
  View,
  Text,
  Button,
  Image,
  Alert,
  Animated,
  Easing,
  Platform,
  Linking,
  TextInput,
  ScrollView,
  Switch,
  TouchableOpacity,
  AppState,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
  InputAccessoryView,
  ActivityIndicator,
  useColorScheme,
  useWindowDimensions,
  Dimensions,
  Modal,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { activateKeepAwakeAsync, deactivateKeepAwakeAsync } from 'expo-keep-awake';
import colors from './colors';
import * as Notifications from 'expo-notifications';
import * as MailComposer from 'expo-mail-composer';
import * as FileSystem from 'expo-file-system';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import * as Papa from 'papaparse';
import { Audio } from 'expo-audio';
import { useAudioPlayer } from 'expo-audio';
// AI voice input uses a lazy dynamic import so iOS startup never loads speech recognition.
import Constants from 'expo-constants';
import * as IntentLauncher from 'expo-intent-launcher';
import Purchases from 'react-native-purchases';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from 'react-native-vector-icons/Ionicons';
import MaterialCommunityIcons from 'react-native-vector-icons/MaterialCommunityIcons';
import DraggableFlatList from 'react-native-draggable-flatlist';
import QRCode from 'react-native-qrcode-svg';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import * as AuthSession from 'expo-auth-session';
import { makeRedirectUri } from 'expo-auth-session';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  OAuthProvider,
  reauthenticateWithCredential,
  signInWithCredential,
  signInAnonymously,
  onAuthStateChanged,
  signOut,
  deleteUser,
  signInWithEmailAndPassword,
  EmailAuthProvider,
  linkWithCredential,
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  sendEmailVerification,
  reload,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { PROD_AD_UNITS } from './adIds';
import NetInfo from '@react-native-community/netinfo';
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  addDoc,
  setDoc,
  updateDoc,
  getDocs,
  deleteDoc,
  query,
  where,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from './firebase';
import mobileAds, {
  BannerAd,
  BannerAdSize,
  TestIds,
  InterstitialAd,
  RewardedAd,
  AdEventType,
  RewardedAdEventType,
  MaxAdContentRating,
} from 'react-native-google-mobile-ads';
import { getApp as getNativeFirebaseApp } from '@react-native-firebase/app';
import {
  getAnalytics,
  logEvent as logNativeAnalyticsEvent,
} from '@react-native-firebase/analytics';

WebBrowser.maybeCompleteAuthSession();

// 🔔 Notifications: allow AgendaGlow meeting alerts in foreground too
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,  // shows heads-up banner
    shouldShowList: true,    // shows in notification tray
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const ACCOUNT_DELETE_URL = 'https://dozenred.com/account-deletion/';

// ---- Safe logging (prevents Metro log bridge hangs on circular/huge objects) ----
const safeStringify = (value, space = 0, maxLen = 8000) => {
  const seen = new WeakSet();
  let out = '';
  try {
    out = JSON.stringify(
      value,
      (k, v) => {
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v)) return '[Circular]';
          seen.add(v);
        }
        if (typeof v === 'function') return `[Function ${v.name || 'anonymous'}]`;
        return v;
      },
      space
    );
  } catch (e) {
    out = `[Unserializable: ${e?.message || e}]`;
  }
  if (out && out.length > maxLen) {
    return out.slice(0, maxLen) + `… (truncated ${out.length - maxLen} chars)`;
  }
  return out;
};

const logSafe = (label, obj) => {
  console.log(label, safeStringify(obj, 0));
};

const QUICKSTART_STORAGE_KEY = '@agendaglow_quickstart_v1';
const TEMPLATE_CATEGORY_STORAGE_KEY = '@agendaglow_template_category_v1';
const MEETINGS_COMPLETED_STORAGE_KEY = '@agendaglow_meetings_completed_v1';
const ADS_UNLOCK_AFTER_MEETINGS = 3;
const PRO_OFFER_AFTER_MEETINGS = 5;

// 🤖 AI agenda usage guard
const AI_FREE_AGENDA_LIMIT = 3;
const AI_AGENDA_USAGE_STORAGE_KEY = '@agendaglow_ai_agendas_used_v1';
const AI_AGENDA_DEFAULT_ITEM_COUNT = 8;
const AI_AGENDA_MAX_ITEM_COUNT = 20;

// Keep AI-generated item titles aligned with the Setup screen maxLength.
// This is module-level because AI normalization lives outside App().
const AGENDA_ITEM_TITLE_MAX_CHARS = 30;

const getAiAgendaUsageStorageKey = (uid) =>
  `${AI_AGENDA_USAGE_STORAGE_KEY}:${uid || 'anonymous'}`;

// ⭐ Quick Launch favorites (1-taps)
const QUICK_LAUNCH_FAVORITES_KEY = '@quickLaunchFavorites_v1';

// Default quick launch titles (used when user hasn't chosen favorites yet)
const DEFAULT_QUICK_LAUNCH = [
  'Daily Stand-up',
  '1:1 Coaching & Check-In',
  'Team Meeting',
  'Project Sync',
  'Client Meeting',
];

const LAUNCH_ID = Date.now().toString();

const logUserEvent = (type, meta = {}, screenName = 'unknown') => {
  return (async () => {
    try {
      const uid = auth.currentUser?.uid;
      if (!uid) return;

      await addDoc(collection(db, 'users', uid, 'events'), {
        type,
        screen: screenName,
        ts: serverTimestamp(),
        launchId: LAUNCH_ID,
        isAnonymous: !!auth.currentUser?.isAnonymous,
        provider:
          auth.currentUser?.providerData?.[0]?.providerId ||
          (auth.currentUser?.isAnonymous ? 'anonymous' : 'unknown'),
        ...meta,
      });
    } catch (e) {
      console.warn('logUserEvent failed', type, e);
    }
  })();
};

// ─────────────────────────────────────────────────────────────────────────────
// ✅ Google Ads / Firebase Analytics conversion events
// Firestore event docs are useful for your own debugging, but Google Ads cannot
// optimize against them. These GA4/Firebase Analytics events are the events you
// import/mark as Google Ads app conversions.
//
// Important privacy rule: do not send user-entered agenda titles or viewer URLs
// to Analytics. Keep conversion params generic and optimization-safe.
// ─────────────────────────────────────────────────────────────────────────────
const sanitizeAnalyticsParams = (params = {}) => {
  const out = {};

  Object.entries(params || {}).forEach(([rawKey, rawValue]) => {
    if (rawValue === undefined || rawValue === null) return;

    const key = String(rawKey)
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .slice(0, 40);

    if (!key) return;

    if (typeof rawValue === 'number') {
      if (Number.isFinite(rawValue)) out[key] = rawValue;
      return;
    }

    if (typeof rawValue === 'boolean') {
      out[key] = rawValue;
      return;
    }

    // GA4 event params can be strings, but keep them short and non-PII.
    out[key] = String(rawValue).replace(/\s+/g, ' ').trim().slice(0, 100);
  });

  return out;
};

const logAnalyticsConversion = (eventName, params = {}, screenName = 'unknown') => {
  return (async () => {
    try {
      const analyticsInstance = getAnalytics(getNativeFirebaseApp());
      const safeParams = sanitizeAnalyticsParams({
        ...params,
        screen: screenName,
        platform: Platform.OS,
        is_anonymous: !!auth.currentUser?.isAnonymous,
        auth_provider:
          auth.currentUser?.providerData?.[0]?.providerId ||
          (auth.currentUser?.isAnonymous ? 'anonymous' : 'unknown'),
      });

      await logNativeAnalyticsEvent(analyticsInstance, eventName, safeParams);
      console.log(`[Analytics conversion] ${eventName}`, sanitizeAnalyticsParams(params));
    } catch (e) {
      console.warn('logAnalyticsConversion failed', eventName, e?.message || e);
    }
  })();
};

const trackAgendaCreated = (meta = {}, screenName = 'setup') => {
  logUserEvent('first_agenda_created', meta, screenName);
  logAnalyticsConversion(
    'agenda_created',
    {
      source: meta.source || 'unknown',
      item_count: meta.itemCount ?? meta.items ?? undefined,
      total_minutes: meta.totalMinutes ?? meta.total_minutes ?? undefined,
    },
    screenName
  );
};

const trackMeetingStarted = (meta = {}, screenName = 'timer') => {
  logUserEvent('meeting_started', meta, screenName);
  logAnalyticsConversion(
    'meeting_started',
    {
      source: meta.source || 'unknown',
      item_count: meta.itemCount ?? meta.items ?? undefined,
      total_minutes: meta.totalMinutes ?? meta.total_minutes ?? undefined,
      viewer_prompt_mode: meta.viewerPromptMode || meta.mode || 'unknown',
    },
    screenName
  );
};

const trackViewerLinkShared = (method, meta = {}, screenName = 'sharelink') => {
  logUserEvent(`viewer_${method}_share_started`, meta, screenName);
  logAnalyticsConversion(
    'viewer_link_shared',
    {
      method,
      mode: meta.mode || 'unknown',
    },
    screenName
  );
};

// 🚀 Sample Meeting (first-run)
const SAMPLE_MEETING_FIRSTRUN_KEY = '@agendaglow_sample_seen_v1';

// 🎬 First-open auto-demo (run once per install)
const FIRST_OPEN_AUTODEMO_KEY = '@agendaglow_first_open_autodemo_v1';

// 🔁 DEV ONLY: reset first-run flags to force auto-demo
const resetFirstRunFlagsForDev = async () => {
  await AsyncStorage.multiRemove([
    FIRST_OPEN_AUTODEMO_KEY,
    SAMPLE_MEETING_FIRSTRUN_KEY,
  ]);
  console.log('🔁 First-run demo flags cleared (dev)');
};

// ✅ Hoist styles so it's initialized before use
const styles = {
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    padding: 8,
    marginBottom: 12,
  },
  footer: {
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    backgroundColor: '#fff',
  },

  // Primary = solid blue bar
  primaryBtn: {
    backgroundColor: '#2f80ed',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
    textTransform: 'none',
  },
  endDemoBtnWrap: {
    width: '75%',
    alignSelf: 'center',
  },

  launchAgendaGlowBtnWrap: {
    width: '92%',
    alignSelf: 'center',
    maxWidth: 520,
  },

  launchAgendaGlowBtn: {
    backgroundColor: '#2f80ed', // electric blue
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  launchAgendaGlowBtnText: {
    color: '#fff',
    fontWeight: '800',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 18,
  },  

  endDemoBtn: {
    backgroundColor: '#d11a2a',
    borderRadius: 999,
    paddingVertical: 14,
    paddingHorizontal: 28,

    width: '100%',     // fill wrapper
    maxWidth: 520,     // optional: keeps it sane on tablets
    alignItems: 'center',
    justifyContent: 'center',
  },
  endDemoBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 16,
    textAlign: 'center',
  },

    // ✅ Demo Summary CTA (blue) — keep timer "End demo" red
    launchAgendaGlowBtn: {
      backgroundColor: '#2f80ed', // electric blue
      borderRadius: 999,
      paddingVertical: 14,
      paddingHorizontal: 28,
      width: '100%',
      maxWidth: 520,
      alignItems: 'center',
      justifyContent: 'center',
    },
    launchAgendaGlowBtnText: {
      color: '#fff',
      fontWeight: '700',
      fontSize: 16,
      textAlign: 'center',
    },

  // ⭐ NEW: Secondary = outline / pill buttons (for My Agendas, Templates, etc.)
  secondaryBtn: {
    borderWidth: 1,
    borderColor: '#2f80ed',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
  },
  secondaryBtnText: {
    color: '#2f80ed',
    fontWeight: '600',
    fontSize: 14,
  },

  authTabsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 12,
  },
  authTab: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#2f80ed',
    marginHorizontal: 6,
  },
  authTabActive: { backgroundColor: '#2f80ed' },
  authTabText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2f80ed',
  },
  authTabTextActive: { color: '#fff' },
  recentHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  recentHeaderText: { fontSize: 12, color: '#666' },
  clearLink: {
    fontSize: 12,
    color: '#2f80ed',
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  recentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 6,
    marginBottom: 6,
  },
  chip: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginRight: 8,
    marginBottom: 8,
    backgroundColor: '#fff',
  },
  chipActive: { borderColor: '#2f80ed', backgroundColor: '#e9f2ff' },
  chipText: { fontSize: 12, fontWeight: '600', color: '#333' },
  authTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  backLink: { paddingVertical: 6, paddingHorizontal: 8 },
  backText: { fontSize: 14, color: '#2f80ed' },
  authSticky: {
    backgroundColor: '#fff',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    zIndex: 100,
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  warningBox: {
    backgroundColor: '#FFF7CC',
    borderColor: '#F0C36D',
    borderWidth: 1,
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  warningText: { color: '#6A4F00', fontSize: 13, lineHeight: 18 },
  errorText: {
    color: '#d11a2a',
    marginTop: -4,
    marginBottom: 8,
    fontSize: 12,
  },
  setupDragCol: {
    width: 24, // ⬅️ bigger touch target (was 24)
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
    paddingVertical: 6, // increases vertical hitbox as well
  },
  setupDragHandle: {
    fontSize: 24,
    color: '#9ca3af',
  },
  setupDurationLabel: {
    fontSize: 11,
    color: '#888',
    textAlign: 'center',
    marginBottom: 2,
  },

  // ───────────────── Setup screen polish ─────────────────
  setupCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 5,
  },
  // Separate card for Share / Start on setup screen
  setupButtonsCard: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  setupDockWrap: {
    width: '100%',
    backgroundColor: '#f3f4f6',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 28 : 8,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',

    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -2 },
    elevation: 6,
  },
  setupBackPill: {
    alignSelf: 'flex-start',
    backgroundColor: '#eef4ff',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    marginBottom: 10,
  },
  setupBackPillText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2f80ed',
  },
  setupHeaderTitle: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  setupHeaderSubtitle: {
    fontSize: 16,
    color: '#444',
    textAlign: 'center',
    marginBottom: 16,
  },
  setupItemCard: {
    backgroundColor: '#f9fbff', // subtle blue-tinted card
    borderRadius: 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#dbeafe', // soft blue border
    shadowColor: '#2f80ed', // on-brand shadow tint
    shadowOpacity: 0.07,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  setupItemTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  setupItemDragCol: {
    width: 26,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
  },
  setupItemMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
  },
  setupItemMetaLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  setupItemTinyText: {
    fontSize: 11,
    color: '#888',
  },
  setupItemDelete: {
    fontSize: 14,
    color: '#d11a2a',
    fontWeight: '600',
  },
  setupBottomRow: {
    marginTop: 16,
    gap: 10,
  },
  setupBottomRowTwo: {
    flexDirection: 'row',
    gap: 10,
  },
  setupSecondaryWide: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#2f80ed',
    borderRadius: 999,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  setupSecondaryWideText: {
    color: '#2f80ed',
    fontWeight: '600',
    fontSize: 15,
  },
  setupShareBtn: {
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2f80ed',
  },
  setupShareBtnText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  setupStartBtn: {
    marginTop: 10,
    borderRadius: 999,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#00c853',
  },
  setupStartBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },

  // 📝 Info + Presenter modal styles
  infoModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  infoModalCard: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
  },
  infoModalTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  infoModalLabel: {
    fontSize: 12,
    color: '#555',
    marginTop: 8,
    marginBottom: 4,
  },
  infoModalInput: {
    borderWidth: 1,
    borderColor: '#d0d0d0',
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#fff',
    fontSize: 13,
  },
  infoModalCounter: {
    fontSize: 11,
    color: '#888',
    textAlign: 'right',
    marginTop: 4,
  },
  infoModalButtonsRow: {
    flexDirection: 'row',
    marginTop: 16,
  },
  summaryUpsellCard: {
    width: '100%',
    backgroundColor: '#f7faff',
    borderWidth: 1,
    borderColor: '#cfe3ff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
  },
  summaryUpsellTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 6,
  },
  summaryUpsellBody: {
    fontSize: 14,
    lineHeight: 20,
    color: '#4b5563',
    marginBottom: 12,
  },
  summaryUpsellButton: {
    alignSelf: 'center',
    backgroundColor: '#2f80ed',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 999,
    marginTop: 4,
  },
  summaryUpsellButtonText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
    proOfferModalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
  },
  proOfferModalIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#eefbf3',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  proOfferModalTitle: {
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
    color: '#111827',
    marginBottom: 8,
  },
  proOfferModalBody: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    color: '#4b5563',
    marginBottom: 18,
  },
  proOfferModalPrimaryBtn: {
    width: '100%',
    backgroundColor: '#00a651',
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  proOfferModalPrimaryBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  proOfferModalSecondaryBtn: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
  },
  proOfferModalSecondaryBtnText: {
    color: '#374151',
    fontSize: 15,
    fontWeight: '700',
  },
};

// ---- Feature flags ----
const ENABLE_GOOGLE_LOGIN = true;

// Treat ONLY this address as the internal tester
const INTERNAL_TEST_EMAIL = 'test.case@dozenred.com';

const isInternalTesterEmail = (email) =>
  (email || '').trim().toLowerCase() === INTERNAL_TEST_EMAIL;

// If you're that exact email (or in __DEV__), use Google’s built-in test ad units
const isTesterNow = () => {
  const email = auth.currentUser?.email || '';
  return __DEV__ || isInternalTesterEmail(email);
};

const SafeTestIds = {
  BANNER: TestIds?.BANNER,
  INTERSTITIAL: TestIds?.INTERSTITIAL,
  REWARDED: TestIds?.REWARDED,
};

// NEVER return undefined; always fall back to Google TestIds
const getAdUnit = (name /* 'BANNER' | 'INTERSTITIAL' | 'REWARDED' */) => {
  try {
    const tester = isTesterNow();
    if (tester) {
      if (SafeTestIds[name]) return SafeTestIds[name];
      console.warn(`[Ads] Unknown test ad type "${name}", using TestIds.BANNER`);
      return SafeTestIds.BANNER;
    }
    const id = PROD_AD_UNITS && PROD_AD_UNITS[name];
    if (!id) {
      console.warn(`[Ads] Missing PROD_AD_UNITS["${name}"]; using Google TestIds`);
      return SafeTestIds[name] || SafeTestIds.BANNER;
    }
    return id;
  } catch (e) {
    console.warn('[Ads] getAdUnit error, falling back to Google TestIds:', e);
    return SafeTestIds[name] || SafeTestIds.BANNER;
  }
};

const configureAdsForUser = async (email) => {
  const isTester = __DEV__ || isInternalTesterEmail(email);

  // Add your real physical device hashes once you see them in logs
  // (the SDK prints: "Use RequestConfiguration.Builder.setTestDeviceIds([\"HASH\"])")
  const knownTestDevices = [
    'EMULATOR', // keep this
    '63b2df23f1e41a29f10c3c9e213d9f44', // Ken’s iPhone (iOS test device)
    // 'D87B0493C75A297BBA08F5D43C730018', 'D445E9EB2570681DF533F0A7932941DF', // ← my device hash
  ];

  await mobileAds().setRequestConfiguration({
    maxAdContentRating: MaxAdContentRating.PG,
    tagForChildDirectedTreatment: false,
    tagForUnderAgeOfConsent: false,
    testDeviceIdentifiers: isTester ? knownTestDevices : [],
  });

  await mobileAds().initialize();
  console.log(`[Ads] Initialized. Tester=${isTester} Email="${email || 'anon/offline'}"`);
};

const checkInternetConnection = async () => {
  const state = await NetInfo.fetch();
  return isEffectivelyOnline(state);
};

// ─────────────────────────────────────────────────────────────────────────────
// ✅ User-safe Firebase error messages (never show raw Firebase errors)
// ─────────────────────────────────────────────────────────────────────────────

const isFirebaseLikeError = (e) => {
  const code = e?.code || '';
  return (
    typeof code === 'string' &&
    (code.startsWith('auth/') ||
      code === 'permission-denied' ||
      code === 'unavailable' ||
      code === 'failed-precondition' ||
      code === 'resource-exhausted')
  );
};

const firebaseUserMessage = (e, fallback = 'Something went wrong. Please try again.') => {
  const code = e?.code || '';

  // Network / offline
  if (code === 'auth/network-request-failed' || code === 'unavailable') {
    return 'Network issue. Please check your connection and try again.';
  }

  // Auth common cases
  if (code === 'auth/invalid-email') return 'That email address doesn’t look valid.';
  if (code === 'auth/user-not-found') return 'No account found with that email.';
  if (code === 'auth/wrong-password') return 'Incorrect password. Please try again.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Please wait a bit and try again.';
  if (code === 'auth/email-already-in-use') return 'That email is already in use. Please sign in instead.';
  if (code === 'auth/credential-already-in-use') return 'That sign-in is already linked to another account.';
  if (code === 'auth/account-exists-with-different-credential')
    return 'An account already exists with a different sign-in method. Try signing in using the original method.';
  if (code === 'auth/requires-recent-login')
    return 'For security, please sign in again and then retry this action.';

  // Firestore rules / permissions
  if (code === 'permission-denied') return 'Permission denied. Please sign in again and try.';
  if (code === 'failed-precondition') return 'This action isn’t available right now. Please try again.';
  if (code === 'resource-exhausted') return 'Service is busy right now. Please try again in a moment.';

  // Default: NEVER show e.message (it can contain raw Firebase text)
  return fallback;
};

const alertSafe = (title, e, fallbackMessage) => {
  // Always log real details for debugging:
  console.warn('[safe-error]', title, e);

  // If it smells like Firebase, sanitize hard:
  if (isFirebaseLikeError(e)) {
    Alert.alert(title, firebaseUserMessage(e, fallbackMessage));
    return;
  }

  // Non-Firebase: still avoid dumping raw error strings to users.
  Alert.alert(title, fallbackMessage || 'Something went wrong. Please try again.');
};

const BrandingFooter = ({
  pulseAnim,
  aboveBranding = null,
  showPauseStatus = false,
  pauseSeconds = 0,
  showBranding = true,
  compact = false,
}) => (
  <View
    style={{
      alignItems: 'center',
      marginBottom: compact ? 8 : 4,
      paddingBottom: compact ? 0 : 4,
    }}
  >
    {/* Row ABOVE the branding (your small Pause/Next buttons) */}
    {aboveBranding ? (
      <View
        style={{
          width: '100%',
          paddingHorizontal: 20,
          marginBottom: compact ? 0 : 4, // 👈 tighter when compact
        }}
      >
        {aboveBranding}
      </View>
    ) : null}

    {/* Main line: either Paused status OR AgendaGlow */}
    {(showPauseStatus || showBranding) && (
      <View
        style={{
          flexDirection: 'row',
          justifyContent: 'center',
          alignItems: 'center',
          marginBottom: 4,
          minHeight: 32,
        }}
      >
        {showPauseStatus ? (
          <Text
            style={{
              fontSize: 16,
              fontWeight: '600',
              color: '#d11a2a',
            }}
          >
            ⏸️ Paused: {Math.floor(pauseSeconds / 60)} min {pauseSeconds % 60} sec
          </Text>
        ) : (
          showBranding && (
            <>
              <Text
                style={{
                  fontSize: 24,
                  fontWeight: 'bold',
                  color: colors.electricBlue,
                }}
              >
                Agenda
              </Text>
              <Animated.Text
                style={{
                  fontSize: 24,
                  fontWeight: 'bold',
                  color: colors.brightGreen,
                  transform: [{ scale: pulseAnim }],
                  textShadowColor: '#ffffffdd',
                  textShadowRadius: 8,
                  textShadowOffset: { width: 0, height: 0 },
                }}
              >
                Glow
              </Animated.Text>
            </>
          )
        )}
      </View>
    )}
  </View>
);

const BottomNav = ({ active, onGo, screen, isTempAccount, isProUser }) => {
  const items = [
    { key: 'prestart', label: 'Home', icon: 'home-outline' },
    { key: 'myagendas', label: 'My Agendas', icon: 'folder-outline' },
    { key: 'templates', label: 'Templates', icon: 'clipboard-check-outline' },
    {
      key: 'me',
      label: isTempAccount ? 'Register' : isProUser ? 'Me' : 'Me',
      icon: 'person-circle-outline',
    },
    { 
      key: 'more',
      label: screen === 'summary' ? 'Export' : 'More',
      icon: screen === 'summary' ? 'download-outline' : 'ellipsis-horizontal'
    },
  ];

  return (
    <View
      style={{
        width: '100%',
        backgroundColor: '#ffffff',
        paddingTop: 8,
        paddingBottom: 8,
        paddingHorizontal: 8,

        // 👇 "lip" that separates nav from the ad area below
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: -4 },

        // Android
        elevation: 14,
      }}
    >
      <View style={{ flexDirection: 'row' }}>
        {items.map((it) => {
          const isActive = active === it.key;

          const activeColor = '#00c853'; // existing active-tab green
          const inactiveColor = '#9ca3af';

          // ✅ Summary-only emphasis: Home + Export
          const isSummary = screen === 'summary';
          const isEmphasized = isSummary && (it.key === 'prestart' || it.key === 'more');
          const emphasisColor =
            it.key === 'more' ? '#16a34a' : '#2563eb'; // Export green, Home blue

          const color = isActive
            ? activeColor
            : isEmphasized
            ? emphasisColor
            : inactiveColor;

          const iconSize = isActive
            ? 28
            : isEmphasized
            ? 26
            : 22;

          return (
            <TouchableOpacity
              key={it.key}
              onPress={() => onGo(it.key)}
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                paddingVertical: 8,
                position: 'relative', // 👈 required for indicator positioning
              }}
              accessibilityRole="button"
              accessibilityLabel={it.label}
            >
              
              {/* 🟢 Active top indicator */}
              {isActive && (
                <View
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 8,
                    right: 8,
                    height: 3, // 2–3px as requested
                    backgroundColor: '#00c853',
                    borderRadius: 2,
                  }}
                />
              )}
              
              {it.key === 'templates' ? (
                <MaterialCommunityIcons
                  name="clipboard-check-outline"
                  size={iconSize}
                  color={color}
                />
              ) : (
                <Ionicons name={it.icon} size={iconSize} color={color} />
              )}
              <Text
                style={{
                  fontSize: isEmphasized ? 12.5 : 11,
                  marginTop: 4,
                  color: color,
                  fontWeight: isActive ? '800' : isEmphasized ? '800' : '600',
                }}
              >
                {it.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const OrDivider = () => (
  <View style={{ flexDirection: 'row', alignItems: 'center', marginVertical: 12 }}>
    <View style={{ flex: 1, height: 1, backgroundColor: '#e9e9e9' }} />
    <Text style={{ marginHorizontal: 8, color: '#777', fontSize: 12, fontWeight: '600' }}>
      or
    </Text>
    <View style={{ flex: 1, height: 1, backgroundColor: '#e9e9e9' }} />
  </View>
);

// 🔧 Format seconds as M:SS, or H:MM:SS when >= 1 hour
const formatMMSS = (totalSec) => {
  const sec = Math.max(0, Math.round(totalSec || 0));

  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;

  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; // 1:02:15
  }

  return `${m}:${String(s).padStart(2, '0')}`; // 3:42
};

// 🔧 Generate remark like “Finished early by 1:24”
const getTimingRemark = (actual, planned) => {
  const delta = actual - planned;
  const abs = Math.abs(delta);
  const minutes = Math.floor(abs / 60);
  const seconds = abs % 60;

  if (delta === 0) {
    return '⏱️ Perfect Timing — right on schedule!';
  }

  return delta > 0
    ? `🚨 Overrun by ${minutes}:${seconds.toString().padStart(2, '0')}`
    : `✅ Finished Early by ${minutes}:${seconds.toString().padStart(2, '0')}`;
};

// Verbose duration like "2 min 31 sec" (omits zero units, fixed abbreviations)
const formatVerboseDuration = (totalSec) => {
  const s = Math.max(0, Math.floor(totalSec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const parts = [];
  if (h) parts.push(`${h} hr`);
  if (m) parts.push(`${m} min`);
  if (ss || (!h && !m)) parts.push(`${ss} sec`);
  return parts.join(' ');
};

// 🎊 Simple emoji confetti overlay for "Finished Early"
const ConfettiOverlay = ({ visible }) => {
  const { width } = Dimensions.get('window');
  const NUM_PIECES = 40;

  // Static random config for each piece (position, size, emoji, etc.)
  const piecesRef = React.useRef(
    Array.from({ length: NUM_PIECES }).map(() => ({
      anim: new Animated.Value(0),
      x: Math.random(), // 0–1, we convert to actual X later
      drift: (Math.random() - 0.5) * 80, // slight left/right drift
      delay: Math.random() * 800,
      duration: 3500 + Math.random() * 2500, // ⏱️ 3.5–6s, nice long fall
      emoji: ['🎉', '🎊', '✨', '⭐'][Math.floor(Math.random() * 4)],
      size: 14 + Math.random() * 10,
    }))
  );

  // Keep track of running loops so we can stop them cleanly
  const loopsRef = React.useRef([]);

  React.useEffect(() => {
    const pieces = piecesRef.current;

    if (!visible) {
      // Stop all loops + reset positions when hidden
      loopsRef.current.forEach((loopAnim) => loopAnim.stop());
      loopsRef.current = [];
      pieces.forEach((p) => p.anim.setValue(0));
      return;
    }

    // Start a looping fall for each piece
    const loops = pieces.map((p) => {
      p.anim.setValue(0);

      const singleFall = Animated.timing(p.anim, {
        toValue: 1,
        duration: p.duration,
        delay: p.delay,
        useNativeDriver: true,
      });

      const loopAnim = Animated.loop(singleFall, {
        resetBeforeIteration: true,
      });

      loopAnim.start();
      return loopAnim;
    });

    loopsRef.current = loops;

    // Cleanup when visible changes or component unmounts
    return () => {
      loops.forEach((loopAnim) => loopAnim.stop());
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
      }}
    >
      {piecesRef.current.map((p, idx) => (
        <Animated.Text
          key={idx}
          style={{
            position: 'absolute',
            fontSize: p.size,
            transform: [
              {
                translateY: p.anim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-60, 900],
                }),
              },
              {
                translateX: p.anim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [p.x * width, p.x * width + p.drift],
                }),
              },
              {
                rotate: p.anim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0deg', '360deg'],
                }),
              },
            ],
            opacity: p.anim.interpolate({
              inputRange: [0, 0.1, 0.8, 1],
              outputRange: [0, 1, 1, 0],
            }),
          }}
        >
          {p.emoji}
        </Animated.Text>
      ))}
    </View>
  );
};

// 🔗 Helper to build safe viewer URLs (handles spaces & Android scanners)
const buildViewerUrl = (uid, sid) => {
  const base = `https://agendaglowviewer.dozenred.com/view/${encodeURIComponent(uid || '')}/${encodeURIComponent(sid || '')}`;
  if (__DEV__) {
    return `${base}?adtest=on`;
  }
  return base;
};

// 📧 Robust email/share handler for the meeting link + QR
const handleShareMeetingLinkByEmail = async (sessionId, userId, shareQRRef) => {
  try {
    const url = buildViewerUrl(userId, sessionId);

    // 1️⃣ Get PNG (base64) from the rendered QR
    const b64 = await new Promise((resolve, reject) => {
      const fn = shareQRRef.current?.toDataURL;
      if (!fn) return reject(new Error('QR not ready'));
      fn((data) => resolve(data));
    });

    // 2️⃣ Write it to a temporary file
    const pngUri =
      FileSystem.cacheDirectory + `AgendaGlow-QR-${sessionId || 'session'}.png`;
    await FileSystem.writeAsStringAsync(pngUri, b64, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // 3️⃣ Try native email composer
    const isMailAvailable = await MailComposer.isAvailableAsync();
    if (isMailAvailable) {
      await MailComposer.composeAsync({
        subject: `AgendaGlow Meeting Link: ${sessionId}`,
        body: `
<div style="font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial;">
  <p>Scan the attached QR to follow the meeting live, or click this link:</p>
  <p><a href="${url}">${url}</a></p>
  <hr />
  <p><small>If the QR doesn’t show inline, it’s attached as a PNG.</small></p>
</div>`,
        isHtml: true,
        attachments: [pngUri],
      });
      return;
    }

    // 4️⃣ Fallback if no email app (iOS with no Mail configured, etc.)
    await Clipboard.setStringAsync(url);

    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      // Let the system share sheet handle it (Outlook, Messages, Teams, etc.)
      await Sharing.shareAsync(pngUri, {
        dialogTitle: 'Share AgendaGlow Meeting Link',
        UTI: 'public.png',
        mimeType: 'image/png',
      });
      // ✅ No extra "Email Not Available" alert here; user just used an app successfully.
    } else {
      // Only show this if we truly have no email app AND no share sheet.
      Alert.alert(
        'Email Not Available',
        'No compatible app found. The meeting link has been copied — paste it into your preferred app.'
      );
    }
  } catch (err) {
    console.warn('Compose email failed:', err);
    Alert.alert('Error', 'Could not prepare sharing. Please try again.');
  }
};

// 🔑 Generate stable IDs for agenda items
const generateAgendaItemId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

// Factory for a brand-new empty item
const createEmptyAgendaItem = () => ({
  id: generateAgendaItemId(),
  title: 'New Item',
  duration: 1,
  yellow: 0.66666,
  red: 0.9,
  info: '',
  presenterTag: '',
});

// Default blank agenda: start with 4 items instead of 1
const createDefaultBlankAgenda = (advancedThresholdsEnabled) => {
  // Option A (recommended): light pre-fill that nudges people into editing fast
  const presets = [
    { title: '👋 Kickoff', duration: 5 },
    { title: '🧾 Updates', duration: 10 },
    { title: '🗣️ Discussion', duration: 15 },
    { title: '✅ Wrap-up', duration: 5 },
  ];

  return presets.map((p) => {
    const base = createEmptyAgendaItem();
    return {
      ...base,
      title: p.title,
      duration: p.duration,
      // keep your existing behavior: when advanced thresholds are enabled,
      // you often use 0.66 (else 0.66666)
      yellow: advancedThresholdsEnabled ? 0.66 : base.yellow,
    };
  });
};

// Blank canvas quick-start: guided blank agenda (still generic, but more useful)
const createBlankCanvasAgenda3 = (advancedThresholdsEnabled) => {
  const mk = (title, duration, presenterTag, info) => {
    const base = createEmptyAgendaItem();
    return {
      ...base,
      title,
      duration,
      presenterTag,
      info,
      yellow: advancedThresholdsEnabled ? 0.66 : base.yellow,
    };
  };

  return [
    mk(
      'Opening',
      5,
      'Facilitator',
      'Set the purpose, desired outcome, and timing for the meeting.'
    ),
    mk(
      'Discussion',
      15,
      'Team',
      'Work through the main topic, review updates, or make decisions.'
    ),
    mk(
      'Wrap-up',
      5,
      'Facilitator',
      'Capture decisions, owners, and next steps before ending.'
    ),
  ];
};


// 🤖 AI agenda generation endpoint
// IMPORTANT: keep your AI provider API key on the server side only.
// This endpoint should be implemented as a Netlify Function or other backend proxy.
const AI_AGENDA_FUNCTION_URL =
  'https://agendaglowviewer.dozenred.com/.netlify/functions/generate-agenda';

// Try a small set of known deployment paths. This keeps the app resilient if
// the Netlify function is exposed through a redirect/proxy path or if an older
// deployment used camelCase for the function name.
const AI_AGENDA_FUNCTION_URLS = [
  AI_AGENDA_FUNCTION_URL,
  'https://agendaglowviewer.dozenred.com/api/generate-agenda',
  'https://agendaglowviewer.dozenred.com/.netlify/functions/generateAgenda',
];

const readJsonResponseSafely = async (response) => {
  const text = await response.text().catch(() => '');
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    // If the viewer SPA/HTML fallback is returned, keep a short body preview so
    // the alert/log explains the real routing problem instead of silently
    // treating the response as an empty agenda.
    return {
      error: 'AI agenda server returned a non-JSON response.',
      rawPreview: text.slice(0, 180),
    };
  }
};

const normalizeAiAgendaTitle = (value) => {
  const title = String(value || 'AI Generated Agenda')
    .replace(/\//g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  return title || 'AI Generated Agenda';
};

const normalizeAiAgendaItems = (rawItems, advancedThresholdsEnabled) => {
  const items = Array.isArray(rawItems) ? rawItems : [];

  const normalized = items
    .slice(0, AI_AGENDA_MAX_ITEM_COUNT)
    .map((raw, idx) => {
      const base = createEmptyAgendaItem();

      const rawDuration =
        raw?.duration ??
        raw?.durationMinutes ??
        raw?.minutes ??
        raw?.timeMinutes ??
        raw?.time;

      const parsedDuration = Number(rawDuration);
      const duration =
        Number.isFinite(parsedDuration) && parsedDuration > 0
          ? Math.min(Math.max(Math.round(parsedDuration), 1), 240)
          : 5;

      return {
        ...base,
        title:
          String(raw?.title || raw?.name || `Agenda Item ${idx + 1}`)
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, AGENDA_ITEM_TITLE_MAX_CHARS) || `Agenda Item ${idx + 1}`,
        duration,
        yellow: advancedThresholdsEnabled ? 0.66 : base.yellow,
        red: 0.9,
        presenterTag: String(raw?.presenterTag || raw?.presenter || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 24),
        info: String(raw?.info || raw?.notes || raw?.description || '')
          .trim()
          .slice(0, 150),
      };
    })
    .filter((item) => item.title && item.duration > 0);

  return ensureAtLeastOneAgendaItem(normalized);
};

// 🧩 Default “starter” agendas used by Quick Launch
const buildQuickLaunchAgenda = (title, advancedThresholdsEnabled) => {
  const mk = (items) =>
    items.map((it) => {
      const base = createEmptyAgendaItem();
      return {
        ...base,
        title: it.title,
        duration: it.duration,
        presenterTag: it.presenterTag ?? base.presenterTag,
        info: it.info ?? base.info,
        yellow: advancedThresholdsEnabled ? 0.66 : base.yellow,
      };
    });

  switch (title) {
    case 'Daily Stand-up':
      return mk([
        {
          title: '📣 Announcements / Alignment',
          duration: 2,
          presenterTag: 'Leader',
          info:
            '✔️ Quick updates on team-wide items\n✔️ Schedule reminders/changes\n✔️ Announcements for the team\n❓️ Alignment before updates?',
        },
        {
          title: '🔥 Team Member Updates',
          duration: 9,
          presenterTag: 'Team Members',
          info: "✅️ What have I done since last meeting?\n🎯 What am I working on today?\n🐌 What's slowing me down?",
        },
        {
          title: '🧠 Next Steps',
          duration: 2,
          presenterTag: 'Leader',
          info: '✔️ Summarize upcoming priorities\n✔️ Clarify expectations\n✔️ Confirm any required handoffs',
        },
        {
          title: '🅿️ Parking Lot',
          duration: 1,
          presenterTag: 'Leader',
          info:
            '📝 Note deeper discussion topics\n☑️ Assign owners to follow-ups\n📅 Schedule breakouts if needed\n\n⏳️ Keep stand-up time boxed',
        },
        {
          title: '🎒 Wrap-up',
          duration: 1,
          presenterTag: 'Leader',
          info:
            '🚧 Brief recap of blockers & owners\n🤔 Confirm expectations\n\nMotivational close:\n"Let\'s have a strong sprint day!"',
        },
      ]);

      case '1:1 Coaching & Check-In':
        // Forced total = 30 minutes
        return mk([
          {
            title: '👋 Check-in',
            duration: 2,
            presenterTag: 'Both',
            info: '🙂 How are you feeling this week?\n🏆 Any wins?\n⚡ Energy level check.\n🗣️ Anything urgent before we dive in?',
          },
          {
            title: '🧠 What’s on Your Mind?',
            duration: 4,
            presenterTag: 'Direct',
            info: '💭 What’s top-of-mind?\n🚧 Any concerns?\n💡 Ideas or opportunities?\n🤝 Anything you need support on?',
          },
          {
            title: '🎯 Review Goals & Progress',
            duration: 6,
            presenterTag: 'Direct',
            info: '📈 Progress since last 1:1.\n🎯 Goals status.\n⚠️ Risks or delays.\n🔄 Any reprioritization needed?',
          },
          {
            title: '👨‍🏫 Feedback & Coaching',
            duration: 10,
            presenterTag: 'Manager (with Direct)',
            info: '🗣️ Feedback both ways.\n🧩 Coaching on challenges.\n🚀 Growth opportunities.\n🛠️ Remove blockers.',
          },
          {
            title: '🤔 Reflections',
            duration: 4,
            presenterTag: 'Both',
            info: '🔍 What’s working well?\n⚖️ What feels off?\n🧠 Patterns or themes?\n😊 Morale and workload check.',
          },
          {
            title: '➡️ Next Steps',
            duration: 2,
            presenterTag: 'Manager',
            info: '📝 Define actions.\n👤 Confirm owners.\n📅 Set deadlines.\n✅ Align on success criteria.',
          },
          {
            title: '🎒 Wrap-up',
            duration: 2,
            presenterTag: 'Manager',
            info: '🔁 Quick recap of commitments.\n🤝 Confirm alignment.\n🙌 End on encouragement.',
          },
        ]);

    case 'Team Meeting':
      return mk([
        {
          title: '👋 Opening & Goals',
          duration: 3,
          presenterTag: 'Leader',
          info: '🎯 Confirm meeting purpose.\n🧭 Align on desired outcomes.\n⏱️ Set expectations for timing.',
        },
        {
          title: '📊 Key Updates',
          duration: 8,
          presenterTag: 'Team',
          info: '📌 Important updates only.\n🚧 Highlight blockers or risks.\n🔄 Keep deep dives for later.',
        },
        {
          title: '🗣️ Discussion',
          duration: 12,
          presenterTag: 'Team',
          info: '💬 Review decisions or open issues.\n🤝 Capture viewpoints.\n🎯 Drive toward alignment.',
        },
        {
          title: '✅ Decisions & Actions',
          duration: 5,
          presenterTag: 'Leader',
          info: '📝 Confirm decisions made.\n👤 Assign owners.\n📅 Confirm due dates.',
        },
        {
          title: '🎒 Wrap-up',
          duration: 2,
          presenterTag: 'Leader',
          info: '🔁 Quick recap.\n📍 Confirm next step.\n🙌 End on clarity.',
        },
      ]);

    case 'Project Sync':
      return mk([
        {
          title: '🎯 Objective Check',
          duration: 3,
          presenterTag: 'Leader',
          info: '🧭 Re-state the project goal.\n📍 This week’s priorities.',
        },
        {
          title: '📈 Progress Review',
          duration: 8,
          presenterTag: 'Team',
          info: '✅ What moved forward?\n📦 What was completed?\n📊 What is on track?',
        },
        {
          title: '🚧 Risks & Blockers',
          duration: 8,
          presenterTag: 'Team',
          info: '⚠️ Surface delivery risks.\n🧱 Identify blockers.\n🤝 Ask for help where needed.',
        },
        {
          title: '➡️ Next Milestones',
          duration: 6,
          presenterTag: 'Leader',
          info: '📅 Confirm next milestones.\n👤 Clarify ownership.\n🎯 Align priorities.',
        },
        {
          title: '🅿️ Parking Lot',
          duration: 2,
          presenterTag: 'Leader',
          info: '📝 Capture side topics.\n📌 Move side topics out.',
        },
        {
          title: '🎒 Wrap-up',
          duration: 1,
          presenterTag: 'Leader',
          info: '✅ Recap commitments.\n🤝 Confirm alignment.',
        },
      ]);

      case 'Client Meeting':
        return mk([
          {
            title: '👋 Welcome & Objectives',
            duration: 5,
            presenterTag: 'Host',
            info: 'Set the tone, confirm goals, and align on what success looks like for this meeting.',
          },
          {
            title: '📊 Status / Updates',
            duration: 10,
            presenterTag: 'Team',
            info: 'Share relevant updates, progress, milestones, or context the client should know.',
          },
          {
            title: '🗣️ Discussion',
            duration: 15,
            presenterTag: 'All',
            info: 'Review questions, decisions, needs, risks, or feedback. Keep the discussion focused.',
          },
          {
            title: '✅ Next Steps',
            duration: 5,
            presenterTag: 'Host',
            info: 'Confirm actions, owners, due dates, and any follow-up items before ending.',
          },
        ]);

      /*
      case 'Athletic Session':
        return mk([
          { title: '🔥 Warm-up', duration: 8, presenterTag: 'Coach', info: '🦵 Mobility work.\n🔄 Dynamic movement prep.\n⚡ Gradual intensity ramp-up.\n🎯 Prepare for main lifts.' },
          { title: '🏋️ Main set', duration: 25, presenterTag: 'Coach', info: '🏋️ Primary lifts or intervals.\n📊 Track loads or times.\n⏱️ Structured rest.\n💪 Focus on form + intensity.' },
          { title: '💧 Conditioning', duration: 12, presenterTag: 'Coach', info: '🔥 Accessory movements.\n🫀 Conditioning finisher.\n🧱 Strengthen weak points.\n🥵 Push capacity safely.' },
          { title: '🧘 Cool-down', duration: 5, presenterTag: 'Coach', info: '🧘 Stretch + breathing.\n📉 Lower heart rate.\n📝 Quick notes for next session.\n🙌 Recovery focus.' },
        ]);

      case 'Teacher Class Agenda':
        return mk([
          { title: '🧠 Bell-ringer', duration: 5, presenterTag: 'Students', info: '✍️ Prompt or problem on entry.\n⏳ Silent start.\n🧠 Activate prior knowledge.\n🎯 Focus the room.' },
          { title: '📚 Instruction', duration: 15, presenterTag: 'Teacher', info: '🧑‍🏫 Mini-lesson.\n📖 Key concept explanation.\n🧩 Worked examples.\n❓ Checks for understanding.' },
          { title: '🧪 Guided practice', duration: 15, presenterTag: 'Students', info: '📝 Student work time.\n👀 Teacher circulates.\n🤝 Small-group support.\n✅ Real-time feedback.' },
          { title: '✅ Exit ticket', duration: 5, presenterTag: 'Teacher', info: '📋 Quick re-check.\n💬 Reflect or summarize.\n🔮 Preview next lesson.\n👋 Close with clarity.' },
        ]);
      */


    default:
      // Fallback: your existing “blank agenda” preset
      return createDefaultBlankAgenda(advancedThresholdsEnabled);
  }
};

// Ensure we always have at least one item AND that each has an id
const ensureAtLeastOneAgendaItem = (agenda) => {
  const base =
    Array.isArray(agenda) && agenda.length > 0 ? agenda : [createEmptyAgendaItem()];
  return base.map((item) => ({
    ...item,
    id: item.id || generateAgendaItemId(),
  }));
};

// Treat unknown reachability as online if connected (Android sometimes reports null briefly)
const isEffectivelyOnline = (state) => {
  return !!(state?.isConnected && state.isInternetReachable !== false);
};

const SocialButton = ({ label, onPress, variant = 'filled', icon }) => {
  const base = {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
  };
  const filled = { backgroundColor: '#4285F4', borderColor: '#4285F4' };
  const outline = { backgroundColor: 'transparent', borderColor: '#B9C1CC' };
  const textStyle = {
    color: variant === 'filled' ? '#fff' : '#1F2937',
    fontWeight: '600',
  };

  return (
    <TouchableOpacity
      onPress={onPress}
      style={[base, variant === 'filled' ? filled : outline]}
    >
      {icon ? <Image source={icon} style={{ width: 18, height: 18 }} /> : null}
      <Text style={textStyle}>{label}</Text>
    </TouchableOpacity>
  );
};

export default function App() {
  // ===== Settings UI helpers (must be ABOVE return) =====
  const SectionHeader = ({ title }) => (
    <Text
      style={{
        fontSize: 12,
        fontWeight: '800',
        color: '#6b7280',
        marginTop: 18,
        marginBottom: 10,
        letterSpacing: 0.6,
      }}
    >
      {String(title || '').toUpperCase()}
    </Text>
  );

  const Card = ({ children }) => (
    <View
      style={{
        backgroundColor: '#ffffff',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        paddingVertical: 8,
        paddingHorizontal: 12,
        shadowColor: '#000',
        shadowOpacity: 0.04,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 1,
        marginBottom: 12,
        alignSelf: 'stretch',
        width: '100%',
      }}
    >
      {children}
    </View>
  );

  const Divider = () => <View style={{ height: 1, backgroundColor: '#f3f4f6' }} />;

  const SettingRow = ({ title, subtitle, value, onValueChange, disabled }) => (
    <View style={{ paddingVertical: 10 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={{ fontSize: 14, fontWeight: '600', color: '#111827' }}>
            {title}
          </Text>

          {!!subtitle && (
            <Text
              style={{ fontSize: 12, color: '#6b7280', marginTop: 3, lineHeight: 16 }}
            >
              {subtitle}
            </Text>
          )}
        </View>

        <Switch value={value} onValueChange={onValueChange} disabled={!!disabled} />
      </View>
    </View>
  );

  // 🚫 Disallow "/" while editing the agenda title (Setup & Summary)
  const handleAgendaTitleDraftChange = (text) => {
    let t = (text ?? '').slice(0, TITLE_MAX_CHARS);

    if (t.includes('/')) {
      Alert.alert('Invalid Character', "The agenda title cannot contain '/'.");
      t = t.replaceAll('/', ''); // strip any pasted slashes
    }

    setAgendaTitleDraft(t);
  };

  async function renameSessionDoc(oldId, newId, newDisplayTitle) {
    if (!userId) throw new Error('Missing userId');
    if (offlineMode) {
      Alert.alert('Offline', 'Renaming requires an internet connection.');
      return false;
    }

    const cleanOld = String(oldId || '').trim();
    const cleanNew = String(newId || '').trim();

    if (!validateSessionTitle(cleanOld) || !validateSessionTitle(cleanNew)) {
      Alert.alert('Invalid title', "Agenda names must be 3+ chars and cannot contain '/'.");
      return false;
    }

    // Don’t rename special placeholders/demos
    if (cleanOld === DEFAULT_SESSION_ID || cleanOld === SAMPLE_MEETING_SESSION_ID) return false;

    const oldRef = doc(db, 'users', userId, 'sessions', cleanOld);
    const newRef = doc(db, 'users', userId, 'sessions', cleanNew);

    const [oldSnap, newSnap] = await Promise.all([getDoc(oldRef), getDoc(newRef)]);

    if (!oldSnap.exists()) {
      Alert.alert('Not found', `Could not find the agenda "${cleanOld}" to rename.`);
      return false;
    }
    if (newSnap.exists()) {
      Alert.alert('Name taken', `An agenda named "${cleanNew}" already exists.`);
      return false;
    }

    const data = oldSnap.data() || {};

    // 1) create new doc (copy)
    await setDoc(
      newRef,
      {
        ...data,
        title: (newDisplayTitle || cleanNew).trim() || cleanNew,
        renamedFrom: cleanOld,
        renamedAt: new Date().toISOString(),
      },
      { merge: true }
    );

    // 2) delete old doc
    await deleteDoc(oldRef);

    // 3) Update local “last used”
    await AsyncStorage.setItem('@userInfo', JSON.stringify({ userId, sessionId: cleanNew }));

    // 4) Update Quick Launch favorites (ids)
    setQuickLaunchFavorites((prev) => {
      const arr = Array.isArray(prev) ? prev : DEFAULT_QUICK_LAUNCH;
      const next = arr.map((x) => (x === cleanOld ? cleanNew : x));
      AsyncStorage.setItem(QUICK_LAUNCH_FAVORITES_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });

    // 5) Update existingSessions list
    setExistingSessions((prev) => {
      const arr = Array.isArray(prev) ? prev : [];
      return arr.map((s) => {
        const sid = s?.id ?? s;
        if (sid !== cleanOld) return s;
        return { ...(typeof s === 'object' ? s : { id: cleanNew }), id: cleanNew, title: newDisplayTitle || cleanNew };
      });
    });

    // 6) Update recents (they store ids/sessionIds)
    try {
      const raw = await AsyncStorage.getItem('@recentSessionTitles');
      const arr = raw ? JSON.parse(raw) : [];
      const safe = Array.isArray(arr) ? arr : [];
      const next = safe.map((x) => (x === cleanOld ? cleanNew : x));
      await AsyncStorage.setItem('@recentSessionTitles', JSON.stringify(next));
      setRecentTitles(next);
    } catch {}

    // 7) Update in-memory current session id + title
    setLocalSessionId(cleanNew);
    setTitle((newDisplayTitle || cleanNew).trim() || cleanNew);

    return true;
  } 

  const normalizeAgendaTitle = (raw) => {
    let next = (raw || '').replace(/\s+/g, ' ').trim();

    if (next.includes('/')) {
      next = next.replaceAll('/', '').trim();
    }

    return next;
  };

  async function commitAgendaTitle(nextRaw) {
    const hadSlash = String(nextRaw || '').includes('/');
    let next = normalizeAgendaTitle(nextRaw);

    if (hadSlash) {
      Alert.alert('Invalid Character', "The agenda title cannot contain '/'.");
    }

    // If user cleared it, treat as "no change"
    if (!next) {
      setAgendaTitleDraft('');
      setIsEditingAgendaTitle(false);
      return;
    }

    // ✅ If they changed the agenda name, do a REAL rename of the saved session doc.
    // This keeps Firestore sessionId, display title, recents, and Quick Launch favorites aligned.
    // Example: if a favorite was pinned as "Weekly Sync" and the user renames it to
    // "Leadership Sync", the favorite now points to "Leadership Sync" instead of
    // continuing to copy from the old sessionId.
    if (next !== sessionId) {
      try {
        const did = await renameSessionDoc(sessionId, next, next);
        if (did) {
          setAgendaTitleDraft(next);
          setIsEditingAgendaTitle(false);
          return; // renamed successfully; do not also run display-only update
        }

        // Rename failed or was blocked (offline, name taken, special demo/default session).
        // Do NOT fall through to display-only title update, because that recreates the
        // sessionId/title mismatch that makes favorites feel weird.
        setAgendaTitleDraft(title || sessionId || '');
        setIsEditingAgendaTitle(false);
        return;
      } catch (e) {
        console.warn('[Title] rename failed', e);
        alertSafe('Rename failed', e, 'Could not rename this agenda. Please try again.');
        setAgendaTitleDraft(title || sessionId || '');
        setIsEditingAgendaTitle(false);
        return;
      }
    }

    // Display-only update (same doc id / no actual rename needed)
    setTitle(next);
    setAgendaTitleDraft(next);
    setIsEditingAgendaTitle(false);

    setExistingSessions((prev) => {
      const arr = Array.isArray(prev) ? prev : [];
      return arr.map((s) =>
        (s?.id ?? s) === sessionId
          ? { ...(typeof s === 'object' ? s : { id: sessionId }), title: next || sessionId }
          : s
      );
    });

    try {
      if (!offlineMode && sessionDocRef && auth.currentUser && !auth.currentUser.isAnonymous) {
        await updateDoc(sessionDocRef, {
          title: next || sessionId,
          titleUpdatedAt: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.warn('[Title] update failed', e);
    }
  }

  // Shared: open the Operating Manual (used by header help icon + More screen)
  const openOperatingManual = async (offline) => {
    if (offline) return;
    try {
      await Linking.openURL('https://dozenred.com/agendaglow-operating-manual/');
    } catch {
      Alert.alert('Unable to open', 'Please try again later.');
    }
  };
  
  const openProPlans = () => {
    if (offlineMode) {
      Alert.alert('Offline', 'Connect to the internet to view Pro plans.');
      return;
    }

    setShowPlans(true);
    setScreen('settings');
  };

  const closeFiveMeetingProModal = () => {
    setShowFiveMeetingProModal(false);
  };

  const maybeShowSummaryInterstitial = () => {
    if (isNoAdsMode || isProUser) return;

    if (suppressNextSummaryInterstitialRef.current) {
      suppressNextSummaryInterstitialRef.current = false;
      return;
    }

    showInterstitialOrHouse();
  };

  const handleFiveMeetingUpgradePress = () => {
    setShowFiveMeetingProModal(false);
    openProPlans();
  };

  // ─── Small Help icon (greyed out when offline) ───
  const ManualHelpButton = ({ offline }) => {
    const openManual = () => openOperatingManual(offline);

    return (
      <TouchableOpacity
        onPress={openManual}
        disabled={offline}
        accessibilityRole="button"
        accessibilityLabel="Open AgendaGlow Operating Manual"
        style={{
          width: 32,
          height: 32,
          borderRadius: 16,
          backgroundColor: 'rgba(0,0,0,0.05)',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: offline ? 0.4 : 1,
        }}
      >
        <Ionicons
          name="help-circle-outline"
          size={20}
          color={offline ? '#999' : '#2f80ed'}
        />
      </TouchableOpacity>
    );
  };

  const isDark = useColorScheme?.() === 'dark';

  const passwordInputStyle = [
    styles.input,
    isDark && {
      backgroundColor: '#121212',
      color: '#FFFFFF',
      borderColor: '#444',
    },
  ];

  // Label color that stays local to auth fields
  const labelStyle = [{ marginTop: 12 }];

  const handleEmailLogin = async () => {
    // quick validation for login
    if (!validateBeforeSubmit('login')) {
      Alert.alert('Check your input', 'Please fix the highlighted fields.');
      return;
    }
    try {
      // Capture whoever is signed in right now (often the anonymous user)
      const prevUser = auth.currentUser;
      const result = await signInWithEmailAndPassword(auth, email, password);
      console.log('🔐 Logged in as:', result.user.uid);

      // 🔐 Persist login info
      await AsyncStorage.setItem('firebaseUID', result.user.uid);
      await AsyncStorage.setItem('authMode', 'email');

      // ✅ Update local state
      setEmailVerified(!!result.user.emailVerified);
      setUserId(result.user.uid);
      setAuthMode('email');

      await cleanupPreviousAnonymousIfNeeded(prevUser, result.user);

      Alert.alert('Login Success', `Signed in as ${result.user.email}`);
      setScreen('prestart');
    } catch (err) {
      console.warn('Login error:', err.message);
      alertSafe('Login Failed', err, 'Could not sign in. Please check your info and try again.');
    }
  };

  const refreshVerification = async () => {
    try {
      const u = auth.currentUser;
      await u?.reload();
      const ok = !!u?.emailVerified;
      setEmailVerified(ok);
      Alert.alert(
        'Email verification',
        ok ? '✅ Verified' : '❌ Not verified yet — check your inbox or resend.'
      );
    } catch (e) {
      alertSafe('Error', e, 'Failed to refresh verification status.');
    }
  };

  const handlePasswordReset = async () => {
    const em = (email || '').trim();

    if (!em || !isValidEmail(em)) {
      Alert.alert(
        'Enter a valid email',
        'Type your account email above, then tap “Send reset link”.'
      );
      return;
    }
    if (offlineMode) {
      Alert.alert('Offline', 'Password reset requires an internet connection.');
      return;
    }

    try {
      await sendPasswordResetEmail(auth, em);
      Alert.alert('Reset email sent', `Check ${em} for a link to create a new password.`);
    } catch (e) {
      const code = e?.code || '';
      if (code === 'auth/user-not-found') {
        Alert.alert('No account found', 'There is no user with that email.');
      } else if (code === 'auth/invalid-email') {
        Alert.alert('Invalid email', 'Please re-check the email address.');
      } else if (code === 'auth/too-many-requests') {
        Alert.alert(
          'Try again later',
          'Too many requests. Please wait a bit and try again.'
        );
      } else if (code === 'auth/network-request-failed') {
        Alert.alert('Network error', 'Please check your connection and try again.');
      } else {
        alertSafe('Reset failed', e, 'Could not send the reset email. Please try again.');
      }
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Account deletion helpers (Guideline 5.1.1(v))
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Deletes all user data we store for this account:
   * - users/{uid} document
   * - users/{uid}/sessions/* subcollection
   */
  const deleteAllUserData = async (uid) => {
    // Delete subcollection: sessions
    const sessionsCol = collection(db, 'users', uid, 'sessions');
    const sessionsSnap = await getDocs(sessionsCol);
    await Promise.all(sessionsSnap.docs.map((d) => deleteDoc(d.ref)));

    // Delete the root user doc
    await deleteDoc(doc(db, 'users', uid));
  };

  // Create a brand-new anonymous account and sync local state
  const createFreshAnon = async () => {
    try {
      const cred = await signInAnonymously(auth);
      const newUid = cred?.user?.uid || '';
      // If you keep a userId in state, sync it:
      if (newUid) setUserId(newUid);
      return newUid;
    } catch (e) {
      console.warn('⚠️ Failed to create fresh anon account:', e);
      Alert.alert(
        'Offline or error',
        'Could not create a new anonymous session yet. You can continue in offline mode and try again later.'
      );
      return null;
    }
  };

  /**
   * Handles the "Delete my account" flow.
   * If signed in -> confirm, delete Firestore data, then delete auth user.
   * If not signed in -> open website deletion page.
   */
  const handleAccountDeletion = async () => {
    const u = auth.currentUser;

    // If no user is signed in, send them to the website flow
    if (!u) {
      Linking.openURL(ACCOUNT_DELETE_URL);
      return;
    }

    // Open the "type confirm" modal (extra friction to prevent accidental deletion)
    setDeleteConfirmText('');
    setShowDeleteAccountModal(true);
    return;

    // Require online to proceed
    if (offlineMode) {
      Alert.alert('Offline', 'Please connect to the internet to delete your account.');
      return;
    }

    try {
      const uid = u.uid;

      // Delete Firestore data first
      await deleteAllUserData(uid);

      // Delete Firebase Auth user
      await deleteUser(u);

      // 🔒 Force hard sign-out to avoid auth resurrection
      try {
        await signOut(auth);
      } catch {}

      Alert.alert('Account deleted', 'Your account and data have been deleted.');

      // Give Firebase Auth a moment to finalize the deletion event
      await new Promise((r) => setTimeout(r, 200));

      // 🧼 Clear all local identity FIRST
      setUserId('');
      setAuthMode('anonymous');
      await AsyncStorage.multiRemove([
        'firebaseUID',
        'authMode',
      ]);

      // 👉 Create a brand-new anonymous user so the app remains usable
      await createFreshAnon();

      // Reset UI
      setAuthMode('login');
      setAuthScreenMode('login');
      setScreen('prestart');

      // Local UI reset
      setUserId('');
      setAuthMode('login');
      setAuthScreenMode('login');
      setScreen('prestart');
    } catch (e) {
      if (e?.code === 'auth/requires-recent-login') {
        Alert.alert(
          'Please sign in again',
          'For security, please sign in again, then return here and tap “Delete my account”. No data was removed.'
        );
        return;
      }
      console.warn('❌ Account deletion failed:', e);
      Alert.alert(
        'Delete failed',
        e?.message || 'Something went wrong. Please try again.'
      );
    }
  };

  // 🔐 Re-auth just-in-time for account deletion (so user doesn't have to "go sign in again")
  const reauthForDeletion = async (u) => {
    const providerId = u?.providerData?.[0]?.providerId || '';

    // Google
    if (providerId === 'google.com') {
      // Reuse your existing PKCE prompt + token exchange pattern
      if (!googleRequest?.codeVerifier) {
        throw new Error('Google auth not ready yet. Please try again in a moment.');
      }
      const codeVerifier = googleRequest.codeVerifier;

      const res = await promptGoogleAsync();
      if (res?.type !== 'success') throw new Error('Google re-auth canceled.');

      const code = res?.params?.code;
      if (!code) throw new Error('No Google auth code returned.');

      const body = new URLSearchParams({
        code,
        client_id: GOOGLE_WEB_CLIENT_ID,
        redirect_uri: NATIVE_REDIRECT,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier,
      }).toString();

      const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });

      if (!tokenResp.ok) {
        const err = await tokenResp.json().catch(() => ({}));
        throw new Error(err.error_description || err.error || `Token HTTP ${tokenResp.status}`);
      }

      const tokenResult = await tokenResp.json();
      const idToken = tokenResult.id_token || tokenResult.idToken;
      const accessToken = tokenResult.access_token || tokenResult.accessToken;

      const cred = GoogleAuthProvider.credential(idToken, accessToken);
      await reauthenticateWithCredential(u, cred);
      return;
    }

    // Apple
    if (providerId === 'apple.com') {
      const { raw, hashed } = await getRandomNonce();
      const appleRes = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashed,
      });

      if (!appleRes?.identityToken) throw new Error('No Apple identity token returned.');

      const provider = new OAuthProvider('apple.com');
      const cred = provider.credential({
        idToken: appleRes.identityToken,
        rawNonce: raw,
      });

      await reauthenticateWithCredential(u, cred);
      return;
    }

    // Email/password: you can add later (needs password prompt)
    throw new Error('Please sign in again to delete your account.');
  };

  const reauthWithPasswordForDeletion = async (u, password) => {
    if (!u?.email) {
      throw new Error('Missing email for re-authentication.');
    }
    if (!password) {
      throw new Error('Password is required.');
    }

    const cred = EmailAuthProvider.credential(u.email, password);
    await reauthenticateWithCredential(u, cred);
  };

  const performAccountDeletion = async () => {
    const u = auth.currentUser;

    // Prevent auto-anon from racing during deletion
    suppressAutoAnonRef.current = true;

    // safety: if user vanished, kick to web flow
    if (!u) {
      Linking.openURL(ACCOUNT_DELETE_URL);
      return;
    }

    // 🔒 Pre-check: require a “recent” sign-in (avoid partial deletes)
    try {
      const last = u?.metadata?.lastSignInTime
        ? new Date(u.metadata.lastSignInTime)
        : null;
      const freshMs = 5 * 60 * 1000; // 5 minutes
      if (!last || Date.now() - last.getTime() > freshMs) {
        Alert.alert(
          'Please sign in again',
          'For security, please sign in again, then return to this screen and tap “Delete my account” once more.'
        );
        return; // ⬅️ abort before deleting any Firestore data
      }
    } catch (_) {
      // If we can’t determine freshness, be conservative and continue.
    }

    // Require online to proceed
    if (offlineMode) {
      Alert.alert('Offline', 'Please connect to the internet to delete your account.');
      return;
    }

    setDeleteAccountBusy(true);
    try {
      const uid = u.uid;

      // Delete Firestore data first
      await deleteAllUserData(uid);

      // Delete Firebase Auth user
      await deleteUser(u);

      Alert.alert('Account deleted', 'Your account and data have been deleted.');

      // Give Firebase Auth a moment to finalize the deletion event
      await new Promise((r) => setTimeout(r, 200));

      // 👉 Create a brand-new anonymous user so the app remains usable
      await createFreshAnon();

      // Reset UI
      setUserId('');
      setAuthMode('login');
      setAuthScreenMode('login');
      setScreen('prestart');
    } catch (e) {
      if (e?.code === 'auth/requires-recent-login') {
        const providerId = u?.providerData?.[0]?.providerId;

        if (providerId === 'password') {
          // 🔐 Email users: ask for password inline
          setShowDeleteReauthModal(true);
          return;
        }

        // Google / Apple handled elsewhere
        throw e;
      }
      console.warn('❌ Account deletion failed:', e);
      alertSafe('Delete failed', e, 'Could not delete your account. Please try again.');
    } finally {
      setDeleteAccountBusy(false);
      setTimeout(() => {
        suppressAutoAnonRef.current = false;
      }, 500);
    }
  };

  const resendVerification = async () => {
    try {
      const u = auth.currentUser;
      if (u && !u.emailVerified) {
        await sendEmailVerification(u);
        Alert.alert('Sent', `We emailed a new verification link to ${u.email}.`);
      } else {
        Alert.alert('Already verified', 'This email is already verified.');
      }
    } catch (e) {
      alertSafe('Error', e, 'Failed to send verification email.');
    }
  };

  const handleAnonymousLogin = async () => {
    try {
      const result = await signInAnonymously(auth);
      const user = result.user;
      console.log('🕵️ Signed in anonymously:', user.uid);
      await AsyncStorage.setItem('firebaseUID', user.uid);
      await AsyncStorage.setItem('authMode', 'anonymous');
      setAuthMode('anonymous');
      setScreen('prestart');
    } catch (e) {
      console.warn('⚠️ Anonymous sign-in failed:', e.message);
      alertSafe('Sign-in Error', e, 'Could not sign in right now. Please try again.');
    }
  };

  const upgradeAnonymousUser = async (email, password) => {
    try {
      const user = auth.currentUser;
      if (!user || !user.isAnonymous) {
        throw new Error('Current user is not anonymous');
      }

      const credential = EmailAuthProvider.credential(email, password);
      const result = await linkWithCredential(user, credential);

      console.log('🎉 Anonymous account upgraded:', result.user.uid);
      await AsyncStorage.setItem('authMode', 'email');
      await AsyncStorage.setItem('firebaseUID', result.user.uid);
      setEmailVerified(!!result.user.emailVerified);
      setAuthMode('email');
      setUserId(result.user.uid);
      setScreen('prestart'); // or wherever you want to land
    } catch (err) {
      console.error('❌ Upgrade failed:', err.message);
      alertSafe('Upgrade failed', err, 'Could not upgrade the account right now. Please try again.');
    }
  };

  const handleUpgradeAnonymous = async () => {
    // full validation for upgrade
    if (!validateBeforeSubmit('upgrade')) {
      Alert.alert('Check your input', 'Please fix the highlighted fields.');
      return;
    }

    try {
      const credential = EmailAuthProvider.credential(email.trim(), password);
      const result = await linkWithCredential(auth.currentUser, credential);
      console.log('🎉 Anonymous upgraded:', result.user.uid);

      setEmailVerified(!!result.user.emailVerified);

      // send verification email if not verified
      try {
        if (!result.user.emailVerified) {
          await sendEmailVerification(result.user);
          Alert.alert('Verify your email', 'We sent a verification link to your inbox.');
        }
      } catch (e) {
        console.warn('📧 Verification email failed:', e?.message || e);
      }

      await AsyncStorage.setItem('authMode', 'email');
      await AsyncStorage.setItem('firebaseUID', result.user.uid);
      setUserId(result.user.uid);
      setAuthMode('email');
      setScreen('prestart');
    } catch (err) {
      console.warn('❌ Upgrade error:', err.message);
      alertSafe('Upgrade Failed', err, 'Could not upgrade right now. Please try again.');
    }
  };

  const createNewUser = async (email, password) => {
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      console.log('✅ New user created:', result.user.uid);
      await AsyncStorage.setItem('authMode', 'email');
      await AsyncStorage.setItem('firebaseUID', result.user.uid);
      setEmailVerified(!!result.user.emailVerified);
      setAuthMode('email');
      setUserId(result.user.uid);
      setScreen('prestart');
    } catch (err) {
      console.error('❌ Account creation failed:', err.message);
      alertSafe('Sign Up Error', err, 'Could not create your account. Please try again.');
    }
  };

  const handleCreateAccount = async () => {
    // 1) Validate inputs for Create (email format, confirm email, password + confirm)
    if (!validateBeforeSubmit('create')) {
      Alert.alert('Check your input', 'Please fix the highlighted fields.');
      return;
    }

    // 2) If currently anonymous, warn about data loss and offer Upgrade instead
    if (auth.currentUser?.isAnonymous) {
      const proceed = await new Promise((resolve) => {
        Alert.alert(
          'Create new account?',
          'You are signed in with a temporary account. Creating a new account will NOT keep your existing agendas. Use “SAVE” to keep your data.\n\nDo you still want to create a new account?',
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            {
              text: 'Go to Upgrade',
              onPress: () => {
                setAuthScreenMode('upgrade');
                resolve(false);
              },
            },
            { text: 'Create Anyway', style: 'destructive', onPress: () => resolve(true) },
          ]
        );
      });
      if (!proceed) return;
    }

    // 3) Create the account (and handle "email already exists")
    try {
      const prevUser = auth.currentUser; // probably anonymous
      const em = email.trim();
      const methods = await fetchSignInMethodsForEmail(auth, em);
      if (methods.length > 0) {
        Alert.alert(
          'Account Exists',
          'An account with this email already exists. Please sign in instead.'
        );
        return;
      }

      const result = await createUserWithEmailAndPassword(auth, em, password);
      console.log('✅ Account created:', result.user.uid);

      setEmailVerified(!!result.user.emailVerified);

      // 4) Send verification email (non-blocking)
      try {
        await sendEmailVerification(result.user);
        Alert.alert('Verify your email', 'We sent a verification link to your inbox.');
      } catch (e) {
        console.warn('📧 Verification email failed:', e?.message || e);
      }

      // 5) Persist & update local state
      await AsyncStorage.setItem('authMode', 'email');
      await AsyncStorage.setItem('firebaseUID', result.user.uid);
      setUserId(result.user.uid);
      setAuthMode('email');
      setScreen('prestart');

      await cleanupPreviousAnonymousIfNeeded(prevUser, result.user);
    } catch (err) {
      console.warn('❌ Signup error:', err.message);
      alertSafe('Sign Up Error', err, 'Could not create your account. Please try again.');
    }
  };

  // --- Google: Upgrade (link anon → Google) ---
  const handleGoogleUpgrade = async () => {
    if (googleBusyRef.current) return; // 🚧 already in progress
    googleBusyRef.current = true;
    let cred = null; // <-- make Firebase credential visible to catch/fallback
    try {
      const anon = auth.currentUser;
      if (!anon?.isAnonymous) {
        Alert.alert('Not anonymous', 'You are already signed in with an account.');
        return;
      }

      // Prevent auto-anon from kicking in while we’re between states
      suppressAutoAnonRef.current = true;

      // 1) capture codeVerifier BEFORE prompt
      const codeVerifier = googleRequest?.codeVerifier;

      if (!googleRequest?.codeVerifier) {
        Alert.alert(
          'Google',
          'Auth request not ready yet. Please try again in a moment.'
        );
        return;
      }

      // 2) prompt once
      const res = await promptGoogleAsync();
      if (res?.type !== 'success') return;
      console.log('Google response:', JSON.stringify(res, null, 2));

      // 3) exchange code → tokens (PKCE)
      const code = res?.params?.code;
      // 🚫 ignore duplicates
      if (code && lastAuthCodeRef.current === code) {
        console.warn('Duplicate Google auth code detected — ignoring.');
        return;
      }
      lastAuthCodeRef.current = code;
      if (!code) {
        Alert.alert('Google', 'No authorization code returned.');
        return;
      }
      if (!codeVerifier) {
        Alert.alert('Google', 'Missing code verifier for PKCE.');
        return;
      }

      const body = new URLSearchParams({
        code,
        client_id: GOOGLE_WEB_CLIENT_ID,
        redirect_uri: NATIVE_REDIRECT,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier, // ← critical
      }).toString();

      const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });

      if (!tokenResp.ok) {
        const err = await tokenResp.json().catch(() => ({}));
        console.warn('Google token exchange failed:', err);
        throw new Error(
          err.error_description || err.error || `Token HTTP ${tokenResp.status}`
        );
      }

      const tokenResult = await tokenResp.json();

      const idToken = tokenResult.id_token || tokenResult.idToken;
      const accessToken = tokenResult.access_token || tokenResult.accessToken;
      if (!idToken) {
        Alert.alert('Google', 'No id_token after token exchange.');
        return;
      }

      // 4) link to Firebase
      cred = GoogleAuthProvider.credential(idToken, accessToken);
      const linkResult = await linkWithCredential(anon, cred);

      await ensureUserDoc(linkResult.user.uid, {
        provider: 'google',
        ...(linkResult.user.email ? { email: linkResult.user.email } : {}),
        ...(linkResult.user.displayName
          ? { displayName: linkResult.user.displayName }
          : {}),
      });

      await AsyncStorage.setItem('authMode', 'google');
      await AsyncStorage.setItem('firebaseUID', linkResult.user.uid);
      setUserId(linkResult.user.uid);
      setAuthMode('google');
      } catch (e) {
        // Firebase sometimes puts the code inside e.message (stringified JSON) or only in the message text,
        // so extract it defensively.
        const msg = e?.message || String(e || '');
        let code = e?.code;

        if (!code && typeof msg === 'string' && msg.trim().startsWith('{')) {
          try {
            const parsed = JSON.parse(msg);
            code = parsed?.code || code;
          } catch {}
        }

        if (!code && typeof msg === 'string') {
          if (msg.includes('auth/credential-already-in-use')) code = 'auth/credential-already-in-use';
          else if (msg.includes('auth/email-already-in-use')) code = 'auth/email-already-in-use';
          else if (msg.includes('auth/account-exists-with-different-credential'))
            code = 'auth/account-exists-with-different-credential';
        }

        console.warn('Google sign-in failed detail:', { code, message: msg });

        // ✅ If the Google account already exists in Firebase, LINK will fail.
        // In that case, switch to SIGN IN using the SAME credential (no 2nd Google prompt).
        if (
          code === 'auth/credential-already-in-use' ||
          code === 'auth/email-already-in-use' ||
          code === 'auth/account-exists-with-different-credential'
        ) {
          try {
            const prevUser = auth.currentUser; // anonymous user we attempted to link

            if (!cred) {
              // shouldn’t happen, but avoids a crash if something failed earlier
              await handleGoogleSignInReplace();
              return;
            }

            const result = await signInWithCredential(auth, cred);

            await ensureUserDoc(result.user.uid, {
              provider: 'google',
              ...(result.user.email ? { email: result.user.email } : {}),
              ...(result.user.displayName ? { displayName: result.user.displayName } : {}),
            });

            await AsyncStorage.setItem('authMode', 'google');
            await AsyncStorage.setItem('firebaseUID', result.user.uid);
            setUserId(result.user.uid);
            setAuthMode('google');

            // optional: navigate back where you expect after auth
            setAuthScreenMode('login');
            setScreen('prestart');

            // clean up the old anonymous user later (your function currently no-ops, but safe to call)
            setTimeout(() => {
              cleanupPreviousAnonymousIfNeeded(prevUser, result.user);
            }, 1000);

            return;
          } catch (e2) {
            console.warn('Google replace-after-link-fail failed:', e2?.message || String(e2));
            alertSafe('Google', e2, 'Google sign-in failed. Please try again.');
            return;
          }
        }

        alertSafe('Google', e, 'Google sign-in failed. Please try again.');
      } finally {
        googleBusyRef.current = false; // ✅ release the lock
        setTimeout(() => {
          suppressAutoAnonRef.current = false;
        }, 500);
      }
  };

  // --- Google: Smart Continue (link anon if possible; else sign-in/replace) ---
  const handleGoogleSmartContinue = async () => {
    // If they’re anonymous: try to LINK first (keeps data)…
    // If the credential is already in use: SIGN IN instead (switches accounts; data loss ok).
    const u = auth.currentUser;

    if (u?.isAnonymous) {
      try {
        await handleGoogleUpgrade(); // your existing linkWithCredential path:contentReference[oaicite:7]{index=7}
        return;
      } catch (_) {
        // handleGoogleUpgrade currently catches internally, so this likely won’t fire
      }
    }

    // …otherwise (or if link isn’t possible), just sign in (replace)
    await handleGoogleSignInReplace(); // your existing signInWithCredential path:contentReference[oaicite:8]{index=8}
  };

  // --- Google: Replace (sign in as Google) ---
  const handleGoogleSignInReplace = async () => {
    if (googleBusyRef.current) return; // 🚧 already in progress
    googleBusyRef.current = true;
    try {
      if (!ENABLE_GOOGLE_LOGIN) return;
      const prevUser = auth.currentUser;

      // prevent onAuthStateChanged from auto-creating anon during the swap
      suppressAutoAnonRef.current = true;

      // 1) capture codeVerifier BEFORE prompt
      const codeVerifier = googleRequest?.codeVerifier;
      if (!googleRequest?.codeVerifier) {
        Alert.alert(
          'Google',
          'Auth request not ready yet. Please try again in a moment.'
        );
        return;
      }

      // 2) prompt once
      const res = await promptGoogleAsync(); // native, no proxy
      if (res?.type !== 'success') return;
      console.log('Google response:', JSON.stringify(res, null, 2));

      // 3) exchange code → tokens (PKCE)
      const code = res?.params?.code;

      if (code && lastAuthCodeRef.current === code) {
        console.warn('Duplicate Google auth code detected — ignoring.');
        return;
      }
      lastAuthCodeRef.current = code;

      if (!code) {
        Alert.alert('Google', 'No authorization code returned.');
        return;
      }
      if (!codeVerifier) {
        Alert.alert('Google', 'Missing code verifier for PKCE.');
        return;
      }

      const body = new URLSearchParams({
        code,
        client_id: GOOGLE_WEB_CLIENT_ID,
        redirect_uri: NATIVE_REDIRECT,
        grant_type: 'authorization_code',
        code_verifier: codeVerifier, // ← critical
      }).toString();

      const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });

      if (!tokenResp.ok) {
        const err = await tokenResp.json().catch(() => ({}));
        console.warn('Google token exchange failed:', err);
        throw new Error(
          err.error_description || err.error || `Token HTTP ${tokenResp.status}`
        );
      }

      const tokenResult = await tokenResp.json();

      const idToken = tokenResult.id_token || tokenResult.idToken;
      const accessToken = tokenResult.access_token || tokenResult.accessToken;
      if (!idToken) {
        Alert.alert('Google', 'No id_token after token exchange.');
        return;
      }

      // 4) sign in to Firebase
      const cred = GoogleAuthProvider.credential(idToken, accessToken);
      const result = await signInWithCredential(auth, cred);

      await ensureUserDoc(result.user.uid, {
        provider: 'google',
        email: result.user.email ?? undefined,
        displayName: result.user.displayName ?? undefined,
      });

      // Let rules see users/{uid}
      await new Promise((r) => setTimeout(r, 300));

      // Update local state immediately (UI polish)
      await AsyncStorage.setItem('authMode', 'google');
      await AsyncStorage.setItem('firebaseUID', result.user.uid);
      setUserId(result.user.uid);
      setAuthMode('google');

      // ✅ Go back to launcher after successful sign-in
      setAuthScreenMode('login'); // reset tab state if you were in upgrade/create
      setScreen('prestart');

      // 🚮 Delete old anon OFF the critical path (after sign-in is stable)
      setTimeout(() => {
        cleanupPreviousAnonymousIfNeeded(prevUser, result.user);
      }, 1000);
    } catch (e) {
      console.warn('Google sign-in failed detail:', e?.response?.data || e?.message || e);
      alertSafe('Sign-in failed', e, 'Google sign-in failed. Please try again.');
    } finally {
      googleBusyRef.current = false; // ✅ release busy
      setTimeout(() => {
        suppressAutoAnonRef.current = false;
      }, 500);
    }
  };

  // --- Apple: Upgrade (keep data; link current anonymous → Apple) ---
  const handleAppleUpgrade = async () => {
    if (Platform.OS !== 'ios') return;

    let cred = null; // ✅ allow fallback sign-in without re-prompting Apple

    try {
      const anon = auth.currentUser;
      if (!anon?.isAnonymous) {
        Alert.alert('Not anonymous', 'You are already signed in with an account.');
        return;
      }

      const { raw, hashed } = await getRandomNonce();
      const appleRes = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashed,
      });

      if (!appleRes?.identityToken) {
        Alert.alert('Apple Sign-in', 'No identity token returned.');
        return;
      }

      const provider = new OAuthProvider('apple.com');
      cred = provider.credential({
        idToken: appleRes.identityToken,
        rawNonce: raw,
      });

      const linkResult = await linkWithCredential(anon, cred);

      await AsyncStorage.setItem('authMode', 'apple');
      await AsyncStorage.setItem('firebaseUID', linkResult.user.uid);
      setUserId(linkResult.user.uid);
      setAuthMode('apple');
      setScreen('prestart');
    } catch (e) {
      const msg = e?.message || String(e || '');
      const code = e?.code;

      console.warn('Apple upgrade failed detail:', { code, message: msg, full: e });

      if (
        code === 'auth/credential-already-in-use' ||
        code === 'auth/email-already-in-use' ||
        code === 'auth/account-exists-with-different-credential'
      ) {
        // ✅ parity with Google: switch using the SAME credential if we have it
        if (!cred) {
          await handleAppleSignInReplace(); // fallback; may re-prompt Apple
          return;
        }

        const prevUser = auth.currentUser;
        const result = await signInWithCredential(auth, cred);

        await AsyncStorage.setItem('authMode', 'apple');
        await AsyncStorage.setItem('firebaseUID', result.user.uid);
        setUserId(result.user.uid);
        setAuthMode('apple');
        setScreen('prestart');

        setTimeout(() => {
          cleanupPreviousAnonymousIfNeeded(prevUser, result.user);
        }, 1000);

        return;
      }

      alertSafe('Apple', e, 'Apple sign-in failed. Please try again.');
    }
  };

  // --- Apple: Replace (discard anon; sign-in → delete anon) ---
  const handleAppleSignInReplace = async () => {
    if (Platform.OS !== 'ios') return;
    try {
      const prevUser = auth.currentUser;

      // prevent onAuthStateChanged from auto-creating anon during the swap
      suppressAutoAnonRef.current = true;

      const { raw, hashed } = await getRandomNonce();
      const appleRes = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
        nonce: hashed,
      });
      if (!appleRes?.identityToken) {
        Alert.alert('Apple Sign-in', 'No identity token returned.');
        return;
      }

      const provider = new OAuthProvider('apple.com');
      const cred = provider.credential({
        idToken: appleRes.identityToken,
        rawNonce: raw,
      });

      const result = await signInWithCredential(auth, cred);

      await ensureUserDoc(result.user.uid, {
        provider: 'apple',
        ...(result.user.email ? { email: result.user.email } : {}),
        ...(result.user.displayName ? { displayName: result.user.displayName } : {}),
      });

      // Let rules see users/{uid}
      await new Promise((r) => setTimeout(r, 300));

      setTimeout(() => {
        cleanupPreviousAnonymousIfNeeded(prevUser, result.user);
      }, 1000);

      await AsyncStorage.setItem('authMode', 'apple');
      await AsyncStorage.setItem('firebaseUID', result.user.uid);
      setUserId(result.user.uid);
      setAuthMode('apple');
      setScreen('prestart');
    } catch (e) {
      if (e?.code === 'ERR_CANCELED') return;
      console.warn('Apple sign-in failed:', e?.message || e);
      Alert.alert('Sign-in failed', e?.message || String(e));
    } finally {
      setTimeout(() => {
        suppressAutoAnonRef.current = false;
      }, 500);
    }
  };

  // --- Manual Sign-Out / Reset ---
  const handleSignOut = async () => {
    try {
      await signOut(auth);
      await AsyncStorage.removeItem('authMode');
      await AsyncStorage.removeItem('firebaseUID');
      console.log('🔹 Signed out and cleared local auth');
      Alert.alert('Signed out', 'You will be logged in anonymously next launch.');
      // Optionally return to setup or prestart:
      setAuthMode('anonymous');
      setScreen('setup');
    } catch (e) {
      console.warn('Sign out error:', e);
      Alert.alert('Error', e.message || String(e));
    }
  };

  // ⏱️ Timing State
  const [itemStartTimestamp, setItemStartTimestamp] = useState(null);
  const [startTimestamp, setStartTimestamp] = useState(null);
  const [endTimestamp, setEndTimestamp] = useState(null);
  const [pausedDuration, setPausedDuration] = useState(0);
  const [pausedTime, setPausedTime] = useState(0);
  const pauseStartRef = useRef(null); // tracks when pause started
  const [headerWidth, setHeaderWidth] = useState(null);
  const pauseStart = useRef(null);
  const passwordRef = useRef(null);
  const emailRef = useRef(null);
  const confirmEmailRef = useRef(null);
  const confirmPasswordRef = useRef(null);
  const suppressAutoAnonRef = useRef(false);
  const triedAnonRef = useRef(false);
  const [livePauseTime, setLivePauseTime] = useState(0);
  const [userId, setUserId] = useState('');
  const [localSessionId, setLocalSessionId] = useState('');
  const [existingSessions, setExistingSessions] = useState([]);
  const [showFavoriteAgendas, setShowFavoriteAgendas] = useState(true);
  const [showArchivedAgendas, setShowArchivedAgendas] = useState(false);
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [quickLaunchFavorites, setQuickLaunchFavorites] = useState([]);

  const allExistingSessions = Array.isArray(existingSessions) ? existingSessions : [];

  const savedAgendaIds = new Set(allExistingSessions.map((s) => s?.id ?? s));

  const favoriteQuickLaunches = (Array.isArray(quickLaunchFavorites) ? quickLaunchFavorites : [])
    .filter((t) => !!String(t || '').trim())
    .filter((t) => savedAgendaIds.has(t))
    .slice(0, 5);

  const favoriteAgendaSessions = favoriteQuickLaunches
    .map((favId) => allExistingSessions.find((s) => (s?.id ?? s) === favId))
    .filter(Boolean);

  const favoriteAgendaIdSet = new Set(favoriteAgendaSessions.map((s) => s?.id ?? s));

  // My Agendas is split into three clean buckets:
  // Pinned agendas (quick-launch favorites), active agendas, and completed/archive.
  // Pinned agendas are removed from the other buckets so the list does not duplicate rows.
  const activeAgendaSessions = allExistingSessions.filter((s) => {
    const id = s?.id ?? s;
    return !s?.isCompletedMeeting && !favoriteAgendaIdSet.has(id);
  });

  const archivedAgendaSessions = allExistingSessions.filter((s) => {
    const id = s?.id ?? s;
    return !!s?.isCompletedMeeting && !favoriteAgendaIdSet.has(id);
  });

  // Activation row: these starter templates should always be available,
  // even before the user has saved/pinned any agendas. Favorites remain
  // a separate repeat-use row below.
  const starterQuickLaunches = DEFAULT_QUICK_LAUNCH.slice(0, 5);
  const hasPinnedQuickLaunches = favoriteQuickLaunches.length > 0;

  const { width, height } = useWindowDimensions();
  const isLandscape = width > height;

  const PRESTART_TILE_GAP = 8;
  const PRESTART_TILE_ROW_MAX_WIDTH = 520;

  const getPrestartTileWrapStyle = (idx) => ({
    flexBasis: '18.5%',
    maxWidth: '18.5%',
    minWidth: '18.5%',
    marginBottom: PRESTART_TILE_GAP,
  });

  // Which agenda item the ⋮ menu is open for (use id, not index)
  const [menuForItemId, setMenuForItemId] = useState(null);

  const deleteSessionById = async (id, friendlyTitle) => {
    try {
      console.log('[delete] tap →', id);
      setDeletingId(id);
      const titleForUser = (friendlyTitle || '').trim() || (id || '').trim();

      // Re-check connectivity right before delete
      const state = await NetInfo.fetch().catch(() => null);
      const online = isEffectivelyOnline(state);
      console.log('[delete] net state:', state, '→ online:', online);

      if (!online) {
        Alert.alert('Offline', 'You must be online to delete a saved agenda.');
        return;
      }
      if (!userId || !id) {
        Alert.alert('Error', 'Missing user or session ID.');
        return;
      }

      // Let the alert render cleanly
      await new Promise((r) => setTimeout(r, 0));

      const confirmed = await new Promise((resolve) => {
        Alert.alert(
          'Delete this Agenda?',
          `This will permanently delete "${titleForUser}" for your account. This cannot be undone.`,
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
          ],
          { cancelable: true }
        );
      });
      if (!confirmed) {
        console.log('[delete] canceled by user');
        return;
      }

      console.log('[delete] issuing deleteDoc for', userId, id);
      await deleteDoc(doc(db, 'users', userId, 'sessions', id));

      // ⭐ If this agenda was pinned, remove it from the saved pinned-agendas row
      setQuickLaunchFavorites((prev) => {
        const current = Array.isArray(prev) ? prev : DEFAULT_QUICK_LAUNCH;

        // Remove BOTH possibilities:
        // - id (your quick launch pin uses id)
        // - friendlyTitle (some older stored values might be title-based)
        let next = current.filter((x) => x !== id && x !== titleForUser);

        // Keep only 5
        next = next.slice(0, 5);

        // Persist
        AsyncStorage.setItem(QUICK_LAUNCH_FAVORITES_KEY, JSON.stringify(next)).catch((e) =>
          console.warn('⚠️ Failed to save quick launch favorites:', e)
        );

        return next;
      });

      // 🧽 Also remove from "Recent" pills (recents store titles, not doc ids)
      try {
        await removeRecentTitle(id); // safe even if not present
        if (titleForUser && titleForUser !== id) {
          await removeRecentTitle(titleForUser);
        }
      } catch {}

      setExistingSessions((prev) => prev.filter((s) => (s?.id ?? s) !== id));

      // If you just deleted the selected one, clear it
      if (localSessionId === id || localSessionId === titleForUser) {
        setLocalSessionId('');
        try {
          await AsyncStorage.removeItem('@userInfo');
        } catch {}
      }

      console.log('[delete] success');
    } catch (e) {
      console.error('[delete] failed:', e);
      alertSafe('Error', e, 'Failed to delete this agenda. Please try again.');
    } finally {
      setDeletingId(null);
    }
  };
  const [showPassword, setShowPassword] = useState(false);
  const [offlineMode, setOfflineMode] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState(null); // 'offline' | 'online' | null
  const [sessionWrittenToFirestore, setSessionWrittenToFirestore] = useState(false);
  const [showSessionList, setShowSessionList] = useState(false);
  const [returnToPrestart, setReturnToPrestart] = useState(false);
  const [quickStartDisabled, setQuickStartDisabled] = useState(false);
  // 🔄 Resume candidate (if the last session didn’t finish)
  const [resumeCandidate, setResumeCandidate] = useState(null); // { id, data } | null
  const [authScreenMode, setAuthScreenMode] = useState('login'); // 'login' | 'create' | 'upgrade'

  // --- Auth convenience flags (used for UI + gating) ---
  const isTempAccount =
    !!auth.currentUser?.isAnonymous || authMode === 'anonymous' || !userId;

  const isRegistered = !isTempAccount;

  // Enforce: CREATE mode only for anonymous users
  useEffect(() => {
    if (!auth.currentUser?.isAnonymous && authScreenMode === 'create') {
      setAuthScreenMode('login');
    }
  }, [authMode, authReady, userId, authScreenMode]);

  const [showEmailForm, setShowEmailForm] = useState(false);
  const currentUser = auth.currentUser;

  const provider = currentUser?.providerData?.[0] || null;
  const providerName = provider?.displayName || null;
  const providerEmail = provider?.email || null;

  const displayEmail = currentUser?.isAnonymous
    ? '🕵️ Anonymous User'
    : providerName ||
      currentUser?.displayName ||
      providerEmail ||
      currentUser?.email ||
      'Signed in';

  // 🏁 Session Finalization
  const finalItemCompleted = useRef(false);
  const finalItemManuallySkipped = useRef(false);

  // ✅ Tracks that we *completed a meeting* and should return Home clean
  const justFinishedMeetingRef = useRef(false);

  const lastSummaryRef = useRef([]);
  const advanceTimeoutRef = useRef(null); // ⏱ pending auto-advance timeout (prevents replay race)

  const openBatterySettingsAndroid = async () => {
    if (Platform.OS !== 'android') return;

    try {
      // 1) Best screen (if available): Battery optimization list
      await IntentLauncher.startActivityAsync('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
      return;
    } catch {}

    try {
      // 2) Fallback: App-specific settings page (user can set Battery -> Unrestricted)
      const pkg = Constants.expoConfig?.android?.package || Constants.manifest?.android?.package;
      if (pkg) {
        await IntentLauncher.startActivityAsync('android.settings.APPLICATION_DETAILS_SETTINGS', {
          data: `package:${pkg}`,
        });
        return;
      }
    } catch {}

    // 3) Last resort: just open system settings
    try {
      await IntentLauncher.startActivityAsync('android.settings.SETTINGS');
    } catch {}
  };

  const maybeShowBgNotifReliabilityHelper = async () => {
    if (Platform.OS !== 'android') return;
    if (bgNotifHelperShown) return;

    Alert.alert(
      'Android notification timing',
      'Some Android phones delay notifications in the background to save battery. For on-time Yellow/Red alerts, set Battery to Unrestricted for AgendaGlow.',
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'Open battery settings',
          onPress: async () => {
            setBgNotifHelperShown(true);
            await openBatterySettingsAndroid();
          },
        },
      ]
    );

    // Mark shown even if they tap "Not now" (prevents nagging)
    setBgNotifHelperShown(true);
  };
  
  const cancelPhaseNotifications = async () => {
    try {
      phaseNotifIdsRef.current = [];

      // Cancel anything scheduled
      await Notifications.cancelAllScheduledNotificationsAsync();

      // Remove anything already delivered
      await Notifications.dismissAllNotificationsAsync();

    } catch (e) {
      console.warn('⚠️ Cancel notifications failed:', e?.message || e);
    }
  };

  const schedulePhaseNotifications = async () => {
    // Always start clean
    await cancelPhaseNotifications();

    // Reset schedule/suppression refs for the current item
    scheduledYellowAtRef.current = null;
    scheduledRedAtRef.current = null;
    suppressYellowOnResumeRef.current = false;
    suppressRedOnResumeRef.current = false;

    // Only schedule when a meeting timer is actually running
    if (screen !== 'timer') return;
    if (!running) return;
    if (isSampleDemoActive) return;
    if (!yellowNotifEnabled && !redNotifEnabled) return;

    const ids = [];

    const now = Date.now();
    const asDateTrigger = (s) => ({
      type: 'date',
      date: new Date(now + Math.round(s) * 1000),
    });
    const isValidDelay = (s) => Number.isFinite(s) && s >= 1;

    const cur = agendaItems[currentIndex];
    if (!cur) return;

    const meetingName = title || 'AgendaGlow';
    const curTitle = cur.title || `Item ${currentIndex + 1}`;

    // ✅ Current item timing (based on remaining-time boundary)
    const curDurSec = Math.max(1, Math.round((cur.duration || 0) * 60));
    const curYellowFrac = cur.yellow ?? 0.66666;

    const curYellowRemaining = Math.round(curDurSec * (1 - curYellowFrac));
    const curToYellow = Math.max(0, timeLeft - curYellowRemaining);
    const curToRed = Math.max(0, timeLeft);

    const androidChannel =
      Platform.OS === 'android'
        ? {
            channelId: 'timer',
            priority: Notifications.AndroidNotificationPriority.MAX,
          }
        : {};

    console.log('[Notif schedule]', {
      timeLeft,
      curToYellow,
      curToRed,
      curYellowRemaining,
      now: new Date(now).toISOString(),
    });

    // Yellow exactly at Green->Yellow transition
    if (yellowNotifEnabled && timeLeft > curYellowRemaining && isValidDelay(curToYellow)) {
      scheduledYellowAtRef.current = now + Math.round(curToYellow) * 1000;

      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: `🟡 Wrapping Up: ${curTitle}`,
          body: `${meetingName} — time is running low.`,
          ...androidChannel,
        },
        trigger: asDateTrigger(curToYellow),
      });
      ids.push(id);
    }

    // Red exactly when allocated time expires (end of item)
    if (redNotifEnabled && isValidDelay(curToRed)) {
      scheduledRedAtRef.current = now + Math.round(curToRed) * 1000;

      const id = await Notifications.scheduleNotificationAsync({
        content: {
          title: `⏰ Time’s up: ${curTitle}`,
          body: `${meetingName} — time expired.`,
          ...androidChannel,
        },
        trigger: asDateTrigger(curToRed),
      });
      ids.push(id);
    }

    phaseNotifIdsRef.current = ids;
      try {
        const scheduled = await Notifications.getAllScheduledNotificationsAsync();
        console.log('[Notif scheduled count]', scheduled.length);

        // Print the next few triggers so we can see if they were scheduled correctly
        const preview = scheduled.slice(0, 6).map((n) => ({
          id: n.identifier,
          title: n.content?.title,
          trigger: n.trigger,
        }));
        console.log('[Notif scheduled preview]', preview);
      } catch (e) {
        console.warn('[Notif scheduled read failed]', e?.message || e);
      }
  };

  // 🔔 Background phase notifications we schedule ahead of time
  const phaseNotifIdsRef = useRef([]); // stores scheduled notification IDs so we can cancel
  const appStateRef = useRef(AppState.currentState);
  const bgNotifScheduledRef = useRef(false);

  // ⏱️ Remember when Yellow/Red were scheduled for the CURRENT item
  const scheduledYellowAtRef = useRef(null);
  const scheduledRedAtRef = useRef(null);

  // 🚫 Suppress a duplicate foreground Yellow/Red when returning from background
  const suppressYellowOnResumeRef = useRef(false);
  const suppressRedOnResumeRef = useRef(false);
  
  // ✏️ Editing State
  const [editingYellow, setEditingYellow] = useState({});
  const [editingRed, setEditingRed] = useState({});

  // Per-row editing buffers keyed by item.id
  const [editingTitle, setEditingTitle] = useState({});
  const [editingDuration, setEditingDuration] = useState({});

  // 🔊 Sound Playback
  const [yellowPlayed, setYellowPlayed] = useState(false);
  const yellowPlayedRef = useRef(false);
  const redPlayedRef = useRef(false);
  const soundRefs = useRef({ yellow: null, red: null });
  const [alarmEnabled, setAlarmEnabled] = useState(true); // yellow chirp
  const [buzzerEnabled, setBuzzerEnabled] = useState(true); // red buzzer
  const [customYellowUri, setCustomYellowUri] = useState(null);
  const [customRedUri, setCustomRedUri] = useState(null);
  const yellowPlayer = useAudioPlayer(
    customYellowUri || require('./assets/chime.mp3')
  );
  const redPlayer = useAudioPlayer(customRedUri || require('./assets/alarmchirp.mp3'));

  // 🔔 Foreground alerts: notifications and custom sounds are independent
  const getNotificationsGranted = async () => {
    try {
      const perms = await Notifications.getPermissionsAsync();
      return perms?.status === 'granted';
    } catch {
      return false;
    }
  };

  const notifyOrPlayFallback = async ({ kind, meetingName, itemTitle }) => {
    // Avoid noise during sample demo
    if (isSampleDemoActive) return;

    const androidChannel =
      Platform.OS === 'android'
        ? {
            channelId: 'timer',
            priority: Notifications.AndroidNotificationPriority.MAX,
          }
        : {};

    const notifTitle =
      kind === 'yellow'
        ? `🟡 Wrapping Up: ${itemTitle}`
        : `⏰ Time’s up: ${itemTitle}`;

    const notifBody =
      kind === 'yellow'
        ? `${meetingName} — time is running low.`
        : `${meetingName} — time expired.`;

    const granted = await getNotificationsGranted();
    const notificationsEnabled =
      kind === 'yellow' ? !!yellowNotifEnabled : !!redNotifEnabled;

    // 1) Notification channel (independent)
    if (notificationsEnabled && granted) {
      try {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: notifTitle,
            body: notifBody,
            ...androidChannel,
          },
          trigger: null, // immediate foreground notification
        });
      } catch (e) {
        console.warn(
          '⚠️ scheduleNotificationAsync failed:',
          e?.message || e
        );
      }
    }

    // 2) Custom sound channel (independent)
    try {
      if (kind === 'yellow') {
        if (!alarmEnabled) return;
        yellowPlayer.seekTo(0);
        yellowPlayer.play();
      } else {
        if (!buzzerEnabled) return;
        redPlayer.seekTo(0);
        redPlayer.play();
      }
    } catch (e) {
      console.warn('⚠️ Custom sound play failed:', e?.message || e);
    }
  };

  const syncAlertFlagsFromCurrentTimerState = () => {
    if (screen !== 'timer') return;
    if (!running) return;
    if (isSampleDemoActive) return;

    const item = agendaItems[currentIndex];
    if (!item) return;

    const durationSec = Math.max(1, Math.round((item.duration || 0) * 60));
    const yellowThreshold = durationSec * (item.yellow ?? 0.66666);

    // ✅ Derive directly from timestamps so we don't depend on stale timeLeft state
    const now = Date.now();
    const rawElapsedSec = (now - itemStartTimestamp - pausedDuration) / 1000;
    const speedMultiplier =
      isSampleMeeting || isSampleDemoActive ? demoSpeed || 1 : 1;
    const effectiveElapsed = Math.floor(Math.max(0, rawElapsedSec) * speedMultiplier);

    // Keep timeLeft visually in sync right away on return
    const newTimeLeft = Math.max(durationSec - effectiveElapsed, 0);
    setTimeLeft(newTimeLeft);

    // If Yellow already happened while backgrounded, block foreground re-fire immediately
    if (effectiveElapsed >= yellowThreshold) {
      yellowPlayedRef.current = true;
      setYellowPlayed(true);
      yellowPlayedRef.current = true;
    }

    // If Red already happened while backgrounded, block foreground re-fire immediately
    if (effectiveElapsed >= durationSec) {
      redPlayedRef.current = true;
    }
  };

  // 🔐 Google auth re-entry guards
  const googleBusyRef = useRef(false);
  const lastUidRef = useRef(null); // track previous auth UID to detect user switches
  const lastAuthCodeRef = useRef(null);

  // 🧪 House ad test flags (set true to force your own promos)
  const FORCE_HOUSE_BANNER = false; // force DozenRed banner in app
  const FORCE_HOUSE_INTERSTITIAL = false; // force DozenRed interstitial in app
  const FORCE_HOUSE_REWARDED = false; // force DozenRed rewarded-style modal

  // 🧪 Dev helper: force the Quick-Start tip on every visit to Pre-start
  // Set to true while testing; set back to false before shipping.
  const FORCE_QUICKSTART_TIP = false;

  // 📺 Ad Toggles & Reward Tracking
  const showBannerAds = true;
  // ⭐ Promo banner: show "Go Pro" nudge for first 10s of first agenda item on Timer
  const [showProNudgeBanner, setShowProNudgeBanner] = useState(false);
  const showInterstitials = true;
  const showRewardedAds = true;

  const pendingAction = useRef(null); // Track intent after rewarded ad
  
  // ✅ Setup → Timer: start only after interstitial closes
  const [deferredStartFromSetup, setDeferredStartFromSetup] = useState(false);
  const [proNudgeArmKey, setProNudgeArmKey] = useState(0);

  const [startingMeeting, setStartingMeeting] = useState(false);

  const [hasSeenRewardAd, setHasSeenRewardAd] = useState(false);

  // 🏠 House fallback modals
  const [showHouseInterstitial, setShowHouseInterstitial] = useState(false);
  const [showHouseRewardModal, setShowHouseRewardModal] = useState(false);

  // Tracks whether the AdMob banner has failed (no fill, account limit, etc.)
  const [bannerFailed, setBannerFailed] = useState(false);

  // 🔁 Cycle house banner between Blog and LinkedIn every 10 seconds
  const [houseBannerVariant, setHouseBannerVariant] = useState('blog');

  useEffect(() => {
    const id = setInterval(() => {
      setHouseBannerVariant((prev) => (prev === 'blog' ? 'linkedin' : 'blog'));
    }, 10000); // 10s; tweak as you like
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    // Only nudge when explicitly armed (after interstitial closes), on Timer, first item, non-pro
    const shouldNudge =
      proNudgeArmKey &&
      showBannerAds &&
      !isProUser &&
      !isNoAdsMode &&
      screen === 'timer' &&
      currentIndex === 0;

    if (!shouldNudge) {
      setShowProNudgeBanner(false);
      return;
    }

    setShowProNudgeBanner(true);

    const t = setTimeout(() => {
      setShowProNudgeBanner(false);
      setProNudgeArmKey(0); // ✅ disarm after showing once
    }, 10000);

    return () => clearTimeout(t);
  }, [proNudgeArmKey, screen, currentIndex, isProUser, isNoAdsMode, showBannerAds]);

  // ✅ Setup → Timer: actually start after interstitial (or house interstitial) closes
  useEffect(() => {
    if (!deferredStartFromSetup) return;

    // reset flag immediately to avoid double-runs
    setDeferredStartFromSetup(false);

    (async () => {
      try {
        await startTimerFromSetup();
      } finally {
        setStartingMeeting(false); // ✅ ensure overlay goes away
      }
    })();
  }, [deferredStartFromSetup]);

  const [authMode, setAuthMode] = useState('anonymous'); // default to 'anonymous'

  const [authReady, setAuthReady] = useState(false);
  const [profileReady, setProfileReady] = useState(false);
  const [appleAvailable, setAppleAvailable] = useState(false);

  // Detect if "Sign in with Apple" is supported on this device (real iOS only)
  useEffect(() => {
    (async () => {
      try {
        const ok = await AppleAuthentication.isAvailableAsync();
        setAppleAvailable(Boolean(ok));
        console.log('[Apple] isAvailableAsync =', ok);
      } catch (e) {
        setAppleAvailable(false);
        console.warn('[Apple] availability check failed:', e);
      }
    })();
  }, []);

  // 🔄 RevenueCat helpers & effects

  // Helper: refresh entitlements & mark user as Pro / not Pro
  const refreshRevenueCatEntitlements = async (uidOverride) => {
    try {
      const rcConfig = Constants?.expoConfig?.extra?.revenuecat;
      const entitlementId = rcConfig?.entitlementId || 'pro';

      const customerInfo = await Purchases.getCustomerInfo();
      const activeEntitlement = customerInfo?.entitlements?.active?.[entitlementId];

      const hasPro = !!activeEntitlement;
      setIsProUser(hasPro);
      console.log('[RC] Entitlement check:', entitlementId, '→', hasPro);

      // 🧩 Persist Pro status so the web viewer can hide ads
      try {
        const targetUid = uidOverride || userId;
        if (targetUid) {
          await ensureUserDoc(targetUid, {
            isProUser: hasPro,
            viewerAdsDisabled: hasPro,
          });
        }
      } catch (err) {
        console.warn('[RC] Failed to persist Pro status to Firestore', err);
      }
    } catch (e) {
      console.warn('[RC] getCustomerInfo failed', e);
    }
  };

  // Configure RevenueCat once on app startup
  useEffect(() => {
    const setupRevenueCat = async () => {
      try {
        const rcConfig = Constants?.expoConfig?.extra?.revenuecat;
        if (!rcConfig) {
          console.warn('[RC] Missing revenuecat config in app.config.js');
          return;
        }

        const apiKey =
          Platform.OS === 'ios' ? rcConfig.iosApiKey : rcConfig.androidApiKey;

        if (!apiKey) {
          console.warn('[RC] Missing RevenueCat API key for this platform');
          return;
        }

        await Purchases.configure({ apiKey });

        setRcConfigured(true);
        setIsRevenueCatReady(true);

        await refreshRevenueCatEntitlements();

        // 🔍 Load current offerings and cache localized price strings
        try {
          const offerings = await Purchases.getOfferings();
          const current = offerings.current;

          if (current && current.availablePackages?.length) {
            const pkgs = current.availablePackages;

            const monthlyPkg = pkgs.find((p) => p.identifier === '$rc_monthly');
            const annualPkg = pkgs.find((p) => p.identifier === '$rc_annual');
            const lifetimePkg = pkgs.find((p) => p.identifier === '$rc_lifetime');

            if (monthlyPkg?.product?.priceString) {
              setMonthlyPrice(monthlyPkg.product.priceString);
            }
            if (annualPkg?.product?.priceString) {
              setAnnualPrice(annualPkg.product.priceString);
            }
            // if (lifetimePkg?.product?.priceString) {
            //  setLifetimePrice(lifetimePkg.product.priceString);
            // }
          }
        } catch (e) {
          console.warn('[RC] getOfferings for price strings failed', e);
        }
      } catch (e) {
        console.warn('[RC] configure failed', e);
      }
    };

    setupRevenueCat();
  }, []);

  // Keep RevenueCat user in sync with Firebase userId
  useEffect(() => {
    if (!rcConfigured) return;

    const syncRcUser = async () => {
      try {
        if (userId) {
          const info = await Purchases.logIn(userId);
          logSafe('[RC] logIn result:', {
            created: info?.created,
            activeSubscriptionsCount: info?.customerInfo?.activeSubscriptions?.length || 0,
            activeEntitlements: Object.keys(info?.customerInfo?.entitlements?.active || {}),
          });
        } else {
          await Purchases.logOut();
          console.log('[RC] logOut → anonymous RevenueCat user');
        }

        await refreshRevenueCatEntitlements();
      } catch (e) {
        console.warn('[RC] logIn/logOut failed', e);
      }
    };

    syncRcUser();
  }, [rcConfigured, userId]);

  // Purchase handler: pass 'monthly' | 'annual' | 'lifetime'
  const handlePurchasePro = async (plan = 'monthly') => {
    if (offlineMode) {
      Alert.alert(
        'Offline',
        'You need an internet connection to upgrade to AgendaGlow Pro.'
      );
      return;
    }

    // 🔐 Block anonymous / unidentified users from purchasing
    const currentUser = auth.currentUser;

    if (
      !currentUser || // no Firebase user at all
      currentUser.isAnonymous || // Firebase anonymous auth
      authMode === 'anonymous' || // your own auth flag
      !userId // no stable userId for RevenueCat
    ) {
      Alert.alert(
        'Quick note',
        'You’re in a temporary account. Sign in first so your Pro/trial is easier to recover if you reinstall or change devices.',
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Sign in',
            onPress: () => {
              setAuthScreenMode('upgrade');
              setScreen('emailAuth');
            },
          },
        ]
      );
      return;
    }

    try {
      const offerings = await Purchases.getOfferings();
      const current = offerings.current;

      if (!current || !current.availablePackages?.length) {
        Alert.alert('Not available', 'No subscription packages are configured yet.');
        return;
      }

      const pkgs = current.availablePackages;

      // 🎯 Use your actual RC package IDs
      const identifierMap = {
        monthly: '$rc_monthly',
        annual: '$rc_annual',
        lifetime: '$rc_lifetime',
      };

      const targetIdentifier = identifierMap[plan];

      const pkg = pkgs.find((p) => p.identifier === targetIdentifier);

      if (!pkg) {
        console.warn(
          'Available packages:',
          pkgs.map((p) => p.identifier)
        );
        Alert.alert(
          'Not available',
          `The ${plan} plan could not be found (expected package "${targetIdentifier}").`
        );
        return;
      }

      const { customerInfo } = await Purchases.purchasePackage(pkg);

      await refreshRevenueCatEntitlements();

      const rcConfig = Constants?.expoConfig?.extra?.revenuecat;
      const entitlementId = rcConfig?.entitlementId || 'pro';
      const activeEntitlement = customerInfo?.entitlements?.active?.[entitlementId];

      if (activeEntitlement) {
        const label = plan === 'annual' ? 'Yearly' : 'Monthly';
        Alert.alert(
          'Thank you!',
          `Your AgendaGlow Pro ${label} subscription is now active.`
        );
      }
    } catch (e) {
      console.warn('[RC] purchasePackage error', e);

      // ✅ Special case: the store says this product is already owned
      if (e?.code === 'ProductAlreadyPurchasedError') {
        try {
          // Ask RevenueCat to sync existing purchases from the store
          await Purchases.syncPurchases();
          await refreshRevenueCatEntitlements();

          Alert.alert(
            'Already active',
            'You already have an active AgendaGlow Pro subscription with this store account. Your access has been restored.'
          );
        } catch (syncErr) {
          console.warn('[RC] syncPurchases after already-owned failed', syncErr);
        }
        return;
      }

      // User cancelled → do nothing
      if (e?.userCancelled) return;

      Alert.alert(
        'Purchase failed',
        'Something went wrong while starting the purchase. Please try again.'
      );
    }
  };

  // Social auth assets
  const GoogleIcon = require('./assets/google_g.png'); // your downloaded asset

  // === Google (installed-app redirect used on both iOS & Android) ===
  const GOOGLE_WEB_CLIENT_ID =
    '241646235139-09vk3lisbe3ggiqsvshsujvn9081ar5u.apps.googleusercontent.com';

  const GOOGLE_OAUTH_SCHEME = `com.googleusercontent.apps.${GOOGLE_WEB_CLIENT_ID.replace('.apps.googleusercontent.com', '')}`;

  const NATIVE_REDIRECT = `${GOOGLE_OAUTH_SCHEME}:/oauth2redirect`;

  // --- Google AuthSession request ---
  const [googleRequest, googleResponse, promptGoogleAsync] = Google.useAuthRequest({
    iosClientId: GOOGLE_WEB_CLIENT_ID,
    androidClientId: GOOGLE_WEB_CLIENT_ID,
    webClientId: GOOGLE_WEB_CLIENT_ID, // optional but keeps the flow consistent
    scopes: ['openid', 'profile', 'email'],
    prompt: 'select_account',
    redirectUri: NATIVE_REDIRECT,
    usePKCE: true,
    responseType: 'code',
  });

  // console.log('[Google] redirect used:', NATIVE_REDIRECT);
  // should log: com.googleusercontent.apps.241646235139-09vk3lisbe3ggiqsvshsujvn9081ar5u:/oauth2redirect

  useEffect(() => {
    // console.log('[Google] request ready?', !!googleRequest, 'verifier?', !!googleRequest?.codeVerifier, 'redirect:', NATIVE_REDIRECT);
  }, [googleRequest]);
  const [email, setEmail] = useState(''); // ✅ moved here
  const [password, setPassword] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState({
    email: '',
    confirmEmail: '',
    password: '',
    confirmPassword: '',
  });

  // Tracks whether the signed-in email user is verified
  const [emailVerified, setEmailVerified] = useState(!!auth.currentUser?.emailVerified);

  const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((value || '').trim());

  const validateBeforeSubmit = (mode /* 'login' | 'create' | 'upgrade' */) => {
    const next = { email: '', confirmEmail: '', password: '', confirmPassword: '' };
    let ok = true;

    const e = email.trim();
    const ce = confirmEmail.trim();

    if (!e) {
      next.email = 'Email is required.';
      ok = false;
    } else if (!isValidEmail(e)) {
      next.email = 'Please enter a valid email address.';
      ok = false;
    }

    if (!password) {
      next.password = 'Password is required.';
      ok = false;
    } else if (password.length < 6) {
      next.password = 'Use at least 6 characters.';
      ok = false;
    }

    if (mode === 'create' || mode === 'upgrade') {
      if (!ce) {
        next.confirmEmail = 'Please confirm your email.';
        ok = false;
      } else if (e !== ce) {
        next.confirmEmail = 'Emails do not match.';
        ok = false;
      }

      if (!confirmPassword) {
        next.confirmPassword = 'Please confirm your password.';
        ok = false;
      } else if (password !== confirmPassword) {
        next.confirmPassword = 'Passwords do not match.';
        ok = false;
      }
    }

    setFieldErrors(next);
    return ok;
  };

  // --- Mirror only viewer-safe flags to a public doc the web viewer can read ---
  async function syncViewerPublicFlags(uid, data = {}) {
    if (!uid) return;

    // Only mirror the fields we want public
    const payload = {};

    if (data.isProUser !== undefined && data.isProUser !== null) {
      payload.isProUser = !!data.isProUser;
    }
    if (data.viewerAdsDisabled !== undefined && data.viewerAdsDisabled !== null) {
      payload.viewerAdsDisabled = !!data.viewerAdsDisabled;
    }

    if (data.viewerConfettiEnabled !== undefined && data.viewerConfettiEnabled !== null) {
      payload.viewerConfettiEnabled = !!data.viewerConfettiEnabled;
    }

    // ✅ NEW: viewer branding (Pro-only feature, but we still just mirror what we’re told)
    if (data.viewerBrandingEnabled !== undefined && data.viewerBrandingEnabled !== null) {
      payload.viewerBrandingEnabled = !!data.viewerBrandingEnabled;
    }
    if (data.viewerBrandLogoUrl !== undefined && data.viewerBrandLogoUrl !== null) {
      payload.viewerBrandLogoUrl = String(data.viewerBrandLogoUrl || '');
    }
    if (data.viewerBrandLine1 !== undefined && data.viewerBrandLine1 !== null) {
      payload.viewerBrandLine1 = String(data.viewerBrandLine1 || '');
    }
    if (data.viewerBrandLine2 !== undefined && data.viewerBrandLine2 !== null) {
      payload.viewerBrandLine2 = String(data.viewerBrandLine2 || '');
    }

    // If nothing to write, do nothing
    if (Object.keys(payload).length === 0) return;

    try {
      await setDoc(
        doc(db, 'users', uid, 'public', 'viewer'),
        {
          ...payload,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (e) {
      console.warn(
        '[ViewerFlags] Failed to sync public viewer flags:',
        e?.message || String(e)
      );
    }
  }

  // --- Ensure user profile doc exists (safe to call repeatedly) ---
  async function ensureUserDoc(passedUid, data = {}) {
    // Prefer the passed UID if provided; otherwise fall back to live auth user
    const uid = passedUid || auth.currentUser?.uid;
    if (!uid) throw new Error('No signed-in user while ensuring user doc');

    // Remove undefined/null so Firestore never sees unsupported values
    const clean = Object.fromEntries(
      Object.entries(data || {}).filter(([, v]) => v !== undefined && v !== null)
    );

    const ref = doc(db, 'users', uid);
    const snap = await getDoc(ref);

    if (snap.exists()) {
      // Existing profile: DO NOT touch createdAt
      await updateDoc(ref, {
        ...clean,
        lastLoginAt: serverTimestamp(),
        lastActiveAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      // First time: set createdAt once
      await setDoc(ref, {
        ownerUid: uid,
        email: auth.currentUser?.email ?? null,
        ...clean,
        createdAt: serverTimestamp(), // set once
        lastLoginAt: serverTimestamp(),
        lastActiveAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    // ✅ Mirror viewer-safe flags to public doc (so web viewer can read without auth)
    await syncViewerPublicFlags(uid, clean);
  }

  // --- TEMP: disable anon cleanup to avoid races; we'll batch-clean later ---
  async function cleanupPreviousAnonymousIfNeeded(prevUser, newUser) {
    console.log(
      '🧹 Skip anon delete (temporarily disabled). prev→new:',
      prevUser?.uid,
      '→',
      newUser?.uid
    );
    return; // no-op
  }

  // --- Apple Sign-In helper: nonce pair (raw + SHA256 hashed) ---
  async function getRandomNonce() {
    const rnd = Math.random().toString(36).slice(2) + Date.now().toString(36);
    const hashed = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      rnd
    );
    return { raw: rnd, hashed };
  }

  // 🚀 First-run Sample Meeting (designed to deliver an “aha” in ~30–45 seconds)
  const SAMPLE_MEETING_TITLE = '🎬 AgendaGlow Demo (not saved)';
  const SAMPLE_MEETING_SESSION_ID = 'Sample Meeting';
  const DEFAULT_SESSION_ID = 'defaultSession'; // placeholder only (never a saved agenda)

  const exitSampleDemoToPrestart = () => {
    // stop demo mechanics
    setRunning(false);
    setIsSampleDemoActive(false);
    setShowPostDemoCta(false);
    setDemoSpeed(1);
    setOvertimeMode(false);
    setOvertimeSec(0);

    // ✅ key reset: prevents "Sample Meeting" (or other prior title) from living in the prestart input
    setLocalSessionId('');      // makes sessionId fall back to DEFAULT_SESSION_ID
    setTitle('');               // optional: clears any demo title used elsewhere
    setAgendaTitleDraft('');    // optional: avoids draft carrying over

    // optional but nice cleanup
    setSummary([]);
    setCurrentIndex(0);

    setScreen('prestart');
  };

  const handleCreateFirstRealAgendaFromDemo = () => {
    logUserEvent('post_demo_create_first_agenda_tapped', {}, 'summary');
    exitSampleDemoToPrestart();
  };

  const SAMPLE_MEETING_AGENDA = [
    {
      title: '👋 Kickoff: Agenda Overview',
      duration: 0.5,
      yellow: 0.6,
      red: 0.8,
      presenterTag: '',
      info:
        "How it works:\n" +
        "  ⚙️ Set up your agenda\n" +
        "  ⏱️ Each agenda item is timed\n" +
        "  🚦 Colors shift automatically\n\n" +
        "Everyone stays on track.",
    },
    {
      title: '🗣️ Discussion: Stay Focused',
      duration: 0.5,
      yellow: 0.6,
      red: 0.8,
      presenterTag: '',
      info:
        "Start the timer:\n" +
        "  🟢 On track\n" +
        "  🟡 Nearing the limit\n" +
        "  🔴 Approaching overtime\n\n" +
        "The app keeps your agenda on track.",
    },
  ];

  const sessionId = localSessionId || DEFAULT_SESSION_ID;

  const isAnon = !!auth.currentUser?.isAnonymous;

  // Card rules:
  // - Signed-in (not anon): always show full "How it works (3 steps)" (even if demo was seen)
  // - Anonymous: show "Ready to run a real meeting?" only after demo
  const showHowItWorks = !isAnon; // <-- always true for signed-in users
  const showReadyRealMeeting = isAnon && hasSeenDemo;

const isSampleMeeting = sessionId === SAMPLE_MEETING_SESSION_ID;
const isNoAdsMode = false;

// 🎬 During the demo, allow banners but block ALL fullscreen ads (rewarded + interstitial)
const suppressFullscreenAds = isSampleMeeting || isSampleDemoActive;

  // 🎬 Demo rule: demo sessions cannot go into overtime
  const demoNoOvertime = isSampleMeeting || isSampleDemoActive;
  const sessionDocRef = useMemo(() => {
    if (!userId || !sessionId) return null;
    return doc(db, 'users', userId, 'sessions', sessionId);
  }, [userId, sessionId]);

  /*
// --- 🔗 Fetch enterprise/user QR logo URL ---
// Tries orgs/{orgId}/settings/public.qrLogoUrl first,
// then users/{userId}/settings/public.qrLogoUrl as fallback.
useEffect(() => {
  if (offlineMode) return;
  (async () => {
    try {
      // Try org settings first
      if (orgId) {
        const snap = await getDoc(doc(db, 'orgs', orgId, 'settings', 'public'));
        if (snap.exists()) {
          const data = snap.data() || {};
          if (data.qrLogoUrl) {
            setQrLogoUrl(data.qrLogoUrl);
            return; // stop if org logo found
          }
        }
      }
      // Fallback to per-user settings
      if (userId) {
        const snap2 = await getDoc(doc(db, 'users', userId, 'settings', 'public'));
        if (snap2.exists()) {
          const data2 = snap2.data() || {};
          if (data2.qrLogoUrl) setQrLogoUrl(data2.qrLogoUrl);
        }
      }
    } catch (err) {
      console.warn('⚠️ Failed to fetch QR logo:', err?.message || err);
    }
  })();
}, [orgId, userId, offlineMode]);
*/

  // 🔦 Unified color calculator so we can push bgColor on pause/resume/edits too
  const computeBgColorAt = (elapsedSec, item, useAdvanced) => {
    const durSec = (item?.duration || 0) * 60;
    if (durSec <= 0) return 'green';

    // ✅ Always allow per-item thresholds when present.
    // Advanced mode still lets users edit thresholds, but demo/sample items can define them too.
    const yellow = useAdvanced ? (item?.yellow ?? 0.66666) : (item?.yellow ?? 0.66666);
    const red = useAdvanced ? (item?.red ?? 0.9) : (item?.red ?? 0.9);

    if (elapsedSec >= durSec * red) return 'red';
    if (elapsedSec >= durSec * yellow) return 'yellow';
    return 'green';
  };

  // Commit agenda edits (local + Firestore) in one place
  const commitAgendaUpdate = async (updated) => {
    // 1) local
    setAgendaItems(updated);

    // 2) Firestore write-through (only if we're on setup or before meeting)
    try {
      if (!offlineMode && sessionDocRef) {
        await updateDoc(
          sessionDocRef,
          {
            agenda: updated,
            lastUpdate: new Date().toISOString(),
          },
          { merge: true }
        );
        console.log('✅ Firestore agenda updated from commitAgendaUpdate()');
      }
    } catch (e) {
      console.warn('⚠️ Firestore write-through failed:', e?.message || e);
    }
  };

  const updateOneAgendaItem = async (matchItem, patch) => {
    const updated = agendaItems.map((it) =>
      (it.id ?? it.title) === (matchItem.id ?? matchItem.title) ? { ...it, ...patch } : it
    );
    await commitAgendaUpdate(updated);
  };

  // ✅ Flush any in-progress Setup edits (editing buffers) BEFORE starting
  const flushPendingSetupEdits = async () => {
    // Nothing to do if there are no buffers
    const hasBuffers =
      (editingTitle && Object.keys(editingTitle).length > 0) ||
      (editingDuration && Object.keys(editingDuration).length > 0) ||
      (editingYellow && Object.keys(editingYellow).length > 0) ||
      (editingRed && Object.keys(editingRed).length > 0);

    if (!hasBuffers) return;

    const updated = (Array.isArray(agendaItems) ? agendaItems : []).map((item, index) => {
      const id = item.id ?? index;
      let next = { ...item };

      // Title
      if (editingTitle?.[id] !== undefined) {
        const raw = String(editingTitle[id] ?? '');
        const trimmed = raw.slice(0, TITLE_MAX_CHARS);
        next.title = trimmed.trim() || 'Untitled item';
      }

      // Duration (minutes)
      if (editingDuration?.[id] !== undefined) {
        const raw = String(editingDuration[id] ?? '');
        const cleaned = raw.replace(/[^0-9]/g, '');
        let parsed = parseInt(cleaned, 10);
        if (isNaN(parsed) || parsed <= 0) parsed = next.duration || 1;
        parsed = Math.min(parsed, 240); // keep your 4-hour cap
        next.duration = parsed;
      }

      // Advanced thresholds (if you’re using these buffers)
      if (editingYellow?.[id] !== undefined) {
        const v = parseInt(String(editingYellow[id]).replace(/[^0-9]/g, ''), 10);
        if (!isNaN(v)) next.yellow = Math.max(0.01, Math.min(0.99, v / 100));
      }
      if (editingRed?.[id] !== undefined) {
        const v = parseInt(String(editingRed[id]).replace(/[^0-9]/g, ''), 10);
        if (!isNaN(v)) next.red = Math.max(0.01, Math.min(0.99, v / 100));
      }

      return next;
    });

    // Clear buffers so UI state is consistent
    setEditingTitle({});
    setEditingDuration({});
    setEditingYellow({});
    setEditingRed({});

    // ✅ Commit local + Firestore write-through (when online + sessionDocRef exists)
    await commitAgendaUpdate(updated);
  };

  // ✅ Explicit "Save" (hard commit) for Setup/Share screens
  const saveAgendaToFirestoreNow = async () => {
    // Prevent saving the placeholder demo session
    if (sessionId === DEFAULT_SESSION_ID) {
      setSaveBannerText('Demo agendas can’t be saved.');
      setTimeout(() => setSaveBannerText(''), 2000);
      return false;
    }

    // If offline or not signed in, we can’t truly commit to Firestore
    if (offlineMode || !userId) {
      setSaveBannerText('Offline — can’t save right now.');
      setTimeout(() => setSaveBannerText(''), 2000);
      return false;
    }

    const cleanTitle = String(title || sessionId || '').replace(/\s+/g, ' ').trim();
    if (!cleanTitle) {
      setSaveBannerText('Add a title before saving.');
      setTimeout(() => setSaveBannerText(''), 2000);
      return false;
    }

    setIsSavingAgenda(true);
    try {
      // Ensure /users/{uid} exists (safe repeat)
      await ensureUserDoc(userId, {
        provider: auth.currentUser?.providerData?.[0]?.providerId || 'unknown',
        email: auth.currentUser?.email ?? undefined,
        displayName: auth.currentUser?.displayName ?? undefined,
      });

      const ref = doc(db, 'users', userId, 'sessions', cleanTitle);

      // ✅ Merge-only: do NOT overwrite timer fields if they exist
      await setDoc(
        ref,
        {
          title: cleanTitle,
          agenda: Array.isArray(agendaItems) ? agendaItems : [],
          published: true,
          lastUpdate: new Date().toISOString(),
        },
        { merge: true }
      );

      // Mark as "exists" so your timer tick path doesn’t re-create it later
      setSessionWrittenToFirestore(true);

      // Remember as current (matches your other flows)
      await AsyncStorage.setItem('@userInfo', JSON.stringify({ userId, sessionId: cleanTitle }));
      await rememberRecentTitle(cleanTitle);

      setSaveBannerText('✅ Saved');
      setTimeout(() => setSaveBannerText(''), 2000);
      return true;
    } catch (e) {
      console.error('❌ SaveAgenda failed:', e);
      setSaveBannerText('Save failed');
      setTimeout(() => setSaveBannerText(''), 2500);
      return false;
    } finally {
      setIsSavingAgenda(false);
    }
  };

  // Helper: update a single agenda item by index
  const updateAgendaItem = (index, patch) => {
    setAgendaItems((prev) => {
      const updated = [...prev];
      const existing = updated[index] || {};
      updated[index] = { ...existing, ...patch };
      return updated;
    });
  };

  // 🚀 One-tap Sample Meeting (starts immediately at 10× speed)
  const startSampleMeetingFromQuickStart = async () => {
    const now = Date.now();

    // ✅ Prevent a previous demo’s delayed “advance/finish” timeout from firing mid-replay
    if (advanceTimeoutRef.current) {
      clearTimeout(advanceTimeoutRef.current);
      advanceTimeoutRef.current = null;
    }

    // Also reset completion refs just to be safe (prevents any stale finalize paths)
    finalItemCompleted.current = false;
    finalItemManuallySkipped.current = false;

    // Mark as seen so next launches don’t “highlight” as first-run
    try {
      await AsyncStorage.setItem(SAMPLE_MEETING_FIRSTRUN_KEY, 'true');
      setIsFirstRunSample(false);
    } catch {}

    // Demo speed
    setDemoSpeed(3);
    setIsSampleDemoActive(true);

    // Load sample agenda + session id/title
    setTitle(SAMPLE_MEETING_TITLE);
    setAgendaItems(SAMPLE_MEETING_AGENDA);
    setLocalSessionId(SAMPLE_MEETING_SESSION_ID);

    // Start timer state (mirrors your normal start path)
    setSummary([]);
    lastSummaryRef.current = [];
    setScreen('timer');
    const liveUid = auth.currentUser?.uid || userId;
    console.log('[demo_timer_entered] uid=', auth.currentUser?.uid, 'userId=', userId, 'authReady=', authReady);
    logUserEvent('demo_timer_entered', {}, 'timer');
    // ✅ Mark auto-demo as completed ONLY once we actually start the demo (timer screen)
    try {
      await AsyncStorage.setItem(FIRST_OPEN_AUTODEMO_KEY, 'true');
      setHasSeenDemo(true);
    } catch (e) {
      console.warn('⚠️ Failed to persist FIRST_OPEN_AUTODEMO_KEY', e);
    }
    setCurrentIndex(0);
    setTimeLeft(SAMPLE_MEETING_AGENDA[0].duration * 60);
    setRunning(true);
    setYellowPlayed(false);
    yellowPlayedRef.current = false;
    redPlayedRef.current = false;
    scheduledYellowAtRef.current = null;
    scheduledRedAtRef.current = null;
    suppressYellowOnResumeRef.current = false;
    suppressRedOnResumeRef.current = false;
    setStartTimestamp(now);
    setEndTimestamp(null);
    setPausedTime(0);
    setItemStartTimestamp(now);
    setPausedDuration(0);
    pauseStartRef.current = null;
    setOvertimeMode(false);
    setOvertimeSec(0);

    console.log('[Demo start] entering Firestore block check', {
      offlineMode,
      liveUid,
    });

    // Optional: create/update the Firestore session so the viewer works instantly
    if (!offlineMode && liveUid) {
      try {
        // ✅ Ensure parent /users/{uid} doc exists even for anonymous users
        await ensureUserDoc(liveUid, {
          provider: auth.currentUser?.providerData?.[0]?.providerId || 'anonymous',
          isAnonymous: !!auth.currentUser?.isAnonymous,
        });

        const sampleRef = doc(db, 'users', liveUid, 'sessions', SAMPLE_MEETING_SESSION_ID);

        await setDoc(
          sampleRef,
          {
            title: SAMPLE_MEETING_TITLE,
            agenda: SAMPLE_MEETING_AGENDA,
            currentItem: SAMPLE_MEETING_AGENDA[0]?.title || 'Intro',
            currentIndex: 0,
            elapsed: 0,
            status: 'Running',
            startTimestamp: now,
            meetingStartAt: serverTimestamp(),
            meetingStartAtMs: now,
            lastUpdate: new Date().toISOString(),
            lastHeartbeat: serverTimestamp(),
            itemStartAt: serverTimestamp(),
            itemStartAtMs: now,
            canResume: true,
            pausedAccumMs: 0,
            durationSec: Math.round((SAMPLE_MEETING_AGENDA[0]?.duration || 0) * 60),
            published: true,
            demoSpeed: 2,
            isSampleDemo: true,
          },
          { merge: true }
        );

        setSessionWrittenToFirestore(true);
      } catch (e) {
        console.warn('⚠️ Sample Meeting Firestore write failed:', e?.message || e);
        setSessionWrittenToFirestore(false);
      }
    }
  };

  // 🔄 Live Elapsed Time Sync
  const updateLiveElapsedTime = async (elapsedSec) => {
    // ✅ Never persist the placeholder session
    if (sessionId === DEFAULT_SESSION_ID) return;
    const item = agendaItems[currentIndex];
    const bgColor = computeBgColorAt(elapsedSec, item, advancedThresholdsEnabled);
    if (offlineMode || !sessionDocRef) return;
    try {
      // ✅ If this is the first tick and the session hasn't been created yet, create it now.
      if (!sessionWrittenToFirestore) {
        await setDoc(
          sessionDocRef,
          {
            title: (title || '').trim() || sessionId,
            agenda: agendaItems,
            currentItem: agendaItems[currentIndex]?.title || '',
            currentIndex,
            elapsed: elapsedSec,
            status: running ? 'Running' : 'Paused',
            published: true, // ✅ so QR viewer can read
            isSampleDemo: isSampleMeeting || isSampleDemoActive,
            lastUpdate: new Date().toISOString(),
            lastHeartbeat: serverTimestamp(),
          },
          { merge: true }
        );
        setSessionWrittenToFirestore(true);
      }
      await updateDoc(
        sessionDocRef,
        { bgColor, elapsed: elapsedSec, demoSpeed: demoSpeed || 1 },
        { merge: true }
      );
    } catch (err) {
      console.error('❌ Failed to sync elapsed + duration:', err);
    }
  };

  // 📝 Record Completed Item
  const recordCurrentItemToSummary = (
    completedAtMs = Date.now(),
    pausedDurationMsOverride = null
  ) => {
    const currentItem = agendaItems[currentIndex];
    const durationSec = currentItem.duration * 60;
    let totalElapsed = durationSec - timeLeft + (overtimeMode ? overtimeSec : 0);

    if (totalElapsed > durationSec && totalElapsed <= durationSec + 1) {
      totalElapsed = durationSec;
    }

    if (totalElapsed > durationSec) {
      console.log(
        `⚠️ Elapsed (${totalElapsed}s) exceeded expected duration (${durationSec}s)`
      );
    }

    const effectivePausedMs = pausedDurationMsOverride ?? pausedDuration ?? 0;

    const redThreshold = durationSec * (currentItem.red ?? 0.9);
    const reachedRed = totalElapsed >= redThreshold;
    const totalWithPause = totalElapsed + effectivePausedMs / 1000;
    const statusColor = totalWithPause > durationSec + 1 ? 'red' : 'green';

    const now = new Date(completedAtMs);
    const pad = (n) => (n < 10 ? '0' + n : n);
    const hours12 = now.getHours() % 12 || 12;
    const ampm = now.getHours() >= 12 ? 'PM' : 'AM';
    const completedAtUS = `${pad(now.getMonth() + 1)}/${pad(now.getDate())}/${now.getFullYear()}, ${pad(hours12)}:${pad(now.getMinutes())}:${pad(now.getSeconds())} ${ampm}`;
    const start = new Date(itemStartTimestamp || Date.now());
    const startedAtUS = start.toLocaleString();
    const startedAt = start.toISOString();

    setSummary((prev) => {
      const updated = [
        ...prev,
        {
          title: currentItem.title,
          duration: currentItem.duration,
          reachedYellow: yellowPlayed || reachedRed,
          reachedRed,
          statusColor,
          timeSpent: totalElapsed,
          pausedDuration: Math.round(effectivePausedMs / 1000),
          startedAt,
          startedAtUS,
          completedAt: now.toISOString(),
          completedAtUS,
          presenterTag: currentItem.presenterTag || '',
          info: currentItem.info || '',
        },
      ];
      lastSummaryRef.current = updated;
      console.log('📋 Updated summary:', updated);
      return updated;
    });
  };

  // 🔍 Agenda Change Checker
  const isAgendaModified = (a, b) => {
    if (a.length !== b.length) return true;
    return a.some(
      (item, i) =>
        item.title !== b[i].title ||
        item.duration !== b[i].duration ||
        item.yellow !== b[i].yellow ||
        item.red !== b[i].red ||
        (item.info || '') !== (b[i].info || '')
    );
  };

  // 🔇 Stop Audio Before Ad
  const stopAudioBeforeAd = async () => {
    try {
      await yellowPlayer.pauseAsync?.();
      await redPlayer.pauseAsync?.();
    } catch (e) {
      console.warn('⚠️ Error stopping audio before ad:', e);
    }
  };

  // 📥 Load Agenda From CSV
  const loadAgendaFromCSV = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['text/csv', 'text/comma-separated-values', 'application/octet-stream'],
      });
      if (!result?.assets || !result.assets[0]?.uri) return;

      const csvUri = result.assets[0].uri;
      const csvString = await FileSystem.readAsStringAsync(csvUri);

      const parsed = Papa.parse(csvString, { header: true, skipEmptyLines: true });
      if (parsed.errors.length) {
        Alert.alert('Error', 'CSV file could not be parsed.');
        return;
      }

      // Normalize header names
      const fields = (parsed.meta.fields || []).map((f) => (f || '').trim());

      // Format A: simple agenda CSV (current behavior)
      const hasSimpleTitle = fields.includes('title') || fields.includes('Title');
      const hasSimpleDuration =
        fields.includes('duration') || fields.includes('Duration');

      // Format B: exported summary CSV
      const hasSummaryTitle = fields.includes('Title');
      const hasSummaryDuration = fields.includes('Duration (min)');

      let mode = null;
      if (hasSimpleTitle && hasSimpleDuration) {
        mode = 'simple';
      } else if (hasSummaryTitle && hasSummaryDuration) {
        mode = 'summary';
      }

      if (!mode) {
        Alert.alert(
          'Invalid Format',
          'CSV must either:\n\n• Include "title/Title" and "duration/Duration" headers\n  (simple agenda format)\n\nOR\n\n• Match the exported summary layout with "Title" and "Duration (min)" columns.'
        );
        return;
      }

      const agendaFromCSV = parsed.data.map((row, i) => {
        if (mode === 'simple') {
          // Simple agenda import (original)
          const title =
            (row.title ?? row.Title ?? '').toString().trim() || `Item ${i + 1}`;
          const duration = parseFloat(row.duration ?? row.Duration);
          const info = (row.info ?? row.Info ?? row.Notes ?? '').toString();
          const presenterTag = (row.presenterTag ?? row.presenter ?? row.Presenter ?? '')
            .toString()
            .trim();

          return {
            title,
            duration: isNaN(duration) || duration <= 0 ? 1 : duration,
            yellow: 0.66666,
            red: 0.9,
            info,
            presenterTag,
          };
        } else {
          // Summary export import (from meeting_summary.csv)
          const title = (row.Title ?? '').toString().trim() || `Item ${i + 1}`;
          const duration = parseFloat(row['Duration (min)']);
          const info = (row.Notes ?? '').toString();
          const presenterTag = (row.Presenter ?? '').toString().trim();

          return {
            title,
            duration: isNaN(duration) || duration <= 0 ? 1 : duration,
            yellow: 0.66666,
            red: 0.9,
            info,
            presenterTag,
          };
        }
      });

      const slicedAgenda = agendaFromCSV.slice(0, 30);
      const finalizeLoad = () => {
        setAgendaItems(slicedAgenda);
        setOriginalAgenda(JSON.parse(JSON.stringify(slicedAgenda)));
        Alert.alert('Success', 'Agenda loaded from CSV!');
      };

      if (agendaItems.length > 0) {
        Alert.alert(
          'Overwrite Current Agenda?',
          'Loading this CSV will replace your existing agenda. Continue?',
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'OK', onPress: finalizeLoad },
          ]
        );
      } else {
        finalizeLoad();
      }
    } catch (e) {
      console.error('CSV load error:', e);
      Alert.alert('Error', 'Failed to load agenda from CSV.');
    }
  };

  // 🎨 Background Color Based on Time
  const getBackgroundColor = () => {
    const item = agendaItems[currentIndex];
    if (!item) return { backgroundColor: colors.brightGreen };

    // 🔴 Overtime always wins visually
    if (overtimeMode) return { backgroundColor: colors.pulseRed };

    // Derive elapsed from timestamps + paused time (same basis the viewer uses)
    // Freeze background while paused by pinning "now" to the moment pause started
    const now = running ? Date.now() : (pauseStartRef.current || Date.now());
    const rawElapsedSec =
      (now - (itemStartTimestamp || now) - (pausedDuration || 0)) / 1000;

    // ✅ Only apply demoSpeed when we're actually in the demo/sample meeting
    const speedMultiplier = isSampleMeeting || isSampleDemoActive ? demoSpeed || 1 : 1;

    const effectiveElapsed = Math.max(
      0,
      Math.floor(Math.max(0, rawElapsedSec) * speedMultiplier)
    );

    const color = computeBgColorAt(effectiveElapsed, item, advancedThresholdsEnabled);
    if (color === 'red') return { backgroundColor: colors.pulseRed };
    if (color === 'yellow') return { backgroundColor: '#ffc107' };
    return { backgroundColor: colors.brightGreen };
  };

  // ♿ Phase badge (matches viewer’s G / Y / R / OT + shape)
  const getPhaseBadge = () => {
    const item = agendaItems[currentIndex];
    if (!item) return { code: 'G', shape: '●' };

    // OT always wins (same as viewer)
    if (overtimeMode) return { code: 'OT', shape: '◆' };

    // Derive elapsed from timestamps + paused time
    const now = Date.now();
    const rawElapsedSec =
      (now - (itemStartTimestamp || now) - (pausedDuration || 0)) / 1000;

    const speedMultiplier =
      isSampleMeeting || isSampleDemoActive ? demoSpeed || 1 : 1;

    const effectiveElapsed = Math.max(
      0,
      Math.floor(Math.max(0, rawElapsedSec) * speedMultiplier)
    );

    const phase = computeBgColorAt(
      effectiveElapsed,
      item,
      advancedThresholdsEnabled
    );

    if (phase === 'yellow') return { code: 'Y', shape: '▲' };
    if (phase === 'red') return { code: 'R', shape: '■' };

    return { code: 'G', shape: '●' };
  };

  // 🟡🔴 Contextual “nudge” text (quiet + helpful). Used on Timer screen.
  const getTimeNudge = () => {
    if (screen !== 'timer') return null;

    // Don't show urgency nudges while paused. Pause means "this time should not count,"
    // so messages like "Wrap up" or "Time to move on" feel wrong during the pause.
    if (!running) return null;

    const item = agendaItems[currentIndex];
    if (!item) return null;

    if (overtimeMode) {
      return '⏱️ Capture & move on';
    }

    const now = Date.now();
    const rawElapsedSec =
      (now - (itemStartTimestamp || now) - (pausedDuration || 0)) / 1000;

    const speedMultiplier = isSampleMeeting || isSampleDemoActive ? demoSpeed || 1 : 1;
    const effectiveElapsed = Math.max(
      0,
      Math.floor(Math.max(0, rawElapsedSec) * speedMultiplier)
    );

    const phase = computeBgColorAt(effectiveElapsed, item, advancedThresholdsEnabled);
    if (phase === 'yellow') return '🟡 Wrap up — land it';
    if (phase === 'red') return '🔴 Time to move on — park it';
    return null;
  };

  // 📊 Agenda & State
  const [screen, setScreen] = useState('splash'); 
  // 'splash' | 'prestart' | 'myagendas' | 'templates' | 'settings' | 'more' | 'setup' | 'timer' | 'summary' | 'login' | 'sharelink' | 'emailAuth'

  const [isSavingAgenda, setIsSavingAgenda] = useState(false);
  const [saveBannerText, setSaveBannerText] = useState('');

  // 🎬 Demo clock multiplier (1 = normal, 3 = demo sample)
  const [demoSpeed, setDemoSpeed] = useState(1);

  useEffect(() => {
    // ✅ Never allow demo speed outside the sample/demo experience
    if (!(isSampleMeeting || isSampleDemoActive) && demoSpeed !== 1) {
      setDemoSpeed(1);
    }
  }, [isSampleMeeting, isSampleDemoActive, demoSpeed]);

  // ✅ Auto-return to prestart after demo summary
  useEffect(() => {
    if (!(isSampleDemoActive && screen === 'summary')) return;

    const timeout = setTimeout(() => {
      setRunning(false);
      setIsSampleDemoActive(false);
      setShowPostDemoCta(false);
      setDemoSpeed(1);
      setOvertimeMode(false);
      setOvertimeSec(0);
      setScreen('prestart');
    }, 7000); // was 15 seconds

    return () => clearTimeout(timeout);
  }, [isSampleDemoActive, screen]);


  const [isSampleDemoActive, setIsSampleDemoActive] = useState(false);
  const [showPostDemoCta, setShowPostDemoCta] = useState(false);

  const [hasSeenDemo, setHasSeenDemo] = useState(false);

  // 🎬 Demo framing emphasis animation (quiet + premium)
  const demoFramingOpacity = useRef(new Animated.Value(0)).current;
  const demoFramingY = useRef(new Animated.Value(4)).current;

  // 🎬 Demo badge pulse (subtle)
  const demoBadgeScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (screen !== 'prestart') return;

    // Leaving Setup/Timer back to Home should clear AI-specific source labels.
    setCurrentAgendaSource(null);

    // ✅ always reset Home after completing a meeting (no matter how we got here)
    if (justFinishedMeetingRef.current) {
      justFinishedMeetingRef.current = false;
      setLocalSessionId('');
      setTitle('');
      setAgendaTitleDraft('');
      setCopySourceId(null);
      setSelectedTemplateSessionId(null);
      return;
    }

    // ✅ never allow Sample Meeting to sit in the "New Agenda Title" field
    if (localSessionId === SAMPLE_MEETING_SESSION_ID) {
      setLocalSessionId('');
      setTitle('');
      setAgendaTitleDraft('');
    }
  }, [screen, localSessionId]);

  useEffect(() => {
    if (!(screen === 'timer' && isSampleDemoActive)) return;

    demoBadgeScale.setValue(1);

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(demoBadgeScale, {
          toValue: 1.08,
          duration: 550,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(demoBadgeScale, {
          toValue: 1,
          duration: 550,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );

    loop.start();
    return () => loop.stop();
  }, [screen, isSampleDemoActive]);

  useEffect(() => {
    // Only animate when the demo framing first becomes relevant (Timer screen + demo active)
    if (!(screen === 'timer' && isSampleDemoActive)) return;

    demoFramingOpacity.setValue(0);
    demoFramingY.setValue(4);

    Animated.parallel([
      Animated.timing(demoFramingOpacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(demoFramingY, {
        toValue: 0,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [screen, isSampleDemoActive]);

  // Used to style the Sample button strongly only on first install
  const [isFirstRunSample, setIsFirstRunSample] = useState(false);

  const [orgId, setOrgId] = useState(''); // optional enterprise org key

  // 🧾 RevenueCat subscription state
  const [isProUser, setIsProUser] = useState(false);
  const [isRevenueCatReady, setIsRevenueCatReady] = useState(false);
  const [rcConfigured, setRcConfigured] = useState(false);
  const [meetingsCompletedCount, setMeetingsCompletedCount] = useState(0);
  const [showThreeMeetingCongrats, setShowThreeMeetingCongrats] = useState(false);
  const [showFiveMeetingProOffer, setShowFiveMeetingProOffer] = useState(false);
  const [showFiveMeetingProModal, setShowFiveMeetingProModal] = useState(false);
  const suppressNextSummaryInterstitialRef = useRef(false);

  const normalizedMeetingsCompletedCount = Number.isFinite(Number(meetingsCompletedCount))
    ? Number(meetingsCompletedCount)
    : 0;

  const adsUnlockedByUsage =
    normalizedMeetingsCompletedCount >= ADS_UNLOCK_AFTER_MEETINGS;

  // ✅ Summary banner waits one extra completed meeting
  const summaryBannerUnlockedByUsage =
    normalizedMeetingsCompletedCount >= (ADS_UNLOCK_AFTER_MEETINGS + 1);

  const shouldShowUsageGatedAds =
    adsUnlockedByUsage && !isSampleMeeting && !isSampleDemoActive;

  const shouldShowSummaryUsageGatedAds =
    summaryBannerUnlockedByUsage && !isSampleMeeting && !isSampleDemoActive;

  const shouldAllowFullscreenAds =
    !isProUser &&
    !isNoAdsMode &&
    !suppressFullscreenAds &&
    adsUnlockedByUsage;

  {/*}
    console.log('[ads-debug][LATEST-REV-1034]', {
    meetingsCompletedCount,
    meetingsCompletedCountType: typeof meetingsCompletedCount,
    normalizedMeetingsCompletedCount,
    normalizedMeetingsCompletedCountType: typeof normalizedMeetingsCompletedCount,
    ADS_UNLOCK_AFTER_MEETINGS,
    adsUnlockedByUsage,
    adsUnlockedByUsageType: typeof adsUnlockedByUsage,
  });
  */}

  // 🔄 Load Pro viewer branding when Settings screen is shown
  useEffect(() => {
    if (screen !== 'settings') return;
    if (offlineMode) return;
    if (!userId) return;

    let cancelled = false;

    (async () => {
      try {
        const snap = await getDoc(doc(db, 'users', userId));
        if (!snap.exists() || cancelled) return;

        const u = snap.data() || {};

        setViewerBrandingEnabled(!!u.viewerBrandingEnabled);
        setViewerBrandLogoUrl(u.viewerBrandLogoUrl || '');
        setViewerBrandLine1(u.viewerBrandLine1 || '');
        setViewerBrandLine2(u.viewerBrandLine2 || '');
      } catch (e) {
        console.warn('[ViewerBranding] load failed', e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [screen, offlineMode, userId]);

  // 💰 Localized price strings from RevenueCat offerings
  const [monthlyPrice, setMonthlyPrice] = useState(null);
  const [annualPrice, setAnnualPrice] = useState(null);
  // If you later re-enable lifetime, you can add:
  // const [lifetimePrice, setLifetimePrice] = useState(null);

  // UI: whether to show the full Pro plans panel on Settings
  const [showPlans, setShowPlans] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        // 1) Local first for instant startup
        const raw = await AsyncStorage.getItem(MEETINGS_COMPLETED_STORAGE_KEY);
        const localParsed = parseInt(raw ?? '0', 10);
        const localCount =
          Number.isFinite(localParsed) && localParsed >= 0 ? localParsed : 0;

        setMeetingsCompletedCount(localCount);

        // 2) Then Firestore backup / cross-device truth
        if (!offlineMode && userId) {
          const userSnap = await getDoc(doc(db, 'users', userId));
          if (userSnap.exists()) {
            const remoteRaw = userSnap.data()?.meetingsCompletedCount;
            const remoteCount = Number(remoteRaw ?? 0);

            if (Number.isFinite(remoteCount) && remoteCount >= 0) {
              setMeetingsCompletedCount(remoteCount);
              await AsyncStorage.setItem(
                MEETINGS_COMPLETED_STORAGE_KEY,
                String(remoteCount)
              );
            }
          }
        }
      } catch (e) {
        console.warn('⚠️ Failed to load meetings completed count:', e);
        setMeetingsCompletedCount(0);
      }
    })();
  }, [userId, offlineMode]);

  const meetingCompletionCountedRef = useRef(false);

  // 🧨 Account deletion: extra-confirm modal (type "confirm")
  const [showDeleteAccountModal, setShowDeleteAccountModal] = useState(false);

  // 🔐 Email re-auth (for account deletion)
  const [showDeleteReauthModal, setShowDeleteReauthModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteReauthBusy, setDeleteReauthBusy] = useState(false);

  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteAccountBusy, setDeleteAccountBusy] = useState(false);
  const DELETE_CONFIRM_WORD = 'confirm';

  // 🏫 Pro: Viewer custom branding (logo + 2 lines)
  const [viewerBrandingEnabled, setViewerBrandingEnabled] = useState(false);
  const [viewerBrandLogoUrl, setViewerBrandLogoUrl] = useState('');
  const [viewerBrandLine1, setViewerBrandLine1] = useState('');
  const [viewerBrandLine2, setViewerBrandLine2] = useState('');

  // 🎉 Confetti flag for "Finished Early" summary
  const [showConfetti, setShowConfetti] = useState(false);

  // const [qrLogoUrl, setQrLogoUrl] = useState(null); // firehose for enterprise logo URL
  // Default to your app icon if no enterprise logo is set:
  //const brandLogoSource = qrLogoUrl ? { uri: qrLogoUrl } : require('./assets/icon.png');
  const brandLogoSource = require('./assets/icon.png'); // Always AgendaGlow logo
  // Reasonable defaults for logo sizing
  const getLogoSize = (qrSize) => Math.floor(qrSize * 0.22); // keep logo ≲ 22% of QR
  const [agenda, setAgenda] = useState([]);
  const [title, setTitle] = useState('');
  // 📝 Editable agenda title (tap-to-edit on Setup & Summary)
  const [isEditingAgendaTitle, setIsEditingAgendaTitle] = useState(false);
  const [agendaTitleDraft, setAgendaTitleDraft] = useState('');
  const agendaTitleInputRef = useRef(null);
  const [agendaItems, setAgendaItems] = useState([]);
  const [showAiAgendaModal, setShowAiAgendaModal] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiDurationMinutes, setAiDurationMinutes] = useState('30');
  const [aiAgendaBusy, setAiAgendaBusy] = useState(false);
  const [aiAgendaUsageCount, setAiAgendaUsageCount] = useState(0);
  const [lastAiPrompt, setLastAiPrompt] = useState('');
  const [lastAiDurationMinutes, setLastAiDurationMinutes] = useState('30');
  const [aiSpeechListening, setAiSpeechListening] = useState(false);
  const [aiSpeechStatus, setAiSpeechStatus] = useState('');
  const [aiSpeechError, setAiSpeechError] = useState('');
  const aiSpeechBasePromptRef = useRef('');
  const aiPromptInputRef = useRef(null);
  const aiDurationInputRef = useRef(null);
  const AI_PROMPT_ACCESSORY_ID = 'agendaglowAiPromptDoneAccessory';
  const AI_DURATION_ACCESSORY_ID = 'agendaglowAiDurationDoneAccessory';
  const [aiPromptFocused, setAiPromptFocused] = useState(false);
  const [aiDurationFocused, setAiDurationFocused] = useState(false);
  const aiKeyboardFocused = aiPromptFocused || aiDurationFocused;
  const [currentAgendaSource, setCurrentAgendaSource] = useState(null);
  // 'share' = user explicitly tapped Save/Share; 'start' = checkpoint shown before starting
  const [shareLinkMode, setShareLinkMode] = useState('share');
  const [originalAgenda, setOriginalAgenda] = useState([]);
  const [summary, setSummary] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [timeLeft, setTimeLeft] = useState(60);
  const [running, setRunning] = useState(false);

  const aiPromptExamples = [
    'Create a 45-minute project risk review with blockers, decisions, and next steps.',
    'Create a 30-minute 1:1 coaching agenda with check-in, feedback, and action items.',
    'Create a 60-minute client kickoff agenda with introductions, goals, timeline, and owners.',
  ];

  const aiAgendaFreeRemaining = Math.max(
    0,
    AI_FREE_AGENDA_LIMIT - (Number(aiAgendaUsageCount) || 0)
  );

  // 🎙️ AI voice prompt: lazy-load speech recognition only when the user taps Speak.
  // This avoids iOS production startup crashes caused by loading/registering the
  // native speech module before React reaches the AgendaGlow splash/card UI.
  const aiSpeechModuleRef = useRef(null);
  const aiSpeechListenersRef = useRef([]);

  const detachAiSpeechListeners = () => {
    try {
      aiSpeechListenersRef.current.forEach((listener) => {
        try {
          listener?.remove?.();
        } catch {}
      });
    } finally {
      aiSpeechListenersRef.current = [];
    }
  };

  const getAiSpeechModule = async () => {
    if (aiSpeechModuleRef.current) return aiSpeechModuleRef.current;

    // Dynamic import is intentional. Do not move this back to the top of App.js.
    // Static import + startup event hooks caused iOS production to hang on the
    // native launch screen before the App.js card could render.
    const mod = await import('expo-speech-recognition');
    const speechModule = mod?.ExpoSpeechRecognitionModule;

    if (!speechModule) {
      throw new Error('Speech recognition module did not load.');
    }

    aiSpeechModuleRef.current = speechModule;
    return speechModule;
  };

  const attachAiSpeechListeners = (speechModule) => {
    detachAiSpeechListeners();

    aiSpeechListenersRef.current = [
      speechModule.addListener('start', () => {
        setAiSpeechListening(true);
        setAiSpeechStatus('Listening… tap Stop when you’re done.');
        setAiSpeechError('');
      }),
      speechModule.addListener('end', () => {
        setAiSpeechListening(false);
        setAiSpeechStatus((prev) =>
          prev === 'Listening… tap Stop when you’re done.'
            ? 'Voice input added. You can edit before generating.'
            : prev
        );
      }),
      speechModule.addListener('result', (event) => {
        const transcript = String(event?.results?.[0]?.transcript || '')
          .replace(/\s+/g, ' ')
          .trim();

        if (!transcript) return;

        const base = aiSpeechBasePromptRef.current || '';
        const nextPrompt = `${base}${transcript}`.slice(0, 600);
        setAiPrompt(nextPrompt);
        setAiSpeechStatus('Listening… tap Stop when you’re done.');
      }),
      speechModule.addListener('error', (event) => {
        console.warn('[AI Agenda Voice] speech recognition error:', event);
        setAiSpeechListening(false);

        const code = event?.error || 'unknown';
        const message = event?.message || '';
        const friendly =
          code === 'not-allowed'
            ? 'Microphone or speech recognition permission was not granted.'
            : code === 'no-speech'
              ? 'No speech detected. Try again and speak clearly.'
              : code === 'busy'
                ? 'Voice input is already active. Please wait a moment and try again.'
                : code === 'audio-capture'
                  ? 'The microphone was not available. Close other recording apps and try again.'
                  : 'Voice input could not start. You can still type your prompt.';

        setAiSpeechError(friendly);
        setAiSpeechStatus('');

        logUserEvent(
          'ai_agenda_voice_error',
          { code: String(code).slice(0, 80), message: String(message).slice(0, 160) },
          screen || 'prestart'
        );
      }),
    ];
  };

  const stopAiPromptVoiceInput = async () => {
    try {
      const speechModule = aiSpeechModuleRef.current;
      if (!speechModule) return;
      speechModule.stop();
    } catch (e) {
      console.warn('[AI Agenda Voice] stop failed:', e?.message || e);
    }
  };

  const startAiPromptVoiceInput = async () => {
    if (aiAgendaBusy) return;

    // iOS production builds crash when expo-speech-recognition starts the native
    // recognizer on some devices/builds. For iOS, ship the safe system-dictation
    // path instead: focus the prompt field and let users tap the iOS keyboard mic.
    // This preserves voice-to-text without invoking the unstable native recognizer.
    if (Platform.OS === 'ios') {
      setAiSpeechListening(false);
      setAiSpeechError('');
      setAiSpeechStatus('Tap the iPhone keyboard microphone to dictate, then tap Done above the keyboard.');
      logUserEvent('ai_agenda_ios_keyboard_dictation_prompted', {}, screen || 'prestart');

      // Make sure the number-pad field is not the active responder before
      // focusing the prompt; otherwise iOS can leave the numeric keyboard up.
      aiDurationInputRef.current?.blur?.();
      Keyboard.dismiss();

      setTimeout(() => {
        setAiPromptFocused(true);
        setAiDurationFocused(false);
        aiPromptInputRef.current?.focus?.();
      }, 180);
      return;
    }

    try {
      setAiSpeechError('');
      setAiSpeechStatus('Preparing microphone…');

      const speechModule = await getAiSpeechModule();
      attachAiSpeechListeners(speechModule);

      const available = speechModule.isRecognitionAvailable();
      if (!available) {
        setAiSpeechStatus('');
        setAiSpeechError('Voice input is not available on this device. You can still type your prompt.');
        logUserEvent('ai_agenda_voice_unavailable', {}, screen || 'prestart');
        return;
      }

      const permissions = await speechModule.requestPermissionsAsync();
      if (!permissions?.granted) {
        setAiSpeechStatus('');
        setAiSpeechError('Microphone or speech recognition permission was not granted. You can still type your prompt.');
        logUserEvent('ai_agenda_voice_permission_denied', {}, screen || 'prestart');
        return;
      }

      // iOS can occasionally need a short beat immediately after first permission grant
      // before the audio session is ready for recognition.
      if (Platform.OS === 'ios') {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      const existingPrompt = String(aiPrompt || '').trim();
      aiSpeechBasePromptRef.current = existingPrompt ? `${existingPrompt} ` : '';

      logUserEvent('ai_agenda_voice_start_tapped', { promptLength: existingPrompt.length }, screen || 'prestart');

      speechModule.start({
        lang: 'en-US',
        interimResults: true,
        continuous: false,
        iosTaskHint: 'dictation',
      });
    } catch (e) {
      console.warn('[AI Agenda Voice] start failed:', e?.message || e);
      setAiSpeechListening(false);
      setAiSpeechStatus('');
      setAiSpeechError('Voice input could not start. You can still type your prompt.');
      logUserEvent(
        'ai_agenda_voice_start_failed',
        { message: String(e?.message || e).slice(0, 160) },
        screen || 'prestart'
      );
    }
  };

  const handleAiPromptVoicePress = async () => {
    if (aiSpeechListening) {
      logUserEvent('ai_agenda_voice_stop_tapped', {}, screen || 'prestart');
      await stopAiPromptVoiceInput();
      return;
    }

    await startAiPromptVoiceInput();
  };

  useEffect(() => {
    if (showAiAgendaModal) return;

    setAiPromptFocused(false);
    setAiDurationFocused(false);

    if (aiSpeechListening) {
      stopAiPromptVoiceInput();
    }

    detachAiSpeechListeners();
    setAiSpeechListening(false);
    setAiSpeechStatus('');
  }, [showAiAgendaModal, aiSpeechListening]);

  useEffect(() => {
    return () => {
      stopAiPromptVoiceInput();
      detachAiSpeechListeners();
    };
  }, []);

  useEffect(() => {
    const uid = auth.currentUser?.uid || userId || 'anonymous';
    let cancelled = false;

    (async () => {
      try {
        const key = getAiAgendaUsageStorageKey(uid);
        const raw = await AsyncStorage.getItem(key);
        const localCount = Math.max(0, parseInt(raw || '0', 10) || 0);

        let nextCount = localCount;

        if (!offlineMode && userId) {
          const snap = await getDoc(doc(db, 'users', userId));
          if (snap.exists()) {
            const remoteCount = Number(snap.data()?.aiAgendaGenerationsCount ?? 0);
            if (Number.isFinite(remoteCount) && remoteCount >= 0) {
              nextCount = Math.max(localCount, remoteCount);
              await AsyncStorage.setItem(key, String(nextCount));
            }
          }
        }

        if (!cancelled) setAiAgendaUsageCount(nextCount);
      } catch (e) {
        console.warn('[AI Agenda] failed to load usage count:', e?.message || e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId, offlineMode]);

  // ✅ Always start timer screen scrolled to top (prevents long agendas landing at bottom)
  useEffect(() => {
    if (screen !== 'timer') return;

    // Wait one frame so layout is ready, then jump to top without animation
    requestAnimationFrame(() => {
      mainScrollRef.current?.scrollTo({ y: 0, animated: false });
    });
  }, [screen]);

  // 💡 Measure widest header (meeting title vs item title) so toggle never shifts width
  useEffect(() => {
    if (screen !== 'timer') {
      setHeaderWidth(null);
      return;
    }

    const titleA = title || sessionId || 'Untitled Session';
    const titleB =
      agendaItems[currentIndex]?.title || title || sessionId || 'Untitled Session';

    // Helper to measure text width
    const measureTextWidth = (str) =>
      new Promise((resolve) => {
        const offscreen = (
          <Text
            style={{ fontSize: 28, fontWeight: 'bold', position: 'absolute', opacity: 0 }}
            onLayout={(e) => resolve(e.nativeEvent.layout.width)}
          >
            {str}
          </Text>
        );
      });

    setTimeout(async () => {
      try {
        const w1 = await measureTextWidth(titleA);
        const w2 = await measureTextWidth(titleB);
        setHeaderWidth(Math.max(w1, w2));
      } catch (e) {
        setHeaderWidth(null); // fallback
      }
    }, 0);
  }, [screen, currentIndex, agendaItems, title, sessionId]);

  // ⚙️ Settings: auto-advance vs. overtime (default OFF = overtime)
  const [autoAdvanceEnabled, setAutoAdvanceEnabled] = useState(false);

  // 🧢 Meeting cap: warn before facilitator extensions exceed the original planned agenda length
  const [respectPlannedMeetingLength, setRespectPlannedMeetingLength] = useState(false);
  const plannedMeetingDurationSecRef = useRef(0);

  // 🔔 Per-phase meeting notifications (Android helper still applies)
  const [yellowNotifEnabled, setYellowNotifEnabled] = useState(false);
  const [redNotifEnabled, setRedNotifEnabled] = useState(false);
  const [bgNotifHelperShown, setBgNotifHelperShown] = useState(false);

  // ⏱️ Overtime state (count-up after time hits zero)
  const [overtimeMode, setOvertimeMode] = useState(false);

  // 💡 Timer header toggle: meeting title ↔ current item title
  const [showMeetingTitle, setShowMeetingTitle] = useState(true);

  // 🔁 Flashing color driver for Overtime label/time
  const flashAnim = useRef(new Animated.Value(0)).current;

  // 🔁 Gentle pulse for Next/Finish CTA during overtime
  const nextPulseAnim = useRef(new Animated.Value(1)).current;
  const nextPulseLoopRef = useRef(null);

  // Map 0→1→2 to red → yellow → black
  const flashColor = flashAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#ffc107', '#000000'], // yellow → black
  });
  const [overtimeSec, setOvertimeSec] = useState(0);
  const [summaryPending, setSummaryPending] = useState(false);

  // Red background guard: treat "red" whenever timeLeft is at/under zero (overtime) or we already flagged overtime
  const isRedBackground = timeLeft <= 0 || overtimeMode;
  const showOvertimeEscalation = overtimeSec >= 60;

  useEffect(() => {
    const shouldPulseNext =
      screen === 'timer' &&
      !autoAdvanceEnabled &&
      !demoNoOvertime &&
      (timeLeft === 0 || overtimeMode);

    // Start pulsing
    if (shouldPulseNext) {
      if (!nextPulseLoopRef.current) {
        nextPulseLoopRef.current = Animated.loop(
          Animated.sequence([
            Animated.timing(nextPulseAnim, {
              toValue: 1.06,
              duration: 550,
              useNativeDriver: true,
            }),
            Animated.timing(nextPulseAnim, {
              toValue: 1.0,
              duration: 550,
              useNativeDriver: true,
            }),
          ])
        );
        nextPulseLoopRef.current.start();
      }
      return;
    }

    // Stop pulsing + reset
    if (nextPulseLoopRef.current) {
      nextPulseLoopRef.current.stop();
      nextPulseLoopRef.current = null;
    }
    nextPulseAnim.setValue(1);
  }, [screen, autoAdvanceEnabled, demoNoOvertime, timeLeft, overtimeMode, nextPulseAnim]);

  // Readable paused-line color: white on red (overtime), black otherwise
  const pausedLineColor = isRedBackground ? '#FFFFFF' : '#000000';

  // Ensure "Preparing summary…" only applies to the Summary screen
  useEffect(() => {
    if (screen !== 'summary' && summaryPending) {
      setSummaryPending(false);
    }
  }, [screen, summaryPending]);

  // Turn off spinner when summary content is available
  useEffect(() => {
    if (screen === 'summary') {
      // If summary array exists (even empty array is OK), clear the spinner.
      const hasSummaryArray = Array.isArray(summary);
      // If you later add a separate stats object, you can OR it in like: const hasStats = !!summaryStats;
      if (hasSummaryArray && summaryPending) {
        setSummaryPending(false);
      }
    }
  }, [screen, summary, summaryPending]);

  // % readouts for current item
  const curItem = agendaItems[currentIndex];
  const curDurSec = Math.max(1, Math.round((curItem?.duration ?? 0) * 60)); // guard divide-by-zero
  const percentRemaining = Math.max(
    0,
    Math.min(100, Math.round((timeLeft / curDurSec) * 100))
  );
  const percentOver = Math.max(0, Math.round((overtimeSec / curDurSec) * 100));

  // ✅ Prevent first-render overwrite of saved prefs
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  // Advanced editing on/off
  const [advancedThresholdsEnabled, setAdvancedThresholdsEnabled] = useState(false);
  // Threshold basis for advanced editing
  const [thresholdBasis, setThresholdBasis] = useState('percent'); // default: percent
  const [showRemaining, setShowRemaining] = useState(true); // default: show as remaining

  // 🎉 User setting: enable/disable confetti celebration
  const [confettiEnabled, setConfettiEnabled] = useState(false);

  // 🌟 First-launch Quick-Start coach mark
  const [showQuickStart, setShowQuickStart] = useState(false);
  const [quickStartHydrated, setQuickStartHydrated] = useState(false);
  const [quickStartDontShowAgain, setQuickStartDontShowAgain] = useState(false);

  // 📝 Info editor modal state (track by item.id instead of index)
  const [detailsModalItemId, setDetailsModalItemId] = useState(null); // string | null
  const [infoDraft, setInfoDraft] = useState('');
  const [presenterDraft, setPresenterDraft] = useState('');

  // Limits for Additional Information
  const INFO_MAX_CHARS = 150; // character cap
  const TITLE_MAX_CHARS = 50;
  const ITEM_TITLE_MAX_CHARS = AGENDA_ITEM_TITLE_MAX_CHARS; // keep AI + Setup in sync
  const INFO_MAX_LINES = 5; // newline/line cap
  const PRESENTER_MAX_CHARS = 24; // short label like “Ken R.” or “Facilitator”

  // 📅 Date helpers for title suggestions (ISO: YYYY-MM-DD)
  const DATE_SEPARATOR = ' ';

  const getTodayISO = () => {
    // Use device-local date parts (avoids UTC date shifts)
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  };

  const titleHasDate = (t) => {
    const s = String(t || '');
    // Detect ISO date and common US date formats to avoid double-append
    return /\b\d{4}-\d{2}-\d{2}\b/.test(s) || /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(s);
  };

  // When copying a saved favorite/template, use the undated base so
  // "Project Sync — 2026-05-29" becomes "Project Sync — 2026-05-30"
  // instead of carrying forward stacked dates.
  const stripTrailingAgendaDate = (rawTitle) => {
    const cleaned = String(rawTitle || '')
      .replace(/\s+/g, ' ')
      .replace(/\//g, '-')
      .trim();

    return cleaned
      .replace(/\s*(?:[-–—])?\s*(?:\d{4}-\d{2}-\d{2}|\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})\s*$/u, '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  // Saved favorites are keyed by Firestore session id, and the session id is
  // what gets copied into the new doc path. Prefer that session id as the
  // naming source, then fall back to the display title if needed.
  // The new agenda title should stay aligned with the new session id to avoid
  // a clean session id but an old/display title with the prior date.
  const getCopiedAgendaNameBase = (sourceSessionId, sourceTitle) => {
    return (
      stripTrailingAgendaDate(sourceSessionId) ||
      stripTrailingAgendaDate(sourceTitle) ||
      String(sourceSessionId || sourceTitle || 'New Agenda').replace(/\s+/g, ' ').trim() ||
      'New Agenda'
    );
  };

  const appendTodayToTitle = (t) => {
    const base = stripTrailingAgendaDate(t);
    if (!base) return base; // don't auto-fill date if title is empty
    if (titleHasDate(base)) return base;

    const suffix = `${DATE_SEPARATOR}${getTodayISO()}`;
    const maxBaseLen = Math.max(0, TITLE_MAX_CHARS - suffix.length);
    const trimmedBase =
      base.length > maxBaseLen ? base.slice(0, maxBaseLen).trimEnd() : base;

    return `${trimmedBase}${suffix}`;
  };

  // Dynamic font size helper for MEETING title (what you edit as the agenda/session title)
  const getMeetingTitleFontSize = (t) => {
    const len = (t ?? '').length;

    // Meeting title should feel "headline-y"
    if (isLandscape) {
      if (len <= 20) return 26;
      if (len <= 30) return 24;
      if (len <= 42) return 22;
      return 20;
    }

    if (len <= 18) return 22;
    if (len <= 26) return 20;
    if (len <= 36) return 18;
    if (len <= 48) return 16;
    return 14;
  };

  // Dynamic font size helper for CURRENT AGENDA ITEM title (timer header when showing item title)
  const getCurrentItemTitleFontSize = (t) => {
    const len = (t ?? '').length;

    // Agenda item title can be slightly smaller than meeting title
    if (isLandscape) {
      if (len <= 22) return 22;
      if (len <= 34) return 20;
      if (len <= 46) return 18;
      return 16;
    }

    if (len <= 20) return 18;
    if (len <= 32) return 16;
    if (len <= 44) return 14;
    return 12;
  };

  // Dynamic font size helper for AGENDA ROW titles (DraggableFlatList rows in setup)
  const getAgendaRowTitleFontSize = (t) => {
    // Rows should feel compact and scannable (not headline-sized)
    if (isLandscape) return 16;

    const len = (t ?? '').length;

    if (len <= 20) return 12;
    if (len <= 28) return 10;
    return 9;
  };

  // Dynamic font size helper for session titles (e independent (agenda it') Launch tiles)
  const getSessionTitleFontSize = (t) => {
    const len = (t ?? '').length;
    if (len <= 10) return 12;
    if (len <= 16) return 11;
    if (len <= 22) return 10;
    return 9;
  };

  // Sanitize helper: enforce char + line limits
  const sanitizeInfo = (text) => {
    let t = text ?? '';
    if (t.length > INFO_MAX_CHARS) t = t.slice(0, INFO_MAX_CHARS);
    const lines = t.split(/\r?\n/);
    if (lines.length > INFO_MAX_LINES) {
      t = lines.slice(0, INFO_MAX_LINES).join('\n');
    }
    return t;
  };

  // Save / close handlers for the Info + Presenter modal
  const handleCloseInfoModal = () => {
    setDetailsModalItemId(null);
    setInfoDraft('');
    setPresenterDraft('');
  };

  const handleSaveInfoModal = () => {
    if (detailsModalItemId === null || detailsModalItemId === undefined) return;

    setAgendaItems((prev) => {
      // Case A: detailsModalItemId is a numeric index fallback (0, 1, 2…)
      if (typeof detailsModalItemId === 'number') {
        const idx = detailsModalItemId;
        if (idx < 0 || idx >= prev.length) return prev;

        const updated = [...prev];
        const it = updated[idx];
        updated[idx] = {
          ...it,
          info: sanitizeInfo(infoDraft || ''),
          presenterTag: (presenterDraft || '').trim().slice(0, PRESENTER_MAX_CHARS),
        };
        return updated;
      }

      // Case B: detailsModalItemId is a real item.id (string/uuid)
      return prev.map((it) =>
        it.id === detailsModalItemId
          ? {
              ...it,
              info: sanitizeInfo(infoDraft || ''),
              presenterTag: (presenterDraft || '').trim().slice(0, PRESENTER_MAX_CHARS),
            }
          : it
      );
    });

    setDetailsModalItemId(null);
    setInfoDraft('');
    setPresenterDraft('');
  };

  // 🌟 Dismiss handler for Quick-Start coach mark
  const handleCloseQuickStart = () => {
    setShowQuickStart(false);
  };

  const handleDismissQuickStartForever = async () => {
    setShowQuickStart(false);
    try {
      await AsyncStorage.setItem(QUICKSTART_STORAGE_KEY, 'true');
      setQuickStartDisabled(true);
    } catch (e) {
      console.warn('⚠️ Failed to persist quick-start flag', e);
    }
  };

  // ✅ Primary CTA handler for Quick-Start ("Continue")
  const openEmailSignIn = () => {
    setAuthScreenMode('login');     // existing user path
    setScreen('emailAuth');
  };

  const openUpgradeFlow = () => {
    // If they’re anonymous, this frames as “unlock real meetings” (keeps data)
    setAuthScreenMode(auth.currentUser?.isAnonymous ? 'upgrade' : 'login');
    setScreen('emailAuth');
  };
  const handleDismissQuickStart = async () => {
    setShowQuickStart(false);

    // If user checked "Don't show this again", persist the flag
    if (quickStartDontShowAgain) {
      try {
        await AsyncStorage.setItem(QUICKSTART_STORAGE_KEY, 'true');
        setQuickStartDisabled(true);
      } catch (e) {
        console.warn('⚠️ Failed to persist quick-start flag', e);
      }
    }

    // reset local checkbox state for next time the modal opens
    setQuickStartDontShowAgain(false);
  };

  // 🔁 Dev/User helper: reset Quick-Start so it shows again
  const handleResetQuickStart = async () => {
    try {
      await AsyncStorage.removeItem(QUICKSTART_STORAGE_KEY);
      setQuickStartDisabled(false);
    } catch (e) {
      console.warn('⚠️ Failed to reset quick-start flag', e);
    }

    // Ensure it shows immediately
    quickStartShownThisSessionRef.current = false;
    setShowQuickStart(true);

    // If you reset from Settings, jump back to prestart so the modal appears
    setScreen('prestart');
  };

  const devReset = async () => {
    try {
      await AsyncStorage.removeItem(FIRST_OPEN_AUTODEMO_KEY);
      await AsyncStorage.removeItem(QUICKSTART_STORAGE_KEY);
      await AsyncStorage.removeItem(SAMPLE_MEETING_FIRSTRUN_KEY);

      await AsyncStorage.removeItem('@yellowNotifEnabled');
      await AsyncStorage.removeItem('@redNotifEnabled');
      await AsyncStorage.removeItem('@bgNotifHelperShown');

      // optional but recommended for a truly clean DEV reset
      await AsyncStorage.removeItem('@userInfo');
      await AsyncStorage.removeItem('@recentSessionTitles');
    } catch (e) {
      console.warn('Dev reset failed', e);
    }

    // kill any pending timer/demo callbacks
    if (advanceTimeoutRef.current) {
      clearTimeout(advanceTimeoutRef.current);
      advanceTimeoutRef.current = null;
    }

    // reset splash/demo flags
    setHasSeenDemo(false);
    setShowQuickStart(false);
    setQuickStartDisabled(false);
    setQuickStartDontShowAgain(false);
    setAutoDemoBooting(false);
    setIsFirstRunSample(true);

    setYellowNotifEnabled(false);
    setRedNotifEnabled(false);
    setBgNotifHelperShown(false);

    setIsSampleDemoActive(false);
    setShowPostDemoCta(false);
    setDemoSpeed(1);

    // keep live auth bootstrap state intact during DEV reset
    // DEV reset should reset app/demo state, not pretend Firebase signed out
    const liveUid = auth.currentUser?.uid || '';
    if (liveUid) {
      setUserId(liveUid);
      setAuthReady(true);
      setProfileReady(true);
    }

    // reset session/ui state so splash starts clean
    setRunning(false);
    setSummary([]);
    lastSummaryRef.current = [];
    setCurrentIndex(0);
    setTimeLeft(60);
    setPausedDuration(0);
    setPausedTime(0);
    setItemStartTimestamp(null);
    setStartTimestamp(null);
    setEndTimestamp(null);
    setOvertimeMode(false);
    setOvertimeSec(0);

    setLocalSessionId('');
    setTitle('');
    setAgendaTitleDraft('');
    setAgendaItems([]);
    setOriginalAgenda([]);
    setResumeCandidate(null);
    setSessionWrittenToFirestore(false);

    // reset refs that can block re-bootstrap
    pendingAutoDemoStartRef.current = false;
    autoDemoRanRef.current = false;
    quickStartShownThisSessionRef.current = false;
    triedAnonRef.current = false;
    suppressAutoAnonRef.current = false;

    console.log('[DEV RESET] state cleared, returning to splash', {
      authReady: false,
      profileReady: false,
      triedAnonReset: true,
      pendingAutoDemo: pendingAutoDemoStartRef.current,
    });

    // go back to splash
    splashStartRef.current = Date.now();
    setScreen('splash');
  };



  // 🧭 Timer panel toggle ('qr' | 'info')
  const [timerPanel, setTimerPanel] = useState('info');

  // 🎛️ Facilitator remote / protected meeting controls
  const [showMeetingControlsModal, setShowMeetingControlsModal] = useState(false);
  const [remoteControlBusy, setRemoteControlBusy] = useState(false);

  // When the current item changes, default to Info if present, otherwise QR
  useEffect(() => {
    const info = agendaItems[currentIndex]?.info;
    const hasInfo = typeof info === 'string' && info.trim().length > 0;
    setTimerPanel(hasInfo ? 'info' : 'qr');
  }, [currentIndex, agendaItems]);

  // 🔁 Every ~5s, toggle header between meeting title and current item (Timer screen only)
  useEffect(() => {
    // Reset to meeting title whenever we leave Timer
    if (screen !== 'timer') {
      setShowMeetingTitle(true);
      return;
    }

    // Don't bother toggling if we don't have a current item
    if (!agendaItems[currentIndex]) {
      setShowMeetingTitle(true);
      return;
    }

    const id = setInterval(() => {
      setShowMeetingTitle((prev) => !prev);
    }, 5000); // ~5 seconds

    return () => clearInterval(id);
  }, [screen, currentIndex, agendaItems]);

  // 🧩 Template sources (brand accounts → Firebase user IDs)
  const TEMPLATE_ACCOUNTS = {
    professionals: { label: 'Work Meetings', userId: 'UHP1m1NBwqTZRzGwGt7Dt2MZFJb2' },
    agile: { label: 'Agile / Scrum', userId: 'VxaFUOSwGQUocVnojsJURXonzK32' },

    /*
    coaches: { label: 'Coaches', userId: 'g8ioGyvvZBdEFqajaeVTnBqlkr93' },
    teachers: { label: 'Teachers', userId: 'pYDabkCh1JQYJTtcvWeccGkca3r1' },
    extras: { label: 'Extras', userId: 'qko4gcgpXnfAlH8OWblPL355oEO2' },
    */
  };

  // 🧩 Template picker state
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [templateCategory, setTemplateCategory] = useState(null); // 'professionals' | 'agile'
  const [templateLoading, setTemplateLoading] = useState(false);
  const [templateSessions, setTemplateSessions] = useState([]); // array of { id, title? }
  const [selectedTemplateSessionId, setSelectedTemplateSessionId] = useState(null);
  const [recentTitles, setRecentTitles] = useState([]);

  // Where to return after selecting a template
  // 'prestart' (existing behavior) | 'setup' (new: load into current agenda)
  const [templateReturnScreen, setTemplateReturnScreen] = useState('prestart');

  useEffect(() => {
    if (screen !== 'templates') return;

    let cancelled = false;

    (async () => {
      try {
        // Ensure the template UI is visible on the Templates screen
        setShowTemplatePicker(true);

        const saved = await AsyncStorage.getItem(TEMPLATE_CATEGORY_STORAGE_KEY);

        // Default to Work Meetings unless a valid saved key exists
        const preferred =
          saved && TEMPLATE_ACCOUNTS[saved] ? saved : 'professionals';

        // Avoid reloading if already selected
        if (!cancelled && templateCategory !== preferred) {
          await loadTemplatesForCategory(preferred);
        }
      } catch (e) {
        console.warn('Template category boot failed', e);
        if (!cancelled) {
          await loadTemplatesForCategory('professionals');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  // only run when entering Templates
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen]);

  // 🧩 Copy-from-existing (My Agendas → new agenda)
  const [copySourceId, setCopySourceId] = useState(null); // when set, primary CTA will "Copy agenda → Setup"

  // ✅ Refs to avoid “first tap” state timing issues
  const copySourceIdRef = useRef(null);
  const localSessionIdRef = useRef('');

  // Keep refs in sync with state
  useEffect(() => {
    copySourceIdRef.current = copySourceId;
  }, [copySourceId]);

  useEffect(() => {
    localSessionIdRef.current = localSessionId;
  }, [localSessionId]);

  const validateSessionTitle = (t) => {
    const clean = (t || '').replace(/\s+/g, ' ').trim();
    return clean.length >= 3 && !clean.includes('/');
  };

  // CTA derivations for prestart screen
  const hasTemplate = !!templateCategory && !!selectedTemplateSessionId;
  const hasCopySource = !!copySourceId;
  const hasValidTitle = validateSessionTitle(localSessionId);

  const primaryCtaLabel = hasTemplate
    ? hasValidTitle
      ? 'Create from Template'
      : 'Name Your Agenda to Create'
    : hasCopySource
      ? hasValidTitle
        ? 'Create Copy'
        : 'Name Your Copy to Create'
      : 'Start a Brand New Agenda';

  const primaryDisabled = (hasTemplate || hasCopySource) && !hasValidTitle;

  const handleTitleChange = (text) => {
    if (titleNeedsAttention) setTitleNeedsAttention(false);

    // Hard cap first so the UI never grows beyond TITLE_MAX_CHARS
    let t = (text ?? '').slice(0, TITLE_MAX_CHARS);

    // Block "/" (typing or paste)
    if (t.includes('/')) {
      // Remove any slashes that came in via paste
      t = t.replace(/\//g, '');

      Alert.alert('Invalid Character', 'The agenda title cannot contain "/".');
    }

    // Normalize spaces, keep leading trim behavior (matches your current intent)
    setLocalSessionId(t.replace(/\s+/g, ' ').trimStart());
  };

  const rememberRecentTitle = async (sessionId) => {
    try {
      const clean = (sessionId || '').replace(/\s+/g, ' ').trim();
      // ✅ Never store the Sample Meeting in Recents
      if (clean === SAMPLE_MEETING_SESSION_ID || clean === SAMPLE_MEETING_TITLE) return;
      if (!validateSessionTitle(clean)) return;

      const raw = await AsyncStorage.getItem('@recentSessionTitles');
      const arr = raw ? JSON.parse(raw) : [];
      const safeArr = Array.isArray(arr) ? arr : [];

      const next = [clean, ...safeArr.filter((x) => x !== clean)].slice(0, 3);
      await AsyncStorage.setItem('@recentSessionTitles', JSON.stringify(next));
      setRecentTitles(next);
    } catch (e) {
      console.warn('[Recents] rememberRecentTitle failed', e);
    }
  };

  const loadRecentTitles = async () => {
    try {
      const raw = await AsyncStorage.getItem('@recentSessionTitles');
      const arr = raw ? JSON.parse(raw) : [];
      setRecentTitles(Array.isArray(arr) ? arr : []);
    } catch {
      setRecentTitles([]);
    }
  };

  const removeRecentTitle = async (title) => {
    try {
      const raw = await AsyncStorage.getItem('@recentSessionTitles');
      const arr = raw ? JSON.parse(raw) : [];
      const next = arr.filter((t) => t !== title);
      await AsyncStorage.setItem('@recentSessionTitles', JSON.stringify(next));
      setRecentTitles(next);
    } catch {}
  };

  const clearRecentTitles = async () => {
    try {
      await AsyncStorage.removeItem('@recentSessionTitles');
    } finally {
      setRecentTitles([]);
    }
  };

  // 📡 Firestore Sync on Agenda Change
  useEffect(() => {
    if (screen === 'setup') {
      console.log('🧪 Sync Firestore called with:', { userId, sessionId });
      syncAgendaPreviewToFirestore();
    }
  }, [agendaItems, screen]);

  useEffect(() => {
    if (screen !== 'prestart' && screen !== 'myagendas') return;
    if (autoDemoBooting) return;
    if (!userId) return;
    if (!authReady || !profileReady) return;

    const fetchSessions = async () => {
      if (!authReady || !profileReady) return;
      const liveUid = auth.currentUser?.uid;
      if (!liveUid) {
        console.warn('No live uid yet');
        return;
      }
      if (userId !== liveUid) setUserId(liveUid); // keep state in sync

      const tryFetch = async () => {
        // Make extra-sure the parent doc exists under the LIVE uid
        await ensureUserDoc(liveUid, {
          provider: auth.currentUser?.providerData?.[0]?.providerId || 'unknown',
          email: auth.currentUser?.email ?? undefined,
          displayName: auth.currentUser?.displayName ?? undefined,
        });
        const sessionsRef = collection(db, 'users', liveUid, 'sessions');
        const snapshot = await getDocs(sessionsRef);
        const sessions = snapshot.docs
          .map((d) => {
            const data = d.data() || {};

            const isCompletedMeeting =
              !!data?.summaryStats?.meetingComplete ||
              data?.status === 'Complete';

            return {
              id: d.id,
              title: (data.title || '').trim() || d.id,
              isSampleDemo: !!data.isSampleDemo,
              isCompletedMeeting,
            };
          })
          // ✅ hide Sample Meeting + any session flagged as sample demo
          .filter(
            (s) =>
              !s.isSampleDemo &&
              s.id !== SAMPLE_MEETING_SESSION_ID &&
              s.id !== DEFAULT_SESSION_ID // ✅ never show placeholder
          );

        setExistingSessions(sessions);
      };

      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          await tryFetch();
          return; // ✅ success
        } catch (err) {
          const msg = err?.message || String(err);
          console.warn(`⚠️ Error fetching sessions (attempt ${attempt}): ${msg}`);
          if (!msg.includes('Missing or insufficient permissions')) throw err;
          await new Promise((r) => setTimeout(r, 200 * attempt)); // tiny backoff
        }
      }
      console.warn('❌ Gave up fetching sessions after retries.');
    };

    const loadRecents = async () => {
      try {
        const raw = await AsyncStorage.getItem('@recentSessionTitles');
        const arr = raw ? JSON.parse(raw) : [];
        const safeArr = Array.isArray(arr) ? arr : [];

        // ✅ Remove Sample Meeting if it ever got saved previously
        const next = safeArr.filter(
          (t) => t !== SAMPLE_MEETING_SESSION_ID && t !== SAMPLE_MEETING_TITLE
        );

        if (next.length !== safeArr.length) {
          await AsyncStorage.setItem('@recentSessionTitles', JSON.stringify(next));
        }

        setRecentTitles(next);
      } catch {}
    };

    fetchSessions();
    loadRecents();
  }, [screen, userId, authReady, profileReady]);

  // Auto-demo now starts directly from the splash gate.
  // Old queued follow-up effect removed because DEV RESET could queue
  // successfully but never re-enter this effect reliably.

  useEffect(() => {
    if (screen !== 'splash') return;
    if (!autoDemoBooting) return;

    const watchdog = setTimeout(() => {
      console.warn('[AutoDemo watchdog] forcing splash fallback', {
        pending: pendingAutoDemoStartRef.current,
        authUid: auth.currentUser?.uid || null,
        userId,
        authReady,
        profileReady,
        t: Date.now(),
      });

      pendingAutoDemoStartRef.current = false;
      setAutoDemoBooting(false);
      setScreen('prestart');
    }, 4000);

    return () => clearTimeout(watchdog);
  }, [screen, autoDemoBooting, userId, authReady, profileReady]);

  // 🔔 Notification permissions + Android channel
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Notifications.requestPermissionsAsync();
        if (status !== 'granted') {
          console.warn('🔕 Notification permissions not granted');
          return;
        }

        // Android requires a channel for predictable delivery
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('timer', {
            name: 'Timer Alerts',
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
            bypassDnd: false,
            sound: null, // ✅ force silent notification channel
          });
        }
      } catch (e) {
        console.warn('⚠️ Notifications init failed:', e?.message || e);
      }
    })();
  }, []);
  
  // ✨ Prestart delight (one-shot): stagger Quick Start tiles in
  const quickStartEnter = useRef(
    Array.from({ length: 5 }).map(() => new Animated.Value(0))
  ).current;

  // Prevent re-running the entrance animation repeatedly while staying on prestart
  const quickStartEnterRanRef = useRef(false);

  useEffect(() => {
    if (screen !== 'prestart') {
      // reset when leaving so it can play again next time we come back
      quickStartEnterRanRef.current = false;
      quickStartEnter.forEach((v) => v.setValue(0));
      return;
    }

    // Don’t animate while your auto-demo “Launching…” flow is booting
    if (autoDemoBooting) return;

    // Only run once per visit to prestart
    if (quickStartEnterRanRef.current) return;
    quickStartEnterRanRef.current = true;

    // Ensure all tiles start hidden before staggering in
    quickStartEnter.forEach((v) => v.setValue(0));

    const anims = quickStartEnter.map((v) =>
      Animated.timing(v, {
        toValue: 1,
        duration: 480,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true, // ✅ opacity + transform only
      })
    );

    Animated.stagger(110, anims).start();
  }, [screen, autoDemoBooting, quickStartEnter]);

  // 🔎 Look for a resumable session (last-used) when entering prestart
  useEffect(() => {
    if (screen !== 'prestart' || autoDemoBooting || offlineMode || !userId || !authReady || !profileReady)
      return;

    (async () => {
      try {
        const saved = await AsyncStorage.getItem('@userInfo');
        const sid = saved ? JSON.parse(saved)?.sessionId : null;
        if (!sid) return;

        const ref = doc(db, 'users', auth.currentUser?.uid || userId, 'sessions', sid);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          try { await AsyncStorage.removeItem('@userInfo'); } catch {}
          setResumeCandidate(null);
          setLocalSessionId('');
          setTitle('');
          setAgendaTitleDraft('');
          return;
        }
        const d = snap.data() || {};
        const meetingComplete = !!(d.summaryStats && d.summaryStats.meetingComplete);
        const resumable =
          d.canResume &&
          (d.status === 'Running' || d.status === 'Paused') &&
          !meetingComplete;

          // 🧹 If the last-used session is complete (or otherwise not resumable),
          // clear the "New Agenda Title" draft so prestart is clean no matter how we got here.
          if (!resumable) {
            try { await AsyncStorage.removeItem('@userInfo'); } catch {}

            setResumeCandidate(null);

            // Clear the title field(s) that drive the prestart input
            setLocalSessionId('');
            setTitle('');
            setAgendaTitleDraft('');

            // Optional: also clear any template/copy selections so Home truly resets
            setCopySourceId(null);
            setSelectedTemplateSessionId(null);

            return;
          }

        if (resumable) {
          setResumeCandidate({ id: sid, data: d });
        } else {
          setResumeCandidate(null);
        }
      } catch (e) {
        console.warn('Resume check failed:', e?.message || e);
      }
    })();
  }, [screen, offlineMode, userId, authReady, profileReady]);

  useEffect(() => {
    if ((screen === 'prestart' || screen === 'myagendas') && !autoDemoBooting) {
      loadRecentTitles();
    }
  }, [screen, autoDemoBooting]);

  useEffect(() => {
    if (screen !== 'prestart') return;
    if (autoDemoBooting) return;

    (async () => {
      try {
        const raw = await AsyncStorage.getItem(QUICK_LAUNCH_FAVORITES_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);

          const cleaned =
            Array.isArray(parsed)
              ? parsed
                  .filter((t) => typeof t === 'string' && t.trim().length >= 3)
                  .filter((t) => !DEFAULT_QUICK_LAUNCH.includes(t)) // remove old default-row carryover
                  .slice(0, 5)
              : [];

          setQuickLaunchFavorites(cleaned);

          await AsyncStorage.setItem(
            QUICK_LAUNCH_FAVORITES_KEY,
            JSON.stringify(cleaned)
          );
          return;
        }

        setQuickLaunchFavorites([]);
      } catch (e) {
        console.warn('⚠️ Failed to load quick launch favorites:', e);
        setQuickLaunchFavorites([]);
      }
    })();
  }, [screen, autoDemoBooting]);

  useEffect(() => {
    const validIds = new Set(
      (Array.isArray(existingSessions) ? existingSessions : []).map((s) => s?.id ?? s)
    );

    setQuickLaunchFavorites((prev) => {
      const current = Array.isArray(prev) ? prev : [];

      const next = current
        .filter((t) => typeof t === 'string' && t.trim().length >= 3)
        .filter((t) => validIds.has(t))
        .slice(0, 5);

      if (next.length !== current.length) {
        AsyncStorage.setItem(
          QUICK_LAUNCH_FAVORITES_KEY,
          JSON.stringify(next)
        ).catch((e) =>
          console.warn('⚠️ Failed to prune quick launch favorites:', e)
        );
      }

      return next;
    });
  }, [existingSessions]);

  // ✅ Show Quick Start only once per app session (unless user explicitly resets it)
  const quickStartShownThisSessionRef = useRef(false);

  useEffect(() => {
    // Only care when we’ve actually landed on the pre-start screen
    if (screen !== 'prestart') return;
    if (autoDemoBooting) return;

    (async () => {
      try {
        // In dev, you can force this to always show while testing
        if (__DEV__ && FORCE_QUICKSTART_TIP) {
          quickStartShownThisSessionRef.current = true;
          setShowQuickStart(true);
          return;
        }

        // ✅ Prevent the quick-start from flashing on first open (auto-demo runs instead)
        const alreadyAutoRan = await AsyncStorage.getItem(FIRST_OPEN_AUTODEMO_KEY);

        // ✅ Always sync the UI state from storage
        setHasSeenDemo(!!alreadyAutoRan);

        // ✅ Prevent the quick-start from flashing on true first open (auto-demo runs instead)
        if (!alreadyAutoRan) {
          setShowQuickStart(false);
          return;
        }

        const seen = await AsyncStorage.getItem(QUICKSTART_STORAGE_KEY);

        // ✅ keep Settings button + state in sync with storage
        setQuickStartDisabled(!!seen);

        if (!seen) {
          // ✅ Don’t pop this every time the user returns to prestart (e.g., bottom-nav Home)
          if (quickStartShownThisSessionRef.current) {
            setShowQuickStart(false);
            return;
          }

          quickStartShownThisSessionRef.current = true;
          setQuickStartDontShowAgain(false);
          setShowQuickStart(true);
        }

      } catch (e) {
        console.warn('⚠️ Failed to load quick-start flag', e);
        // Fail-open: still show the tip so new users get guidance
        setShowQuickStart(true);
      }
    })();
  }, [screen]);

  // 🚀 First-run Sample Meeting button emphasis on prestart
  useEffect(() => {
    if (screen !== 'prestart') return;
    if (autoDemoBooting) return;

    (async () => {
      try {
        const seen = await AsyncStorage.getItem(SAMPLE_MEETING_FIRSTRUN_KEY);
        setIsFirstRunSample(!seen);
      } catch (e) {
        // fail-open: treat as first-run so the sample is visible
        setIsFirstRunSample(true);
      }
    })();
  }, [screen]);

  const [autoDemoBooting, setAutoDemoBooting] = useState(false);

  // 🎬 First-open: auto-run the Sample Meeting so new users FEEL the value fast.
  // Runs once per install, and will not interrupt a resumable meeting.
  const autoDemoRanRef = useRef(false);
  
  // ✅ Queue auto-demo start until auth is ready
  const pendingAutoDemoStartRef = useRef(false);

  // 📢 Ads and Animation
  const interstitialLoaded = useRef(false);
  const rewardedLoaded = useRef(false);
  const [adsReady, setAdsReady] = useState(false); // <-- NEW: flip true once we create ad instances

  // ✅ put initAds INSIDE the component (after the refs above)
  const initAds = React.useCallback(async (email) => {
    // 🔄 Reset state so user switches get fresh instances + listeners
    setAdsReady(false);
    interstitialLoaded.current = false;
    rewardedLoaded.current = false;
    isLoadingInterstitial.current = false;
    isLoadingRewarded.current = false;
    interstitialBackoffMs.current = 0;
    rewardedBackoffMs.current = 0;

    // Configure test/prod mode based on this user
    await configureAdsForUser(email);

    // Create fresh ad instances for this identity
    interstitialRef.current = InterstitialAd.createForAdRequest(
      getAdUnit('INTERSTITIAL'),
      { requestNonPersonalizedAdsOnly: true }
    );

    rewardedRef.current = RewardedAd.createForAdRequest(getAdUnit('REWARDED'), {
      requestNonPersonalizedAdsOnly: true,
    });

    // This flip triggers the useEffect that wires listeners + warm loads
    setAdsReady(true);
    console.log('[Ads] Units:', getAdUnit('INTERSTITIAL'), getAdUnit('REWARDED'));
  }, []);

  // Guard flags + simple backoff
  const isLoadingInterstitial = useRef(false);
  const isLoadingRewarded = useRef(false);
  const interstitialBackoffMs = useRef(0);
  const rewardedBackoffMs = useRef(0);

  const nextBackoff = (ref) => {
    // start 15s, double, cap 120s
    ref.current = Math.min(ref.current ? ref.current * 2 : 15000, 120000);
    return ref.current;
  };
  const resetBackoff = (ref) => {
    ref.current = 0;
  };

  const loadInterstitial = () => {
    // ❌ Don't load interstitials for Pro users
    if (isProUser || isNoAdsMode || suppressFullscreenAds || !adsUnlockedByUsage) return;

    if (
      !interstitialRef.current ||
      isLoadingInterstitial.current ||
      interstitialLoaded.current
    )
      return;
    isLoadingInterstitial.current = true;
    interstitialRef.current.load();
  };

  const loadRewarded = () => {
    // ❌ Don't load rewarded ads for Pro users
    if (isProUser || isNoAdsMode || suppressFullscreenAds || !adsUnlockedByUsage) return;

    if (!rewardedRef.current || isLoadingRewarded.current || rewardedLoaded.current)
      return;
    isLoadingRewarded.current = true;
    rewardedRef.current.load();
  };

  // 🎬 Helper: show network interstitial or fall back to house interstitial modal
  const showInterstitialOrHouse = () => {
    if (!showInterstitials || isProUser || isNoAdsMode || suppressFullscreenAds || !adsUnlockedByUsage) return;

    // 🧪 Force your own interstitial for testing
    if (FORCE_HOUSE_INTERSTITIAL) {
      console.log('[ads] FORCE_HOUSE_INTERSTITIAL enabled → showing house interstitial.');
      setShowHouseInterstitial(true);
      return;
    }

    if (interstitialLoaded.current && interstitialRef.current) {
      const toShow = interstitialRef.current;
      interstitialLoaded.current = false;
      setTimeout(() => {
        try {
          toShow?.show();
        } catch (e) {
          console.warn(
            '[ads] Interstitial show() failed, falling back to house interstitial:',
            e
          );
          loadInterstitial(); // ✅ try again for next time
          setShowHouseInterstitial(true);
        }
      }, 150);
    } else {
      console.log('[ads] Interstitial not loaded → showing house interstitial.');
      loadInterstitial(); // ✅ start loading for the next opportunity
      setShowHouseInterstitial(true);
    }
  };

  const closeHouseInterstitial = () => {
    setShowHouseInterstitial(false);

    // ✅ Mirror AdEventType.CLOSED behavior for "Setup → Start"
    if (pendingAction.current === 'startTimer') {
      pendingAction.current = null;
      setDeferredStartFromSetup(true);
    }
  };

  // ✅ Setup → Start: shared “start meeting” logic (so we can call it after ads close)
  const startTimerFromSetup = async () => {
    const now = Date.now();

    const plannedMeetingDurationSec = Math.max(
      0,
      Math.round(
        (Array.isArray(agendaItems) ? agendaItems : []).reduce(
          (sum, item) => sum + Number(item?.duration || 0) * 60,
          0
        )
      )
    );
    plannedMeetingDurationSecRef.current = plannedMeetingDurationSec;

    meetingCompletionCountedRef.current = false;
    setShowThreeMeetingCongrats(false);
    setShowFiveMeetingProOffer(false);

    // ✅ If this is NOT the Sample Meeting, always force normal speed
    if (!isSampleMeeting) {
      setDemoSpeed(1);
      setIsSampleDemoActive(false);
    }
    // else: keep demoSpeed + demo flags as-is for the demo

    // Resolve the latest title synchronously so a fast Start tap
    // still uses the current TextInput value before blur/setState settles
    const draftCandidate = isEditingAgendaTitle ? agendaTitleDraft : title;
    const resolvedTitle = normalizeAgendaTitle(draftCandidate) || sessionId;

    // Keep UI state aligned immediately
    setTitle(resolvedTitle);
    setAgendaTitleDraft(resolvedTitle);
    setIsEditingAgendaTitle(false);

    // ✅ Write initial session doc (if online)
    if (!offlineMode && sessionDocRef) {
      try {
        await setDoc(
          sessionDocRef,
          {
            title: resolvedTitle,
            agenda: agendaItems,
            currentItem: agendaItems[0]?.title || 'Intro',
            currentIndex: 0,
            elapsed: 0,
            status: 'Running',
            startTimestamp: now,
            meetingStartAt: serverTimestamp(),
            meetingStartAtMs: Date.now(),
            lastUpdate: new Date().toISOString(),
            lastHeartbeat: serverTimestamp(),
            itemStartAt: serverTimestamp(),
            itemStartAtMs: Date.now(),
            canResume: true,
            pausedAccumMs: 0,
            durationSec: Math.round((agendaItems[0]?.duration || 0) * 60),
            summaryItems: [],
            summaryStats: {},
            published: true,
          },
          { merge: true }
        );

        setSessionWrittenToFirestore(true);
        console.log('✅ Initial session document created in Firestore');
      } catch (err) {
        console.error('❌ Firestore session creation failed:', err);
      }
    } else {
      console.log('🚫 Offline mode — session not yet written to Firestore');
      setSessionWrittenToFirestore(false);
    }

    // ✅ Start timer locally
    setSummary([]);
    lastSummaryRef.current = [];

    // IMPORTANT: setScreen('timer') should happen LAST,
    // so the user actually sees the “Go Pro” banner after the ad closes
    setCurrentIndex(0);
    setTimeLeft(agendaItems[0].duration * 60);
    setRunning(true);
    setYellowPlayed(false);
    yellowPlayedRef.current = false;
    redPlayedRef.current = false;
    scheduledYellowAtRef.current = null;
    scheduledRedAtRef.current = null;
    suppressYellowOnResumeRef.current = false;
    suppressRedOnResumeRef.current = false;
    setStartTimestamp(now);
    setEndTimestamp(null);
    setPausedTime(0);
    setItemStartTimestamp(now);
    setPausedDuration(0);
    pauseStartRef.current = null;
    setOvertimeMode(false);
    setOvertimeSec(0);

    setScreen('timer');

    trackMeetingStarted(
      {
        // Keep title in Firestore user events only if you want it there, but do
        // not send titles to Analytics/Google Ads conversion params.
        title: resolvedTitle,
        source: currentAgendaSource || 'unknown',
        itemCount: Array.isArray(agendaItems) ? agendaItems.length : 0,
        totalMinutes: Array.isArray(agendaItems)
          ? agendaItems.reduce((sum, it) => sum + Number(it?.duration || 0), 0)
          : 0,
        viewerPromptMode: shareLinkMode,
      },
      'timer'
    );

    if (currentAgendaSource === 'ai') {
      logUserEvent(
        'ai_agenda_started',
        {
          title: resolvedTitle,
          items: Array.isArray(agendaItems) ? agendaItems.length : 0,
          totalMinutes: Array.isArray(agendaItems)
            ? agendaItems.reduce((sum, it) => sum + Number(it?.duration || 0), 0)
            : 0,
        },
        'timer'
      );
    }

    // ✅ Arm the “Go Pro nudge” ONLY for Setup→Start path
    if (showBannerAds && !isProUser && !isNoAdsMode) {
      setProNudgeArmKey(Date.now());
    }
  };

  const startMeetingWithOptionalInterstitial = async () => {
    setStartingMeeting(true);

    if (shouldAllowFullscreenAds) {
      pendingAction.current = 'startTimer';
      showInterstitialOrHouse();
      return;
    }

    try {
      await startTimerFromSetup();
    } finally {
      setStartingMeeting(false);
    }
  };

  const showShareCheckpointBeforeStart = async () => {
    Keyboard.dismiss();

    const draft = (agendaTitleDraft ?? '').trim();
    const current = (title ?? '').trim();

    if (draft && draft !== current) {
      await commitAgendaTitle(draft);
    }

    setShareLinkMode('start');
    logUserEvent('viewer_share_checkpoint_shown', { source: currentAgendaSource || 'unknown' }, 'setup');
    setScreen('sharelink');
  };

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const interstitialRef = useRef(null);
  const rewardedRef = useRef(null);
  const shareQRRef = useRef(null);
  const pulseLoop = useRef(null);
  const splashStartRef = useRef(Date.now());

  const mainScrollRef = useRef(null); // 👈 controls the main scroll for timer/setup/summary/settings

  // Focus handle for the "New Agenda Title" input
  const titleInputRef = useRef(null);

  // ✨ Title attention (highlight + quick shake) when user taps CTA without a valid title
  const [titleNeedsAttention, setTitleNeedsAttention] = useState(false);
  const titleShakeAnim = useRef(new Animated.Value(0)).current;
  const titleAttentionTimeoutRef = useRef(null);

  const triggerTitleAttention = () => {
    setTitleNeedsAttention(true);

    // Focus the input so the user can fix it immediately
    requestAnimationFrame(() => {
      titleInputRef.current?.focus?.();
    });

    // Quick shake (subtle)
    titleShakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(titleShakeAnim, {
        toValue: 8,
        duration: 110,
        useNativeDriver: true,
      }),
      Animated.timing(titleShakeAnim, {
        toValue: -8,
        duration: 110,
        useNativeDriver: true,
      }),
      Animated.timing(titleShakeAnim, {
        toValue: 5,
        duration: 110,
        useNativeDriver: true,
      }),
      Animated.timing(titleShakeAnim, {
        toValue: -5,
        duration: 110,
        useNativeDriver: true,
      }),
      Animated.timing(titleShakeAnim, {
        toValue: 0,
        duration: 110,
        useNativeDriver: true,
      }),
    ]).start();

    // Auto-clear highlight after a moment
    if (titleAttentionTimeoutRef.current) {
      clearTimeout(titleAttentionTimeoutRef.current);
    }
    titleAttentionTimeoutRef.current = setTimeout(
      () => setTitleNeedsAttention(false),
      3800
    );
  };

  // 🚀 After selecting a template, jump Home and focus the New Agenda Title field
  const jumpHomeAndFocusTitle = () => {
    setScreen('prestart');

    // Let Pre-start mount first, then focus + glow/shake
    setTimeout(() => {
      triggerTitleAttention();
    }, 150);
  };

  const startPulseAnimation = () => {
    stopPulseAnimation();
    pulseAnim.setValue(1);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    pulseLoop.current = loop;
    loop.start();
  };

  const stopPulseAnimation = () => {
    if (pulseLoop.current) {
      pulseLoop.current.stop();
      pulseLoop.current = null;
    }
    pulseAnim.stopAnimation();
  };

  // 📥 Import CSV (non-Papa version)
  const importCSVAgenda = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: true,
      });

      if (result.type !== 'success') {
        console.log('📁 User cancelled import.');
        return;
      }

      if (!result.name.toLowerCase().endsWith('.csv')) {
        Alert.alert('Invalid File', 'Please select a file with a .csv extension.');
        return;
      }

      const contents = await FileSystem.readAsStringAsync(result.uri);
      const agendaItems = parseCSVToAgenda(contents);

      setAgendaItems(agendaItems);
      Alert.alert('Success', `Imported ${agendaItems.length} agenda item(s).`);
    } catch (err) {
      console.error('❌ Import Error:', err);
      alertSafe('Import Failed', err, 'Could not import that file. Please try again.');
    }
  };

  // 🔄 Push Final Summary to Firestore
  const pushFinalSummaryToFirestore = async () => {
    try {
      // 🚫 Never write a summary to the placeholder session
      if (!localSessionId || localSessionId === DEFAULT_SESSION_ID) {
        console.warn('⏳ Skipping final summary write: no real sessionId yet.');
        return;
      }
      const summaryData = Array.isArray(lastSummaryRef.current)
        ? lastSummaryRef.current
        : [];

      if (!summaryData.length) {
        console.warn('⏳ Skipping final summary write: no summary items yet.');
        return;
      }
      const plannedTimeSec = agendaItems.reduce(
        (acc, item) => acc + item.duration * 60,
        0
      );
      const actualTimeSec = summaryData.reduce(
        (acc, item) => acc + item.timeSpent + (item.pausedDuration || 0),
        0
      );

      const formattedStartTime = startTimestamp
        ? new Date(startTimestamp).toLocaleString()
        : 'Unknown';

      const stats = {
        meetingComplete: true,
        startedAt: formattedStartTime,
        plannedTime: formatMMSS(plannedTimeSec),
        actualTime: formatMMSS(actualTimeSec),
        timingRemark: getTimingRemark(actualTimeSec, plannedTimeSec),
      };
      if (offlineMode) return;

      // Build a fresh doc ref using LIVE uid + the real session id
      const liveUid = auth.currentUser?.uid;
      if (!liveUid) return;

      // Optional but safe: ensure profile doc exists even for anon
      await ensureUserDoc(liveUid, {
        provider: auth.currentUser?.providerData?.[0]?.providerId || 'unknown',
        email: auth.currentUser?.email ?? undefined,
        displayName: auth.currentUser?.displayName ?? undefined,
      });

      const summaryRef = doc(db, 'users', liveUid, 'sessions', localSessionId);

      // Use setDoc(merge) so it won't crash if the doc doesn't exist yet
      await setDoc(
        summaryRef,
        {
          summaryStats: stats,
          summaryItems: summaryData,
        },
        { merge: true }
      );

      console.log('📡 Firestore: stats + summaryItems pushed');
    } catch (err) {
      console.error('❌ Failed to push summary to Firestore', err);
    }
  };

  // 📡 Sync Agenda Preview Before Meeting Starts
  const syncAgendaPreviewToFirestore = async () => {
    if (offlineMode || !sessionDocRef) {
      console.warn('❌ Cannot push agenda: sessionDocRef is null');
      return;
    }

    // ✅ Allow anonymous too (Start already writes sessions for anonymous)
    const liveUid = auth.currentUser?.uid;
    if (!liveUid) {
      console.warn('⏳ Skipping preview sync: no authenticated user yet.');
      return;
    }

    // 🚫 No need to ensure a user profile doc just to publish a session preview.
    // (If you want profiles later, do that at sign-in / account-link time.)

    // Build a fresh doc ref using the LIVE UID to avoid any stale state
    const sessionsDoc = doc(db, 'users', liveUid, 'sessions', sessionId);

    try {
      await setDoc(
        sessionsDoc,
        {
          agenda: agendaItems,
          title: (title || '').trim() || sessionId,
          status: 'Ready',
          screen: 'setup',
          currentItem: agendaItems[0]?.title || '',
          currentIndex: 0,
          lastUpdate: new Date().toISOString(),
          summaryItems: [], // 🔥 clear prior results
          summaryStats: {}, // 🔥 clear prior results
          published: true, // ✅ publish for viewer access
        },
        { merge: true }
      );

      console.log('📡 Firestore updated with agenda preview (Ready)');
    } catch (err) {
      console.error('❌ Failed to push agenda preview to Firestore:', err);
    }
  };

  // ✅ Auto-save immediately when entering Share/Save screen
  useEffect(() => {
    if (screen !== 'sharelink') return;

    // No-op if offline or we don’t have a doc ref yet
    if (offlineMode || !sessionDocRef) return;

    // Fire-and-forget: publish/commit latest agenda/title so the viewer + link are always valid
    (async () => {
      try {
        setIsSavingAgenda?.(true);
        await syncAgendaPreviewToFirestore();
        setSaveBannerText?.('✅ Saved');        
      } catch (e) {
        console.warn('⚠️ Auto-save on sharelink failed:', e?.message || e);
        setSaveBannerText?.('Save failed');
      } finally {
        setIsSavingAgenda?.(false);
      }
    })();
  }, [screen, offlineMode, sessionDocRef, agendaItems, title]);

  const recoverFirestoreSync = async () => {
    if (!sessionDocRef || !agendaItems[currentIndex]) return;

    // Ensure profile doc and non-anonymous user exist before recovery writes
    if (!auth.currentUser || auth.currentUser.isAnonymous) {
      console.warn('⏳ Skipping recovery sync until non-anonymous user is ready.');
      return;
    }
    await ensureUserDoc(userId, {
      provider: auth.currentUser?.providerData?.[0]?.providerId || 'unknown',
      email: auth.currentUser?.email ?? undefined,
      displayName: auth.currentUser?.displayName ?? undefined,
    });

    try {
      // If session was never written, create it first
      if (!sessionWrittenToFirestore) {
        await setDoc(
          sessionDocRef,
          {
            title: (title || '').trim() || sessionId,
            agenda: agendaItems,
            currentItem: agendaItems[currentIndex]?.title || '',
            currentIndex,
            elapsed: 0,
            status: running ? 'Running' : 'Paused',
            startTimestamp: startTimestamp ?? Date.now(),
            lastUpdate: new Date().toISOString(),
            summaryItems: [],
            summaryStats: {},
            published: true,
          },
          { merge: true }
        );

        setSessionWrittenToFirestore(true);
        console.log('🆕 Firestore session created on reconnect');
      } else {
        // Already exists, just sync
        await updateDoc(
          sessionDocRef,
          {
            currentItem: agendaItems[currentIndex]?.title || '',
            currentIndex,
            elapsed: 0,
            status: running ? 'Running' : 'Paused',
            agenda: agendaItems,
            lastUpdate: new Date().toISOString(),
          },
          { merge: true }
        );

        console.log('🔄 Recovered Firestore sync after reconnect');
      }
    } catch (err) {
      console.error('❌ Firestore recovery failed:', err);
    }
  };

  // 🧩 Load session list from a template brand account
  const loadTemplatesForCategory = async (catKey) => {
    try {
      const cat = TEMPLATE_ACCOUNTS[catKey];
      if (!cat?.userId) {
        Alert.alert('Missing brand ID', 'This template category is not configured yet.');
        return;
      }

      // ✅ remember last selected template category (device-level)
      try {
        await AsyncStorage.setItem(TEMPLATE_CATEGORY_STORAGE_KEY, catKey);
      } catch (e) {
        console.warn('Failed to save template category', e);
      }

      setTemplateCategory(catKey);
      setTemplateLoading(true);
      setSelectedTemplateSessionId(null);
      setTemplateSessions([]);

      // ✅ you need this line; it's what your error is complaining about
      const sessionsRef = collection(db, 'users', cat.userId, 'sessions');

      // 🔎 only fetch published templates
      const q = query(
        sessionsRef,
        where('published', '==', true)
        // , orderBy("title") // optional once you add an index
      );

      const snap = await getDocs(q);

      let items = snap.docs.map((d) => {
        const data = d.data() || {};
        return {
          id: d.id,
          title: typeof data.title === 'string' && data.title.trim() ? data.title : d.id,
        };
      });

      // client-side sort (safe without Firestore index)
      items.sort((a, b) => a.title.localeCompare(b.title));

      setTemplateSessions(items);
    } catch (e) {
      console.warn('Template load failed:', e);
      Alert.alert('Error', 'Could not load templates for this category.');
    } finally {
      setTemplateLoading(false);
      setShowTemplatePicker(true);
    }
  };

  // 🧩 Build a unique template-based title for today
  const getNextAvailableTemplateTitle = async (rawTemplateTitle) => {
    const baseTemplateTitle = stripTrailingAgendaDate(rawTemplateTitle);

    const datedBase = appendTodayToTitle(baseTemplateTitle);

    // Offline: can't check Firestore, so just use the dated base
    if (!userId || offlineMode) {
      return datedBase;
    }

    // Try plain dated title first: "Template Name 2026-03-24"
    let candidate = datedBase;
    let docRef = doc(db, 'users', userId, 'sessions', candidate);
    let snap = await getDoc(docRef);

    if (!snap.exists()) {
      return candidate;
    }

    // Then try numbered copies: "(2)", "(3)", ...
    let n = 2;
    while (n < 100) {
      candidate = `${datedBase} (${n})`;
      docRef = doc(db, 'users', userId, 'sessions', candidate);
      snap = await getDoc(docRef);

      if (!snap.exists()) {
        return candidate;
      }

      n += 1;
    }

    // Fallback safety
    return `${datedBase} (${Date.now()})`;
  };

  // 🧩 Create a new session from a selected template
  const createSessionFromTemplate = async (cleanTitle) => {
    try {
      if (!userId) {
        Alert.alert('Not signed in', 'Please sign in first.');
        return;
      }
      if (!templateCategory || !selectedTemplateSessionId) {
        Alert.alert('Select a template', 'Pick a brand and a session template first.');
        return;
      }

      // Safety: double-check the passed-in title
      if (!validateSessionTitle(cleanTitle)) {
        Alert.alert(
          'Name your agenda',
          "Enter a valid New Agenda Title (3+ characters, no '/')."
        );
        return;
      }

      const cat = TEMPLATE_ACCOUNTS[templateCategory];
      const templateSessionRef = doc(
        db,
        'users',
        cat.userId,
        'sessions',
        selectedTemplateSessionId
      );
      const templateSnap = await getDoc(templateSessionRef);
      if (!templateSnap.exists()) {
        Alert.alert('Template not found', 'This template agenda no longer exists.');
        return;
      }
      const tData = templateSnap.data() || {};

      // Validate agenda from template
      const agendaFromTemplate = ensureAtLeastOneAgendaItem(
        Array.isArray(tData.agenda) ? tData.agenda : []
      );

      // 🔐 Write to the current user's sessions/{cleanTitle}
      const destRef = doc(db, 'users', userId, 'sessions', cleanTitle);
      await setDoc(
        destRef,
        {
          title: cleanTitle,
          agenda: agendaFromTemplate,
          currentItem: agendaFromTemplate[0]?.title || '',
          currentIndex: 0,
          elapsed: 0,
          status: 'Ready',
          lastUpdate: new Date().toISOString(),
          summaryItems: [],
          summaryStats: {},
          published: true,
        },
        { merge: true }
      );

      // Load into local UI and go to setup
      setAgendaItems(agendaFromTemplate);
      setOriginalAgenda(JSON.parse(JSON.stringify(agendaFromTemplate)));
      setTitle(cleanTitle);
      setCurrentAgendaSource('template_picker');
      logUserEvent('template_selected', { templateTitle: selectedTemplateSessionId, category: templateCategory, source: 'template_picker' }, 'prestart');
      trackAgendaCreated({ title: cleanTitle, source: 'template_picker', itemCount: agendaFromTemplate.length, totalMinutes: agendaFromTemplate.reduce((sum, it) => sum + Number(it?.duration || 0), 0) }, 'setup');
      setShowTemplatePicker(false);
      setScreen('setup');
      // ✅ Clear the chosen template so Home/Prestart is "clean" next time
      setSelectedTemplateSessionId(null);
      // optional (but safe): ensure future template picks return to normal flow
      setTemplateReturnScreen('prestart');
    } catch (e) {
      console.error('Create from template failed:', e);
      Alert.alert('Error', 'Failed to create agenda from template.');
    }
  };

  // 🧩 Load a selected template into the CURRENT agenda (Setup)
  const loadSelectedTemplateIntoCurrentAgenda = async (templateSessionIdOverride) => {
    try {
      if (!userId) {
        Alert.alert('Not signed in', 'Please sign in first.');
        return;
      }
      if (offlineMode) {
        Alert.alert('Offline', 'Connect to the internet to load templates.');
        return;
      }

      const pickedId = templateSessionIdOverride || selectedTemplateSessionId;
      if (!templateCategory || !pickedId) {
        Alert.alert('Select a template', 'Pick a category and a template first.');
        return;
      }

      const cat = TEMPLATE_ACCOUNTS[templateCategory];
      const templateSessionRef = doc(db, 'users', cat.userId, 'sessions', pickedId);
      const templateSnap = await getDoc(templateSessionRef);

      if (!templateSnap.exists()) {
        Alert.alert('Template not found', 'This template agenda no longer exists.');
        return;
      }

      const tData = templateSnap.data() || {};
      const agendaFromTemplate = ensureAtLeastOneAgendaItem(
        Array.isArray(tData.agenda) ? tData.agenda : []
      );

      // ✅ Load into UI
      setAgendaItems(agendaFromTemplate);
      setScreen('setup');

      // Optional: persist into the current session doc (keeps your title/session)
      const cleanTitle = (localSessionId || title || '').replace(/\s+/g, ' ').trim();
      if (validateSessionTitle(cleanTitle)) {
        const destRef = doc(db, 'users', userId, 'sessions', cleanTitle);
        await setDoc(
          destRef,
          {
            title: title || cleanTitle,
            agenda: agendaFromTemplate,
            currentItem: agendaFromTemplate[0]?.title || '',
            currentIndex: 0,
            elapsed: 0,
            status: 'Ready',
            lastUpdate: new Date().toISOString(),
            published: true,
          },
          { merge: true }
        );
      }
    } catch (e) {
      console.error('Load template into current agenda failed:', e);
      Alert.alert('Error', 'Failed to load agenda from template.');
    } finally {
      setTemplateReturnScreen('prestart'); // reset
      setSelectedTemplateSessionId(null);  // ✅ clear selected template
    }
  };

  const reopenCompletedMeetingSummary = async (cleanId, data) => {
    try {
      const agendaToUse = ensureAtLeastOneAgendaItem(
        Array.isArray(data.agenda) ? data.agenda : []
      );

      const summaryItems = Array.isArray(data.summaryItems) ? data.summaryItems : [];
      const stats = data.summaryStats || {};

      setShowSessionPicker(false);
      setShowTemplatePicker(false);
      setSelectedTemplateSessionId(null);
      setTemplateCategory(null);
      setCopySourceId(null);

      setLocalSessionId(cleanId);
      setAgendaItems(agendaToUse);
      setTitle(data.title || cleanId);

      // restore summary payload used by exportSummary()
      setSummary(summaryItems);
      lastSummaryRef.current = summaryItems;

      // restore timestamps if available
      setStartTimestamp(data.startTimestamp || null);
      setEndTimestamp(data.endTimestamp || null);

      // keep this as last-used so export can still work after navigation
      await AsyncStorage.setItem(
        '@userInfo',
        JSON.stringify({ userId, sessionId: cleanId })
      );
      await rememberRecentTitle(cleanId);

      setScreen('summary');
    } catch (e) {
      console.error('Reopen completed summary failed:', e);
      Alert.alert('Error', 'Could not reopen that meeting summary.');
    }
  };

  const overwriteCompletedMeetingAndStartFresh = async (cleanId, data) => {
    try {
      const agendaToUse = ensureAtLeastOneAgendaItem(
        Array.isArray(data.agenda) ? data.agenda : []
      );

      const docRef = doc(db, 'users', userId, 'sessions', cleanId);

      // clear old results but keep the agenda itself
      await setDoc(
        docRef,
        {
          title: data.title || cleanId,
          agenda: agendaToUse,
          currentItem: agendaToUse[0]?.title || '',
          currentIndex: 0,
          elapsed: 0,
          status: 'Ready',
          canResume: false,
          lastUpdate: new Date().toISOString(),
          summaryItems: [],
          summaryStats: {},
          endTimestamp: null,
          published: true,
        },
        { merge: true }
      );

      setLocalSessionId(cleanId);
      setAgendaItems(agendaToUse);
      setOriginalAgenda(JSON.parse(JSON.stringify(agendaToUse)));
      setTitle(data.title || cleanId);

      setSummary([]);
      lastSummaryRef.current = [];
      setCurrentIndex(0);
      setTimeLeft((agendaToUse[0]?.duration || 1) * 60);
      setRunning(false);
      setOvertimeMode(false);
      setOvertimeSec(0);
      setPausedDuration(0);
      setPausedTime(0);
      setStartTimestamp(null);
      setEndTimestamp(null);
      setItemStartTimestamp(null);
      meetingCompletionCountedRef.current = false;

      await AsyncStorage.setItem(
        '@userInfo',
        JSON.stringify({ userId, sessionId: cleanId })
      );
      await rememberRecentTitle(cleanId);

      setScreen('setup');
    } catch (e) {
      console.error('Overwrite completed agenda failed:', e);
      Alert.alert('Error', 'Could not reset that completed meeting.');
    }
  };

  // 🔓 Open an existing session by id (used by Recents + My Agendas quick open)
  const openExistingSessionById = async (sessionIdToOpen) => {
    try {
      if (!userId) {
        Alert.alert('Missing Info', 'Please sign in first.');
        return;
      }

      if (offlineMode) {
        Alert.alert('Offline', 'Connect to the internet to load saved agendas.');
        return;
      }

      const cleanId = (sessionIdToOpen || '').replace(/\s+/g, ' ').trim();
      if (!validateSessionTitle(cleanId)) {
        Alert.alert('Invalid agenda', 'That agenda title is not valid.');
        return;
      }

      // UI cleanup so we don't leave pickers in weird states
      setShowSessionPicker(false);
      setShowTemplatePicker(false);
      setSelectedTemplateSessionId(null);
      setTemplateCategory(null);
      setCopySourceId(null);

      const docRef = doc(db, 'users', userId, 'sessions', cleanId);
      const docSnap = await getDoc(docRef);

      if (!docSnap.exists()) {
        Alert.alert('Not found', `No saved agenda named “${cleanId}”.`);
        return;
      }

      const data = docSnap.data() || {};

      const isCompletedMeeting =
        !!data?.summaryStats?.meetingComplete ||
        data?.status === 'Complete';

      if (isCompletedMeeting) {
        Alert.alert(
          'Completed meeting',
          `“${data.title || cleanId}” is already complete. What would you like to do?`,
          [
            {
              text: 'Re-open Summary',
              onPress: () => {
                reopenCompletedMeetingSummary(cleanId, data);
              },
            },
            {
              text: 'Overwrite & Start New',
              style: 'destructive',
              onPress: () => {
                overwriteCompletedMeetingAndStartFresh(cleanId, data);
              },
            },
            {
              text: 'Cancel',
              style: 'cancel',
            },
          ]
        );
        return;
      }

      const agendaToUse = ensureAtLeastOneAgendaItem(
        Array.isArray(data.agenda) ? data.agenda : []
      );

      // existing behavior for non-complete agendas
      setLocalSessionId(cleanId);
      setAgendaItems(agendaToUse);
      setTitle(data.title || cleanId);
      setScreen('setup');

      await AsyncStorage.setItem(
        '@userInfo',
        JSON.stringify({ userId, sessionId: cleanId })
      );
      await rememberRecentTitle(cleanId);
    } catch (e) {
      console.error('Open existing (by id) failed:', e);
      Alert.alert('Error', 'Could not open that agenda.');
    }
  };

  // 🔓 Open an existing session directly (from inside the Template Picker)
  const openExistingSession = async () => {
    try {
      if (!userId) {
        Alert.alert('Not signed in', 'Please sign in first.');
        return;
      }

      const cleanTitle = (localSessionId || '').replace(/\s+/g, ' ').trim();
      if (!validateSessionTitle(cleanTitle)) {
        Alert.alert(
          'Enter a valid title',
          "Pick or type an existing agenda title (3+ chars, no '/')."
        );
        return;
      }

      const docRef = doc(db, 'users', userId, 'sessions', cleanTitle);
      const docSnap = await getDoc(docRef);

      if (!docSnap.exists()) {
        Alert.alert('Not found', `No saved agenda named “${cleanTitle}”.`);
        return;
      }

      const data = docSnap.data() || {};
      const isCompletedMeeting =
        !!data?.summaryStats?.meetingComplete ||
        data?.status === 'Complete';

      if (isCompletedMeeting) {
        Alert.alert(
          'Completed meeting',
          `“${data.title || cleanTitle}” is already complete. What would you like to do?`,
          [
            {
              text: 'Re-open Summary',
              onPress: () => {
                reopenCompletedMeetingSummary(cleanTitle, data);
              },
            },
            {
              text: 'Overwrite & Start New',
              style: 'destructive',
              onPress: () => {
                overwriteCompletedMeetingAndStartFresh(cleanTitle, data);
              },
            },
            {
              text: 'Cancel',
              style: 'cancel',
            },
          ]
        );
        return;
      }
      const agendaToUse = ensureAtLeastOneAgendaItem(
        Array.isArray(data.agenda) ? data.agenda : []
      );

      setAgendaItems(agendaToUse);
      setTitle(data.title || cleanTitle);
      setShowTemplatePicker(false);
      setScreen('setup');

      // 🧠 Remember this as recently used
      await AsyncStorage.setItem(
        '@userInfo',
        JSON.stringify({
          userId,
          sessionId: cleanTitle,
        })
      );
      await rememberRecentTitle(cleanTitle);
    } catch (e) {
      console.error('Open existing failed:', e);
      Alert.alert('Error', 'Could not open that agenda.');
    }
  };

  // ⚡ 1-tap open (quick launch).
  // - If it's a saved agenda id: load it, create a dated copy, open Setup pre-filled.
  // - If it's a starter template tile: use buildQuickLaunchAgenda (existing behavior).
  const openQuickLaunchAgenda = async (pickedKey) => {
    try {
      const baseKey = String(pickedKey || '').replace(/\s+/g, ' ').trim();

      // Starter template tiles (your DEFAULT_QUICK_LAUNCH items)
      const isStarter = DEFAULT_QUICK_LAUNCH.includes(baseKey);

      // If offline OR not signed in → local-only behavior
      if (offlineMode || !userId) {
        const localTitle = await makeUniqueDatedCopyTitle(baseKey || 'New Agenda');
        const sourceAgenda = buildQuickLaunchAgenda(baseKey, advancedThresholdsEnabled);
        setLocalSessionId(localTitle);
        setTitle(localTitle);
        setAgendaItems(sourceAgenda);
        setOriginalAgenda(JSON.parse(JSON.stringify(sourceAgenda)));
        setCurrentAgendaSource(isStarter ? 'starter_template' : 'quick_launch_local');
        logUserEvent(
          isStarter ? 'template_selected' : 'quick_launch_selected',
          { templateTitle: baseKey, source: isStarter ? 'starter_template' : 'quick_launch_local' },
          'prestart'
        );
        trackAgendaCreated(
          {
            title: localTitle,
            source: isStarter ? 'starter_template' : 'quick_launch_local',
            itemCount: sourceAgenda.length,
            totalMinutes: sourceAgenda.reduce((sum, it) => sum + Number(it?.duration || 0), 0),
          },
          'setup'
        );
        setScreen('setup');
        return;
      }

      // ✅ ONLINE + SIGNED IN
      // If this key is a saved session doc id, load it. Otherwise treat as starter.
      if (!isStarter) {
        const sourceRef = doc(db, 'users', userId, 'sessions', baseKey);
        const sourceSnap = await getDoc(sourceRef);

        if (sourceSnap.exists()) {
          const sData = sourceSnap.data() || {};
          const sourceAgenda = ensureAtLeastOneAgendaItem(
            Array.isArray(sData.agenda) ? sData.agenda : []
          );

          // Use the saved session id as the naming base for the copy.
          // Pinned agendas store session ids, and those ids often carry the prior date.
          // Strip the date from the session id first so copies don't become:
          // "Project Sync — 2026-05-29 — 2026-05-30".
          const namingBase = getCopiedAgendaNameBase(baseKey, sData.title);
          const copyTitle = await makeUniqueDatedCopyTitle(namingBase);

          // Update UI state
          setLocalSessionId(copyTitle);
          setTitle(copyTitle);
          setAgendaItems(sourceAgenda);
          setOriginalAgenda(JSON.parse(JSON.stringify(sourceAgenda)));
          setCurrentAgendaSource('saved_agenda_copy');
          logUserEvent('quick_launch_selected', { sourceId: baseKey, source: 'saved_agenda_copy' }, 'prestart');
          trackAgendaCreated({ title: copyTitle, source: 'saved_agenda_copy', itemCount: sourceAgenda.length, totalMinutes: sourceAgenda.reduce((sum, it) => sum + Number(it?.duration || 0), 0) }, 'setup');
          setScreen('setup');

          // Persist “last used”
          await AsyncStorage.setItem('@userInfo', JSON.stringify({ userId, sessionId: copyTitle }));
          await rememberRecentTitle(copyTitle);

          // (Optional but recommended) Pre-create the Firestore doc for the copy,
          // so sharelink/resume never races against "doc not existing yet".
          const destRef = doc(db, 'users', userId, 'sessions', copyTitle);
          await setDoc(
            destRef,
            {
              // Keep the copied agenda's display title aligned with the new
              // session id. The source agenda content is copied, but the old
              // dated session/title should not carry forward.
              title: copyTitle,
              agenda: sourceAgenda,
              published: true,
              createdFrom: baseKey,
              createdAt: new Date().toISOString(),
            },
            { merge: true }
          );

          return;
        }
      }

      // Fallback: treat as starter template
      const copyTitle = await makeUniqueDatedCopyTitle(baseKey || 'New Agenda');
      setLocalSessionId(copyTitle);
      setTitle(copyTitle);
      await AsyncStorage.setItem('@userInfo', JSON.stringify({ userId, sessionId: copyTitle }));
      await rememberRecentTitle(copyTitle);

      const starterAgenda = buildQuickLaunchAgenda(baseKey, advancedThresholdsEnabled);
      setAgendaItems(starterAgenda);
      setOriginalAgenda(JSON.parse(JSON.stringify(starterAgenda)));
      setCurrentAgendaSource('starter_template');
      logUserEvent('template_selected', { templateTitle: baseKey, source: 'starter_template' }, 'prestart');
      trackAgendaCreated({ title: copyTitle, source: 'starter_template', itemCount: starterAgenda.length, totalMinutes: starterAgenda.reduce((sum, it) => sum + Number(it?.duration || 0), 0) }, 'setup');
      setScreen('setup');
    } catch (e) {
      console.error('Quick launch open failed:', e);
      Alert.alert('Error', 'Could not open that agenda.');
    }
  };

  // 🤖 Generate a new AgendaGlow agenda from a user prompt
  const incrementAiAgendaUsage = async () => {
    const uid = auth.currentUser?.uid || userId || 'anonymous';
    const key = getAiAgendaUsageStorageKey(uid);
    const nextCount = (Number(aiAgendaUsageCount) || 0) + 1;

    setAiAgendaUsageCount(nextCount);

    try {
      await AsyncStorage.setItem(key, String(nextCount));

      if (!offlineMode && userId) {
        await setDoc(
          doc(db, 'users', userId),
          {
            aiAgendaGenerationsCount: nextCount,
            aiAgendaLastGeneratedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }
    } catch (e) {
      console.warn('[AI Agenda] failed to persist usage count:', e?.message || e);
    }

    return nextCount;
  };

  const showAiAgendaGate = () => {
    if (isTempAccount) {
      Alert.alert(
        'Sign in to keep generating',
        `You’ve used your ${AI_FREE_AGENDA_LIMIT} free AI agenda drafts on this device. Sign in to keep your agendas and unlock more options.`,
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Sign in',
            onPress: () => {
              logUserEvent('ai_agenda_gate_signin_tapped', {}, 'prestart');
              openUpgradeFlow();
            },
          },
        ]
      );
      return;
    }

    Alert.alert(
      'AI agendas are a Pro feature',
      `You’ve used your ${AI_FREE_AGENDA_LIMIT} free AI agenda drafts. Upgrade to AgendaGlow Pro to keep generating agendas.`,
      [
        { text: 'Not now', style: 'cancel' },
        {
          text: 'View Pro',
          onPress: () => {
            logUserEvent('ai_agenda_gate_pro_tapped', {}, 'prestart');
            openProPlans();
          },
        },
      ]
    );
  };

  const openAiAgendaGenerator = () => {
    if (offlineMode) {
      Alert.alert('Offline', 'Connect to the internet to generate an AI agenda.');
      return;
    }

    logUserEvent(
      'ai_agenda_opened',
      {
        used: Number(aiAgendaUsageCount) || 0,
        freeLimit: AI_FREE_AGENDA_LIMIT,
        isProUser: !!isProUser,
        isTempAccount: !!isTempAccount,
      },
      'prestart'
    );

    if (!isProUser && (Number(aiAgendaUsageCount) || 0) >= AI_FREE_AGENDA_LIMIT) {
      logUserEvent('ai_agenda_gate_shown', { reason: isTempAccount ? 'signin' : 'pro' }, 'prestart');
      showAiAgendaGate();
      return;
    }

    setAiPrompt('');
    setAiDurationMinutes('30');
    setAiSpeechStatus('');
    setAiSpeechError('');
    aiSpeechBasePromptRef.current = '';
    setShowAiAgendaModal(true);
  };

  const numberWordsToInt = (value) => {
    const text = String(value || '')
      .replace(/[-_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    if (!text) return null;

    const direct = Number(text);
    if (Number.isFinite(direct)) return Math.round(direct);

    const wordMap = {
      one: 1,
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
      eleven: 11,
      twelve: 12,
      thirteen: 13,
      fourteen: 14,
      fifteen: 15,
      sixteen: 16,
      seventeen: 17,
      eighteen: 18,
      nineteen: 19,
      twenty: 20,
      twentyone: 21,
      'twenty one': 21,
      twentytwo: 22,
      'twenty two': 22,
      twentythree: 23,
      'twenty three': 23,
      twentyfour: 24,
      'twenty four': 24,
      twentyfive: 25,
      'twenty five': 25,
      thirty: 30,
    };

    return wordMap[text.replace(/\s+/g, '')] ?? wordMap[text] ?? null;
  };

  const getPromptRequestedItemCount = (value) => {
    const text = String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    if (!text) return null;

    const numberToken = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|twenty[- ]?one|twenty[- ]?two|twenty[- ]?three|twenty[- ]?four|twenty[- ]?five|thirty)';

    const patterns = [
      // “15 item agenda”, “15-item agenda”, “fifteen item agenda”
      new RegExp(`\\b${numberToken}\\s*[- ]?\\s*(?:item|items|agenda item|agenda items)\\s+(?:agenda|meeting|session|sync|review|call|discussion)\\b`, 'i'),
      // “agenda with 15 items”, “meeting with fifteen agenda items”
      new RegExp('\\b(?:agenda|meeting|session|sync|review|call|discussion)\\s+(?:with|containing|that has|including|of)\\s+' + numberToken + '\\s*[- ]?\\s*(?:item|items|agenda item|agenda items)\\b', 'i'),
      // “create 15 agenda items”, “make fifteen items”
      new RegExp('\\b(?:create|generate|make|build|draft)\\s+(?:a|an)?\\s*' + numberToken + '\\s*[- ]?\\s*(?:item|items|agenda item|agenda items)\\b', 'i'),
      // “split into 15 items”
      new RegExp('\\b(?:split|break|divide)\\s+(?:it|this|the agenda|the meeting)?\\s*(?:into|up into)\\s+' + numberToken + '\\s*[- ]?\\s*(?:item|items|agenda item|agenda items)\\b', 'i'),
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match?.[1]) continue;

      const count = numberWordsToInt(match[1]);
      if (Number.isFinite(count) && count > 0) return count;
    }

    return null;
  };

  const getPromptTargetMinutes = (value) => {
    const text = String(value || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    if (!text) return null;

    const meetingWords =
      '(?:meeting|agenda|session|sync|review|call|discussion|standup|stand-up|one[- ]on[- ]one|1:1|client|project|team|check[- ]in|checkin|kickoff|retro|retrospective)';

    const patterns = [
      // “Create a 45-minute project sync”, “60 min meeting”, “30-minute agenda”
      new RegExp(`\\b(\\d{1,3})\\s*[- ]?\\s*(?:minute|minutes|min|mins)\\s+${meetingWords}\\b`, 'i'),
      // “Meeting for 45 minutes”, “agenda should be 30 min”, “session lasting 1 hour”
      new RegExp(`\\b${meetingWords}\\s+(?:for|lasting|of|is|should be|should last|around|about)?\\s*(\\d{1,3})\\s*[- ]?\\s*(?:minute|minutes|min|mins)\\b`, 'i'),
      // “Create/generate/build/draft a 45-minute ...”
      /\b(?:create|generate|make|draft|build)\s+(?:a|an)?\s*(\d{1,3})\s*[- ]?\s*(?:minute|minutes|min|mins)\b/i,
      // “for a 45-minute meeting/agenda”
      new RegExp(`\\bfor\\s+(?:a|an)?\\s*(\\d{1,3})\\s*[- ]?\\s*(?:minute|minutes|min|mins)\\s+${meetingWords}\\b`, 'i'),
      // “Create a 1.5-hour meeting”, “2 hr session”
      new RegExp(`\\b(\\d+(?:\\.\\d+)?)\\s*[- ]?\\s*(?:hour|hours|hr|hrs)\\s+${meetingWords}\\b`, 'i'),
      // “meeting for 1.5 hours”, “agenda should be 2 hrs”
      new RegExp(`\\b${meetingWords}\\s+(?:for|lasting|of|is|should be|should last|around|about)?\\s*(\\d+(?:\\.\\d+)?)\\s*[- ]?\\s*(?:hour|hours|hr|hrs)\\b`, 'i'),
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (!match?.[1]) continue;

      const raw = Number(match[1]);
      if (!Number.isFinite(raw) || raw <= 0) continue;

      const isHourPattern = /hour|hours|hr|hrs/.test(match[0]);
      const minutes = Math.round(isHourPattern ? raw * 60 : raw);

      if (minutes >= 5 && minutes <= 240) return minutes;
    }

    const wordHourPatterns = [
      { regex: new RegExp(`\\b(?:one|an?)\\s*[- ]?hour\\s+${meetingWords}\\b`, 'i'), minutes: 60 },
      { regex: new RegExp(`\\b${meetingWords}\\s+(?:for|lasting|of|is|should be|should last)?\\s*(?:one|an?)\\s*[- ]?hour\\b`, 'i'), minutes: 60 },
      { regex: new RegExp(`\\bhalf[- ]?hour\\s+${meetingWords}\\b`, 'i'), minutes: 30 },
      { regex: new RegExp(`\\b${meetingWords}\\s+(?:for|lasting|of|is|should be|should last)?\\s*half[- ]?hour\\b`, 'i'), minutes: 30 },
    ];

    const wordMatch = wordHourPatterns.find((p) => p.regex.test(text));
    return wordMatch ? wordMatch.minutes : null;
  };

  const confirmAiDurationConflictIfNeeded = async ({
    prompt,
    requestedMinutes,
    isRegenerate,
    skipDurationConflictCheck,
  }) => {
    // Return the minutes to use, or null if the user cancels.
    if (isRegenerate || skipDurationConflictCheck) return requestedMinutes;

    const promptMinutes = getPromptTargetMinutes(prompt);
    if (!promptMinutes) return requestedMinutes;

    // Avoid nagging for tiny rounding differences. Anything 5+ minutes apart is likely intentional.
    if (Math.abs(promptMinutes - requestedMinutes) < 5) return requestedMinutes;

    logUserEvent(
      'ai_agenda_duration_conflict_shown',
      { promptMinutes, requestedMinutes },
      screen || 'prestart'
    );

    return await new Promise((resolve) => {
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      Alert.alert(
        'Adjust target length?',
        `Your prompt says ${promptMinutes} minutes, but the target length is set to ${requestedMinutes} minutes.\n\nUse ${promptMinutes} minutes instead?`,
        [
          {
            text: 'Cancel',
            style: 'cancel',
            onPress: () => {
              logUserEvent(
                'ai_agenda_duration_conflict_cancel_tapped',
                { promptMinutes, requestedMinutes },
                screen || 'prestart'
              );
              finish(null);
            },
          },
          {
            text: `Keep ${requestedMinutes}`,
            onPress: () => {
              logUserEvent(
                'ai_agenda_duration_conflict_keep_target_tapped',
                { promptMinutes, requestedMinutes },
                screen || 'prestart'
              );
              finish(requestedMinutes);
            },
          },
          {
            text: `Use ${promptMinutes}`,
            onPress: () => {
              logUserEvent(
                'ai_agenda_duration_conflict_use_prompt_tapped',
                { promptMinutes, requestedMinutes },
                screen || 'prestart'
              );
              setAiDurationMinutes(String(promptMinutes));
              finish(promptMinutes);
            },
          },
        ],
        {
          cancelable: true,
          onDismiss: () => finish(null),
        }
      );
    });
  };

  const createAgendaFromAiPrompt = async (options = {}) => {
    const prompt = String(options.promptOverride ?? aiPrompt ?? '')
      .replace(/\s+/g, ' ')
      .trim();

    const requestedMinutesRaw = Number(options.durationOverride ?? aiDurationMinutes);
    let requestedMinutes =
      Number.isFinite(requestedMinutesRaw) && requestedMinutesRaw > 0
        ? Math.min(Math.max(Math.round(requestedMinutesRaw), 5), 240)
        : 30;

    const promptRequestedItemCount = getPromptRequestedItemCount(prompt);
    const requestedItemCount = Number.isFinite(promptRequestedItemCount)
      ? Math.round(promptRequestedItemCount)
      : null;
    const aiMaxItems = requestedItemCount || AI_AGENDA_DEFAULT_ITEM_COUNT;

    const isRegenerate = !!options.isRegenerate;

    if (!prompt || prompt.length < 8) {
      Alert.alert(
        'Add a little more detail',
        'Describe the meeting goal, audience, and any important topics.'
      );
      return;
    }

    if (requestedItemCount && requestedItemCount > AI_AGENDA_MAX_ITEM_COUNT) {
      Alert.alert(
        'Too many agenda items',
        `AgendaGlow AI can create up to ${AI_AGENDA_MAX_ITEM_COUNT} agenda items. Please edit your prompt to request ${AI_AGENDA_MAX_ITEM_COUNT} items or fewer.`
      );
      logUserEvent(
        'ai_agenda_item_cap_shown',
        { requestedItemCount, maxItems: AI_AGENDA_MAX_ITEM_COUNT },
        screen || 'prestart'
      );
      return;
    }

    if (offlineMode) {
      Alert.alert('Offline', 'Connect to the internet to generate an AI agenda.');
      return;
    }

    if (!isProUser && (Number(aiAgendaUsageCount) || 0) >= AI_FREE_AGENDA_LIMIT) {
      logUserEvent('ai_agenda_gate_shown', { reason: isTempAccount ? 'signin' : 'pro' }, 'prestart');
      showAiAgendaGate();
      return;
    }

    const confirmedMinutes = await confirmAiDurationConflictIfNeeded({
      prompt,
      requestedMinutes,
      isRegenerate,
      skipDurationConflictCheck: !!options.skipDurationConflictCheck,
    });

    if (!confirmedMinutes) return;
    requestedMinutes = confirmedMinutes;

    if (requestedItemCount && requestedMinutes < requestedItemCount) {
      Alert.alert(
        'Increase target length',
        `${requestedItemCount} agenda items need at least ${requestedItemCount} minutes because each item must be at least 1 minute. Increase the target length or request fewer items.`
      );
      logUserEvent(
        'ai_agenda_min_duration_shown',
        { requestedItemCount, requestedMinutes },
        screen || 'prestart'
      );
      return;
    }

    setAiAgendaBusy(true);

    logUserEvent(
      isRegenerate ? 'ai_agenda_regenerate_tapped' : 'ai_agenda_generate_tapped',
      {
        requestedMinutes,
        requestedItemCount: requestedItemCount || null,
        maxItems: aiMaxItems,
        promptLength: prompt.length,
        used: Number(aiAgendaUsageCount) || 0,
        freeLimit: AI_FREE_AGENDA_LIMIT,
      },
      screen || 'prestart'
    );

    try {
      const token = auth.currentUser ? await auth.currentUser.getIdToken() : null;

      let payload = null;
      let lastAiError = null;

      for (const url of AI_AGENDA_FUNCTION_URLS) {
        try {
          const response = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              prompt,
              totalMinutes: requestedMinutes,
              maxItems: aiMaxItems,
            }),
          });

          const candidatePayload = await readJsonResponseSafely(response);

          if (!response.ok) {
            const msg =
              candidatePayload?.error ||
              candidatePayload?.message ||
              `AI agenda request failed (${response.status})`;

            lastAiError = new Error(`${msg} [${url}]`);

            // 404 means this app build is pointing at a path that this deploy
            // does not expose. Try the next known route before giving up.
            if (response.status === 404) {
              console.warn('[AI Agenda] endpoint returned 404, trying fallback:', url);
              continue;
            }

            throw lastAiError;
          }

          if (!Array.isArray(candidatePayload?.agenda) && !Array.isArray(candidatePayload?.items)) {
            const preview = candidatePayload?.rawPreview
              ? ` ${candidatePayload.rawPreview}`
              : '';
            throw new Error(`AI agenda response was not in the expected format.${preview}`);
          }

          payload = candidatePayload;
          break;
        } catch (err) {
          lastAiError = err;

          // Network/routing failures can happen during deploys. Try the next
          // alias, but keep the final error for the user/logs.
          console.warn('[AI Agenda] endpoint attempt failed:', url, err?.message || err);
        }
      }

      if (!payload) {
        throw lastAiError || new Error('AI agenda request failed.');
      }

      const rawAgenda = payload?.agenda || payload?.items || [];
      const aiAgenda = normalizeAiAgendaItems(rawAgenda, advancedThresholdsEnabled);

      const rawTitle =
        payload?.title ||
        payload?.agendaTitle ||
        prompt.split(/[.!?]/)[0] ||
        'AI Generated Agenda';

      const titleBase = normalizeAiAgendaTitle(rawTitle);
      const newTitle = await makeUniqueDatedCopyTitle(titleBase);

      setLocalSessionId(newTitle);
      setTitle(newTitle);
      setAgendaItems(aiAgenda);
      setOriginalAgenda(JSON.parse(JSON.stringify(aiAgenda)));
      setShowAiAgendaModal(false);
      setLastAiPrompt(prompt);
      setLastAiDurationMinutes(String(requestedMinutes));
      setCurrentAgendaSource('ai');
      setScreen('setup');

      await AsyncStorage.setItem(
        '@userInfo',
        JSON.stringify({ userId, sessionId: newTitle })
      );
      await rememberRecentTitle(newTitle);

      const nextUsageCount = isProUser ? Number(aiAgendaUsageCount) || 0 : await incrementAiAgendaUsage();

      logUserEvent(
        'ai_agenda_generated',
        {
          requestedMinutes,
          requestedItemCount: requestedItemCount || null,
          maxItems: aiMaxItems,
          items: aiAgenda.length,
          totalMinutes: aiAgenda.reduce((sum, it) => sum + Number(it?.duration || 0), 0),
          usageCount: nextUsageCount,
          isRegenerate,
        },
        'setup'
      );


      trackAgendaCreated(
        {
          title: newTitle,
          source: isRegenerate ? 'ai_regenerate' : 'ai',
          itemCount: aiAgenda.length,
          totalMinutes: aiAgenda.reduce((sum, it) => sum + Number(it?.duration || 0), 0),
        },
        'setup'
      );

      if (!offlineMode && userId) {
        const destRef = doc(db, 'users', userId, 'sessions', newTitle);
        await setDoc(
          destRef,
          {
            title: newTitle,
            agenda: aiAgenda,
            published: true,
            createdFrom: 'ai-prompt',
            aiPrompt: prompt,
            aiRequestedMinutes: requestedMinutes,
            aiRequestedItemCount: requestedItemCount || null,
            aiMaxItems: aiMaxItems,
            createdAt: new Date().toISOString(),
            lastUpdate: new Date().toISOString(),
          },
          { merge: true }
        );
        setSessionWrittenToFirestore(true);
      }
    } catch (e) {
      console.warn('[AI Agenda] generation failed:', e);
      logUserEvent(
        'ai_agenda_failed',
        {
          message: String(e?.message || e).slice(0, 300),
          requestedMinutes,
          promptLength: prompt.length,
          isRegenerate,
        },
        screen || 'prestart'
      );
      Alert.alert(
        'Could not generate agenda',
        'Please try again with a shorter prompt or check the server function.'
      );
    } finally {
      setAiAgendaBusy(false);
    }
  };

  const regenerateAiAgendaFromLastPrompt = async () => {
    const prompt = String(lastAiPrompt || '').trim();

    if (!prompt) {
      setShowAiAgendaModal(true);
      return;
    }

    await createAgendaFromAiPrompt({
      promptOverride: prompt,
      durationOverride: lastAiDurationMinutes || '30',
      isRegenerate: true,
    });
  };

  // 🧻 Quick-start: Blank Canvas (3 items)
  const openBlankCanvasQuickStart = async () => {
    try {
      const baseKey = 'Blank Canvas';
      const newTitle = await makeUniqueDatedCopyTitle(baseKey);

      const blankAgenda = createBlankCanvasAgenda3(advancedThresholdsEnabled);

      setLocalSessionId(newTitle);
      setTitle(newTitle);
      setAgendaItems(blankAgenda);
      setOriginalAgenda(JSON.parse(JSON.stringify(blankAgenda)));
      setCurrentAgendaSource('blank_canvas');
      trackAgendaCreated({ title: newTitle, source: 'blank_canvas', itemCount: blankAgenda.length, totalMinutes: blankAgenda.reduce((sum, it) => sum + Number(it?.duration || 0), 0) }, 'setup');
      setScreen('setup');

      // Remember as last-used (matches your other open flows)
      await AsyncStorage.setItem(
        '@userInfo',
        JSON.stringify({ userId, sessionId: newTitle })
      );
      await rememberRecentTitle(newTitle);

      // Optional: if online + signed-in, pre-create the doc (prevents “doc not existing yet” races)
      if (!offlineMode && userId) {
        const destRef = doc(db, 'users', userId, 'sessions', newTitle);
        await setDoc(
          destRef,
          {
            title: newTitle,
            agenda: blankAgenda,
            published: true,
            createdFrom: baseKey,
            createdAt: new Date().toISOString(),
          },
          { merge: true }
        );
      }
    } catch (e) {
      console.error('Blank canvas quick start failed:', e);
      Alert.alert('Error', 'Could not create a blank canvas agenda.');
    }
  };

  // 📌 Pin/unpin an agenda to the Pinned Agendas quick-start row (max 5)
  const toggleQuickLaunchPin = async (sessionIdOrTitle) => {
    try {
      const key = String(sessionIdOrTitle || '').replace(/\s+/g, ' ').trim();
      if (!key) return;

      setQuickLaunchFavorites((prev) => {
        const current = Array.isArray(prev) ? prev : [];

        let next;
        if (current.includes(key)) {
          next = current.filter((x) => x !== key);
        } else {
          next = [key, ...current.filter((x) => x !== key)];
        }

        next = next.slice(0, 5);

        AsyncStorage.setItem(
          QUICK_LAUNCH_FAVORITES_KEY,
          JSON.stringify(next)
        ).catch((e) => console.warn('⚠️ Failed to save quick launch favorites:', e));

        return next;
      });
    } catch (e) {
      console.error('toggleQuickLaunchPin failed:', e);
      Alert.alert('Error', 'Could not update Quick Launch favorites.');
    }
  };

  // 📅 Make a dated copy title like: "Daily Stand-up — 2026-02-17"
  const makeUniqueDatedCopyTitle = async (baseTitle) => {
    const cleanBase = stripTrailingAgendaDate(baseTitle) || 'New Agenda';

    const date = getTodayISO();
    const sep = ' — ';
    const baseWithDate = `${cleanBase}${sep}${date}`;

    const maxTries = 50;
    for (let n = 1; n <= maxTries; n++) {
      const suffix = n === 1 ? '' : ` (${n})`;
      const maxBaseLen = Math.max(0, TITLE_MAX_CHARS - suffix.length);

      const trimmed =
        baseWithDate.length > maxBaseLen
          ? baseWithDate.slice(0, maxBaseLen).trimEnd()
          : baseWithDate;

      const candidate = `${trimmed}${suffix}`;

      if (!validateSessionTitle(candidate)) continue;

      if (offlineMode || !userId) return candidate;

      const candidateRef = doc(db, 'users', userId, 'sessions', candidate);
      const candidateSnap = await getDoc(candidateRef);
      if (!candidateSnap.exists()) return candidate;
    }

    return baseWithDate.slice(0, TITLE_MAX_CHARS).trimEnd();
  };

  // 🔁 Make a unique "{Title} (Copy)" / "{Title} (Copy 2)" name that fits TITLE_MAX_CHARS
  const makeUniqueCopyTitle = async (baseTitle) => {
    // Clean + enforce your rules (no "/")
    const cleanBase = String(baseTitle || '')
      .replace(/\s+/g, ' ')
      .replace(/\//g, '-') // safety; validateSessionTitle forbids "/"
      .trim();

    const maxTries = 50;
    for (let n = 1; n <= maxTries; n++) {
      const suffix = n === 1 ? ' (Copy)' : ` (Copy ${n})`;
      const maxBaseLen = Math.max(0, TITLE_MAX_CHARS - suffix.length);

      const trimmedBase =
        cleanBase.length > maxBaseLen
          ? cleanBase.slice(0, maxBaseLen).trimEnd()
          : cleanBase;

      const candidate = `${trimmedBase}${suffix}`;

      // Must still satisfy your title rules (3+ chars, no "/")
      if (!validateSessionTitle(candidate)) continue;

      const candidateRef = doc(db, 'users', userId, 'sessions', candidate);
      const candidateSnap = await getDoc(candidateRef);
      if (!candidateSnap.exists()) return candidate;
    }

    // Fallback (should be rare)
    return cleanBase.slice(0, TITLE_MAX_CHARS).trimEnd();
  };

  // 🧩 Create a NEW agenda by copying one of the user's existing sessions
  const createSessionCopyFromExisting = async (sourceId, cleanTitle) => {
    try {
      if (!userId) {
        Alert.alert('Not signed in', 'Please sign in first.');
        return;
      }

      if (!validateSessionTitle(sourceId)) {
        Alert.alert(
          'Invalid source agenda',
          'The selected source agenda name is not valid.'
        );
        return;
      }

      if (!validateSessionTitle(cleanTitle)) {
        Alert.alert(
          'Name your copy',
          "Enter a valid New Agenda Title (3+ characters, no '/')."
        );
        return;
      }

      if (offlineMode) {
        Alert.alert('Offline', 'Copying an agenda requires an internet connection.');
        return;
      }

      // 1) Load the source agenda
      const sourceRef = doc(db, 'users', userId, 'sessions', sourceId);
      const sourceSnap = await getDoc(sourceRef);
      if (!sourceSnap.exists()) {
        Alert.alert('Not found', `No saved agenda named “${sourceId}”.`);
        return;
      }

      const sData = sourceSnap.data() || {};
      const agendaFromSource = ensureAtLeastOneAgendaItem(
        Array.isArray(sData.agenda) ? sData.agenda : []
      );

      // 2) If the destination title exists, auto-pick "(Copy 2)/(Copy 3)…"
      let finalTitle = cleanTitle;
      let destRef = doc(db, 'users', userId, 'sessions', finalTitle);
      let destSnap = await getDoc(destRef);

      if (destSnap.exists()) {
        finalTitle = await makeUniqueCopyTitle(cleanTitle);
        destRef = doc(db, 'users', userId, 'sessions', finalTitle);
        destSnap = await getDoc(destRef);

        // If something truly weird happens, bail safely
        if (destSnap.exists()) {
          Alert.alert(
            'Agenda Exists',
            'Could not generate a unique copy name. Please choose a different name.'
          );
          return;
        }
      }

      // 3) Write the NEW agenda doc based on the source
      await setDoc(
        destRef,
        {
          // Copy the agenda items, but use the new session name as the copied
          // agenda title so title/session stay in sync.
          title: finalTitle,
          agenda: agendaFromSource,
          currentItem: agendaFromSource[0]?.title || '',
          currentIndex: 0,
          elapsed: 0,
          status: 'Ready',
          lastUpdate: new Date().toISOString(),
          summaryItems: [],
          summaryStats: {},
          published: true, // same behavior as template-created agendas
        },
        { merge: true }
      );

      // ✅ Mark this new agenda as "last used" + add to Recents
      await AsyncStorage.setItem(
        '@userInfo',
        JSON.stringify({
          userId,
          sessionId: finalTitle,
        })
      );
      await rememberRecentTitle(finalTitle);

      // cleanup the copy flow so the UI goes back to normal
      setCopySourceId(null);
      setLocalSessionId(finalTitle);

      // 4) Load into UI and go to setup
      setAgendaItems(agendaFromSource);
      setTitle(finalTitle);
      setCurrentAgendaSource('saved_agenda_copy');
      trackAgendaCreated(
        {
          title: finalTitle,
          source: 'saved_agenda_copy',
          itemCount: agendaFromSource.length,
          totalMinutes: agendaFromSource.reduce((sum, it) => sum + Number(it?.duration || 0), 0),
        },
        'setup'
      );
      setCopySourceId(null);
      setShowSessionPicker(false);
      setScreen('setup');

      // 5) Remember as current / recent
      await AsyncStorage.setItem(
        '@userInfo',
        JSON.stringify({
          userId,
          sessionId: finalTitle,
        })
      );
      await rememberRecentTitle(finalTitle);
    } catch (e) {
      console.error('Copy from existing failed:', e);
      Alert.alert('Error', 'Could not copy that agenda.');
    }
  };

  const handleMeetingCompleted = async () => {
    if (isSampleMeeting || isSampleDemoActive) return;
    if (meetingCompletionCountedRef.current) return;

    meetingCompletionCountedRef.current = true;

    try {
      const baseCount = Number.isFinite(Number(meetingsCompletedCount))
        ? Number(meetingsCompletedCount)
        : 0;

      const nextCount = baseCount + 1;

      setMeetingsCompletedCount(nextCount);
      await AsyncStorage.setItem(
        MEETINGS_COMPLETED_STORAGE_KEY,
        String(nextCount)
      );

      // ✅ Mirror completed-meeting count to Firestore user doc
      if (!offlineMode && userId) {
        try {
          await setDoc(
            doc(db, 'users', userId),
            {
              meetingsCompletedCount: nextCount,
              updatedAt: serverTimestamp(),
              lastActiveAt: serverTimestamp(),
            },
            { merge: true }
          );
        } catch (e) {
          console.warn('⚠️ Failed to persist meetings completed count to Firestore:', e);
        }
      }

      suppressNextSummaryInterstitialRef.current = false;

      if (nextCount === ADS_UNLOCK_AFTER_MEETINGS) {
        setShowThreeMeetingCongrats(true);
        setShowFiveMeetingProOffer(false);
        setShowFiveMeetingProModal(false);
      }

      if (nextCount === PRO_OFFER_AFTER_MEETINGS) {
        setShowFiveMeetingProOffer(true);
        setShowThreeMeetingCongrats(false);
        setShowFiveMeetingProModal(true);
        suppressNextSummaryInterstitialRef.current = true;
      }

      if (nextCount > PRO_OFFER_AFTER_MEETINGS) {
        setShowFiveMeetingProOffer(true);
        setShowThreeMeetingCongrats(false);
        setShowFiveMeetingProModal(false);
      }
    } catch (e) {
      console.warn('⚠️ Failed to persist meetings completed count:', e);
    }
  };

  // 🎛️ Facilitator remote: pause/resume without duplicating footer logic
  const handleToggleTimerRunning = async () => {
    if (isSampleDemoActive) return;

    const newRunningState = !running;
    const now = Date.now();

    if (newRunningState) {
      // ▶️ RESUME
      let newPaused = pausedDuration;
      if (pauseStartRef.current) {
        const pauseTime = now - pauseStartRef.current;
        newPaused = pausedDuration + pauseTime;
        setPausedDuration(newPaused);
        pauseStartRef.current = null;
        setLivePauseTime(Math.floor(newPaused / 1000));
      }
      setRunning(true);

      try {
        if (!offlineMode && sessionDocRef) {
          await updateDoc(
            sessionDocRef,
            {
              status: 'Running',
              pausedAccumMs: newPaused,
              lastUpdate: new Date().toISOString(),
              lastHeartbeat: serverTimestamp(),
              canResume: true,
            },
            { merge: true }
          );

          const effectiveElapsed = Math.max(
            0,
            Math.floor(
              Math.max(
                0,
                ((now - (itemStartTimestamp || now) - (newPaused || 0)) / 1000) *
                  (demoSpeed || 1)
              )
            )
          );
          const item = agendaItems[currentIndex];
          const bgColor = computeBgColorAt(effectiveElapsed, item, advancedThresholdsEnabled);
          await updateDoc(sessionDocRef, { bgColor }, { merge: true });
        }
      } catch (err) {
        console.error('❌ Firestore resume update failed:', err);
      }
    } else {
      // ⏸️ PAUSE
      pauseStartRef.current = now;
      setLivePauseTime(Math.floor((pausedDuration || 0) / 1000));
      setRunning(false);

      try {
        if (!offlineMode && sessionDocRef) {
          await updateDoc(
            sessionDocRef,
            {
              status: 'Paused',
              lastUpdate: new Date().toISOString(),
              lastHeartbeat: serverTimestamp(),
              canResume: true,
            },
            { merge: true }
          );

          const effectiveElapsed = Math.max(
            0,
            Math.floor((now - (itemStartTimestamp || now) - (pausedDuration || 0)) / 1000)
          );
          const item = agendaItems[currentIndex];
          const bgColor = computeBgColorAt(effectiveElapsed, item, advancedThresholdsEnabled);
          await updateDoc(sessionDocRef, { bgColor }, { merge: true });
        }
      } catch (err) {
        console.error('❌ Firestore pause update failed:', err);
      }
    }
  };

  const getAgendaPlannedTotalSeconds = (items) => {
    return Math.max(
      0,
      Math.round(
        (Array.isArray(items) ? items : []).reduce(
          (sum, item) => sum + Number(item?.duration || 0) * 60,
          0
        )
      )
    );
  };

  const getProjectedMeetingLengthAfterExtension = (extensionSec = 0) => {
    const safeAgenda = Array.isArray(agendaItems) ? agendaItems : [];
    const completedActualSec = (Array.isArray(summary) ? summary : []).reduce(
      (sum, item) => sum + Number(item?.timeSpent || 0),
      0
    );

    const currentItem = safeAgenda[currentIndex];
    const currentDurationSec = Math.max(0, Math.round(Number(currentItem?.duration || 0) * 60));
    const currentElapsedSec = overtimeMode
      ? currentDurationSec + Number(overtimeSec || 0)
      : Math.max(0, currentDurationSec - Math.max(0, Number(timeLeft || 0)));

    const currentRemainingSec = Math.max(0, Number(timeLeft || 0));
    const futureItemsSec = safeAgenda
      .slice(currentIndex + 1)
      .reduce((sum, item) => sum + Number(item?.duration || 0) * 60, 0);

    return Math.round(
      completedActualSec + currentElapsedSec + currentRemainingSec + extensionSec + futureItemsSec
    );
  };

  const applyAddOneMinuteToCurrentItem = async () => {
    const currentItem = agendaItems[currentIndex];
    if (!currentItem) return;

    const extendedDurationMin = Number(currentItem.duration || 0) + 1;
    const extendedItem = { ...currentItem, duration: extendedDurationMin };

    const updatedAgenda = agendaItems.map((item, idx) =>
      idx === currentIndex ? extendedItem : item
    );

    const nextTimeLeftSec = Math.max(0, Number(timeLeft || 0)) + 60;
    const nextDurationSec = Math.round(extendedDurationMin * 60);
    const projectedElapsedSec = Math.max(0, nextDurationSec - nextTimeLeftSec);
    const projectedPhase = computeBgColorAt(
      projectedElapsedSec,
      extendedItem,
      advancedThresholdsEnabled
    );

    // If the facilitator adds time after Yellow/Red and the item moves back
    // to an earlier phase, reset alert eligibility to match the new time box.
    // This keeps Summary from saying "Reached Yellow" when the extension brought
    // the item fully back to Green and it never re-entered Yellow afterward.
    if (projectedPhase === 'green') {
      yellowPlayedRef.current = false;
      setYellowPlayed(false);
      redPlayedRef.current = false;
    } else if (projectedPhase === 'yellow') {
      // Still in Yellow after the extension: don't immediately re-nag Yellow,
      // but clear Red because the item is no longer expired/Red.
      yellowPlayedRef.current = true;
      setYellowPlayed(true);
      redPlayedRef.current = false;
    } else if (projectedPhase === 'red') {
      yellowPlayedRef.current = true;
      setYellowPlayed(true);
      redPlayedRef.current = true;
    }

    scheduledYellowAtRef.current = null;
    scheduledRedAtRef.current = null;
    suppressYellowOnResumeRef.current = false;
    suppressRedOnResumeRef.current = false;

    setAgendaItems(updatedAgenda);
    setTimeLeft(nextTimeLeftSec);
    setOvertimeMode(false);
    setOvertimeSec(0);

    try {
      if (!offlineMode && sessionDocRef) {
        await updateDoc(
          sessionDocRef,
          {
            agenda: updatedAgenda,
            durationSec: nextDurationSec,
            bgColor: projectedPhase,
            elapsed: projectedElapsedSec,
            lastUpdate: new Date().toISOString(),
            lastHeartbeat: serverTimestamp(),
          },
          { merge: true }
        );
      }
    } catch (err) {
      console.warn('⚠️ Failed to extend current item:', err?.message || err);
    }
  };

  // ⏱️ Facilitator remote: extend the active topic by one minute
  const handleAddOneMinuteToCurrentItem = async () => {
    if (isSampleDemoActive) return;
    const currentItem = agendaItems[currentIndex];
    if (!currentItem) return;

    const plannedCapSec =
      plannedMeetingDurationSecRef.current || getAgendaPlannedTotalSeconds(originalAgenda) || getAgendaPlannedTotalSeconds(agendaItems);

    if (respectPlannedMeetingLength && plannedCapSec > 0) {
      const projectedSec = getProjectedMeetingLengthAfterExtension(60);

      if (projectedSec > plannedCapSec) {
        const overBySec = projectedSec - plannedCapSec;
        Alert.alert(
          'Extend past planned meeting length?',
          `Adding 1 minute will push this meeting about ${formatMMSS(overBySec)} past the original planned agenda length.`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Add Time',
              onPress: applyAddOneMinuteToCurrentItem,
            },
          ]
        );
        return;
      }
    }

    await applyAddOneMinuteToCurrentItem();
  };

  // ⏹️ Protected End Meeting: finish immediately and show Summary
  const finishMeetingNowFromRemote = async () => {
    if (remoteControlBusy) return;
    if (isSampleDemoActive) return;
    if (!agendaItems[currentIndex]) return;

    setRemoteControlBusy(true);
    setShowMeetingControlsModal(false);

    const now = Date.now();
    let effectivePausedMs = pausedDuration || 0;

    if (!running && pauseStartRef.current) {
      effectivePausedMs += now - pauseStartRef.current;
      setPausedDuration(effectivePausedMs);
      setLivePauseTime(Math.floor(effectivePausedMs / 1000));
      pauseStartRef.current = null;
    }

    try {
      recordCurrentItemToSummary(now, effectivePausedMs);
      finalItemManuallySkipped.current = true;

      await stopAudioBeforeAd();
      await cancelPhaseNotifications();

      setRunning(false);
      setEndTimestamp(now);
      setSummaryPending(true);
      justFinishedMeetingRef.current = true;
      await handleMeetingCompleted();
      setScreen('summary');

      if (!isSampleMeeting && !isSampleDemoActive) {
        setTimeout(() => {
          pushFinalSummaryToFirestore().catch((err) =>
            console.error('❌ Final summary push failed:', err)
          );
        }, 0);
      }

      if (!offlineMode && sessionDocRef) {
        try {
          await updateDoc(
            sessionDocRef,
            {
              status: 'Complete',
              canResume: false,
              lastUpdate: new Date().toISOString(),
              lastHeartbeat: serverTimestamp(),
            },
            { merge: true }
          );
        } catch (e) {
          console.warn('⚠️ Failed to mark session complete (remote end):', e?.message || e);
        }
      }

      finalItemManuallySkipped.current = false;
      finalItemCompleted.current = false;
      maybeShowSummaryInterstitial();
    } finally {
      setRemoteControlBusy(false);
    }
  };

  const confirmEndMeetingNow = () => {
    if (isSampleDemoActive) return;

    Alert.alert(
      'End meeting now?',
      'This will stop the timer and open the meeting summary. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'End Meeting',
          style: 'destructive',
          onPress: finishMeetingNowFromRemote,
        },
      ]
    );
  };

  // ➡️ Advance to Next Agenda Item
  const goToNextItem = async () => {
    const currentItem = agendaItems[currentIndex];
    const durationSec = currentItem.duration * 60;
    const timeSpent = durationSec - timeLeft;
    const now = Date.now();

    const yellowReached = yellowPlayed;
    const redReached = redPlayedRef.current;

    let effectivePausedMs = pausedDuration || 0;

    // ✅ If user taps Next while paused, include the still-open pause segment
    if (!running && pauseStartRef.current) {
      effectivePausedMs += now - pauseStartRef.current;
      setPausedDuration(effectivePausedMs);
      setLivePauseTime(Math.floor(effectivePausedMs / 1000));
    }

    // ✅ Always record locally using the true paused total
    recordCurrentItemToSummary(now, effectivePausedMs);

    const isFinalItem = currentIndex === agendaItems.length - 1;

    if (isFinalItem) {
      // mark intent but don’t touch timeLeft
      finalItemManuallySkipped.current = true;

      // stop any in-flight audio to avoid chirps/buzzers
      await stopAudioBeforeAd();

      // lock end time & leave timer immediately
      setRunning(false);
      setEndTimestamp(now);
      setSummaryPending(true);
      justFinishedMeetingRef.current = true;
      await handleMeetingCompleted();
      setScreen('summary');

      // ✅ Persist final summary for later reopen/export
      if (!isSampleMeeting && !isSampleDemoActive) {
        setTimeout(() => {
          pushFinalSummaryToFirestore().catch((err) =>
            console.error('❌ Final summary push failed:', err)
          );
        }, 0);
      }

      if (isSampleDemoActive) {
        setShowPostDemoCta(true);
        logUserEvent('sample_demo_completed', {}, 'summary');
      }

      // 🔒 Mark not resumable once we enter Summary
      if (!offlineMode && sessionDocRef) {
        try {
          await updateDoc(
            sessionDocRef,
            {
              status: 'Complete',
              canResume: false,
              lastUpdate: new Date().toISOString(),
              lastHeartbeat: serverTimestamp(),
            },
            { merge: true }
          );
        } catch (e) {
          console.warn(
            '⚠️ Failed to mark session complete (manual finish):',
            e?.message || e
          );
        }
      }

      // prevent CLOSED listener from re-navigating
      finalItemManuallySkipped.current = false;
      finalItemCompleted.current = false;

      // show the ad after summary has mounted — except on the exact 5th meeting
      maybeShowSummaryInterstitial();

      return; // ✅ done
    }

    // ⏭️ Go to next item (this part MUST run even offline)
    const nextIndex = currentIndex + 1;
    const nextDuration = agendaItems[nextIndex].duration * 60;

    setCurrentIndex(nextIndex);
    setItemStartTimestamp(now);
    setPausedDuration(0);
    pauseStartRef.current = null;
    setTimeLeft(nextDuration);
    setYellowPlayed(false);
    yellowPlayedRef.current = false;
    redPlayedRef.current = false;

    // reset background schedule/suppression refs for the new item
    scheduledYellowAtRef.current = null;
    scheduledRedAtRef.current = null;
    suppressYellowOnResumeRef.current = false;
    suppressRedOnResumeRef.current = false;

    setRunning(true);
    setOvertimeMode(false);
    setOvertimeSec(0);

    // 🔄 If online, push update to Firestore
    if (!offlineMode && sessionDocRef) {
      try {
        await updateDoc(
          sessionDocRef,
          {
            currentItem: agendaItems[nextIndex]?.title || `Item ${nextIndex + 1}`,
            currentIndex: nextIndex,
            status: 'Running',
            agenda: agendaItems,
            // ⏱️ Canonical timing restart for the new item
            itemStartAt: serverTimestamp(),
            itemStartAtMs: Date.now(),
            canResume: true,
            pausedAccumMs: 0,
            durationSec: Math.round((agendaItems[nextIndex]?.duration || 0) * 60),
            lastUpdate: new Date().toISOString(),
            lastHeartbeat: serverTimestamp(),
          },
          { merge: true }
        );

        console.log('🔥 Firestore updated for next item');
      } catch (err) {
        console.error('❌ Firestore update failed on item advance:', err);
      }
    } else {
      console.log('📴 Offline — Firestore update skipped on item advance');
    }
  };

  // 🚀 Resume a terminated session from Firestore snapshot
  const resumeFromFirestore = async (sid, d) => {
    try {
      // 1) Load agenda + title
      const agendaFromDoc = ensureAtLeastOneAgendaItem(
        Array.isArray(d.agenda) ? d.agenda : []
      );
      setAgendaItems(agendaFromDoc);
      setTitle(d.title || sid);
      setLocalSessionId(sid);

      // 2) Index & durations
      const idx = Number.isFinite(d.currentIndex) ? d.currentIndex : 0;
      const item = agendaFromDoc[idx] || agendaFromDoc[0];
      const itemDurSec = Math.max(0, Math.round((item?.duration || 0) * 60));

      // 3) Rebuild timing: prefer plain ms, then Firestore Timestamp, then fallback
      const startMs =
        typeof d.itemStartAtMs === 'number' && d.itemStartAtMs > 0
          ? d.itemStartAtMs
          : d.itemStartAt && d.itemStartAt.toMillis
            ? d.itemStartAt.toMillis()
            : Date.now();

      const pausedMs = Math.max(0, d.pausedAccumMs || 0);
      const now = Date.now();
      const effectiveElapsedSec = Math.max(
        0,
        Math.floor((now - startMs - pausedMs) / 1000)
      );
      const left = Math.max(0, itemDurSec - effectiveElapsedSec);

      // 4) Apply to local timer
      setCurrentIndex(idx);
      setItemStartTimestamp(startMs);
      setPausedDuration(pausedMs);
      setTimeLeft(left);

      const wasRunning = d.status === 'Running';
      setRunning(wasRunning);

      if (!autoAdvanceEnabled && !demoNoOvertime && effectiveElapsedSec > itemDurSec) {
        setOvertimeMode(true);
        setOvertimeSec(effectiveElapsedSec - itemDurSec);
      } else {
        setOvertimeMode(false);
        setOvertimeSec(0);
      }

      // 5) Enter the timer screen
      setScreen('timer');
      setSessionWrittenToFirestore(true);

      // 6) Fire an immediate heartbeat to clear any viewer stale banners
      setTimeout(async () => {
        try {
          const ref = doc(db, 'users', userId, 'sessions', sid);
          await updateDoc(
            ref,
            {
              lastUpdate: new Date().toISOString(),
              lastHeartbeat: serverTimestamp(),
              canResume: true,
            },
            { merge: true }
          );
        } catch (e) {
          console.warn('Resume heartbeat failed:', e?.message || e);
        }
      }, 0);
    } catch (e) {
      Alert.alert('Resume failed', e?.message || 'Could not resume this session.');
    }
  };

  useEffect(() => {
    if (screen === 'prestart' && auth.currentUser) {
      reload(auth.currentUser)
        .then(() => setEmailVerified(!!auth.currentUser?.emailVerified)) // ✅ set state after reload
        .catch(() => {});
    }
  }, [screen]);

  // ⚡ Wake Lock
  useEffect(() => {
    const manageWakeLock = async () => {
      if (screen === 'timer') {
        await activateKeepAwakeAsync();
      } else {
        await deactivateKeepAwakeAsync();
      }
    };
    manageWakeLock();
  }, [screen]);

  // ⏱️ Unified Timer Countdown with Offline Support
  useEffect(() => {
    let interval;

    if (
      screen === 'timer' &&
      running &&
      itemStartTimestamp !== null &&
      agendaItems[currentIndex]
    ) {
      interval = setInterval(() => {
        const now = Date.now();
        const rawElapsedSec = (now - itemStartTimestamp - pausedDuration) / 1000;
        const speedMultiplier =
          isSampleMeeting || isSampleDemoActive ? demoSpeed || 1 : 1;
        const effectiveElapsed = Math.floor(Math.max(0, rawElapsedSec) * speedMultiplier);
        const itemDurationSec = agendaItems[currentIndex].duration * 60;
        const newTimeLeft = itemDurationSec - effectiveElapsed;

        setTimeLeft(Math.max(newTimeLeft, 0));

        // ⏱️ Overtime: derive from timestamps so background throttling can’t drift us
        if (!autoAdvanceEnabled && !demoNoOvertime) {
          const derivedOver = Math.max(0, effectiveElapsed - itemDurationSec);
          setOvertimeMode(derivedOver > 0);
          setOvertimeSec(derivedOver);
        } else if (demoNoOvertime) {
          // Demo sessions never show/enter overtime
          if (overtimeMode) setOvertimeMode(false);
          if (overtimeSec !== 0) setOvertimeSec(0);
        }

        if (!offlineMode && sessionDocRef) {
          updateLiveElapsedTime(effectiveElapsed);
        }

        if (__DEV__) {
          console.log('⏱ Tick → elapsed:', effectiveElapsed, 'left:', newTimeLeft);
        }
      }, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [
    screen,
    running,
    itemStartTimestamp,
    pausedDuration,
    currentIndex,
    agendaItems,
    offlineMode,
    sessionDocRef,
    autoAdvanceEnabled,
    demoSpeed,
  ]);

  // 🔁 Flash animation during overtime (yellow ↔ black)
  useEffect(() => {
    if (overtimeMode) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(flashAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: false,
          }),
          Animated.timing(flashAnim, {
            toValue: 0,
            duration: 1000,
            useNativeDriver: false,
          }),
        ])
      );
      loop.start();
      return () => loop.stop();
    } else {
      flashAnim.stopAnimation();
      flashAnim.setValue(0);
    }
  }, [overtimeMode, flashAnim]);

  // ❤️‍🔥 Heartbeat to Firestore (running AND paused; slower while paused; fires once immediately)
  useEffect(() => {
    if (screen !== 'timer' || offlineMode || !sessionDocRef) return;
    if (!sessionWrittenToFirestore) return; // ✅ wait until session doc exists

    // different cadence when paused is OK (tweak if you like)
    const periodMs = running ? 15000 : 45000;

    const send = async () => {
      try {
        const now = new Date().toISOString();
        await updateDoc(
          sessionDocRef,
          {
            lastUpdate: now,
            lastHeartbeat: serverTimestamp(),
            canResume: true,
          },
          { merge: true }
        );
      } catch (err) {
        console.error('❌ Heartbeat update failed:', err);
      }
    };

    // fire once immediately whenever state changes
    send();

    const id = setInterval(send, periodMs);
    return () => clearInterval(id);
  }, [screen, running, offlineMode, sessionDocRef]);

  // 🔔 One-shot heartbeat when app comes to foreground (even if still paused)
  useEffect(() => {
    if (!sessionDocRef) return;
    const sub = AppState.addEventListener('change', async (state) => {
      if (state === 'active' && screen === 'timer' && !offlineMode) {
        try {
          const now = new Date().toISOString();
          await updateDoc(
            sessionDocRef,
            {
              lastUpdate: now,
              lastHeartbeat: serverTimestamp(),
            },
            { merge: true }
          );
        } catch (err) {
          console.error('❌ Foreground heartbeat failed:', err);
        }
      }
    });
    return () => sub.remove();
  }, [sessionDocRef, screen, offlineMode]);

  // 🔔 When user backgrounds the app, schedule Yellow/Red notifications ahead of time.
  // When they return to the app, cancel them (so you don’t double-alert).
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (nextState) => {
      const prevState = appStateRef.current;
      appStateRef.current = nextState;

      if (nextState === 'active') {
        bgNotifScheduledRef.current = false;

        const nowMs = Date.now();

        // ✅ IMPORTANT: set suppression flags BEFORE awaiting notification cancel,
        // otherwise the foreground Yellow effect can race and fire first.
        if (
          yellowNotifEnabled &&
          scheduledYellowAtRef.current &&
          nowMs >= scheduledYellowAtRef.current
        ) {
          suppressYellowOnResumeRef.current = true;
          yellowPlayedRef.current = true;
          setYellowPlayed(true);
        }

        if (
          redNotifEnabled &&
          scheduledRedAtRef.current &&
          nowMs >= scheduledRedAtRef.current
        ) {
          suppressRedOnResumeRef.current = true;
          redPlayedRef.current = true;
        }

        // Keep timer state visually in sync immediately
        syncAlertFlagsFromCurrentTimerState();

        // Then clean up any remaining scheduled/delivered notifications
        await cancelPhaseNotifications();

        return;
      }
      // ✅ ONLY schedule on actual background (not iOS inactive)
      const leavingActiveForScheduling =
        Platform.OS === 'ios'
          ? (nextState === 'inactive' || nextState === 'background')
          : nextState === 'background';

      if (
        prevState === 'active' &&
        leavingActiveForScheduling &&
        !bgNotifScheduledRef.current
      ) {
        bgNotifScheduledRef.current = true;

        const anyNotificationsEnabled = yellowNotifEnabled || redNotifEnabled;

        // ✅ Show helper once automatically on Android the first time
        // we background during a running timer (right when we schedule alerts)
        if (anyNotificationsEnabled && screen === 'timer' && running && !isSampleDemoActive) {
          maybeShowBgNotifReliabilityHelper();
        }

        if (anyNotificationsEnabled) {
          await schedulePhaseNotifications();
        }
      }
    });

    return () => sub.remove();
  }, [
    screen,
    running,
    timeLeft,
    currentIndex,
    agendaItems,
    isSampleDemoActive,
    title,
    yellowNotifEnabled,
    redNotifEnabled,
  ]);

  // 🔔 If we leave the timer screen or stop running, cancel any scheduled phase notifications
  useEffect(() => {
    if (screen !== 'timer' || !running) {
      cancelPhaseNotifications();
    }
  }, [screen, running]);

  // ⏳ Splash Screen Timeout (keep it short; auth bootstrap decides what happens next)
  useEffect(() => {
    if (screen !== 'splash') return;

    const timer = setTimeout(async () => {
      logUserEvent('app_launch', {}, 'splash').catch(() => {});
      
      try {
        const saved = await AsyncStorage.getItem('@userInfo');
        if (saved) {
          const { userId } = JSON.parse(saved);
          setUserId(userId || '');
          setLocalSessionId('');
        }
      } catch (e) {
        console.warn('⚠️ Could not load user info:', e);
      }

      // Auth listener will also drive navigation; this is just a quick handoff.
      // ✅ Decide first-run auto-demo BEFORE showing prestart (so overlay can render immediately)
      try {
        const alreadyAutoRan = await AsyncStorage.getItem(FIRST_OPEN_AUTODEMO_KEY);
        const seenSample = await AsyncStorage.getItem(SAMPLE_MEETING_FIRSTRUN_KEY);
        const quickStartDisabled = await AsyncStorage.getItem(QUICKSTART_STORAGE_KEY);

        console.log('[AutoDemo gate]', {
          alreadyAutoRan: !!alreadyAutoRan,
          seenSample: !!seenSample,
          quickStartDisabled: !!quickStartDisabled,
        });

        const shouldAutoDemo = !alreadyAutoRan && !seenSample && !quickStartDisabled;

        logUserEvent(
          'autodemo_gate',
          {
            alreadyAutoRan: !!alreadyAutoRan,
            seenSample: !!seenSample,
            quickStartDisabled: !!quickStartDisabled,
            shouldAutoDemo,
          },
          screen
        ).catch(() => {});

        if (shouldAutoDemo) {
          autoDemoRanRef.current = true;

          setShowQuickStart(false);
          setAutoDemoBooting(true);
          pendingAutoDemoStartRef.current = true;

          console.log('[AutoDemo] queued from splash gate', {
            shouldAutoDemo: true,
            t: Date.now(),
          });

          logUserEvent('demo_auto_start', {}, 'splash').catch(() => {});

          // Start directly from the gate instead of waiting for a second effect
          
          const elapsed = Date.now() - splashStartRef.current;
          const minSplash = 2400;
          const delay = Math.max(0, minSplash - elapsed);
          
          setTimeout(async () => {
            try {
              const liveUid = auth.currentUser?.uid || userId || '';

              console.log('[AutoDemo] direct start from splash gate', {
                liveUid: !!liveUid,
                authUid: auth.currentUser?.uid || null,
                userId,
                authReady,
                profileReady,
                t: Date.now(),
              });

              // keep state aligned if Firebase already has a user
              if (liveUid && userId !== liveUid) {
                setUserId(liveUid);
              }

              // normalize boot flags for DEV RESET path
              if (liveUid) {
                setAuthReady(true);
                setProfileReady(true);
              }

              pendingAutoDemoStartRef.current = false;
              await startSampleMeetingFromQuickStart();
              setAutoDemoBooting(false);
            } catch (e) {
              console.warn('[AutoDemo direct start failed]', e?.message || e);
              pendingAutoDemoStartRef.current = false;
              setAutoDemoBooting(false);
              setScreen('prestart');
            }
          }, delay);

          return;
        }

        logUserEvent('demo_not_started', {}, 'splash').catch(() => {});
      } catch (e) {
        console.warn('Splash auto-demo check failed:', e?.message || e);
      }

      // normal path
      setScreen('prestart');

    }, 1200);

    return () => clearTimeout(timer);
  }, [screen]);

  useEffect(() => {
    (async () => {
      try {
        const savedOrg = await AsyncStorage.getItem('@orgId');
        if (savedOrg) setOrgId(savedOrg);
      } catch {}
    })();
  }, []);

  // 🌟 Rehydrate Quick-Start disabled flag on app launch
  useEffect(() => {
    (async () => {
      try {
        const seen = await AsyncStorage.getItem(QUICKSTART_STORAGE_KEY);
        setQuickStartDisabled(!!seen); // ✅ drives "Show Quick-Start again" visibility in Settings
      } catch (e) {
        console.warn('⚠️ Failed to load quick-start flag (rehydrate)', e);
        // fail-open: treat as not disabled
        setQuickStartDisabled(false);
      }
    })();
  }, []);

  // 🧠 Load persisted threshold settings
  useEffect(() => {
    (async () => {
      try {
        const savedAdv = await AsyncStorage.getItem('@advancedThresholdsEnabled');
        if (savedAdv != null) setAdvancedThresholdsEnabled(savedAdv === 'true');

        const savedBasis = await AsyncStorage.getItem('@thresholdBasis');
        if (savedBasis === 'percent' || savedBasis === 'seconds') {
          setThresholdBasis(savedBasis);
        }
        const savedAuto = await AsyncStorage.getItem('@autoAdvanceEnabled');
        if (savedAuto != null) setAutoAdvanceEnabled(savedAuto === 'true');

        const savedRespectCap = await AsyncStorage.getItem('@respectPlannedMeetingLength');
        if (savedRespectCap != null) setRespectPlannedMeetingLength(savedRespectCap === 'true');
        // ✅ Mark done only after all reads have completed

        const savedYellowNotif = await AsyncStorage.getItem('@yellowNotifEnabled');
        if (savedYellowNotif != null) setYellowNotifEnabled(savedYellowNotif === 'true');

        const savedRedNotif = await AsyncStorage.getItem('@redNotifEnabled');
        if (savedRedNotif != null) setRedNotifEnabled(savedRedNotif === 'true');

        const savedHelper = await AsyncStorage.getItem('@bgNotifHelperShown');
        if (savedHelper != null) setBgNotifHelperShown(savedHelper === 'true');

        const savedAlarm = await AsyncStorage.getItem('@alarmEnabled');
        if (savedAlarm != null) setAlarmEnabled(savedAlarm === 'true');

        const savedBuzzer = await AsyncStorage.getItem('@buzzerEnabled');
        if (savedBuzzer != null) setBuzzerEnabled(savedBuzzer === 'true');

        const savedConfetti = await AsyncStorage.getItem('@confettiEnabled');
        if (savedConfetti !== null) {
          setConfettiEnabled(savedConfetti === 'true');
        }

        setPrefsLoaded(true);
      } catch (e) {
        console.warn('⚠️ Failed to load threshold prefs:', e);
      }
    })();
  }, []);

  // 🔒 Persist threshold settings whenever they change
  useEffect(() => {
    if (!prefsLoaded) return; // don’t overwrite storage on first render
    (async () => {
      try {
        await AsyncStorage.setItem(
          '@advancedThresholdsEnabled',
          String(advancedThresholdsEnabled)
        );
        await AsyncStorage.setItem('@thresholdBasis', thresholdBasis);
      } catch (e) {
        console.warn('⚠️ Failed to save threshold prefs:', e);
      }
    })();
  }, [advancedThresholdsEnabled, thresholdBasis, prefsLoaded]);

  // 💾 Persist auto-advance toggle whenever it changes
  useEffect(() => {
    if (!prefsLoaded) return; // don’t clobber saved value with default
    (async () => {
      try {
        await AsyncStorage.setItem('@autoAdvanceEnabled', String(autoAdvanceEnabled));
      } catch (e) {
        console.warn('⚠️ Failed to save auto-advance preference:', e);
      }
    })();
  }, [autoAdvanceEnabled, prefsLoaded]);

  // 💾 Persist meeting cap warning preference
  useEffect(() => {
    if (!prefsLoaded) return;
    (async () => {
      try {
        await AsyncStorage.setItem(
          '@respectPlannedMeetingLength',
          String(respectPlannedMeetingLength)
        );
      } catch (e) {
        console.warn('⚠️ Failed to save meeting cap preference:', e);
      }
    })();
  }, [respectPlannedMeetingLength, prefsLoaded]);

  // 💾 Persist yellow notification toggle
  useEffect(() => {
    if (!prefsLoaded) return;
    (async () => {
      try {
        await AsyncStorage.setItem('@yellowNotifEnabled', String(yellowNotifEnabled));
      } catch (e) {
        console.warn('⚠️ Failed to save yellowNotifEnabled pref:', e);
      }
    })();
  }, [yellowNotifEnabled, prefsLoaded]);

  // 💾 Persist red notification toggle
  useEffect(() => {
    if (!prefsLoaded) return;
    (async () => {
      try {
        await AsyncStorage.setItem('@redNotifEnabled', String(redNotifEnabled));
      } catch (e) {
        console.warn('⚠️ Failed to save redNotifEnabled pref:', e);
      }
    })();
  }, [redNotifEnabled, prefsLoaded]);

  // 💾 Persist "helper shown" flag
  useEffect(() => {
    if (!prefsLoaded) return;
    (async () => {
      try {
        await AsyncStorage.setItem('@bgNotifHelperShown', String(bgNotifHelperShown));
      } catch (e) {
        console.warn('⚠️ Failed to save bgNotifHelperShown pref:', e);
      }
    })();
  }, [bgNotifHelperShown, prefsLoaded]);

  // 🌐 Sync confetti preference to viewer (so viewer matches app)
  useEffect(() => {
    if (!prefsLoaded) return;

    (async () => {
      try {
        if (!offlineMode && auth.currentUser && !auth.currentUser.isAnonymous) {
          await ensureUserDoc(undefined, { viewerConfettiEnabled: confettiEnabled });
          await syncViewerPublicFlags(auth.currentUser.uid, {
            viewerConfettiEnabled: confettiEnabled,
          });
        }
      } catch (e) {
        console.warn('⚠️ Failed to sync confetti preference to viewer:', e?.message || e);
      }
    })();
  }, [prefsLoaded, confettiEnabled, offlineMode]);

  // 🔇 Ensure keyboard is closed on emailAuth until user taps a field
  useEffect(() => {
    if (screen === 'emailAuth') {
      requestAnimationFrame(() => {
        emailRef.current?.blur?.();
        passwordRef.current?.blur?.();
        Keyboard.dismiss();
      });
    }
  }, [screen]);

  useEffect(() => {
    let unsubscribe = () => {}; // will hold the Firebase cleanup
    let isMounted = true; // avoid state updates after unmount

    (async () => {
      // (optional) these are unused; remove if you don't need them
      // const storedUID = await AsyncStorage.getItem('firebaseUID');
      // const storedMode = await AsyncStorage.getItem('authMode');

      const isConnected = await checkInternetConnection();
      if (!isMounted) return;

      if (!isConnected) {
        console.warn('📴 Offline on app launch — entering offlineMode');
        setOfflineMode(true);
        setUserId('local-only');
        setAuthMode('offline');
        setScreen('prestart');
        return; // no auth listener in true offline start
      }

      setOfflineMode(false);

      // Register the listener and stash its cleanup in outer scope
      unsubscribe = onAuthStateChanged(auth, async (user) => {
        if (!isMounted) return;

        if (user) {
          try {
            await user.reload();
          } catch (e) {
            console.warn('reload() failed:', e?.message || e);
          }
          setUserId(user.uid);

          // If switching users, wipe local "Recent" titles so we don't leak between accounts
          try {
            if (lastUidRef.current && lastUidRef.current !== user.uid) {
              await clearRecentTitles(); // this already sets state to []
              console.log(
                '🧹 Cleared recents on user switch:',
                lastUidRef.current,
                '→',
                user.uid
              );
            }
          } catch (e) {
            console.warn('Failed to clear recents on user switch:', e?.message || e);
          }
          lastUidRef.current = user.uid;

          // Detect provider(s)
          const provs = user.providerData?.map((p) => p.providerId) || [];
          const isGoogle = provs.includes('google.com');
          const isApple = provs.includes('apple.com');

          // For federated providers, treat as verified (provider-verified)
          setEmailVerified(isGoogle || isApple ? true : !!user.emailVerified);

          // Set auth mode accurately
          setAuthMode(
            user.isAnonymous
              ? 'anonymous'
              : isGoogle
                ? 'google'
                : isApple
                  ? 'apple'
                  : 'email'
          );

          // We’re about to (re)create the profile doc
          setProfileReady(false);

          // Ensure profile doc exists before anyone touches subcollections
          try {
            const prov =
              user.providerData?.[0]?.providerId ||
              (user.isAnonymous ? 'anonymous' : 'email');
            await ensureUserDoc(user.uid, {
              provider: prov === 'google.com' ? 'google' : prov,
              ...(user.email ? { email: user.email } : {}),
              ...(user.displayName ? { displayName: user.displayName } : {}),
            });
            // small settle so rules/indexes are definitely ready
            await new Promise((r) => setTimeout(r, 300));
            setProfileReady(true); // ✅ profile doc is there now

            // 🔐 Belt-and-suspenders: after auth is established, re-check RC entitlements
            // and stamp isProUser/viewerAdsDisabled for THIS uid (so viewer flags stay in sync)
            if (!user.isAnonymous && isRevenueCatReady) {
              try {
                await refreshRevenueCatEntitlements(user.uid);
              } catch (e) {
                console.warn(
                  '[RC] refreshRevenueCatEntitlements after auth failed',
                  e?.message || String(e)
                );
              }
            }
          } catch (e) {
            console.warn(
              'ensureUserDoc during auth watcher failed:',
              e?.message || String(e)
            );
            setProfileReady(false);
          }

          console.log('[Auth] ready', {
            uid: user?.uid,
            isAnonymous: user?.isAnonymous,
            t: Date.now(),
          });

          // Mark auth bootstrapped so Firestore reads can proceed
          setAuthReady(true);

          // ✅ Let the Splash flow decide whether to auto-demo.
          // If we navigate away from splash immediately, we cancel the splash timer (and skip auto-demo).
          if (screen !== 'splash') {
            setScreen('prestart');
          }

          try {
            await initAds(user.email || '');
          } catch (e) {
            console.warn('ads init failed', e);
          }
        } else {
          if (!suppressAutoAnonRef.current && !triedAnonRef.current) {
            triedAnonRef.current = true;
            try {
              const res = await signInAnonymously(auth);
              await AsyncStorage.setItem('firebaseUID', res.user.uid);
              await AsyncStorage.setItem('authMode', 'anonymous');
              setUserId(res.user.uid);
              setAuthMode('anonymous');
              // ✅ Let Splash decide whether to auto-demo.
              // If we navigate away from splash immediately, we cancel the splash timer (and skip auto-demo).
              if (screen !== 'splash') {
                setScreen('prestart');
              } else {
                console.log('[Splash] anon auth ready; staying on splash so auto-demo gate can run');
              }

              try {
                await initAds('');
              } catch (e) {
                console.warn('ads init (anon) failed', e);
              }
            } catch (e) {
              console.warn('Anonymous sign-in failed:', e?.message || e);
              setAuthMode('login');
              setUserId('');
              setAuthScreenMode('login');
              setScreen('emailAuth');
            }
          } else if (suppressAutoAnonRef.current) {
            console.log('🔇 Auto-anon suppressed during Google sign-in.');
          }
        }
      });
    })();

    // ✅ React will call this on unmount
    return () => {
      isMounted = false;
      unsubscribe(); // safe no-op if never set
    };
  }, []);

  useEffect(() => {
    setConfirmEmail('');
    setConfirmPassword('');
    setFieldErrors({ email: '', confirmEmail: '', password: '', confirmPassword: '' });
  }, [authScreenMode]);

  // After a successful UPGRADE (linking anon → real account), bounce back to prestart
  useEffect(() => {
    if (
      authScreenMode === 'upgrade' &&
      (authMode === 'email' || authMode === 'google' || authMode === 'apple')
    ) {
      setAuthScreenMode('login'); // collapse/reset the auth sheet
      setScreen('prestart'); // return to launcher
    }
  }, [authScreenMode, authMode]);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const isConnected = state.isConnected && state.isInternetReachable;

      if (!isConnected && !offlineMode) {
        console.warn('📴 Lost connection');
        setOfflineMode(true);
        setConnectionStatus('offline');
      }

      if (isConnected && offlineMode) {
        console.log('🌐 Reconnected — resuming sync');
        setOfflineMode(false);
        setConnectionStatus('online');
        setTimeout(() => setConnectionStatus(null), 4000);

        // ✅ Force sync re-init after reconnect
        recoverFirestoreSync();
      }
    });

    return () => unsubscribe();
  }, [offlineMode, sessionDocRef, currentIndex, agendaItems, running]);

  // ⏸️ Pause Timer
  useEffect(() => {
    let pauseInterval;

    if (screen === 'timer' && !running && pauseStartRef.current) {
      pauseInterval = setInterval(() => {
        const now = Date.now();
        const elapsedPause = now - pauseStartRef.current;
        const totalPause = pausedDuration + elapsedPause;
        const totalPauseSec = Math.floor(totalPause / 1000);

        setLivePauseTime(totalPauseSec);

        if (!offlineMode && sessionDocRef) {
          updateDoc(
            sessionDocRef,
            { livePausedTime: totalPauseSec },
            { merge: true }
          ).catch((err) => console.error('❌ Failed to push paused time:', err));
        }
      }, 1000);
    } else if (!pauseStartRef.current) {
      const totalPauseSec = Math.floor(pausedDuration / 1000);
      setLivePauseTime(totalPauseSec);
    }

    return () => clearInterval(pauseInterval);
  }, [screen, running, pausedDuration]);

  // 🔔 Time Zero Logic
  useEffect(() => {
    if (screen === 'timer' && timeLeft === 0) {
      console.log('⏰ Time hit 0 for item:', agendaItems[currentIndex]?.title);

      const isFinalItem = currentIndex === agendaItems.length - 1;

      // Alert once at time zero (prefer notification, fallback to sound)
      if (!redPlayedRef.current && !isSampleDemoActive) {
        const meetingName = title || 'AgendaGlow';
        const itemTitle = agendaItems[currentIndex]?.title || `Item ${currentIndex + 1}`;

        (async () => {
          await notifyOrPlayFallback({
            kind: 'red',
            meetingName,
            itemTitle,
          });
        })();

        redPlayedRef.current = true; // ✅ always mark as played
      }

      const shouldAutoAdvance = autoAdvanceEnabled || demoNoOvertime; // ✅ demo always advances
      if (shouldAutoAdvance) {
        // 🔁 Legacy behavior: auto-proceed (keep your existing final-item/ad flow)
        // ✅ Clear any previous pending auto-advance (prevents replay races)
        if (advanceTimeoutRef.current) {
          clearTimeout(advanceTimeoutRef.current);
          advanceTimeoutRef.current = null;
        }

        const completedAtMs = Date.now(); // ✅ stamp completion at the moment time expired

        advanceTimeoutRef.current = setTimeout(() => {
          // once it fires, clear the ref
          advanceTimeoutRef.current = null;

          if (isFinalItem) {
            console.log('➡️ Final item complete — recording and summarizing…');

            recordCurrentItemToSummary(completedAtMs); // ✅ use stamped time (not delayed)

            finalItemCompleted.current = true;
            setSummaryPending(true);
            setRunning(false);
            setEndTimestamp(completedAtMs); // ✅ keep consistent

            stopAudioBeforeAd().catch(() => {});

            if (!offlineMode && sessionDocRef) {
              (async () => {
                try {
                  await updateDoc(
                    sessionDocRef,
                    {
                      status: 'Complete',
                      canResume: false,
                      lastUpdate: new Date().toISOString(),
                      lastHeartbeat: serverTimestamp(),
                    },
                    { merge: true }
                  );
                } catch (e) {
                  console.warn('⚠️ Failed to mark session complete (auto-finish):', e?.message || e);
                }
              })();
            }

            handleMeetingCompleted().catch((e) =>
              console.warn('⚠️ handleMeetingCompleted failed:', e)
            );
            setScreen('summary');
            maybeShowSummaryInterstitial();
          } else {
            console.log('➡️ Time expired — advancing to next item...');
            goToNextItem();
          }
        }, isFinalItem ? 2500 : 0);

      } else {
        // User-configured behavior (NON-DEMO only):
        // - normal sessions: allow overtime when auto-advance is off
        // - demo sessions: ALWAYS auto-advance (never overtime)
        if (demoNoOvertime) {
          setRunning(false); // stop the clock at 0 (no count-up)
          setOvertimeMode(false);
          setOvertimeSec(0);
        } else {
          setOvertimeMode(true);
        }
      }
    }
      return () => {
        if (advanceTimeoutRef.current) {
          clearTimeout(advanceTimeoutRef.current);
          advanceTimeoutRef.current = null;
        }
      };
  }, [
  screen,
  timeLeft,
  autoAdvanceEnabled,
  demoNoOvertime,
  buzzerEnabled,
  isSampleDemoActive,
  currentIndex,
  agendaItems.length,
  offlineMode,
  sessionDocRef,
  isNoAdsMode,
  isProUser,
]);

  // 📦 Final Summary Push Trigger
  useEffect(() => {
    if (finalItemManuallySkipped.current || finalItemCompleted.current) {
      if (summary.length === agendaItems.length) {
        console.log('✅ All items summarized, pushing to Firestore...');
        pushFinalSummaryToFirestore();
      }
    }
  }, [summary]);

  // ✅ Keep lastSummaryRef in sync with summary state
  useEffect(() => {
    if (summary && summary.length) {
      lastSummaryRef.current = summary;
    }
  }, [summary]);

  // 🔔 Yellow Alarm
  useEffect(() => {
    if (screen !== 'timer') return;
    if (isSampleDemoActive) return;

    const item = agendaItems[currentIndex];
    if (!item) return;

    const duration = item.duration * 60;
    const elapsed = duration - timeLeft;
    const yellowThreshold = duration * (item.yellow ?? 0.66666);

    if (elapsed >= yellowThreshold && !yellowPlayedRef.current) {
      // 🚫 If Yellow already fired in background for this item, suppress one replay on resume
      if (suppressYellowOnResumeRef.current) {
        suppressYellowOnResumeRef.current = false;
        yellowPlayedRef.current = true;
        setYellowPlayed(true);
        return;
      }

      const meetingName = title || 'AgendaGlow';
      const itemTitle = agendaItems[currentIndex]?.title || `Item ${currentIndex + 1}`;

      yellowPlayedRef.current = true;
      setYellowPlayed(true);

      (async () => {
        await notifyOrPlayFallback({
          kind: 'yellow',
          meetingName,
          itemTitle,
        });
      })();
    }
  }, [timeLeft, agendaItems, currentIndex, screen, isSampleDemoActive, title]);

  // 💡 Start Branding Animation
  useEffect(() => {
    if (['splash', 'setup', 'summary', 'settings', 'timer'].includes(screen)) {
      const timeout = setTimeout(() => {
        startPulseAnimation();
      }, 100);

      return () => {
        clearTimeout(timeout);
        stopPulseAnimation();
      };
    }
  }, [screen]);

  // Keep the latest screen value available inside ad callbacks
  const screenRef = useRef('splash');
  useEffect(() => {
    screenRef.current = screen;
  }, [screen]);

  // When user becomes Pro, clear any "loaded" flags and load states
  useEffect(() => {
    if (isProUser) {
      interstitialLoaded.current = false;
      rewardedLoaded.current = false;
      isLoadingInterstitial.current = false;
      isLoadingRewarded.current = false;
    }
  }, [isProUser]);

  // 🎬 Interstitial Ad Lifecycle
  const [canShowReward, setCanShowReward] = useState(false);

  useEffect(() => {
    const interstitial = interstitialRef.current;
    const rewarded = rewardedRef.current;
    if (
      !adsReady ||
      !interstitial ||
      !rewarded ||
      isProUser ||
      isNoAdsMode ||
      suppressFullscreenAds ||
      !adsUnlockedByUsage
    ) return;

    // INTERSTITIAL
    const iLoaded = interstitial.addAdEventListener(AdEventType.LOADED, () => {
      console.log('✅ Interstitial loaded');
      interstitialLoaded.current = true;
      isLoadingInterstitial.current = false;
      resetBackoff(interstitialBackoffMs);
    });
    const iError = interstitial.addAdEventListener(AdEventType.ERROR, (error) => {
      console.warn('🚨 Interstitial failed:', error);
      interstitialLoaded.current = false;
      isLoadingInterstitial.current = false;
      const delay = nextBackoff(interstitialBackoffMs);
      setTimeout(loadInterstitial, delay);
    });
    const iClosed = interstitial.addAdEventListener(AdEventType.CLOSED, () => {
      console.log('✅ Interstitial closed');
      interstitialLoaded.current = false;
      loadInterstitial(); // warm next

      // ✅ Setup → Start flow: now that the interstitial is gone, start the meeting
      if (pendingAction.current === 'startTimer') {
        pendingAction.current = null;
        setDeferredStartFromSetup(true);
        return;
      }

      if (pendingAction.current === 'loadCSV') {
        pendingAction.current = null;
        return setTimeout(() => loadAgendaFromCSV(), 300);
      }
      if (pendingAction.current === 'shareLink') {
        pendingAction.current = null;
        return setTimeout(() => {
          syncAgendaPreviewToFirestore()
            .catch((e) => console.warn('⚠️ Preview sync failed before share:', e?.message || e))
            .finally(() => setScreen('sharelink'));
        }, 100);
      }
      if (pendingAction.current === 'exportSummary') {
        pendingAction.current = null;
        return setTimeout(() => exportSummary(), 150);
      }

      if (finalItemCompleted.current || finalItemManuallySkipped.current) {
        setRunning(false);
        justFinishedMeetingRef.current = true;
        setScreen('summary');
        setSummaryPending(false);
        finalItemCompleted.current = false;
        finalItemManuallySkipped.current = false;
      }
    });

    // REWARDED
    const rLoaded = rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {
      console.log('✅ Rewarded ad loaded');
      rewardedLoaded.current = true;
      isLoadingRewarded.current = false;
      resetBackoff(rewardedBackoffMs);
      setCanShowReward(true);
    });
    const rError = rewarded.addAdEventListener(AdEventType.ERROR, (error) => {
      console.warn('🚨 Rewarded ad error:', error);
      rewardedLoaded.current = false;
      isLoadingRewarded.current = false;
      const delay = nextBackoff(rewardedBackoffMs);
      setTimeout(loadRewarded, delay);
    });
    const rEarned = rewarded.addAdEventListener(
      RewardedAdEventType.EARNED_REWARD,
      (reward) => {
        console.log(`🎁 Reward earned: ${reward.amount} ${reward.type}`);
        const intent = pendingAction.current;
        pendingAction.current = null;
        if (intent === 'loadCSV') return setTimeout(() => loadAgendaFromCSV(), 500);
        if (intent === 'shareLink')
          return setTimeout(() => {
            syncAgendaPreviewToFirestore()
              .catch((e) => console.warn('⚠️ Preview sync failed before share:', e?.message || e))
              .finally(() => setScreen('sharelink'));
          }, 200);
        if (intent === 'exportSummary') return setTimeout(() => exportSummary(), 200);
      }
    );
    const rClosed = rewarded.addAdEventListener(AdEventType.CLOSED, () => {
      console.log('🎬 Rewarded ad closed');
      rewardedLoaded.current = false;
      setCanShowReward(false);
      setTimeout(loadRewarded, 1000);

      if (pendingAction.current) {
        console.warn(`❌ Action "${pendingAction.current}" canceled (no reward earned)`);
        pendingAction.current = null;
      }
      setRunning(false);
      if (screenRef.current === 'timer') setScreen('setup');
    });

    // Warm after listeners are attached:
    loadRewarded();
    loadInterstitial();

    return () => {
      try {
        iLoaded();
        iError();
        iClosed();
        rLoaded();
        rError();
        rEarned();
        rClosed();
      } catch {}
    };
  }, [adsReady, isProUser, isNoAdsMode, suppressFullscreenAds]);

  useEffect(() => {
    if (screen === 'setup' && agendaItems.length === 0) {
      console.warn('🛠️ No agenda items found. Inserting default.');
      setAgendaItems([createEmptyAgendaItem()]);
    }
  }, [screen]);

  // 🔁 Helper: run whatever action was waiting on an ad
  const runPendingActionImmediately = () => {
    const action = pendingAction.current;
    pendingAction.current = null;
    if (!action) return;

    if (action === 'loadCSV') {
      return loadAgendaFromCSV();
    }
    if (action === 'shareLink') {
      // ✅ Ensure the session is written before showing the QR/link
      syncAgendaPreviewToFirestore()
        .catch((e) => console.warn('⚠️ Preview sync failed before share:', e?.message || e))
        .finally(() => setScreen('sharelink'));
      return;
    }
    if (action === 'exportSummary') {
      return exportSummary();
    }
  };

  // 👇 Usage-gated action wall: Prefer REWARDED; fallback to INTERSTITIAL; else house modal.
  const gateActionWithRewardedFirst = async (intent) => {
    if (
      !showRewardedAds ||
      isProUser ||
      isNoAdsMode ||
      suppressFullscreenAds ||
      !adsUnlockedByUsage
    ) {
      console.log('[gate] Ads disabled / gated by usage / user is Pro, proceeding with', intent);
      if (intent === 'loadCSV') return loadAgendaFromCSV();
      if (intent === 'shareLink') return setScreen('sharelink');
      if (intent === 'exportSummary') return exportSummary();
      return;
    }

    // Record what the user is trying to do (e.g. 'loadCSV', 'shareLink', 'exportSummary')
    pendingAction.current = intent;

    // Always stop any in-flight audio before an ad
    await stopAudioBeforeAd();

    // 🧪 If we're forcing the house rewarded modal, show it now and bail
    if (FORCE_HOUSE_REWARDED) {
      console.log('[gate] FORCE_HOUSE_REWARDED enabled → showing house reward modal');
      setShowHouseRewardModal(true);
      return;
    }

    // 1) Try Rewarded first, if loaded
    if (rewardedLoaded.current && rewardedRef.current) {
      console.log('[ads] Showing RewardedAd for intent:', intent);
      try {
        const toShow = rewardedRef.current;
        rewardedLoaded.current = false; // mark as consumed
        toShow.show();
        return;
      } catch (e) {
        console.warn(
          '[ads] RewardedAd show() failed, trying interstitial as fallback:',
          e
        );
      }
    }

    // 2) Try interstitial as fallback
    if (interstitialLoaded.current && interstitialRef.current) {
      console.log('[ads] Fallback to InterstitialAd for intent:', intent);
      try {
        const toShow = interstitialRef.current;
        interstitialLoaded.current = false;
        setTimeout(() => {
          try {
            toShow?.show();
          } catch (e) {
            console.warn('[ads] InterstitialAd show() failed as fallback:', e);
            // 👇 Fallback to house reward modal if even this fails
            setShowHouseRewardModal(true);
          }
        }, 150);
        return;
      } catch (e) {
        console.warn('[ads] Interstitial fallback threw synchronously:', e);
      }
    }

    // 3) No network ad available → show your own "reward" modal
    console.log(
      '[ads] No network Rewarded/Interstitial available → showing house reward modal.'
    );
    loadRewarded(); // ✅ start loading rewarded for next time
    loadInterstitial(); // ✅ and/or interstitial
    setShowHouseRewardModal(true);
  };

  const pickYellowSound = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*' });
    if (result.assets && result.assets.length > 0 && result.assets[0].uri) {
      console.log('🎵 Yellow sound selected:', result.assets[0].uri);
      setCustomYellowUri(result.assets[0].uri);
    }
  };

  const pickRedSound = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*' });
    if (result.assets && result.assets.length > 0 && result.assets[0].uri) {
      console.log('🎵 Red sound selected:', result.assets[0].uri);
      setCustomRedUri(result.assets[0].uri);
    }
  };

  const formatMMSS = (sec) => {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  };

  const formatTimestamp24 = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);

    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');

    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');

    return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
  };

  const cleanExcelText = (s) =>
    (s || '').replace(/\u202F/g, ' ').replace(/\u00A0/g, ' ');

  const exportSummary = async () => {
    // Helper so we always export what the Summary screen is showing
    const getExportData = () => {
      if (Array.isArray(summary) && summary.length) return summary;
      if (Array.isArray(lastSummaryRef.current) && lastSummaryRef.current.length) {
        return lastSummaryRef.current;
      }
      return [];
    };

    let data = getExportData();

    // In case we arrived right as the last item committed, give React a tick to settle
    if (!data.length) {
      await new Promise((r) => setTimeout(r, 50));
      data = getExportData();
    }

    if (!data.length) {
      Alert.alert('Nothing to export', 'Run the timer first.');
      return;
    }

    const header =
      'Item #,Title,Presenter,Notes,Duration (min),Reached Yellow,Reached Red,Time Spent (mm:ss),Paused (mm:ss),Started At,Completed At,Started At (ISO),Completed At (ISO),Agenda Title';

    const lines = data.map((item, i) => {
      const safeTitle = String(item.title ?? '').replace(/"/g, '""');
      const safePresenter = String(item.presenterTag ?? '').replace(/"/g, '""');
      const safeNotes = String(item.info ?? '').replace(/"/g, '""');

      const safeAgendaTitle = (title || '').replace(/"/g, '""');

      return `${i + 1},"${safeTitle}","${safePresenter}","${safeNotes}",${item.duration},${item.reachedYellow},${item.reachedRed},"${formatMMSS(item.timeSpent)}","${formatMMSS(item.pausedDuration)}","${formatTimestamp24(item.startedAt)}","${formatTimestamp24(item.completedAt)}","${item.startedAt}","${item.completedAt}","${safeAgendaTitle}"`;
    });

    const content = '\uFEFF' + [header, ...lines].join('\n');
    const fileUri = FileSystem.documentDirectory + 'meeting_summary.csv';

    try {
      await FileSystem.writeAsStringAsync(fileUri, content);
      await Sharing.shareAsync(fileUri);
    } finally {
      // 🧭 After the share sheet closes (even if user cancels), return to Summary
      setScreen('summary');
    }
  };

  const handleBackFromSetup = async () => {
    // No “Leave setup?” prompt anymore

    try {
      await AsyncStorage.removeItem('@userInfo');
    } catch {}

    setIsEditingAgendaTitle(false);
    setAgendaTitleDraft('');

    // Clear session edit state
    setAgendaItems([]);
    setOriginalAgenda && setOriginalAgenda([]); // if defined in your file
    setTitle('');
    setCurrentIndex && setCurrentIndex(0); // if defined
    setLocalSessionId && setLocalSessionId(''); // if defined
    setSummary && setSummary([]); // if defined

    // Go back to template chooser
    setScreen('prestart');
  };


  const goBottomNav = async (target) => {

    // ✅ Summary-only: hijack one nav button to export
    if (!isSampleDemoActive && screen === 'summary' && target === 'more') {
      gateActionWithRewardedFirst('exportSummary');
      return;
    }

    if (target === screen) return;

    // Prevent accidental navigation during an active meeting
    if (screen === 'timer' && running) {
      Alert.alert(
        'Meeting in progress',
        'Pause or finish the meeting before leaving this screen.',
        [{ text: 'OK' }]
      );
      return;
    }

    // Optional: if you want summary to be “safe”, allow it freely.
    
    // 🧹 When entering Templates, don't keep a draft title from Home
    if (target === 'templates') {
      setLocalSessionId('');
      // optional: also clear copy/template selections if you want Templates to be "clean"
      // setCopySourceId(null);
      // setSelectedTemplateSessionId(null);
    }

    // 🧹 Summary → Home: start clean (don't carry last agenda title into "New Agenda Title")
    if (target === 'prestart' && screen === 'summary') {
      setLocalSessionId('');
      setTitle('');
      setAgendaTitleDraft(''); // optional but consistent with your demo-reset behavior

      // optional: clear any template/copy selections so Home is truly "new"
      setCopySourceId(null);
      setSelectedTemplateSessionId(null);
    }

    // 👤 "Me" routes to account management (not a dedicated screen)
    if (target === 'me') {
      if (offlineMode) {
        Alert.alert('Offline', 'Account management requires an internet connection.');
        return;
      }
      setAuthScreenMode(auth.currentUser?.isAnonymous ? 'upgrade' : 'login');
      setScreen('emailAuth');
      return;
    } 
    setScreen(target);
  };

  // 🗂️ Save Agenda Template
  const saveTemplate = async () => {
    try {
      await AsyncStorage.setItem('@agendaTemplate', JSON.stringify(agendaItems));
      alert('Template saved!');
    } catch (e) {
      console.error('Save failed:', e);
      alert('Failed to save template.');
    }
  };

  // 📂 Load Agenda Template (with validation)
  const loadTemplate = async () => {
    try {
      const storedAgenda = await AsyncStorage.getItem('@agendaTemplate');
      if (storedAgenda !== null) {
        const parsed = JSON.parse(storedAgenda);
        const validated = parsed.map((item, i) => {
          const base = createEmptyAgendaItem(); // provides id + defaults
          return {
            ...base,
            title: typeof item.title === 'string' ? item.title : `Item ${i + 1}`,
            duration:
              typeof item.duration === 'number' && item.duration > 0 ? item.duration : 1,
            yellow: typeof item.yellow === 'number' ? item.yellow : 0.66666,
            red: typeof item.red === 'number' ? item.red : 0.9,
            info: typeof item.info === 'string' ? item.info : '',
            presenterTag: typeof item.presenterTag === 'string' ? item.presenterTag : '',
          };
        });
        setAgendaItems(validated);
        alert('Template loaded!');
      } else {
        alert('No template found.');
      }
    } catch (e) {
      console.error('Load failed:', e);
      alert('Failed to load template.');
    }
  };

  // 🕰️ Robust "Started At" text for the Summary screen (app-side)
  // Prefer the explicit startTimestamp (set when you pressed Start),
  // else fall back to the first itemStartTimestamp, else "Unknown".
  const summaryItems = Array.isArray(summary) ? summary : [];

  const startedAtMsFinal =
    (typeof startTimestamp === 'number' && startTimestamp) ||
    (typeof itemStartTimestamp === 'number' && itemStartTimestamp) ||
    0;

  const startedAtTextApp = startedAtMsFinal
    ? new Date(startedAtMsFinal).toLocaleString([], { hour12: true })
    : 'Unknown';

  const finishedAtMsFinal =
    (Array.isArray(summaryItems) &&
      summaryItems.length > 0 &&
      summaryItems[summaryItems.length - 1]?.completedAt)
      ? new Date(summaryItems[summaryItems.length - 1].completedAt).getTime()
      : (typeof endTimestamp === 'number' && endTimestamp) || 0;

  const finishedAtTextApp = finishedAtMsFinal
    ? new Date(finishedAtMsFinal).toLocaleString([], { hour12: true })
    : 'Unknown';
  
  const yellowCountApp = summaryItems.filter((item) => !!item?.reachedYellow).length;
  const redCountApp = summaryItems.filter((item) => !!item?.reachedRed).length;

  const overrunItems = summaryItems.filter(
    (item) => (item?.timeSpent ?? 0) > (item?.duration ?? 0) * 60
  );

  const yellowItems = summaryItems.filter((item) => !!item?.reachedYellow);
  const redItems = summaryItems.filter((item) => !!item?.reachedRed);

  const meetingInsights = [];

  if (overrunItems.length === 1) {
    meetingInsights.push(`⚠️ ${overrunItems[0]?.title || 'One item'} ran long`);
  } else if (overrunItems.length > 1) {
    meetingInsights.push(
      `⚠️ ${overrunItems.length} items exceeded their planned time`
    );
  }

  if (yellowItems.length > 0) {
    meetingInsights.push(
      `🟡 ${yellowItems.length} item${yellowItems.length > 1 ? 's' : ''} reached the yellow phase`
    );
  }

  if (redItems.length > 0) {
    meetingInsights.push(
      `🔴 ${redItems.length} item${redItems.length > 1 ? 's' : ''} reached the red phase`
    );
  }

  if (yellowItems.length === 0 && redItems.length === 0) {
    meetingInsights.push('🎯 All agenda items stayed on time');
  }
  
    // 📊 Summary totals + verdict for the app (±60s window counts as on time)
  const plannedTotalSec = Math.round(
    (Array.isArray(summary) ? summary : []).reduce(
      (acc, item) => acc + Math.max(0, (item?.duration || 0) * 60),
      0
    )
  );

  const activeTotalSec = Math.round(
    (Array.isArray(summary) ? summary : []).reduce(
      (acc, item) => acc + Math.max(0, item?.timeSpent || 0),
      0
    )
  );

  const pausedTotalSec = Math.round(
    (Array.isArray(summary) ? summary : []).reduce(
      (acc, item) => acc + Math.max(0, item?.pausedDuration || 0),
      0
    )
  );

  const actualTotalSec = activeTotalSec + pausedTotalSec;

  const wallClockActualSec =
    startedAtMsFinal && finishedAtMsFinal
      ? Math.max(0, Math.floor((finishedAtMsFinal - startedAtMsFinal) / 1000))
      : actualTotalSec;

  const singleItemActualSec =
    Array.isArray(summaryItems) && summaryItems.length === 1
      ? Math.max(
          0,
          Math.round(
            Math.max(0, summaryItems[0]?.timeSpent || 0) +
              Math.max(0, summaryItems[0]?.pausedDuration || 0)
          )
        )
      : null;

  const displayedActualSec =
    singleItemActualSec !== null ? singleItemActualSec : wallClockActualSec;

  const onTimeWindowSec = 60; // ±1 minute

  // Judge agenda performance by active discussion time.
  // Explain wall-clock impact separately when pause time changes the story.
  const activeDeltaSec = activeTotalSec - plannedTotalSec;
  const pauseCausedWallClockOverrun =
    plannedTotalSec > 0 &&
    pausedTotalSec > 0 &&
    activeTotalSec <= plannedTotalSec &&
    displayedActualSec > plannedTotalSec;

  // 🔍 Reusable flag: did we finish noticeably early?
  const finishedEarlyApp = plannedTotalSec > 0 && activeDeltaSec < -onTimeWindowSec;

  let verdictTextApp = '—';
  let verdictColorApp = '#555';

  if (plannedTotalSec > 0) {
    if (pauseCausedWallClockOverrun) {
      verdictTextApp =
        activeTotalSec < plannedTotalSec
          ? '⏸ Early; total ran over'
          : '⏸ On time; total ran over';
      verdictColorApp = '#b7791f'; // amber
    } else if (Math.abs(activeDeltaSec) <= onTimeWindowSec) {
      verdictTextApp = '🎯 On Time';
      verdictColorApp = '#2b6cb0'; // blue
    } else if (finishedEarlyApp) {
      verdictTextApp = `🎉 Finished ${formatVerboseDuration(-activeDeltaSec)} early`;
      verdictColorApp = '#1a7f37'; // green
    } else {
      verdictTextApp = `⚠️ Over by ${formatVerboseDuration(activeDeltaSec)}`;
      verdictColorApp = '#d11a2a'; // red
    }
  }

  const renderMyAgendaSessionRow = (s) => {
    const id = s?.id ?? s;
    const displayTitle = s?.title ?? id;
    const isCompletedMeeting = !!s?.isCompletedMeeting;

    return (
      <View
        key={id}
        style={{
          paddingVertical: 10,
          paddingHorizontal: 12,
          backgroundColor: '#fff',
          borderRadius: 14,
          borderWidth: 1,
          borderColor: isCompletedMeeting ? '#d1fae5' : '#e5e7eb',
          marginBottom: 10,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          opacity: isCompletedMeeting ? 0.92 : 1,
        }}
      >
        <TouchableOpacity
          style={{ flex: 1, paddingRight: 12 }}
          onPress={() => openExistingSessionById(id)}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              flex: 1,
              minWidth: 0,
            }}
          >
            <Text
              style={{
                fontSize: 11,
                fontStyle: 'italic',
                color: '#374151',
                flexShrink: 1,
              }}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {displayTitle}
            </Text>

            {isCompletedMeeting && (
              <Ionicons
                name="checkmark-circle"
                size={15}
                color="#16a34a"
                style={{ marginLeft: 6 }}
              />
            )}
          </View>
        </TouchableOpacity>

        <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 4 }}>
          {/* ⭐ Pin to Quick Launch */}
          <TouchableOpacity
            onPress={() => toggleQuickLaunchPin(id)}
            style={{
              width: 36,
              height: 36,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 8,
              marginRight: 2,
            }}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons
              name={quickLaunchFavorites?.includes(id) ? 'star' : 'star-outline'}
              size={20}
              color={quickLaunchFavorites?.includes(id) ? '#f59e0b' : '#111827'}
            />
          </TouchableOpacity>

          {/* 📄 Duplicate */}
          <TouchableOpacity
            onPress={async () => {
              const base = String(displayTitle || id)
                .replace(/\//g, '-')
                .trim();

              const suggested = await makeUniqueCopyTitle(base);
              await createSessionCopyFromExisting(id, suggested);
            }}
            style={{
              width: 36,
              height: 36,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 8,
              marginRight: 2,
            }}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="copy-outline" size={20} color="#111827" />
          </TouchableOpacity>

          {/* 🗑 Delete */}
          <TouchableOpacity
            onPress={() => deleteSessionById(id, displayTitle)}
            disabled={deletingId === id}
            style={{
              width: 36,
              height: 36,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 8,
            }}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            {deletingId === id ? (
              <ActivityIndicator size="small" color="#d11a2a" />
            ) : (
              <Ionicons name="trash-outline" size={20} color="#d11a2a" />
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView
        style={[
          {
            flex: 1,
            backgroundColor: '#ffffff',
          },
          screen === 'timer' ? getBackgroundColor() : {},
        ]}
      >
        <View style={{ flex: 1, width: '100%' }}>
          {screen === 'splash' && (
            <LinearGradient
              colors={['#f3f4f6', '#e3f9f0']} // soft brand-ish gradient
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}
            >
              <View
                style={{
                  backgroundColor: '#ffffffee',
                  paddingVertical: 32,
                  paddingHorizontal: 28,
                  borderRadius: 24,
                  alignItems: 'center',
                  shadowColor: '#000',
                  shadowOpacity: 0.08,
                  shadowRadius: 18,
                  shadowOffset: { width: 0, height: 6 },
                  elevation: 6,
                  minWidth: 260,
                }}
              >
                {/* Logo / wordmark */}
                <View style={{ alignItems: 'center', marginBottom: 10 }}>
                  <Text
                    style={{
                      fontSize: 42,
                      fontWeight: 'bold',
                      color: colors.electricBlue,
                      letterSpacing: 0.5,
                    }}
                  >
                    Agenda
                  </Text>
                  <Animated.Text
                    style={{
                      fontSize: 42,
                      fontWeight: 'bold',
                      color: colors.brightGreen,
                      letterSpacing: 0.5,
                      transform: [{ scale: pulseAnim }],
                      textShadowColor: '#ffffffdd',
                      textShadowRadius: 8,
                      textShadowOffset: { width: 0, height: 0 },
                    }}
                  >
                    Glow™
                  </Animated.Text>
                </View>

                {/* Tagline */}
                <Text
                  style={{
                    fontSize: 16,
                    color: '#333',
                    marginBottom: autoDemoBooting ? 10 : 16,
                    textAlign: 'center',
                  }}
                >
                  Run meetings that stay on time.
                </Text>

                
                {/* Auto-demo loading state */}
                {/*
                {autoDemoBooting && (
                  <>
                    <Text
                      style={{
                        marginTop: 0,
                        fontSize: 16,
                        color: '#4b5563',
                        textAlign: 'center',
                        fontWeight: '500',
                      }}
                    >
                      Launching sample meeting...
                    </Text>

                    <ActivityIndicator
                      size="small"
                      color="#0f8f7f"
                      style={{ marginTop: 6, marginBottom: 10, opacity: 0.85 }}
                    />
                  </>
                )}
                */}

                {/* Footer / legal text */}
                <Text style={{ fontSize: 13, color: '#6b7280', marginTop: 18, marginBottom: 4 }}>
                  Patent Pending
                </Text>
                <Text style={{ fontSize: 12, color: '#777', marginBottom: 2 }}>
                  © 2025 DozenRed LLC
                </Text>
                <Text style={{ fontSize: 12, color: '#007AFF' }}>
                  www.dozenred.com
                </Text>
              </View>
            </LinearGradient>
          )}

          {screen === 'emailAuth' && (
            <KeyboardAvoidingView
              style={{ flex: 1, backgroundColor: '#f3f4f6' }}
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
              keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
            >
              <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()}>
                <View style={{ flex: 1 }}>
                  <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={{
                      padding: 16,
                      paddingTop: 0,
                      paddingBottom: 180,
                    }} // ⬅️ add flexGrow
                    keyboardShouldPersistTaps="handled"
                    stickyHeaderIndices={[0]} // 👈 keep header sticky
                  >
                    {/* 👇 STICKY HEADER: ONLY the “Choose mode” + tabs */}
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        paddingHorizontal: 12,
                        paddingTop: 10,
                      }}
                    >
                      <View style={{ width: 64 }} />

                      <View style={{ alignItems: 'center' }}>
                        <Text
                          style={{
                            fontSize: 24,
                            fontWeight: '800',
                            color: '#111827',
                            textAlign: 'center',
                            marginTop: 16,
                            marginBottom: 4, // tightened to make room for subtitle
                          }}
                        >
                          Account
                        </Text>

                        <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 2, marginBottom: 18 }}>
                          🔐 Save your agendas and access them anytime
                        </Text>
                      </View>

                      <View style={{ width: 64 }} />
                    </View>
                    
                    <View
style={{
  backgroundColor: '#fff',
  paddingVertical: 8,

  borderRadius: 16,

  borderBottomWidth: 1,
  borderBottomColor: '#eee',

  zIndex: 100,
  elevation: 4,

  shadowColor: '#000',
  shadowOpacity: 0.06,
  shadowRadius: 6,
  shadowOffset: { width: 0, height: 2 },
}}

                    >
                      
                      {/* 👤 Signed-in identity (moved here from pre-start) */}
                      {!auth.currentUser?.isAnonymous && !!auth.currentUser?.email && (
                        <Text
                          style={{
                            textAlign: 'center',
                            fontSize: 14,
                            color: '#374151',
                            marginTop: 8,
                            marginBottom: 4,
                          }}
                        >
                        👤 You: <Text style={{ fontWeight: '700' }}>{auth.currentUser.email}</Text>
                        <Text style={{ color: emailVerified ? '#007A33' : '#B26A00' }}>
                          {` ${emailVerified ? '(verified)' : '(unverified)'}`}
                        </Text>
                      </Text>
                      )}
                      
{isTempAccount ? (
  <Text
    style={{ textAlign: 'center', marginBottom: 6, color: '#666' }}
  >
    Choose mode
  </Text>
) : (
  <View style={{ height: 6 }} />
)}



                      {/* Mode-specific helper line */}
                      <Text
                        style={{
                          textAlign: 'center',
                          color: '#6B7280',
                          fontSize: 13,
                          marginBottom: 14,
                        }}
                      >
                        {authScreenMode === 'login' && 'Welcome back. Continue or switch accounts below.'}
                        {authScreenMode === 'create' && 'Create a new account to start fresh.'}
                        {authScreenMode === 'upgrade' && 'Using a temporary account? It may expire if inactive.'}
                      </Text>

                      <View style={styles.authTabsRow}>
{auth.currentUser?.isAnonymous ? (
  <TouchableOpacity
    style={[
      styles.authTab,
      authScreenMode === 'login' && styles.authTabActive,
    ]}
    onPress={() => setAuthScreenMode('login')}
    disabled={authScreenMode === 'login'}
  >
    <Text
      style={[
        styles.authTabText,
        authScreenMode === 'login' && styles.authTabTextActive,
      ]}
    >
      SIGN IN
    </Text>
  </TouchableOpacity>
) : null}


                        {/*
                        {auth.currentUser?.isAnonymous && (
                          <TouchableOpacity
                            style={[
                              styles.authTab,
                              authScreenMode === 'create' && styles.authTabActive,
                            ]}
                            onPress={() => setAuthScreenMode('create')}
                            disabled={authScreenMode === 'create'}
                          >
                            <Text
                              style={[
                                styles.authTabText,
                                authScreenMode === 'create' && styles.authTabTextActive,
                              ]}
                            >
                              NEW
                            </Text>
                          </TouchableOpacity>
                        )}
                        */}

                        {auth.currentUser?.isAnonymous && (
                          <TouchableOpacity
                            style={[
                              styles.authTab,
                              authScreenMode === 'upgrade' && styles.authTabActive,
                            ]}
                            onPress={() => setAuthScreenMode('upgrade')}
                            disabled={authScreenMode === 'upgrade'}
                          >
                            <Text
                              style={[
                                styles.authTabText,
                                authScreenMode === 'upgrade' && styles.authTabTextActive,
                              ]}
                            >
                              REGISTER
                            </Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>

                    {/* ✅ Email verification (show only on Manage Account, not pre-start) */}
                    {authMode === 'email' && !offlineMode && !emailVerified && (
                      <View style={styles.warningBox}>
                        <Text style={styles.warningText}>
                          Verify your email to secure your account and make recovery easier.
                          {'\n\n'}
                          We sent a link to{' '}
                          <Text style={{ fontWeight: 'bold' }}>{auth.currentUser?.email}</Text>.
                        </Text>

                        <View style={{ height: 8 }} />

                        <Button title="I’ve verified — Refresh status" onPress={refreshVerification} />
                        <View style={{ height: 6 }} />
                        <Button title="Resend verification email" onPress={resendVerification} />
                      </View>
                    )}

                    {authScreenMode === 'create' && auth.currentUser?.isAnonymous && (
                      <View style={styles.warningBox}>
                        <Text style={styles.warningText}>
                          You’re currently using a temporary account. Creating a{' '}
                          <Text style={{ fontWeight: 'bold' }}>new account</Text> (Email, Apple, or Google)
                          will <Text style={{ fontWeight: 'bold' }}>not</Text> keep your existing agendas.
                          To keep your data, choose{' '}
                          <Text style={{ fontWeight: 'bold' }}>SAVE</Text> instead.
                        </Text>
                      </View>
                    )}

                    {showEmailForm ? (
                      <>
                        <View style={{ alignItems: 'flex-end' }}>
                          <TouchableOpacity onPress={() => setShowEmailForm(false)}>
                            <Text style={{ color: '#6B7280', fontWeight: '600' }}>
                              Hide email
                            </Text>
                          </TouchableOpacity>
                        </View>
                        {/* Email & Password (with confirm fields on Create/Upgrade) */}
                        <Text style={{ marginTop: 12 }}>Email</Text>
                        <TextInput
                          ref={emailRef}
                          style={styles.input}
                          placeholder="you@example.com"
                          value={email}
                          onChangeText={(t) => {
                            setEmail(t);
                            if (fieldErrors.email)
                              setFieldErrors((p) => ({ ...p, email: '' }));
                          }}
                          autoCapitalize="none"
                          keyboardType="email-address"
                          returnKeyType="next"
                          onSubmitEditing={() => {
                            // If user must confirm email next, go there; otherwise go to password
                            if (
                              authScreenMode === 'create' ||
                              authScreenMode === 'upgrade'
                            ) {
                              confirmEmailRef?.current?.focus?.();
                            } else {
                              passwordRef?.current?.focus?.();
                            }
                          }}
                        />

                        {/* Inline validity + form error for email */}
                        {email.length > 0 && !isValidEmail(email) && (
                          <Text style={styles.errorText}>
                            This doesn’t look like a valid email.
                          </Text>
                        )}
                        {!!fieldErrors.email && (
                          <Text style={styles.errorText}>{fieldErrors.email}</Text>
                        )}

                        {/* Confirm Email only on Create/Upgrade */}
                        {(authScreenMode === 'create' ||
                          authScreenMode === 'upgrade') && (
                          <>
                            <Text style={{ marginTop: 12 }}>Confirm Email</Text>
                            <TextInput
                              ref={confirmEmailRef}
                              style={styles.input}
                              placeholder="you@example.com"
                              value={confirmEmail}
                              onChangeText={(t) => {
                                setConfirmEmail(t);
                                if (
                                  t.trim() === email.trim() &&
                                  fieldErrors.confirmEmail
                                ) {
                                  setFieldErrors((p) => ({ ...p, confirmEmail: '' }));
                                }
                              }}
                              autoCapitalize="none"
                              keyboardType="email-address"
                              returnKeyType="next"
                              onSubmitEditing={() => passwordRef?.current?.focus?.()}
                            />
                            {!!fieldErrors.confirmEmail && (
                              <Text style={styles.errorText}>
                                {fieldErrors.confirmEmail}
                              </Text>
                            )}
                          </>
                        )}

                        {/* --- Password --- */}
                        <Text style={labelStyle}>Password</Text>
                        <TextInput
                          ref={passwordRef}
                          style={passwordInputStyle}
                          placeholder="••••••••"
                          placeholderTextColor={isDark ? '#9AA0A6' : undefined}
                          value={password}
                          onChangeText={(t) => {
                            setPassword(t);
                            if (fieldErrors.password)
                              setFieldErrors((p) => ({ ...p, password: '' }));
                          }}
                          secureTextEntry={!showPassword}
                          keyboardAppearance={isDark ? 'dark' : 'light'}
                          selectionColor={isDark ? '#8ab4f8' : undefined}
                          returnKeyType={
                            authScreenMode === 'create' || authScreenMode === 'upgrade'
                              ? 'next'
                              : authScreenMode === 'login'
                                ? 'go'
                                : 'done'
                          }
                          onSubmitEditing={() => {
                            if (
                              authScreenMode === 'create' ||
                              authScreenMode === 'upgrade'
                            ) {
                              confirmPasswordRef?.current?.focus?.();
                            } else if (authScreenMode === 'login') {
                              if (auth.currentUser?.isAnonymous) {
                                Alert.alert(
                                  'Switch accounts?',
                                  'Signing in will switch you away from this temporary account. To keep your data, choose “SYNC”.',
                                  [
                                    {
                                      text: 'Sync & Keep Data',
                                      onPress: () => setAuthScreenMode('upgrade'),
                                    },
                                    {
                                      text: 'Discard & Sign In',
                                      style: 'destructive',
                                      onPress: handleEmailLogin,
                                    },
                                    { text: 'Cancel', style: 'cancel' },
                                  ]
                                );
                              } else {
                                handleEmailLogin();
                              }
                            }
                          }}
                        />
                        {!!fieldErrors.password && (
                          <Text style={styles?.errorText}>{fieldErrors.password}</Text>
                        )}

                        {/* Forgot Password (login only) */}
                        {authScreenMode === 'login' && !offlineMode && (
                          <TouchableOpacity
                            onPress={handlePasswordReset}
                            style={{
                              alignSelf: 'flex-end',
                              marginTop: 6,
                              marginBottom: 10,
                            }}
                            accessibilityRole="button"
                            accessibilityLabel="Send password reset email"
                          >
                            <Text style={{ color: '#2f80ed', fontWeight: '600' }}>
                              Forgot password?
                            </Text>
                          </TouchableOpacity>
                        )}

                        {/* --- Confirm Password (Create/Upgrade only) --- */}
                        {(authScreenMode === 'create' ||
                          authScreenMode === 'upgrade') && (
                          <>
                            <Text style={labelStyle}>Confirm Password</Text>
                            <TextInput
                              ref={confirmPasswordRef}
                              style={passwordInputStyle}
                              placeholder="••••••••"
                              placeholderTextColor={isDark ? '#9AA0A6' : undefined}
                              value={confirmPassword}
                              onChangeText={(t) => {
                                setConfirmPassword(t);
                                if (t === password && fieldErrors.confirmPassword) {
                                  setFieldErrors((p) => ({ ...p, confirmPassword: '' }));
                                }
                              }}
                              secureTextEntry={!showPassword}
                              keyboardAppearance={isDark ? 'dark' : 'light'}
                              selectionColor={isDark ? '#8ab4f8' : undefined}
                              returnKeyType="done"
                              onSubmitEditing={() => {
                                if (authScreenMode === 'create') handleCreateAccount();
                                if (authScreenMode === 'upgrade')
                                  handleUpgradeAnonymous();
                              }}
                            />
                            {!!fieldErrors.confirmPassword && (
                              <Text style={styles?.errorText}>
                                {fieldErrors.confirmPassword}
                              </Text>
                            )}
                          </>
                        )}

                        <View
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            marginBottom: 12,
                          }}
                        >
                          <Switch value={showPassword} onValueChange={setShowPassword} />
                          <Text style={{ marginLeft: 8 }}>Show password</Text>
                        </View>

                        {/* Primary action */}
                        {(() => {
                          const label =
                            authScreenMode === 'login'
                              ? '🔐 Sign In'
                              : authScreenMode === 'create'
                                ? '🆕 Create Account'
                                : '🔐 Upgrade Account';

                          let onPress = () => {};
                          if (authScreenMode === 'login') {
                            onPress = () => {
                              if (auth.currentUser?.isAnonymous) {
                                Alert.alert(
                                  'Switch accounts?',
                                  'Signing in will switch you away from this temporary account. To keep your data, choose “SYNC”.',
                                  [
                                    {
                                      text: 'Sync & Keep Data',
                                      onPress: () => setAuthScreenMode('upgrade'),
                                    },
                                    {
                                      text: 'Discard & Sign In',
                                      style: 'destructive',
                                      onPress: handleEmailLogin,
                                    },
                                    { text: 'Cancel', style: 'cancel' },
                                  ]
                                );
                              } else {
                                handleEmailLogin();
                              }
                            };
                          } else if (authScreenMode === 'create') {
                            onPress = handleCreateAccount;
                          } else {
                            onPress = handleUpgradeAnonymous;
                          }

                          return <Button title={label} onPress={onPress} />;
                        })()}
                      </>
                    ) : (
                      <View style={{ alignItems: 'center', marginTop: 24 }}>
                        <TouchableOpacity onPress={() => setShowEmailForm(true)}>
                          <Text style={{ color: '#2563EB', fontWeight: '600' }}>
                            Use email
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )}

                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        marginVertical: 14,
                      }}
                    >
                      <View style={{ flex: 1, height: 1, backgroundColor: '#E5E7EB' }} />
                      <View style={{ flex: 1, height: 1, backgroundColor: '#E5E7EB' }} />
                    </View>

                    {/* --- Provider Sign-in section --- */}
                    {Platform.OS === 'android' && ENABLE_GOOGLE_LOGIN && (
                      <>
                        {/* Create/Upgrade → show Upgrade with Google (now blue) */}
                        {(authScreenMode === 'create' ||
                          authScreenMode === 'upgrade') && (
                          <View style={{ marginTop: 12 }}>
                            <SocialButton
                              label="Sign in with Google"
                              onPress={handleGoogleUpgrade}
                              variant="filled" // ← changed from outline to filled
                              icon={GoogleIcon}
                            />
                          </View>
                        )}

                        {/* Sign In → show Sign in with Google */}
                        {authScreenMode === 'login' && (
                          <View style={{ marginTop: 12 }}>
                            <SocialButton
                              label="Sign in with Google"
                              onPress={handleGoogleSignInReplace}
                              variant="filled"
                              icon={GoogleIcon}
                            />
                          </View>
                        )}
                      </>
                    )}

                    {Platform.OS === 'ios' && appleAvailable && (
                      <>
                        {/* ✅ Apple (single button, neutral label) */}
                        <View style={{ marginTop: 12 }}>
                          <TouchableOpacity
                            onPress={authScreenMode === 'upgrade' ? handleAppleUpgrade : handleAppleSignInReplace}
                            style={{
                              padding: 10,
                              borderRadius: 8,
                              backgroundColor: '#000',
                            }}
                          >
                            <Text style={{ textAlign: 'center', color: '#fff' }}>
                              Continue with Apple
                            </Text>
                          </TouchableOpacity>

                          {/* Optional: tiny clarity line only in SYNC mode */}
                          {authScreenMode === 'upgrade' && (
                            <Text style={{ textAlign: 'center', color: '#6B7280', fontSize: 12, marginTop: 6 }}>
                              Keeps your existing agendas
                            </Text>
                          )}
                        </View>

                        {/* ✅ Google on iOS (single button, neutral label) */}
                        <View style={{ marginTop: 12 }}>
                          <TouchableOpacity
                            onPress={authScreenMode === 'upgrade' ? handleGoogleUpgrade : handleGoogleSignInReplace}
                            disabled={!googleRequest}
                            style={{
                              padding: 10,
                              borderRadius: 8,
                              backgroundColor: '#4285F4',
                              opacity: !googleRequest ? 0.5 : 1,
                            }}
                          >
                            <Text style={{ textAlign: 'center', color: '#fff' }}>
                              Continue with Google
                            </Text>
                          </TouchableOpacity>

                          {/* Optional: tiny clarity line only in SYNC mode */}
                          {authScreenMode === 'upgrade' && (
                            <Text style={{ textAlign: 'center', color: '#6B7280', fontSize: 12, marginTop: 6 }}>
                              Keeps your existing agendas
                            </Text>
                          )}
                        </View>
                      </>
                    )}

                    {/* ───────────────── Danger zone ───────────────── */}
                    <View
                      style={{
                        marginTop: 40,
                        paddingTop: 18,
                        borderTopWidth: 1,
                        borderTopColor: '#e5e7eb',
                        alignItems: 'center',
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 10,
                          fontWeight: '600',
                          color: '#9ca3af',
                          marginBottom: 10,
                          letterSpacing: 0.5,
                        }}
                      >
                        ACCOUNT ACTIONS
                      </Text>

                      <TouchableOpacity
                        onPress={handleAccountDeletion}
                        accessibilityRole="button"
                        accessibilityLabel="Delete account"
                        style={{
                          paddingVertical: 8,
                          paddingHorizontal: 16,
                          borderRadius: 999,
                          backgroundColor: '#f9fafb',
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 11,
                            fontWeight: '600',
                            color: '#991b1b', // deeper red, not bright
                          }}
                        >
                          Delete account
                        </Text>
                      </TouchableOpacity>

                      <Text
                        style={{
                          fontSize: 10,
                          color: '#6b7280',
                          marginTop: 8,
                          textAlign: 'center',
                          maxWidth: 280,
                          lineHeight: 16,
                        }}
                      >
                        Permanently deletes your account and all saved agendas.
                      </Text>

                      {!!auth.currentUser?.uid && (
                        <Text
                          selectable
                          style={{
                            textAlign: 'center',
                            color: '#6b7280',   // readable gray
                            fontSize: 9,
                            marginTop: 12,
                            fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
                          }}
                        >
                          UID: {auth.currentUser.uid}
                        </Text>
                      )}
                    </View>
                  </ScrollView>
                  {/*
                  <View style={{ marginTop: 20 }}>
                    <TouchableOpacity
                      onPress={handleSignOut}
                      style={{ padding: 10, borderRadius: 8, backgroundColor: '#d11a2a' }}
                    >
                      <Text style={{ textAlign: 'center', color: '#fff' }}>🔁 Reset / Sign Out</Text>
                    </TouchableOpacity>
                  </View>
                  */}
                </View>
              </TouchableWithoutFeedback>
            </KeyboardAvoidingView>
          )}

          {screen === 'prestart' && (
            <View style={{ flex: 1, backgroundColor: '#f3f4f6' }}>
              {/* ─── Top header row (DEV reset • Branding • Help) ─── */}
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 12,
                  paddingTop: 10,
                  paddingBottom: 6, // 👈 gives the branding a little breathing room
                }}
              >
                {/* LEFT (dev reset or spacer) */}
                <View style={{ width: 92, alignItems: 'flex-start' }}>
                  {__DEV__ ? (
                    <TouchableOpacity
                      onPress={async () => {
                        await devReset();
                        Alert.alert(
                          'Dev reset',
                          'Auto-demo + Quick Start have been reset.\nNext launch will behave like first install.',
                          [{ text: 'OK' }]
                        );
                      }}
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                        borderRadius: 999,
                        opacity: 0.28,
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={{ fontSize: 11, fontWeight: '800', color: '#111827' }}>
                        DEV RESET
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    <View />
                  )}
                </View>

                {/* CENTER (AgendaGlow branding) */}
                <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text
                      style={{
                        fontSize: screen === 'prestart' ? 26 : 24,
                        fontWeight: '800',
                        color: '#2f80ed',
                        letterSpacing: 0.2,
                      }}
                    >
                      Agenda
                    </Text>
                    <Text
                      style={{
                        fontSize: screen === 'prestart' ? 26 : 24,
                        fontWeight: '800',
                        color: '#00c853',
                        letterSpacing: 0.2,
                      }}
                    >
                      Glow
                    </Text>
                  </View>
                </View>

                {/* RIGHT (help) */}
                <View style={{ width: 92, alignItems: 'flex-end' }}>
                  <ManualHelpButton offline={offlineMode} />
                </View>
              </View>
                <ScrollView contentContainerStyle={{ padding: 24 }}>
                {/* 🌈 Gradient glow behind card (AgendaGlow blue → green) */}
                <LinearGradient
                  colors={['#2f80ed33', '#00c85333']} // blue → green with transparency
                  start={{ x: 0.1, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: 280,
                    marginHorizontal: 10,
                    marginTop: 10,
                    borderRadius: 26,
                    transform: [{ scale: 1.1 }], // slightly larger than card = soft halo
                    opacity: 0.7, // still subtle, can nudge down if too strong
                  }}
                />
                {/* MAIN CARD */}
                <View
                  style={{
                    backgroundColor: '#fff',
                    borderRadius: 20,
                    padding: 22,
                    shadowColor: '#2f80ed',
                    shadowOpacity: 0.15,
                    shadowRadius: 18,
                    shadowOffset: { width: 0, height: 6 },
                    elevation: 6,
                  }}
                >
                  {offlineMode ? (
                    <Text style={{ fontSize: 14, color: '#d11a2a', marginBottom: 16 }}>
                      📴 Offline mode — account features unavailable
                    </Text>
                  ) : null}

                  {/*
                  {authMode === 'email' && !offlineMode && !emailVerified && (
                    <View
                      style={{
                        backgroundColor: '#FFF7CC',
                        borderColor: '#F0C36D',
                        borderWidth: 1,
                        padding: 12,
                        borderRadius: 10,
                        marginTop: 16,
                        gap: 8,
                      }}
                    >
                      <Text style={{ color: '#6A4F00' }}>
                        We sent a verification link to{' '}
                        <Text style={{ fontWeight: 'bold' }}>
                          {auth.currentUser?.email}
                        </Text>
                        . After you click it, tap “Refresh status”.
                      </Text>
                      <Button
                        title="I’ve verified — Refresh status"
                        onPress={refreshVerification}
                      />
                      <Button
                        title="Resend verification email"
                        onPress={resendVerification}
                      />
                    </View>
                  )}
                  */}

                  {/* 🔄 Resume card (if we found a resumable session) */}
                  {resumeCandidate && (
                    <View
                      style={{
                        backgroundColor: '#FFF7CC',
                        borderColor: '#F0C36D',
                        borderWidth: 1,
                        padding: 12,
                        borderRadius: 10,
                        marginBottom: 12,
                        marginTop: 12,
                      }}
                    >
                      <Text style={{ color: '#6A4F00', marginBottom: 8 }}>
                        Resume "{resumeCandidate.data?.title || resumeCandidate.id}" where
                        it left off?
                        {'  '}
                        <Text style={{ fontStyle: 'italic' }}>
                          {resumeCandidate.data?.status === 'Paused'
                            ? '(Paused)'
                            : '(Running)'}
                        </Text>
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <View style={{ flex: 1, marginRight: 6 }}>
                          <Button
                            title="▶️ Resume Session"
                            onPress={async () => {
                              const { id, data } = resumeCandidate;
                              setResumeCandidate(null);
                              try { await AsyncStorage.removeItem('@userInfo'); } catch {}
                              resumeFromFirestore(id, data);
                            }}
                          />
                        </View>
                        <View style={{ flex: 1, marginLeft: 6 }}>
                          <Button
                            title="Dismiss"
                            onPress={async () => {
                              setResumeCandidate(null);
                              try {
                                await AsyncStorage.removeItem('@userInfo'); // ✅ prevents the resume card from coming back
                              } catch {}
                            }}
                          />
                        </View>
                      </View>
                    </View>
                  )}

                  {/* 📂 Session Picker */}
                  <View style={{ height: 8 }} />
                  {/* Agenda actions */}

                  {showSessionPicker && (
                    <View
                      style={{
                        marginTop: 12,
                        backgroundColor: '#f0f0f0',
                        borderRadius: 8,
                        padding: 12,
                      }}
                    >
                      {existingSessions.length === 0 ? (
                        <Text
                          style={{
                            fontSize: 14,
                            fontStyle: 'italic',
                            color: '#666',
                            textAlign: 'center',
                            paddingVertical: 8,
                          }}
                        >
                          🗃️ No saved agendas found
                        </Text>
                      ) : (
                        existingSessions.map((s) => {
                          const id = s?.id ?? s;
                          const displayTitle = s?.title ?? id;
                          const isCompletedMeeting = !!s?.isCompletedMeeting;

                          return (
                            <View
                              key={id}
                              style={{
                                paddingVertical: 8,
                                flexDirection: 'row',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                              }}
                            >
                              {/* Tap title → use this agenda as-is */}
                              <TouchableOpacity
                                style={{ flex: 1, paddingRight: 12 }}
                                onPress={() => openExistingSessionById(id)}
                              >
                                <Text style={{ fontSize: 16 }}>{displayTitle}</Text>
                              </TouchableOpacity>

                              {/* Copy + Delete controls */}
                              <View
                                style={{
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                }}
                              >
                                {/* Copy to new agenda */}
                                <TouchableOpacity
                                  onPress={async () => {
                                    const base = String(displayTitle || id)
                                      .replace(/\//g, '-')
                                      .trim();

                                    const suggested = await makeUniqueCopyTitle(base);

                                    setShowSessionPicker(false);
                                    setSelectedTemplateSessionId(null);
                                    setTemplateCategory(null);
                                    setCopySourceId(null);

                                    await createSessionCopyFromExisting(id, suggested);
                                  }}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Copy agenda ${id} into a new agenda`}
                                  style={{
                                    minWidth: 44,
                                    minHeight: 44,
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    borderRadius: 8,
                                    paddingHorizontal: 6,
                                    marginRight: 4,
                                  }}
                                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                >
                                  <Ionicons
                                    name="copy-outline"
                                    size={20}
                                    color="#111827"
                                  />
                                </TouchableOpacity>

                                {/* Delete existing agenda */}
                                <TouchableOpacity
                                  onPress={() => deleteSessionById(id, displayTitle)}
                                  disabled={deletingId === id}
                                  accessibilityRole="button"
                                  accessibilityLabel={`Delete agenda ${id}`}
                                  style={{
                                    minWidth: 44,
                                    minHeight: 44,
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    borderRadius: 8,
                                    paddingHorizontal: 6,
                                    opacity: deletingId === id ? 0.5 : 1,
                                  }}
                                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                >
                                  <Ionicons
                                    name="trash-bin-outline"
                                    size={22}
                                    color={deletingId === id ? '#9ca3af' : '#dc2626'}
                                  />
                                </TouchableOpacity>
                              </View>
                            </View>
                          );
                        })
                      )}
                    </View>
                  )}

                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: '600',
                      color: '#6b7280',
                      marginBottom: 4,
                      marginTop: 2,
                      width: '100%',
                      maxWidth: 520,
                      letterSpacing: 0.3,
                    }}
                  >
                    🚀 Start with a meeting type
                  </Text>
                  <View
                    style={{
                      width: '100%',
                      maxWidth: PRESTART_TILE_ROW_MAX_WIDTH,
                      alignSelf: 'center',
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      flexWrap: 'nowrap',
                      marginTop: 6,
                      marginBottom: 6,
                    }}
                  >
                    {starterQuickLaunches.map((t, idx) => {
                      const resolvedTitle =
                        (existingSessions || []).find((s) => (s?.id ?? s) === t)?.title || t;
                      // Pinned agendas are keyed by session id, so strip the date from the session key first.
                      const displayTitle = stripTrailingAgendaDate(t) || stripTrailingAgendaDate(resolvedTitle) || resolvedTitle;

                      const icon =
                        displayTitle === 'Daily Stand-up'
                          ? 'people-outline'
                          : displayTitle === '1:1 Coaching & Check-In'
                          ? 'chatbubble-ellipses-outline'
                          : displayTitle === 'Team Meeting'
                          ? 'briefcase-outline'
                          : displayTitle === 'Project Sync'
                          ? 'git-branch-outline'
                          : displayTitle === 'Client Meeting'
                          ? 'people-circle-outline'
                          : 'flash';

                      const label =
                        displayTitle === 'Daily Stand-up'
                          ? 'Standup'
                          : displayTitle === '1:1 Coaching & Check-In'
                          ? '1:1'
                          : displayTitle === 'Team Meeting'
                          ? 'Team'
                          : displayTitle === 'Project Sync'
                          ? 'Project'
                          : displayTitle === 'Client Meeting'
                          ? 'Client'
                          : displayTitle;

                      const enter = quickStartEnter[idx] || quickStartEnter[0];

                      return (
                        <Animated.View
                          key={`default-quickstart-${t}`}
                          style={{
                            opacity: enter,
                            transform: [
                              {
                                translateY: enter.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: [10, 0],
                                }),
                              },
                              {
                                scale: enter.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: [0.97, 1],
                                }),
                              },
                            ],
                            ...getPrestartTileWrapStyle(idx),
                          }}
                        >
                          <TouchableOpacity
                            onPress={() => openQuickLaunchAgenda(t)}
                            activeOpacity={0.88}
                            style={{
                              minHeight: 72,
                              backgroundColor: '#ffffff',
                              borderRadius: 14,
                              paddingVertical: 10,
                              paddingHorizontal: 6,
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderWidth: 1,
                              borderColor: '#e5e7eb',
                              shadowColor: '#000',
                              shadowOpacity: 0.05,
                              shadowRadius: 8,
                              shadowOffset: { width: 0, height: 3 },
                              elevation: 2,
                            }}
                          >
                            <Ionicons
                              name={icon}
                              size={18}
                              color="#2f80ed"
                              style={{ marginBottom: 6 }}
                            />
                            <Text
                              numberOfLines={2}
                              style={{
                                fontSize: getSessionTitleFontSize(label) - 1,
                                fontWeight: '700',
                                color: '#111827',
                                textAlign: 'center',
                                lineHeight: 13,
                              }}
                            >
                              {label}
                            </Text>
                          </TouchableOpacity>
                        </Animated.View>
                      );
                    })}
                  </View>

                  {!offlineMode && auth.currentUser?.isAnonymous && !isSampleMeeting && !isSampleDemoActive && (
                    <View
                      style={{
                        width: '100%',
                        maxWidth: 520,
                        alignSelf: 'center',
                        backgroundColor: '#f9fafb',
                        borderWidth: 1,
                        borderColor: '#e5e7eb',
                        borderRadius: 14,
                        padding: 12,
                        marginTop: 8,
                        marginBottom: 4,
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: '800',
                          color: '#374151',
                          marginBottom: 3,
                        }}
                      >
                        Using a temporary account
                      </Text>
                      <Text
                        style={{
                          fontSize: 11,
                          color: '#6b7280',
                          lineHeight: 15,
                        }}
                      >
                        You can run a meeting now. Sign in later to save agendas across devices.
                      </Text>
                      <TouchableOpacity
                        onPress={() => {
                          logUserEvent('home_signin_to_save_tapped', {}, 'prestart');
                          setAuthScreenMode('upgrade');
                          setScreen('emailAuth');
                        }}
                        style={{ alignSelf: 'flex-start', marginTop: 7, paddingVertical: 2 }}
                        activeOpacity={0.7}
                      >
                        <Text style={{ fontSize: 11, color: '#2f80ed', fontWeight: '700' }}>
                          Sign in to save
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  <Text
                    style={{
                      fontSize: 12,
                      fontWeight: '600',
                      color: '#6b7280',
                      marginBottom: 4,
                      marginTop: 10,
                      width: '100%',
                      maxWidth: 520,
                      letterSpacing: 0.3,
                    }}
                  >
                    📌 Pinned Agendas
                  </Text>
                  <View
                    style={{
                      width: '100%',
                      maxWidth: PRESTART_TILE_ROW_MAX_WIDTH,
                      alignSelf: 'center',
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      flexWrap: 'nowrap',
                      marginTop: 6,
                      marginBottom: 6,
                    }}
                  >
                    {[...favoriteQuickLaunches, ...Array.from({ length: Math.max(0, 5 - favoriteQuickLaunches.length) })].map((entry, idx) => {
                      const isPlaceholder = !entry;

                      if (isPlaceholder) {
                        return (
                          <View
                            key={`favorite-placeholder-${idx}`}
                            style={{
                              ...getPrestartTileWrapStyle(idx),
                              minHeight: 72,
                              backgroundColor: '#f3f4f6',
                              borderRadius: 14,
                              paddingVertical: 10,
                              paddingHorizontal: 6,
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderWidth: 1,
                              borderColor: '#e5e7eb',
                              opacity: 0.55,
                            }}
                          >
                            <Ionicons
                              name="star-outline"
                              size={18}
                              color="#9ca3af"
                              style={{ marginBottom: 6 }}
                            />
                            <Text
                              numberOfLines={2}
                              style={{
                                fontSize: 10,
                                fontWeight: '700',
                                color: '#9ca3af',
                                textAlign: 'center',
                                lineHeight: 12,
                              }}
                            >
                              Favorite
                            </Text>
                          </View>
                        );
                      }

                      const t = entry;

                      const matchingSession =
                        (existingSessions || []).find((s) => (s?.id ?? s) === t);
                      const resolvedTitle =
                        String(matchingSession?.title || '').replace(/\s+/g, ' ').trim();

                      // Favorite tiles should show the saved agenda's human title when it exists.
                      // Favorites are still keyed/copied by session id; this is display-only.
                      const displaySource = resolvedTitle || t;
                      const displayTitle =
                        stripTrailingAgendaDate(displaySource) || displaySource || 'Favorite';

                      const icon =
                        displayTitle === 'Daily Stand-up'
                          ? 'people-outline'
                          : displayTitle === '1:1 Coaching & Check-In'
                          ? 'chatbubble-ellipses-outline'
                          : displayTitle === 'Team Meeting'
                          ? 'briefcase-outline'
                          : displayTitle === 'Project Sync'
                          ? 'git-branch-outline'
                          : displayTitle === 'Client Meeting'
                          ? 'people-circle-outline'
                          : 'flash';

                      const label =
                        displayTitle === 'Daily Stand-up'
                          ? 'Standup'
                          : displayTitle === '1:1 Coaching & Check-In'
                          ? '1:1'
                          : displayTitle === 'Team Meeting'
                          ? 'Team'
                          : displayTitle === 'Project Sync'
                          ? 'Project'
                          : displayTitle === 'Client Meeting'
                          ? 'Client'
                          : displayTitle;

                      const enter = quickStartEnter[idx] || quickStartEnter[0];

                      return (
                        <Animated.View
                          key={`favorite-quickstart-${t}`}
                          style={{
                            opacity: enter,
                            transform: [
                              {
                                translateY: enter.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: [10, 0],
                                }),
                              },
                              {
                                scale: enter.interpolate({
                                  inputRange: [0, 1],
                                  outputRange: [0.97, 1],
                                }),
                              },
                            ],
                            ...getPrestartTileWrapStyle(idx),
                          }}
                        >
                          <TouchableOpacity
                            onPress={() => openQuickLaunchAgenda(t)}
                            activeOpacity={0.88}
                            style={{
                              minHeight: 72,
                              backgroundColor: '#ffffff',
                              borderRadius: 14,
                              paddingVertical: 10,
                              paddingHorizontal: 6,
                              alignItems: 'center',
                              justifyContent: 'center',
                              borderWidth: 1,
                              borderColor: '#e5e7eb',
                              shadowColor: '#000',
                              shadowOpacity: 0.05,
                              shadowRadius: 8,
                              shadowOffset: { width: 0, height: 3 },
                              elevation: 2,
                            }}
                          >
                            <Ionicons
                              name={icon}
                              size={18}
                              color="#2f80ed"
                              style={{ marginBottom: 6 }}
                            />
                            <Text
                              numberOfLines={2}
                              style={{
                                fontSize: getSessionTitleFontSize(label) - 1,
                                fontWeight: '700',
                                color: '#111827',
                                textAlign: 'center',
                                lineHeight: 13,
                              }}
                            >
                              {label}
                            </Text>
                          </TouchableOpacity>
                        </Animated.View>
                      );
                    })}
                  </View>

                  {!hasPinnedQuickLaunches && (
                    <Text
                      style={{
                        width: '100%',
                        maxWidth: 520,
                        fontSize: 11,
                        color: '#9ca3af',
                        marginTop: 2,
                        marginBottom: 6,
                      }}
                    >
                      {isTempAccount
                        ? 'Pinned agendas are saved agendas you keep for one-tap reuse. Run your first meeting now; sign in later if you want to keep agendas across devices.'
                        : 'Pinned agendas are saved agendas you keep for one-tap reuse. Run a meeting, save the agenda, then pin it here for fast access.'}
                    </Text>
                  )}

                  <Text
                    style={{
                      fontSize: 13,
                      fontWeight: '600',
                      color: '#555',
                      marginTop: 18,
                      marginBottom: 8,
                    }}
                  >
                    📝 Start a Brand New Agenda
                  </Text>

                  {/*
                  <Text
                    style={{
                      fontSize: 13,        // slightly bigger than Quick start
                      fontWeight: '600',   // ✅ equal weight
                      color: '#555',
                      marginTop: 18,
                      marginBottom: 4,
                    }}
                  >
                    📝 Start a brand-new agenda
                  </Text>

                  <Text style={{ marginTop: 12 }}>New Agenda Title</Text>

                  <Animated.View
                    style={{
                      transform: [{ translateX: titleShakeAnim }],
                      borderRadius: 10,
                    }}
                  >
                    <TextInput
                      ref={titleInputRef}
                      style={{
                        borderWidth: titleNeedsAttention ? 2 : 1,
                        borderColor: titleNeedsAttention ? '#f59e0b' : '#ccc', // amber/orange
                        backgroundColor: titleNeedsAttention ? '#fff7ed' : '#fff', // warm subtle
                        borderRadius: 8,
                        padding: 8,
                        marginBottom: 8,

                        // Soft glow (iOS)
                        shadowColor: '#f59e0b',
                        shadowOpacity: titleNeedsAttention ? 0.28 : 0,
                        shadowRadius: titleNeedsAttention ? 12 : 0,
                        shadowOffset: { width: 0, height: 0 },

                        // Android glow-ish
                        elevation: titleNeedsAttention ? 4 : 0,
                      }}
                      placeholder={`e.g., Weekly Planning Meeting${DATE_SEPARATOR}${getTodayISO()}`}
                      value={localSessionId}
                      maxLength={TITLE_MAX_CHARS}
                      onChangeText={handleTitleChange}
                    />
                  </Animated.View>
                  */}

                  {/* 🧩 Create Session From Template */}
                  {hasTemplate && !hasValidTitle && (
                    <Text
                      style={{
                        color: '#6b7280',      // softer gray (Tailwind gray-500)
                        fontSize: 13,          // slightly larger so it feels intentional
                        fontWeight: '500',     // subtle emphasis without shouting
                        marginTop: 6,
                        marginBottom: 6,
                      }}
                    >
                      Add a title above to use this:
                    </Text>
                  )}
                  {hasTemplate && (
                    <View
                      style={{
                        borderWidth: 1,
                        borderColor: '#e5e5e5',
                        borderRadius: 10,
                        padding: 10,
                        marginBottom: 10,
                        backgroundColor: '#fafafa',
                        marginTop: -6,
                      }}
                    >
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                        }}
                      >
                        <Text
                          style={{
                            fontSize: 12,
                            color: '#555',
                            flexShrink: 1,
                            paddingRight: 8,
                          }}
                        >
                          Template:
                          <Text style={{ fontWeight: '600' }}>
                            {' '}
                            {templateSessions.find(
                              (s) => s.id === selectedTemplateSessionId
                            )?.title || selectedTemplateSessionId}
                          </Text>
                        </Text>
                      </View>
                    </View>
                  )}

                  {String(localSessionId || '').trim().length >= 2 &&
                    !titleHasDate(localSessionId) && (
                      <TouchableOpacity
                        onPress={() =>
                          handleTitleChange(appendTodayToTitle(localSessionId))
                        }
                        style={{ alignSelf: 'flex-start', marginTop: 4, marginBottom: 4 }}
                      >
                        <Text style={{ color: '#2563eb', fontWeight: '600' }}>
                          ➕ Add today&apos;s date
                        </Text>
                      </TouchableOpacity>
                    )}

                  <TouchableOpacity
                    onPress={openAiAgendaGenerator}
                    disabled={offlineMode}
                    style={{
                      borderWidth: 1,
                      borderColor: offlineMode ? '#d1d5db' : '#2f80ed',
                      backgroundColor: offlineMode ? '#f3f4f6' : '#eef6ff',
                      borderRadius: 999,
                      paddingVertical: 12,
                      paddingHorizontal: 14,
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: 10,
                      opacity: offlineMode ? 0.55 : 1,
                    }}
                  >
                    <Text
                      style={{
                        color: offlineMode ? '#9ca3af' : '#2f80ed',
                        fontWeight: '800',
                        fontSize: 15,
                      }}
                    >
                      ✨ Generate Agenda with AI
                    </Text>
                    <Text
                      style={{
                        color: offlineMode ? '#9ca3af' : '#4b5563',
                        fontSize: 11,
                        marginTop: 3,
                        textAlign: 'center',
                      }}
                    >
                      Describe the meeting. AgendaGlow drafts the timing.
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    disabled={primaryDisabled}
                    style={[styles.primaryBtn, primaryDisabled && { opacity: 0.5 }]}
                    onPress={async () => {
                      if (!userId) {
                        Alert.alert('Missing Info', 'Please sign in first.');
                        return;
                      }

                      // 1) Template path
                      if (hasTemplate) {
                        const cleanTitle = String(localSessionIdRef.current || '')
                          .replace(/\s+/g, ' ')
                          .trim();

                        if (!validateSessionTitle(cleanTitle)) {
                          Alert.alert(
                            'Missing Info',
                            'Please enter a valid agenda title.',
                            [
                              {
                                text: 'OK',
                                onPress: () => {
                                  triggerTitleAttention();
                                },
                              },
                            ],
                            { cancelable: false }
                          );
                          return;
                        }

                        try {
                          await createSessionFromTemplate(cleanTitle);
                          await AsyncStorage.setItem(
                            '@userInfo',
                            JSON.stringify({
                              userId,
                              sessionId: cleanTitle,
                            })
                          );
                          await rememberRecentTitle(cleanTitle);
                        } catch (e) {
                          Alert.alert('Error', 'Could not create from template.');
                        }
                        return;
                      }

                      // 2) Copy-from-existing path
                      const sourceIdNow = copySourceIdRef.current;

                      if (sourceIdNow) {
                        const cleanTitleNow = String(localSessionIdRef.current || '')
                          .replace(/\s+/g, ' ')
                          .trim();

                        if (!validateSessionTitle(cleanTitleNow)) {
                          Alert.alert(
                            'Missing Info',
                            'Please enter a valid agenda title.',
                            [
                              {
                                text: 'OK',
                                onPress: () => {
                                  triggerTitleAttention();
                                },
                              },
                            ],
                            { cancelable: false }
                          );
                          return;
                        }

                        await createSessionCopyFromExisting(sourceIdNow, cleanTitleNow);
                        return;
                      }

                      if (copySourceIdRef.current) {
                        setCopySourceId(null);
                      }

                      // 3) Brand-new agenda path
                      try {
                        await openBlankCanvasQuickStart();
                      } catch (e) {
                        console.error('New agenda start failed:', e);
                        Alert.alert('Error', 'Could not start a new agenda.');
                      }
                    }}
                  >
                    <Text style={styles.primaryBtnText}>{primaryCtaLabel}</Text>
                  </TouchableOpacity>

                  {isRegistered && !isProUser && (
                    <TouchableOpacity
                      onPress={() => {
                        if (offlineMode) {
                          Alert.alert(
                            'Offline',
                            'Connect to the internet to view Pro plans.'
                          );
                          return;
                        }
                        setReturnToPrestart(true);
                        setShowPlans(true);
                        setScreen('settings');
                      }}
                      style={{ marginTop: 12, alignItems: 'center' }}
                    >
                      <Text
                        style={{
                          color: '#2f80ed',
                          fontSize: 13,
                          textDecorationLine: 'underline',
                        }}
                      >
                        ✨ View Pro plans & remove ads
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
                {/* ⭐ END CARD ⭐ */}
              </ScrollView>
            </View>
          )}

          {screen === 'myagendas' && (
            <View style={{ flex: 1, backgroundColor: '#f3f4f6' }}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingHorizontal: 12,
                  paddingTop: 10,
                }}
              >
                <View style={{ width: 64 }} />
                <View style={{ alignItems: 'center' }}>
                  <Text
                    style={{
                      fontSize: 24,
                      fontWeight: '800',
                      color: '#111827',
                      textAlign: 'center',
                      marginTop: 16,
                      marginBottom: 4,
                    }}
                  >
                    My Agendas
                  </Text>
                  <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>⭐ Pin up to 5 for Quick Launch</Text>
                </View>

                <View style={{ width: 64 }} />
              </View>

              <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 180 }}>

                {/* 🕘 Recents (moved from Pre-start) */}
                {recentTitles.length > 0 && (
                  <View style={{ marginBottom: 12 }}>
                    <View style={styles.recentHeaderRow}>
                      <Text style={styles.recentHeaderText}>Recent:</Text>
                      <TouchableOpacity onPress={clearRecentTitles}>
                        <Text style={styles.clearLink}>Clear</Text>
                      </TouchableOpacity>
                    </View>

                    <View style={styles.recentRow}>
                      {recentTitles.map((t) => {
                        const active = (localSessionId || '').trim() === t;

                        // t is sessionId (doc id). Try to show saved title if we have it.
                        const displayTitle =
                          (existingSessions || []).find((s) => (s?.id ?? s) === t)?.title || t;

                        return (
                          <TouchableOpacity
                            key={t}
                            onPress={() => openExistingSessionById(t)}
                            onLongPress={() => {
                              Alert.alert('Remove from recents?', `"${displayTitle}"`, [
                                { text: 'Cancel', style: 'cancel' },
                                {
                                  text: 'Remove',
                                  style: 'destructive',
                                  onPress: () => removeRecentTitle(t),
                                },
                              ]);
                            }}
                            delayLongPress={350}
                            style={[styles.chip, active && styles.chipActive]}
                          >
                            <Text style={styles.chipText}>{displayTitle}</Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                )}

                {/* Favorites stay up front; active agendas follow; completed meetings live in a collapsible archive. */}
                {existingSessions.length === 0 ? (
                  <Text style={{ fontSize: 14, fontStyle: 'italic', color: '#666', textAlign: 'center', paddingVertical: 12 }}>
                    🗃️ No saved agendas found
                  </Text>
                ) : (
                  <>
                    {favoriteAgendaSessions.length > 0 && (
                      <View style={{ marginBottom: 8 }}>
                        <TouchableOpacity
                          onPress={() => setShowFavoriteAgendas((prev) => !prev)}
                          style={{
                            paddingVertical: 12,
                            paddingHorizontal: 12,
                            backgroundColor: '#fffbeb',
                            borderRadius: 14,
                            borderWidth: 1,
                            borderColor: '#fde68a',
                            marginBottom: 10,
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                          }}
                          accessibilityRole="button"
                          accessibilityLabel="Toggle pinned agendas"
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                            <Ionicons name="star" size={18} color="#b45309" />
                            <Text
                              style={{
                                marginLeft: 8,
                                fontSize: 13,
                                fontWeight: '800',
                                color: '#92400e',
                              }}
                            >
                              Pinned Agendas ({favoriteAgendaSessions.length})
                            </Text>
                          </View>
                          <Ionicons
                            name={showFavoriteAgendas ? 'chevron-up-outline' : 'chevron-down-outline'}
                            size={18}
                            color="#92400e"
                          />
                        </TouchableOpacity>

                        {showFavoriteAgendas && favoriteAgendaSessions.map(renderMyAgendaSessionRow)}
                      </View>
                    )}

                    {(activeAgendaSessions.length > 0 || favoriteAgendaSessions.length > 0) && (
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: '800',
                          color: '#6b7280',
                          marginTop: favoriteAgendaSessions.length > 0 ? 4 : 0,
                          marginBottom: 8,
                          letterSpacing: 0.4,
                        }}
                      >
                        MY AGENDAS
                      </Text>
                    )}

                    {activeAgendaSessions.length === 0 ? (
                      <Text style={{ fontSize: 14, fontStyle: 'italic', color: '#666', textAlign: 'center', paddingVertical: 12 }}>
                        {favoriteAgendaSessions.length > 0
                          ? 'No other active agendas.'
                          : 'No active agendas. Completed meetings are in Archive below.'}
                      </Text>
                    ) : (
                      activeAgendaSessions.map(renderMyAgendaSessionRow)
                    )}

                    {archivedAgendaSessions.length > 0 && (
                      <View style={{ marginTop: 8 }}>
                        <TouchableOpacity
                          onPress={() => setShowArchivedAgendas((prev) => !prev)}
                          style={{
                            paddingVertical: 12,
                            paddingHorizontal: 12,
                            backgroundColor: '#eefdf3',
                            borderRadius: 14,
                            borderWidth: 1,
                            borderColor: '#bbf7d0',
                            marginBottom: 10,
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                          }}
                          accessibilityRole="button"
                          accessibilityLabel="Toggle completed meetings archive"
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
                            <Ionicons name="archive-outline" size={18} color="#166534" />
                            <Text
                              style={{
                                marginLeft: 8,
                                fontSize: 13,
                                fontWeight: '800',
                                color: '#166534',
                              }}
                            >
                              Completed / Archive ({archivedAgendaSessions.length})
                            </Text>
                          </View>
                          <Ionicons
                            name={showArchivedAgendas ? 'chevron-up-outline' : 'chevron-down-outline'}
                            size={18}
                            color="#166534"
                          />
                        </TouchableOpacity>

                        {showArchivedAgendas && archivedAgendaSessions.map(renderMyAgendaSessionRow)}
                      </View>
                    )}
                  </>
                )}
              </ScrollView>
            </View>
          )}

          {screen === 'templates' && (
            <View style={{ flex: 1, backgroundColor: '#f3f4f6' }}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingHorizontal: 12,
                  paddingTop: 10,
                }}
              >
                <View style={{ width: 64 }} />

                <View style={{ alignItems: 'center' }}>
                  <Text
                    style={{
                      fontSize: 24,
                      fontWeight: '800',
                      color: '#111827',
                      textAlign: 'center',
                      marginTop: 16,
                      marginBottom: 4, // was 12; tighter because we add a subtitle
                    }}
                  >
                    Templates
                  </Text>

                  <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                    ✨ Pick a work-meeting template to get started fast
                  </Text>
                </View>

                <View style={{ width: 64 }} />
              </View>

              <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 180 }}>

                <View
                    style={{
                      marginTop: 2,
                      marginBottom: 6,
                      backgroundColor: '#f9fafb',
                      borderRadius: 16,
                      paddingVertical: 12,
                      paddingHorizontal: 12,
                      borderWidth: 1,
                      borderColor: '#e5e7eb',
                      shadowColor: '#000',
                      shadowOpacity: 0.04,
                      shadowRadius: 8,
                      shadowOffset: { width: 0, height: 3 },
                      elevation: 2,
                    }}
                  >
                    {/* Categories row */}
                    <View
                      style={{
                        flexDirection: 'row',
                        flexWrap: 'wrap',
                        gap: 8,
                        marginBottom: 12,
                      }}
                    >
                      {Object.entries(TEMPLATE_ACCOUNTS).map(([key, cfg]) => {
                        const active = templateCategory === key;
                        return (
                          <TouchableOpacity
                            key={key}
                            onPress={() => loadTemplatesForCategory(key)}
                            style={{
                              paddingVertical: 8,
                              paddingHorizontal: 12,
                              borderRadius: 16,
                              borderWidth: 1,
                              borderColor: active ? '#2f80ed' : '#ccc',
                              backgroundColor: active ? '#e9f2ff' : '#fff',
                              marginRight: 8,
                              marginBottom: 8,
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 13,
                                fontWeight: active ? '700' : '600',
                                color: active ? '#2f80ed' : '#333',
                              }}
                            >
                              {cfg.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    {/* Session list */}
                    {templateLoading ? (
                      <View style={{ alignItems: 'center', paddingVertical: 12 }}>
                        <ActivityIndicator />
                        <Text style={{ color: '#666', marginTop: 6 }}>
                          Loading templates…
                        </Text>
                      </View>
                    ) : templateCategory == null ? (
                      <Text
                        style={{
                          textAlign: 'center',
                          color: '#666',
                          paddingVertical: 10,
                        }}
                      >
                        Pick a category above to load templates
                      </Text>
                    ) : (
                      <>
                        {templateSessions.length === 0 ? (
                          <Text
                            style={{
                              textAlign: 'center',
                              color: '#666',
                              paddingVertical: 10,
                            }}
                          >
                            No templates found for this category.
                          </Text>
                        ) : (
                          templateSessions.map(({ id, title }, index) => {
                            const isLocked = isTempAccount && index >= 2; // allow first 2, lock the rest

                            return (
                              <TouchableOpacity
                                key={id}
                                onPress={async () => {
                                  if (isLocked) {
                                    Alert.alert(
                                      'Locked template',
                                      'Create a free account to unlock all templates and protect your agendas.',
                                      [
                                        { text: 'Not now', style: 'cancel' },
                                        {
                                          text: 'Register',
                                          onPress: () => {
                                            setAuthScreenMode('upgrade');
                                            setScreen('emailAuth');
                                          },
                                        },
                                      ]
                                    );
                                    return;
                                  }

                                  setSelectedTemplateSessionId(id);
                                  setShowTemplatePicker(false);

                                  // Build from the template session id, not only the display title.
                                  // Some template/session ids already include dates, so strip that source id
                                  // before appending today's date.
                                  const suggestedTitle = await getNextAvailableTemplateTitle(id || title);

                                  setLocalSessionId(suggestedTitle);
                                  localSessionIdRef.current = suggestedTitle;

                                  // Clear copy mode because template is now the source
                                  setCopySourceId(null);
                                  copySourceIdRef.current = null;

                                  // If we came from Setup, load into current agenda and go back to Setup
                                  if (templateReturnScreen === 'setup') {
                                    setTimeout(() => loadSelectedTemplateIntoCurrentAgenda(id), 0);
                                    return;
                                  }

                                  // Existing behavior (Prestart)
                                  jumpHomeAndFocusTitle();
                                }}
                                style={{
                                  paddingVertical: 10,
                                  paddingHorizontal: 8,
                                  borderRadius: 8,
                                  backgroundColor: selectedTemplateSessionId === id ? '#e9f2ff' : '#fff',
                                  borderWidth: 1,
                                  borderColor: selectedTemplateSessionId === id ? '#2f80ed' : '#ddd',
                                  marginBottom: 8,
                                  opacity: isLocked ? 0.55 : 1,
                                }}
                              >
                                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                  <Text style={{ fontSize: 16 }}>{title}</Text>
                                  {isLocked ? (
                                    <Ionicons name="lock-closed" size={16} color="#6b7280" />
                                  ) : null}
                                </View>
                              </TouchableOpacity>
                            );
                          })

                        )}
                        <Text style={{ fontSize: 12, color: '#555', marginTop: 8 }}>
                          Tip: Tap any template to start a new agenda from it.
                        </Text>
                      </>
                    )}
                </View>
              </ScrollView>
            </View>
          )}

          {screen === 'more' && (
            <View style={{ flex: 1, backgroundColor: '#f3f4f6' }}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingHorizontal: 12,
                  paddingTop: 10,
                }}
              >
                <View style={{ width: 64 }} />
                <View style={{ alignItems: 'center' }}>
                  <Text
                    style={{
                      fontSize: 24,
                      fontWeight: '800',
                      color: '#111827',
                      textAlign: 'center',
                      marginTop: 16,
                      marginBottom: 4, // tighter because we add a subtitle
                    }}
                  >
                    More
                  </Text>

                  <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                    Product Info & updates
                  </Text>
                </View>

                <View style={{ width: 64 }} />
              </View>

              <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 180 }}>
                
                {/* --- Top CTA: Register (anon) or Go Pro (registered free) --- */}
                {isTempAccount ? (
                  <TouchableOpacity
                    onPress={() => {
                      setAuthScreenMode('upgrade'); // upgrade temp → registered
                      setScreen('emailAuth');
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      padding: 14,
                      backgroundColor: '#fff',
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: '#e5e7eb',
                      marginBottom: 10,
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Register to protect agendas"
                  >
                    <Ionicons name="lock-closed" size={24} color="#2f80ed" style={{ marginRight: 10 }} />

                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 16, fontWeight: '900', color: '#111827' }}>
                        Protect your agendas
                      </Text>
                      <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                        Save your agendas and unlock more.
                      </Text>
                    </View>

                    <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
                  </TouchableOpacity>
                ) : !isProUser ? (
                  <TouchableOpacity
                    onPress={() => {
                      if (offlineMode) {
                        Alert.alert('Offline', 'Connect to the internet to view Pro plans.');
                        return;
                      }
                      setShowPlans(true);     // 👈 expands the Pro Plans panel on Settings
                      setScreen('settings');  // 👈 navigates to Settings
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      padding: 14,
                      backgroundColor: '#fff',
                      borderRadius: 14,
                      borderWidth: 1,
                      borderColor: '#e5e7eb',
                      marginBottom: 10,
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Open Pro plans"
                  >
                    <Ionicons name="sparkles" size={24} color="#2f80ed" style={{ marginRight: 10 }} />

                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 16, fontWeight: '900', color: '#111827' }}>
                        Go Pro
                      </Text>
                      <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                        Remove ads and unlock all features.
                      </Text>
                    </View>

                    <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
                  </TouchableOpacity>
                ) : null}
                
                <TouchableOpacity
                  onPress={() => setScreen('settings')}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: 14,
                    backgroundColor: '#fff',
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: '#e5e7eb',
                    marginBottom: 10,
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Open Settings"
                >
                  <Ionicons name="settings" size={24} color="#2f80ed" style={{ marginRight: 10 }} />

                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: '900', color: '#111827' }}>
                      Settings
                    </Text>
                    <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                      Preferences, demo reset, viewer options
                    </Text>
                  </View>

                  <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => Linking.openURL('https://www.linkedin.com/company/dozenred-llc')}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: 14,
                    backgroundColor: '#f9fafb',
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: '#e5e7eb',
                    marginBottom: 10,
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Open LinkedIn"
                >
                  <Ionicons name="logo-linkedin" size={20} color="#6b7280" style={{ marginRight: 10 }} />

                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '800', color: '#111827' }}>
                      LinkedIn
                    </Text>
                    <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                      Follow for updates
                    </Text>
                  </View>

                  <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => Linking.openURL('https://www.facebook.com/AgendaGlow')}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: 14,
                    backgroundColor: '#f9fafb',
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: '#e5e7eb',
                    marginBottom: 10,
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Open Facebook"
                >
                  <Ionicons
                    name="logo-facebook"
                    size={20}
                    color="#6b7280"
                    style={{ marginRight: 10 }}
                  />

                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '800', color: '#111827' }}>
                      Facebook
                    </Text>
                    <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                      Follow AgendaGlow on Facebook
                    </Text>
                  </View>

                  <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => Linking.openURL('https://dozenred.com/blog/')}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: 14,
                    backgroundColor: '#f9fafb',
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: '#e5e7eb',
                    marginBottom: 10,
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Open AgendaGlow blog"
                >
                  <Ionicons name="newspaper-outline" size={20} color="#6b7280" style={{ marginRight: 10 }} />

                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '800', color: '#111827' }}>
                      AgendaGlow blog
                    </Text>
                    <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                      Templates, tips, and release notes
                    </Text>
                  </View>

                  <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => Linking.openURL('https://dozenred.com')}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: 14,
                    backgroundColor: '#f9fafb',
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: '#e5e7eb',
                    marginBottom: 10,
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Open DozenRed website"
                >
                  <Ionicons name="globe-outline" size={20} color="#6b7280" style={{ marginRight: 10 }} />

                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '800', color: '#111827' }}>
                      DozenRed website
                    </Text>
                    <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                      AgendaGlow updates, support, and resources
                    </Text>
                  </View>

                  <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
                </TouchableOpacity>
                
                <TouchableOpacity
                  onPress={async () => {
                    if (offlineMode) return;
                    try {
                      await Linking.openURL('https://dozenred.com/agendaglow-operating-manual/');
                    } catch {
                      Alert.alert('Unable to open', 'Please try again later.');
                    }
                  }}
                  disabled={offlineMode}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    padding: 14,
                    backgroundColor: '#f9fafb',
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: '#e5e7eb',
                    marginBottom: 10,
                    opacity: offlineMode ? 0.5 : 1,
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Open AgendaGlow Operating Manual"
                >
                  <Ionicons
                    name="help-circle-outline"
                    size={20}
                    color={offlineMode ? '#9ca3af' : '#6b7280'}
                    style={{ marginRight: 10 }}
                  />

                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '800', color: '#111827' }}>
                      Operating Manual
                    </Text>
                    <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                      Tips, how-to, and common questions
                    </Text>
                  </View>

                  <Ionicons name="chevron-forward" size={18} color="#9ca3af" />
                </TouchableOpacity>


              </ScrollView>
            </View>
          )}

          {screen === 'sharelink' && (
            <View style={{ flex: 1, backgroundColor: '#ffffff' }}>
              {/* Top bar: Save (left) */}
              <View
                style={{
                  alignSelf: 'stretch',
                  paddingHorizontal: 12,
                  paddingTop: 10,
                  paddingBottom: 4,
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <TouchableOpacity
                  onPress={() => {
                    // ✅ No save here. Share screen already auto-saves on entry.
                    setScreen('setup');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Save"
                  style={{ paddingVertical: 6, paddingHorizontal: 8 }}
                >
                  <Text style={{ fontSize: 16, fontWeight: '600', color: '#2f80ed' }}>
                    ← Back
                  </Text>
                </TouchableOpacity>

                {/* spacer to keep left aligned look (optional) */}
                <View style={{ width: 64 }} />
              </View>

              <ScrollView
                contentContainerStyle={{
                  alignItems: 'center',
                  padding: 24,
                  paddingBottom: !isProUser ? 140 : 24, // 👈 space for banner + separator
                }}
              >
              <View
                style={{
                  width: '100%',
                  backgroundColor: '#ffffff',
                  borderRadius: 18,
                  paddingVertical: 20,
                  paddingHorizontal: 16,
                  shadowColor: '#000',
                  shadowOpacity: 0.06,
                  shadowRadius: 10,
                  shadowOffset: { width: 0, height: 4 },
                  elevation: 3,
                  alignItems: 'center',
                }}
              >
                {/* Title + subtitle */}
                <Text
                  style={{
                    fontSize: 24,
                    fontWeight: '700',
                    textAlign: 'center',
                    marginBottom: 4,
                  }}
                >
                  {shareLinkMode === 'start' ? 'Share Before You Start' : '🔗 Share Meeting Link'}
                </Text>

                {/* ✅ Saved / Saving banner (moved inside the card, under the title) */}
                {(saveBannerText || isSavingAgenda) ? (
                  <View style={{ alignSelf: 'stretch', marginTop: 8, marginBottom: 12 }}>
                    <View
                      style={{
                        backgroundColor: 'rgba(17, 24, 39, 0.06)',
                        borderWidth: 1,
                        borderColor: 'rgba(17, 24, 39, 0.10)',
                        paddingVertical: 8,
                        paddingHorizontal: 10,
                        borderRadius: 12,
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ fontSize: 12, color: '#111827', fontWeight: '700' }}>
                        {isSavingAgenda ? 'Saving…' : saveBannerText}
                      </Text>
                      {isSavingAgenda ? <ActivityIndicator /> : <View />}
                    </View>
                  </View>
                ) : null}

                <Text
                  style={{
                    fontSize: 13,
                    color: '#6b7280',
                    textAlign: 'center',
                    marginBottom: 16,
                  }}
                >
                  {shareLinkMode === 'start' ? 'Your team can follow the agenda and timer live. Copy the link or show the QR, then start the meeting.' : 'Send this AgendaGlow viewer link so your team can follow along.'}
                </Text>

                {/* QR in its own card */}
                <View
                  style={{
                    backgroundColor: '#ffffff',
                    padding: 16,
                    borderRadius: 16,
                    shadowColor: '#000',
                    shadowOpacity: 0.04,
                    shadowRadius: 8,
                    shadowOffset: { width: 0, height: 2 },
                    elevation: 2,
                    marginBottom: 20,
                  }}
                >
                  <QRCode
                    value={buildViewerUrl(userId, sessionId)}
                    size={180}
                    ecl="H"
                    logo={brandLogoSource}
                    logoSize={getLogoSize(180)}
                    logoBackgroundColor="#FFFFFF"
                    logoMargin={2}
                    getRef={(c) => (shareQRRef.current = c)}
                  />
                </View>

                {/* 📋 Copy Link (primary action) */}
                <TouchableOpacity
                  onPress={() => {
                    const link = buildViewerUrl(userId, sessionId);
                    Clipboard.setStringAsync(link);
                    logUserEvent('viewer_link_copied', { sessionId, mode: shareLinkMode }, 'sharelink');
                    logAnalyticsConversion('viewer_link_shared', { method: 'copy', mode: shareLinkMode }, 'sharelink');
                    Alert.alert(
                      'Copied!',
                      'You can now paste the link into your email or calendar invite.'
                    );
                  }}
                  style={[
                    styles.primaryBtn,
                    {
                      paddingVertical: 10,
                      borderRadius: 12,
                      width: '100%',
                      marginTop: 4,
                      marginBottom: 8,
                    },
                  ]}
                >
                  <Text style={styles.primaryBtnText}>📋 Copy Link to Clipboard</Text>
                </TouchableOpacity>

                <Text
                  style={{
                    fontSize: 12,
                    color: '#555',
                    marginVertical: 8,
                    textAlign: 'center',
                  }}
                >
                  Tip: Tap “Copy Link” and paste it in your email or invite.
                </Text>

                {/* 📧 Compose Email (secondary) */}
                <TouchableOpacity
                  onPress={() => {
                    trackViewerLinkShared('email', { sessionId, mode: shareLinkMode }, 'sharelink');
                    handleShareMeetingLinkByEmail(sessionId, userId, shareQRRef);
                  }}
                  style={[
                    styles.primaryBtn,
                    {
                      paddingVertical: 10,
                      borderRadius: 12,
                      width: '100%',
                      marginTop: 12,
                      marginBottom: shareLinkMode === 'start' ? 8 : 12,
                    },
                  ]}
                >
                  <Text style={styles.primaryBtnText}>📧 Compose Email</Text>
                </TouchableOpacity>

                {shareLinkMode === 'start' && (
                  <TouchableOpacity
                    onPress={startMeetingWithOptionalInterstitial}
                    style={[
                      styles.primaryBtn,
                      {
                        paddingVertical: 12,
                        borderRadius: 999,
                        width: '100%',
                        marginTop: 4,
                        marginBottom: 4,
                        backgroundColor: '#27ae60',
                      },
                    ]}
                  >
                    <Text style={styles.primaryBtnText}>▶️ Start Meeting</Text>
                  </TouchableOpacity>
                )}
              </View>
            </ScrollView>
          </View>
          )}

          {['timer', 'setup', 'summary', 'settings'].includes(screen) && (
            <ScrollView
              ref={mainScrollRef}
              contentContainerStyle={{ alignItems: 'center', paddingVertical: 20 }}
            >
              {screen === 'timer' && (
                <View style={{ alignItems: 'center', marginBottom: 20 }}>
                  {connectionStatus === 'offline' && (
                    <View
                      style={{
                        backgroundColor: '#d11a2a',
                        paddingVertical: 6,
                        paddingHorizontal: 12,
                        borderRadius: 8,
                        marginBottom: 8,
                      }}
                    >
                      <Text style={{ color: '#fff', fontWeight: '600' }}>
                        🛑 Connection Lost — Running in Offline Mode
                      </Text>
                    </View>
                  )}

                  {connectionStatus === 'online' && (
                    <View
                      style={{
                        backgroundColor: '#007A33',
                        paddingVertical: 6,
                        paddingHorizontal: 12,
                        borderRadius: 8,
                        marginBottom: 8,
                      }}
                    >
                      <Text style={{ color: '#fff', fontWeight: '600' }}>
                        ✅ Connection Restored — Syncing Resumed
                      </Text>
                    </View>
                  )}

                  {/* 🎬 Demo badge + Skip (only during the sample/demo) */}
                  {isSampleDemoActive && (
                    <View style={{ alignItems: 'center', marginBottom: 6, width: '100%' }}>
                      <View
                        style={{
                          width: '100%',
                          maxWidth: 520,
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          paddingHorizontal: 6,
                          marginBottom: 4,
                        }}
                      >
                        <Animated.View
                          style={{
                            marginRight: 10,
                            transform: [{ scale: demoBadgeScale }],
                          }}
                        >
                          <View
                            style={{
                              paddingVertical: 6,
                              paddingHorizontal: 14,
                              borderRadius: 999,
                              backgroundColor: 'rgba(17,24,39,0.08)',
                              borderWidth: 1,
                              borderColor: 'rgba(17,24,39,0.18)',
                            }}
                          >
                            <Text style={{ fontSize: 12, fontWeight: '900', letterSpacing: 1, color: '#111827' }}>
                              DEMO
                            </Text>
                          </View>
                        </Animated.View>
                      </View>

                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#111827', opacity: 0.85 }}>
                        You don&apos;t have to watch the clock. We do.
                      </Text>
                    </View>
                  )}

                  {summaryPending && screen === 'summary' ? (
                    <>
                      <Text style={{ fontSize: 18, color: '#6b7280', marginBottom: 4 }}>
                        Preparing summary…
                      </Text>
                      <ActivityIndicator />
                    </>
                  ) : !overtimeMode ? (
                    <>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                        {/* Badge LEFT */}
                        <View
                          style={{
                            marginRight: 10,
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            borderRadius: 999,
                            backgroundColor: 'rgba(255,255,255,0.65)',
                            borderWidth: 2,
                            borderColor: 'rgba(0,0,0,0.55)',
                          }}
                        >
                          <Text style={{ fontSize: 14, fontWeight: '900', letterSpacing: 0.5, color: '#111827' }}>
                            {(() => {
                              const b = getPhaseBadge();
                              return `${b.shape} ${b.code}`;
                            })()}
                          </Text>
                        </View>

                        {/* Digits RIGHT */}
                        <Text
                          style={{
                            fontSize: 56,
                            fontWeight: '700',
                            letterSpacing: 2,
                            marginBottom: 6,
                          }}
                        >
                          {Math.floor(timeLeft / 60)}:
                          {(timeLeft % 60).toString().padStart(2, '0')}
                        </Text>
                      </View>

                      {!overtimeMode && !isSampleDemoActive && (
                        <Text
                          style={{
                            marginTop: 2,
                            fontSize: 11,
                            color: '#111827',
                            opacity: 0.8,
                          }}
                        >
                          {`${percentRemaining}% remaining`}
                        </Text>
                      )}
                      {/* 🎬 Demo badge + Skip (first-run demo only) */}
                      {isSampleDemoActive && (
                        <View
                          style={{
                            marginTop: 10,
                            flexDirection: 'row',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 12,
                          }}
                        >

                        </View>
                      )}
                    </>
                  ) : (
                    <>

                      {/* Time digits flash yellow ↔ black */}
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                        {/* Badge LEFT */}
                        <View
                          style={{
                            marginRight: 10,
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            borderRadius: 999,
                            backgroundColor: 'rgba(255,255,255,0.65)',
                            borderWidth: 2,
                            borderColor: 'rgba(0,0,0,0.55)',
                          }}
                        >
                          <Text style={{ fontSize: 14, fontWeight: '900', letterSpacing: 0.5, color: '#111827' }}>
                            {(() => {
                              const b = getPhaseBadge();
                              return `${b.shape} ${b.code}`;
                            })()}
                          </Text>
                        </View>

                        {/* Digits RIGHT */}
                        <Animated.Text
                          style={{
                            fontSize: 56,
                            fontWeight: '700',
                            letterSpacing: 2,
                            color: flashColor,
                          }}
                        >
                          {Math.floor(overtimeSec / 60)}:
                          {(overtimeSec % 60).toString().padStart(2, '0')}
                        </Animated.Text>
                      </View>

                      <Text
                        style={{
                          marginTop: 2,
                          fontSize: 11,
                          color: '#111827',
                          opacity: 0.9,
                        }}
                      >
                        {`${percentOver}% over scheduled`}
                      </Text>
                    </>
                  )}

                  {/* Current Agenda Title (QR = meeting, Info = item) */}
                  {(() => {
                    const isShowingMeetingTitle = timerPanel === 'qr';
                    const nudge = !isShowingMeetingTitle ? getTimeNudge() : null;

                    const titleText = isShowingMeetingTitle
                      ? title || sessionId || 'Untitled Session'
                      : agendaItems[currentIndex]?.title ||
                        title ||
                        sessionId ||
                        'Untitled Session';

                    return (
                      <View style={{ alignItems: 'center', marginTop: 4, marginBottom: 8 }}>
                        <Text
                          style={{
                            fontSize: isShowingMeetingTitle
                              ? getMeetingTitleFontSize(titleText)
                              : getCurrentItemTitleFontSize(titleText),
                            fontWeight: '700',
                            textAlign: 'center',
                            maxWidth: '100%',
                          }}
                          numberOfLines={1}
                        >
                          {titleText}
                        </Text>

                        {/* Nudge slot (reserved space so layout never shifts) */}
                        <View
                          pointerEvents="none"
                          style={{
                            height: 30,          // <- reserved space (tweak 28–34 if you want)
                            marginTop: 6,
                            justifyContent: 'center',
                            alignItems: 'center',
                          }}
                        >
                          {!!nudge && (
                            <View
                              style={{
                                paddingVertical: 5,
                                paddingHorizontal: 12,
                                borderRadius: 999,
                                backgroundColor: 'rgba(255,255,255,0.35)',
                                borderWidth: 1,
                                borderColor: 'rgba(255,255,255,0.25)',
                              }}
                            >
                              <Text
                                style={{
                                  fontFamily: Platform.OS === 'ios' ? 'System' : 'sans-serif',
                                  fontStyle: 'italic',
                                  fontSize: 12,
                                  fontWeight: '600',   // italic + 800 often won't render correctly
                                  color: '#111827',
                                  textAlign: 'center',
                                  opacity: 0.9,
                                  maxWidth: 220,         // prevents box widening
                                }}
                              >
                                {nudge}
                              </Text>
                            </View>
                          )}
                        </View>

                      </View>
                    );
                  })()}

                  {/* Toggle buttons */}
                  {(() => {
                    const rawInfo = agendaItems[currentIndex]?.info ?? '';
                    const hasInfo = rawInfo.trim().length > 0;

                    return (
                      <>
                        <View
                          style={{
                            flexDirection: 'row',
                            marginTop: 4,
                            borderRadius: 999,
                            overflow: 'hidden',
                            borderWidth: 1,
                            borderColor: '#d1d5db',
                            backgroundColor: '#f9fafb',
                            alignSelf: 'stretch',
                            marginHorizontal: 24, // line up with the info card
                          }}
                        >
                          {/* INFO on the LEFT */}
                          <TouchableOpacity
                            onPress={() => setTimerPanel('info')}
                            disabled={!hasInfo}
                            style={{
                              flex: 1,
                              paddingVertical: 7,
                              paddingHorizontal: 12,
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor:
                                timerPanel === 'info' ? '#e5f0ff' : 'transparent',
                              opacity: hasInfo ? 1 : 0.5,
                              borderRightWidth: 1,
                              borderRightColor: '#d1d5db',
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 13,
                                fontWeight: '600',
                                color: timerPanel === 'info' ? '#2f80ed' : '#4b5563',
                              }}
                            >
                              Info
                            </Text>
                          </TouchableOpacity>

                          {/* QR on the RIGHT */}
                          <TouchableOpacity
                            onPress={() => setTimerPanel('qr')}
                            style={{
                              flex: 1,
                              paddingVertical: 7,
                              paddingHorizontal: 12,
                              alignItems: 'center',
                              justifyContent: 'center',
                              backgroundColor:
                                timerPanel === 'qr' ? '#e5f0ff' : 'transparent',
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 13,
                                fontWeight: '600',
                                color: timerPanel === 'qr' ? '#2f80ed' : '#4b5563',
                              }}
                            >
                              QR
                            </Text>
                          </TouchableOpacity>
                        </View>

                        {/* Panel (show Info if present; otherwise always show QR) */}
                        <View
                          style={{
                            marginTop: 4,
                            height: 220, // keep existing height
                            justifyContent: 'center',
                            alignSelf: 'stretch',
                            marginHorizontal: -24,
                          }}
                        >
                          {timerPanel === 'qr' ? (
                            <View style={{ alignItems: 'center' }}>
                              <QRCode
                                value={buildViewerUrl(userId, sessionId)}
                                size={148}
                                ecl="H"
                                logo={brandLogoSource}
                                logoSize={getLogoSize(160)}
                                logoBackgroundColor="#FFFFFF"
                                logoMargin={2}
                              />
                            </View>
                          ) : (
                            <ScrollView
                              style={{ flex: 1 }}
                              contentContainerStyle={{ paddingBottom: 4 }}
                              showsVerticalScrollIndicator={false}
                            >
                              <View
                                style={{
                                  flex: 1,
                                  backgroundColor: '#fff', // solid white like pre-start
                                  borderRadius: 18,
                                  padding: 16,
                                  width: '86%',
                                  alignSelf: 'center',
                                  justifyContent: 'flex-start',

                                  // subtle card shadow (similar vibe to pre-start card)
                                  shadowColor: '#2f80ed',
                                  shadowOpacity: 0.12,
                                  shadowRadius: 14,
                                  shadowOffset: { width: 0, height: 5 },
                                  elevation: 5,

                                  // light border to keep it crisp on bright green
                                  borderWidth: 1,
                                  borderColor: '#e5e7eb',
                                }}
                              >
                                <>
                                  {/* Presenter line (only if present) */}
                                  {(() => {
                                    const presenter = (
                                      agendaItems[currentIndex]?.presenterTag || ''
                                    ).trim();
                                    if (!presenter) return null;
                                    return (
                                      <Text
                                        style={{
                                          fontSize: 13,
                                          color: '#333',
                                          marginBottom: 6,
                                        }}
                                      >
                                        <Text style={{ fontWeight: 'bold' }}>
                                          {presenter}
                                        </Text>{' '}
                                        <Text>(presenter)</Text>
                                      </Text>
                                    );
                                  })()}

                                  {/* Additional info / notes */}
                                  <Text
                                    style={{
                                      fontSize: 13,
                                      color: '#333',
                                      lineHeight: 18,
                                    }}
                                  >
                                    {agendaItems[currentIndex]?.info ||
                                      'No additional info for this item. Tap the 🅣 icon on Setup to add notes.'}
                                  </Text>
                                </>
                              </View>
                            </ScrollView>
                          )}
                        </View>
                      </>
                    );
                  })()}

                  {/* Agenda list (completed items get a checkmark + strikethrough) */}
                  <View style={{ marginTop: 0, width: '90%', position: 'relative' }}>
                    {(() => {
                      // For longer agendas, keep the Timer screen compact by showing
                      // only the two most-recent completed items as strikethroughs.
                      // Current and upcoming items still remain visible.
                      const compactCompleted = agendaItems.length > 5;
                      const hiddenCompletedCount = compactCompleted
                        ? Math.max(0, currentIndex - 2)
                        : 0;

                      return (
                        <>
                          {hiddenCompletedCount > 0 && (
                            <View
                              style={{
                                flexDirection: 'row',
                                alignItems: 'center',
                                marginBottom: 4,
                                paddingVertical: 3,
                                paddingHorizontal: 8,
                                opacity: 0.72,
                              }}
                            >
                              <View
                                style={{
                                  width: 24,
                                  alignItems: 'flex-end',
                                  marginRight: 6,
                                }}
                              >
                                <Text style={{ color: '#4b5563', fontWeight: '800' }}>✓</Text>
                              </View>
                              <Text
                                style={{
                                  fontSize: 12,
                                  color: '#4b5563',
                                  fontStyle: 'italic',
                                }}
                              >
                                {hiddenCompletedCount} earlier completed
                              </Text>
                            </View>
                          )}

                          {agendaItems.map((item, idx) => {
                            const isCurrent = idx === currentIndex;
                            const isCompleted = idx < currentIndex;
                            const hideOlderCompleted = compactCompleted && idx < currentIndex - 2;

                            if (hideOlderCompleted) return null;

                            return (
                              <View
                                key={`${item.title}-${idx}`}
                                style={{
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  marginBottom: 6,
                                  paddingVertical: 6,
                                  paddingHorizontal: 8,
                                  borderRadius: 12,
                                  backgroundColor: isCurrent
                                    ? 'rgba(255,255,255,0.25)'
                                    : 'transparent',
                                  borderWidth: isCurrent ? 1 : 0,
                                  borderColor: isCurrent
                                    ? 'rgba(255,255,255,0.35)'
                                    : 'transparent',
                                  transform: isCurrent ? [{ scale: 1.02 }] : [{ scale: 1 }],
                                  opacity: isCompleted ? 0.68 : 1,
                                }}
                              >
                                {/* Status column: current arrow, completed checkmark */}
                                <View
                                  style={{
                                    width: 24,
                                    alignItems: 'flex-end',
                                    marginRight: 6,
                                  }}
                                >
                                  {isCurrent ? (
                                    <Text>👉</Text>
                                  ) : isCompleted ? (
                                    <Text style={{ color: '#4b5563', fontWeight: '800' }}>✓</Text>
                                  ) : null}
                                </View>

                                {/* left-justified text column */}
                                <Text
                                  style={{
                                    fontSize: 14,
                                    fontWeight: isCurrent ? '700' : '400',
                                    color: isCompleted ? '#4b5563' : '#111827',
                                    textDecorationLine: isCompleted ? 'line-through' : 'none',
                                  }}
                                >
                                  {item.title} ({item.duration} min)
                                </Text>
                              </View>
                            );
                          })}
                        </>
                      );
                    })()}
                  </View>

                  {/* 🔽 On Deck or Final */}

                  {currentIndex === agendaItems.length - 1 && (
                    <Text
                      style={{
                        fontSize: 14,
                        color: '#555',
                        marginTop: 4,
                        fontStyle: 'italic',
                      }}
                    >
                      🏁 Final item
                    </Text>
                  )}
                </View>
              )}

              {screen === 'setup' && (
                <View style={{ flex: 1, width: '100%', backgroundColor: '#f3f4f6' }}>
                  {/* Top bar: Help (right only) */}
                  <View
                    style={{
                      alignSelf: 'stretch',
                      paddingHorizontal: 12,
                      paddingTop: 8,
                      paddingBottom: 4,
                      flexDirection: 'row',
                      justifyContent: 'flex-end',
                      alignItems: 'center',
                    }}
                  >
                    <ManualHelpButton offline={offlineMode} />
                  </View>

                  {/* Fixed title header (always visible) */}
                  <View
                    style={{
                      paddingHorizontal: 20,
                      paddingBottom: 8,
                      alignItems: 'center',
                    }}
                  >
                    <View style={{ alignItems: 'center' }}>
                      {!isEditingAgendaTitle ? (
                        <TouchableOpacity
                          onPress={() => {
                            setAgendaTitleDraft(title || '');
                            setIsEditingAgendaTitle(true);
                          }}
                          activeOpacity={0.7}
                          style={{ alignItems: 'center' }}
                        >
                          <Text
                            style={{
                              fontSize: getMeetingTitleFontSize(title || ''),
                              fontWeight: '700',
                              textAlign: 'center',
                              maxWidth: '100%',
                            }}
                            numberOfLines={1}
                          >
                            {title || 'Untitled agenda'}
                          </Text>
                          <Text style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                            Tap to edit title
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        <TextInput
                          ref={agendaTitleInputRef}
                          value={agendaTitleDraft}
                          onChangeText={handleAgendaTitleDraftChange}
                          placeholder="Agenda title"
                          placeholderTextColor="#9ca3af"
                          returnKeyType="done"
                          onSubmitEditing={() => commitAgendaTitle(agendaTitleDraft)}
                          onBlur={() => {
                            setAgendaTitleDraft(title || '');
                            setIsEditingAgendaTitle(false);
                          }}
                          style={{
                            minWidth: '80%',
                            textAlign: 'center',
                            fontSize: 18,
                            fontWeight: '700',
                            color: '#111827',
                            paddingVertical: 6,
                            paddingHorizontal: 10,
                            borderRadius: 12,
                            borderWidth: 1,
                            borderColor: '#e5e7eb',
                            backgroundColor: '#fff',
                          }}
                        />
                      )}
                    </View>

                    {String(agendaTitleDraft || title || '').trim().length > 0 &&
                      !titleHasDate(agendaTitleDraft || title) && (
                        <TouchableOpacity
                          onPress={async () => {
                            const base = String(agendaTitleDraft || title || '').trim();
                            const next = base ? appendTodayToTitle(base) : getTodayISO(); // allow date-only ONLY when user taps
                            setAgendaTitleDraft(next);
                            await commitAgendaTitle(next);
                          }}
                          style={{ alignSelf: 'center', marginTop: 6, marginBottom: 2 }}
                        >
                          <Text style={{ color: '#2563eb', fontWeight: '600' }}>
                            ➕ Add today&apos;s date
                          </Text>
                        </TouchableOpacity>
                      )}

                    <Text style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>
                      Setup your agenda before starting
                    </Text>
                  </View>

                  {/* Scrollable content in a floating card */}
                  <ScrollView
                    contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 180 }}
                  >
                    <View style={styles.setupCard}>
                      {offlineMode && (
                        <Text
                          style={{
                            color: '#d11a2a',
                            fontStyle: 'italic',
                            textAlign: 'center',
                            marginBottom: 8,
                          }}
                        >
                          ⚠️ Running in Offline Mode — No data will be synced
                        </Text>
                      )}

                      {!offlineMode && auth.currentUser?.isAnonymous && (
                        <View
                          style={{
                            backgroundColor: '#f9fafb',
                            borderColor: '#e5e7eb',
                            borderWidth: 1,
                            borderRadius: 14,
                            padding: 12,
                            marginBottom: 12,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 13,
                              color: '#111827',
                              fontWeight: '800',
                              marginBottom: 4,
                            }}
                          >
                            Ready to run this meeting
                          </Text>
                          <Text style={{ fontSize: 12, color: '#6b7280', lineHeight: 16 }}>
                            This agenda works now. Sign in later if you want to save and reuse it across devices.
                          </Text>
                          <TouchableOpacity
                            onPress={() => {
                              logUserEvent('setup_signin_to_save_tapped', {}, 'setup');
                              setAuthScreenMode('upgrade');
                              setScreen('emailAuth');
                            }}
                            style={{ alignSelf: 'flex-start', marginTop: 8, paddingVertical: 2 }}
                            activeOpacity={0.7}
                          >
                            <Text style={{ fontSize: 12, color: '#2f80ed', fontWeight: '700' }}>
                              Sign in to save
                            </Text>
                          </TouchableOpacity>
                        </View>
                      )}

                      {currentAgendaSource === 'ai' && !!lastAiPrompt && (
                        <View
                          style={{
                            backgroundColor: '#eef6ff',
                            borderColor: '#bfdbfe',
                            borderWidth: 1,
                            borderRadius: 14,
                            padding: 12,
                            marginBottom: 12,
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 13,
                              color: '#1f2937',
                              fontWeight: '700',
                              marginBottom: 4,
                            }}
                          >
                            ✨ AI drafted this agenda
                          </Text>
                          <Text
                            style={{
                              fontSize: 12,
                              color: '#4b5563',
                              lineHeight: 16,
                              marginBottom: 10,
                            }}
                            numberOfLines={2}
                          >
                            {lastAiPrompt}
                          </Text>
                          <TouchableOpacity
                            onPress={regenerateAiAgendaFromLastPrompt}
                            disabled={aiAgendaBusy || offlineMode}
                            style={[
                              styles.secondaryBtn,
                              {
                                alignSelf: 'flex-start',
                                opacity: aiAgendaBusy || offlineMode ? 0.5 : 1,
                              },
                            ]}
                          >
                            <Text style={styles.secondaryBtnText}>
                              {aiAgendaBusy ? 'Regenerating…' : 'Regenerate / Try again'}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      )}

                      {/* 🔹 Agenda items list (true drag & drop) */}

                      {/* Header row: Agenda Item | Min */}
                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'flex-end',
                          paddingHorizontal: 4,
                          marginBottom: 6,
                        }}
                      >
                        {/* spacer for drag handle column */}
                        <View style={{ width: 24, marginRight: 6 }} />

                        {/* agenda item label – aligned with first character inside title pill */}
                        <View style={{ flex: 1, marginRight: 8 }}>
                          <Text
                            style={{
                              fontSize: 11,
                              color: '#777',
                              marginLeft: 24, // matches title TextInput paddingHorizontal
                            }}
                          >
                            agenda item:
                          </Text>
                        </View>

                        {/* minutes label – centered above minutes pill */}
                        <View
                          style={{
                            width: 44, // ⬅️ match minutes TextInput width
                            marginRight: 22,
                            alignItems: 'center',
                          }}
                        >
                          <Text
                            style={{
                              fontSize: 11,
                              color: '#777',
                              textAlign: 'center',
                            }}
                          >
                            min
                          </Text>
                        </View>

                        {/* spacer for ⋮ menu column */}
                        <View style={{ width: 24 }} />
                      </View>

                      <DraggableFlatList
                        data={agendaItems}
                        keyExtractor={(item, index) => String(item.id ?? index)}
                        scrollEnabled={false} // outer ScrollView handles scrolling
                        contentContainerStyle={{ paddingBottom: 8 }}
                        extraData={{
                          editingDuration,
                          editingTitle,
                          detailsModalItemId,
                          editingYellow,
                          editingRed,
                        }}
                        onDragEnd={async ({ data }) => {
                          await commitAgendaUpdate(data);
                        }}
                        renderItem={({ item, index, drag, isActive }) => {
                          const id = item.id ?? index; // safe key to use in our editing maps
                          const idx = index;

                          return (
                            <View
                              style={[
                                styles.setupItemCard,
                                isActive && {
                                  transform: [{ scale: 0.98 }],
                                  shadowOpacity: 0.08,
                                },
                              ]}
                            >
                              {/* Top row: drag handle + title + duration + Aa + trash */}
                              <View style={styles.setupItemTopRow}>
                                {/* Drag handle: long-press to drag */}
                                <TouchableOpacity
                                  onLongPress={drag}
                                  delayLongPress={120}
                                  style={styles.setupDragCol}
                                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }} // 👈 bigger hit area
                                >
                                  <Text style={styles.setupDragHandle}>≡</Text>
                                </TouchableOpacity>

                                {/* Title + label */}
                                <View style={{ flex: 1, marginRight: 8 }}>
                                  <TextInput
                                    style={{
                                      borderColor: '#d0d0d0',
                                      borderWidth: 1,
                                      borderRadius: 999, // full pill look
                                      paddingVertical: 8,
                                      paddingHorizontal: 12,
                                      backgroundColor: '#fff',
                                      fontSize: getAgendaRowTitleFontSize(
                                        editingTitle[id] ?? item.title ?? ''
                                      ),
                                    }}
                                    value={editingTitle[id] ?? item.title}
                                    placeholder="Agenda item title"
                                    maxLength={ITEM_TITLE_MAX_CHARS}
                                    onChangeText={(text) => {
                                      // keep it local while typing
                                      setEditingTitle((prev) => ({
                                        ...prev,
                                        [id]: text,
                                      }));
                                    }}
                                    onBlur={async() => {
                                      const raw = editingTitle[id] ?? item.title ?? '';
                                      const trimmed = raw.slice(0, ITEM_TITLE_MAX_CHARS);

                                      // clear local buffer
                                      setEditingTitle((prev) => {
                                        const updated = { ...prev };
                                        delete updated[id];
                                        return updated;
                                      });

                                      await updateOneAgendaItem(item, { title: trimmed || 'Untitled item' });
                                    }}
                                  />
                                </View>

                                {/* Duration – smaller pill, still 3-digit capable */}
                                <View style={{ marginRight: 8, alignItems: 'center' }}>
                                  <TextInput
                                    style={{
                                      width: 44, // narrower → more room for title
                                      borderColor: '#d0d0d0',
                                      borderWidth: 1,
                                      borderRadius: 10,
                                      paddingVertical: 6,
                                      paddingHorizontal: 6,
                                      textAlign: 'center',
                                      backgroundColor: '#fff',
                                      fontSize: 14,
                                    }}
                                    keyboardType="numeric"
                                    value={
                                      editingDuration[id] ?? String(item.duration ?? 1)
                                    }
                                    onChangeText={(text) => {
                                      // Keep a local editing buffer per row while typing
                                      setEditingDuration((prev) => ({
                                        ...prev,
                                        [id]: text,
                                      }));
                                    }}
                                    onBlur={async() => {
                                      const raw =
                                        editingDuration[id] ?? String(item.duration ?? 1);
                                      const cleaned = raw.replace(/[^0-9]/g, '');
                                      let parsed = parseInt(cleaned, 10);

                                      if (isNaN(parsed) || parsed <= 0) {
                                        parsed = item.duration || 1;
                                      }

                                      // ⛔ hard cap at 240 minutes (4 hours)
                                      parsed = Math.min(parsed, 240);

                                      setEditingDuration((prev) => {
                                        const updated = { ...prev };
                                        delete updated[id];
                                        return updated;
                                      });

                                      await updateOneAgendaItem(item, { duration: parsed });
                                    }}
                                  />
                                </View>

                                {/* ⋮ Per-item overflow menu */}
                                <TouchableOpacity
                                  onPress={() => setMenuForItemId(item.id ?? index)}
                                  style={{ paddingHorizontal: 4, paddingVertical: 4 }}
                                >
                                  <Ionicons
                                    name="ellipsis-vertical"
                                    size={20}
                                    color="#6b7280"
                                  />
                                </TouchableOpacity>
                              </View>

                              {/* Advanced thresholds editor (only when enabled in Settings) */}
                              {advancedThresholdsEnabled && (
                                <View style={styles.setupItemMetaRow}>
                                  <View style={styles.setupItemMetaLeft}>
                                    {/* Yellow threshold editor */}
                                    <View
                                      style={{
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                        marginRight: 12,
                                      }}
                                    >
                                      <Text style={styles.setupItemTinyText}>
                                        Yellow:
                                      </Text>
                                      <TextInput
                                        style={{
                                          marginLeft: 4,
                                          paddingHorizontal: 4,
                                          paddingVertical: 2,
                                          minWidth: 46,
                                          borderWidth: 1,
                                          borderColor: '#d0d0d0',
                                          borderRadius: 6,
                                          textAlign: 'center',
                                          backgroundColor: '#fff',
                                          fontSize: 11,
                                        }}
                                        keyboardType="numeric"
                                        value={
                                          editingYellow[id] !== undefined
                                            ? editingYellow[id]
                                            : (() => {
                                                const durSec = (item.duration || 1) * 60;
                                                const frac = item.yellow ?? 0.66666;

                                                if (thresholdBasis === 'percent') {
                                                  const elapsedPct = Math.round(
                                                    frac * 100
                                                  );
                                                  const shownPct = showRemaining
                                                    ? 100 - elapsedPct
                                                    : elapsedPct;
                                                  return String(shownPct);
                                                } else {
                                                  const elapsedSec = Math.round(
                                                    frac * durSec
                                                  );
                                                  const remainingSec = Math.max(
                                                    0,
                                                    durSec - elapsedSec
                                                  );
                                                  const shownSec = showRemaining
                                                    ? remainingSec
                                                    : elapsedSec;
                                                  return String(shownSec);
                                                }
                                              })()
                                        }
                                        onChangeText={(text) => {
                                          // keep raw typing buffer
                                          setEditingYellow((prev) => ({
                                            ...prev,
                                            [id]: text,
                                          }));

                                          const cleaned = text.replace(',', '.').trim();
                                          if (
                                            cleaned === '' ||
                                            cleaned === '.' ||
                                            cleaned === '-'
                                          )
                                            return;

                                          const parsed = parseFloat(cleaned);
                                          if (isNaN(parsed) || parsed < 0) return;

                                          const durSec = Math.max(
                                            1,
                                            (item.duration || 1) * 60
                                          );
                                          const redFrac = item.red ?? 0.9;

                                          let frac;
                                          if (thresholdBasis === 'percent') {
                                            const clamped = Math.min(
                                              100,
                                              Math.max(0, parsed)
                                            );
                                            const elapsedPct = showRemaining
                                              ? 100 - clamped
                                              : clamped;
                                            frac = elapsedPct / 100;
                                          } else {
                                            const clamped = Math.min(
                                              durSec,
                                              Math.max(0, parsed)
                                            );
                                            const elapsedSec = showRemaining
                                              ? durSec - clamped
                                              : clamped;
                                            frac = elapsedSec / durSec;
                                          }

                                          // 🔕 SILENT RULE: only commit if valid
                                          if (frac > 0 && frac < redFrac && frac < 1) {
                                            setAgendaItems((prev) =>
                                              prev.map((it) =>
                                                (it.id ?? it.title) ===
                                                (item.id ?? item.title)
                                                  ? { ...it, yellow: frac }
                                                  : it
                                              )
                                            );
                                          }
                                        }}
                                        onBlur={async() => {
                                          const raw = (editingYellow[id] ?? '')
                                            .replace(',', '.')
                                            .trim();
                                          const parsed = parseFloat(raw);

                                          const durSec = Math.max(
                                            1,
                                            (item.duration || 1) * 60
                                          );
                                          const redFrac = item.red ?? 0.9;

                                          // If empty/NaN, just clear buffer and exit quietly
                                          if (isNaN(parsed)) {
                                            setEditingYellow((prev) => {
                                              const copy = { ...prev };
                                              delete copy[id];
                                              return copy;
                                            });
                                            return;
                                          }

                                          // 🚨 Basis-specific “within duration” check for time mode
                                          if (thresholdBasis !== 'percent') {
                                            // In time-based mode the input is seconds (remaining OR elapsed), both must be within [0..durSec]
                                            if (parsed > durSec) {
                                              Alert.alert(
                                                '⚠️ Invalid Yellow',
                                                `Yellow time must be within the agenda duration (${durSec}s).`
                                              );
                                              setEditingYellow((prev) => {
                                                const copy = { ...prev };
                                                delete copy[id];
                                                return copy;
                                              });
                                              return;
                                            }
                                          } else {
                                            // percent mode must be within [0..100]
                                            if (parsed > 100) {
                                              Alert.alert(
                                                '⚠️ Invalid Yellow',
                                                'Yellow percent must be within 0–100%.'
                                              );
                                              setEditingYellow((prev) => {
                                                const copy = { ...prev };
                                                delete copy[id];
                                                return copy;
                                              });
                                              return;
                                            }
                                          }

                                          // Convert input -> frac (elapsed fraction)
                                          let frac;
                                          if (thresholdBasis === 'percent') {
                                            const clamped = Math.min(
                                              100,
                                              Math.max(0, parsed)
                                            );
                                            const elapsedPct = showRemaining
                                              ? 100 - clamped
                                              : clamped;
                                            frac = elapsedPct / 100;
                                          } else {
                                            const clamped = Math.min(
                                              durSec,
                                              Math.max(0, parsed)
                                            );
                                            const elapsedSec = showRemaining
                                              ? durSec - clamped
                                              : clamped;
                                            frac = elapsedSec / durSec;
                                          }

                                          // 🚨 Reason-specific rules
                                          if (frac <= 0) {
                                            Alert.alert(
                                              '⚠️ Invalid Yellow',
                                              'Yellow must be greater than 0.'
                                            );
                                          } else if (frac >= 1) {
                                            Alert.alert(
                                              '⚠️ Invalid Yellow',
                                              'Yellow must be within the agenda duration.'
                                            );
                                          } else if (frac >= redFrac) {
                                            Alert.alert(
                                              '⚠️ Invalid Yellow',
                                              'Yellow must occur before red.'
                                            );
                                          } else {
                                          await updateOneAgendaItem(item, { yellow: frac });
                                          }

                                          // clear typing buffer
                                          setEditingYellow((prev) => {
                                            const copy = { ...prev };
                                            delete copy[id];
                                            return copy;
                                          });
                                        }}
                                      />
                                      <Text
                                        style={[
                                          styles.setupItemTinyText,
                                          { marginLeft: 2 },
                                        ]}
                                      >
                                        {thresholdBasis === 'percent' ? '%' : 's'}
                                      </Text>
                                    </View>

                                    {/* Red threshold editor */}
                                    <View
                                      style={{
                                        flexDirection: 'row',
                                        alignItems: 'center',
                                      }}
                                    >
                                      <Text style={styles.setupItemTinyText}>Red:</Text>
                                      <TextInput
                                        style={{
                                          marginLeft: 4,
                                          paddingHorizontal: 4,
                                          paddingVertical: 2,
                                          minWidth: 46,
                                          borderWidth: 1,
                                          borderColor: '#d0d0d0',
                                          borderRadius: 6,
                                          textAlign: 'center',
                                          backgroundColor: '#fff',
                                          fontSize: 11,
                                        }}
                                        keyboardType="numeric"
                                        value={
                                          editingRed[id] !== undefined
                                            ? editingRed[id]
                                            : (() => {
                                                const durSec = (item.duration || 1) * 60;
                                                const frac = item.red ?? 0.9;

                                                if (thresholdBasis === 'percent') {
                                                  const elapsedPct = Math.round(
                                                    frac * 100
                                                  );
                                                  const shownPct = showRemaining
                                                    ? 100 - elapsedPct
                                                    : elapsedPct;
                                                  return String(shownPct);
                                                } else {
                                                  const elapsedSec = Math.round(
                                                    frac * durSec
                                                  );
                                                  const remainingSec = Math.max(
                                                    0,
                                                    durSec - elapsedSec
                                                  );
                                                  const shownSec = showRemaining
                                                    ? remainingSec
                                                    : elapsedSec;
                                                  return String(shownSec);
                                                }
                                              })()
                                        }
                                        onChangeText={(text) => {
                                          // keep raw typing buffer
                                          setEditingRed((prev) => ({
                                            ...prev,
                                            [id]: text,
                                          }));

                                          const cleaned = text.replace(',', '.').trim();
                                          if (
                                            cleaned === '' ||
                                            cleaned === '.' ||
                                            cleaned === '-'
                                          )
                                            return;

                                          const parsed = parseFloat(cleaned);
                                          if (isNaN(parsed) || parsed < 0) return;

                                          const durSec = Math.max(
                                            1,
                                            (item.duration || 1) * 60
                                          );
                                          const yellowFrac = item.yellow ?? 0.66666;

                                          let frac;
                                          if (thresholdBasis === 'percent') {
                                            const clamped = Math.min(
                                              100,
                                              Math.max(0, parsed)
                                            );
                                            const elapsedPct = showRemaining
                                              ? 100 - clamped
                                              : clamped;
                                            frac = elapsedPct / 100;
                                          } else {
                                            const clamped = Math.min(
                                              durSec,
                                              Math.max(0, parsed)
                                            );
                                            const elapsedSec = showRemaining
                                              ? durSec - clamped
                                              : clamped;
                                            frac = elapsedSec / durSec;
                                          }

                                          // 🔕 SILENT RULE: only commit if valid
                                          if (frac > yellowFrac && frac < 1) {
                                            setAgendaItems((prev) =>
                                              prev.map((it) =>
                                                (it.id ?? it.title) ===
                                                (item.id ?? item.title)
                                                  ? { ...it, red: frac }
                                                  : it
                                              )
                                            );
                                          }
                                        }}
                                        onBlur={async() => {
                                          const raw = (editingRed[id] ?? '')
                                            .replace(',', '.')
                                            .trim();
                                          const parsed = parseFloat(raw);

                                          const durSec = Math.max(
                                            1,
                                            (item.duration || 1) * 60
                                          );
                                          const yellowFrac = item.yellow ?? 0.66666;

                                          if (isNaN(parsed)) {
                                            setEditingRed((prev) => {
                                              const copy = { ...prev };
                                              delete copy[id];
                                              return copy;
                                            });
                                            return;
                                          }

                                          // Basis-specific “within duration” check
                                          if (thresholdBasis !== 'percent') {
                                            if (parsed > durSec) {
                                              Alert.alert(
                                                '⚠️ Invalid Red',
                                                `Red time must be within the agenda duration (${durSec}s).`
                                              );
                                              setEditingRed((prev) => {
                                                const copy = { ...prev };
                                                delete copy[id];
                                                return copy;
                                              });
                                              return;
                                            }
                                          } else {
                                            if (parsed > 100) {
                                              Alert.alert(
                                                '⚠️ Invalid Red',
                                                'Red percent must be within 0–100%.'
                                              );
                                              setEditingRed((prev) => {
                                                const copy = { ...prev };
                                                delete copy[id];
                                                return copy;
                                              });
                                              return;
                                            }
                                          }

                                          let frac;
                                          if (thresholdBasis === 'percent') {
                                            const clamped = Math.min(
                                              100,
                                              Math.max(0, parsed)
                                            );
                                            const elapsedPct = showRemaining
                                              ? 100 - clamped
                                              : clamped;
                                            frac = elapsedPct / 100;
                                          } else {
                                            const clamped = Math.min(
                                              durSec,
                                              Math.max(0, parsed)
                                            );
                                            const elapsedSec = showRemaining
                                              ? durSec - clamped
                                              : clamped;
                                            frac = elapsedSec / durSec;
                                          }

                                          // Reason-specific rules
                                          if (frac <= 0) {
                                            Alert.alert(
                                              '⚠️ Invalid Red',
                                              'Red must be greater than 0.'
                                            );
                                          } else if (frac >= 1) {
                                            Alert.alert(
                                              '⚠️ Invalid Red',
                                              'Red must be within the agenda duration.'
                                            );
                                          } else if (frac <= yellowFrac) {
                                            Alert.alert(
                                              '⚠️ Invalid Red',
                                              'Red must occur after yellow.'
                                            );
                                          } else {
                                            await updateOneAgendaItem(item, { red: frac });
                                          }

                                          setEditingRed((prev) => {
                                            const copy = { ...prev };
                                            delete copy[id];
                                            return copy;
                                          });
                                        }}
                                      />
                                      <Text
                                        style={[
                                          styles.setupItemTinyText,
                                          { marginLeft: 2 },
                                        ]}
                                      >
                                        {thresholdBasis === 'percent' ? '%' : 's'}
                                      </Text>
                                    </View>
                                  </View>

                                  {/* Helper text on the right */}
                                  <Text style={styles.setupItemTinyText}>
                                    {thresholdBasis === 'percent'
                                      ? showRemaining
                                        ? 'remaining of item time'
                                        : 'elapsed of item time'
                                      : showRemaining
                                        ? 'before end'
                                        : 'after start'}
                                  </Text>
                                </View>
                              )}
                            </View>
                          );
                        }}
                      />
                    </View>
                  </ScrollView>
                </View>
              )}

              {screen === 'summary' && (
                <>
                  <Text
                    style={{
                      fontSize: 30,
                      fontWeight: 'bold',
                      textAlign: 'center',
                      marginBottom: 12,
                    }}
                  >
                    🎉 Meeting Complete
                  </Text>

                  <View style={{ alignItems: 'center' }}>
                    <Text
                      style={{
                        fontSize: getMeetingTitleFontSize(title || ''),
                        fontWeight: 'bold',
                        marginBottom: 10,
                        textAlign: 'center',
                        maxWidth: '100%',
                      }}
                      numberOfLines={1}
                    >
                      {title || 'Untitled'}
                    </Text>
                  </View>

                  <View
                    style={{
                      width: '92%',
                      maxWidth: 520,
                      alignSelf: 'center',
                      backgroundColor: '#ffffff',
                      borderRadius: 18,
                      padding: 16,
                      marginBottom: 14,
                      borderWidth: 1,
                      borderColor: '#e5e7eb',
                      shadowColor: '#000',
                      shadowOpacity: 0.04,
                      shadowRadius: 10,
                      shadowOffset: { width: 0, height: 4 },
                      elevation: 1,
                    }}
                  >
                    <View
                      style={{
                        width: '100%',
                        alignItems: 'center',
                        marginBottom: 10,
                        paddingHorizontal: 12,
                      }}
                    >
                      <Text
                        style={{
                          width: '100%',
                          fontSize: 18,
                          fontWeight: '800',
                          color: verdictColorApp,
                          textAlign: 'center',
                          lineHeight: 22,
                          flexShrink: 1,
                        }}
                      >
                        {verdictTextApp}
                      </Text>
                    </View>

                    <Text
                      style={{
                        fontSize: 14,
                        color: '#374151',
                        textAlign: 'center',
                        marginBottom: 4,
                      }}
                    >
                      Started {startedAtTextApp}
                    </Text>

                    <Text
                      style={{
                        fontSize: 14,
                        color: '#374151',
                        textAlign: 'center',
                        marginBottom: 6,
                      }}
                    >
                      Finished {finishedAtTextApp}
                    </Text>

                    {pausedTotalSec > 0 ? (
                      <>
                        <Text
                          style={{
                            fontSize: 14,
                            color: '#374151',
                            textAlign: 'center',
                            marginBottom: 4,
                          }}
                        >
                          Active {formatMMSS(activeTotalSec)}   •   Planned {formatMMSS(plannedTotalSec)}
                        </Text>

                        <Text
                          style={{
                            fontSize: 14,
                            color: '#374151',
                            textAlign: 'center',
                            marginBottom: 6,
                          }}
                        >
                          Total {formatMMSS(displayedActualSec)} including pause
                        </Text>
                      </>
                    ) : (
                      <Text
                        style={{
                          fontSize: 14,
                          color: '#374151',
                          textAlign: 'center',
                          marginBottom: 6,
                        }}
                      >
                        Planned {formatMMSS(plannedTotalSec)}   •   Actual {formatMMSS(displayedActualSec)}
                      </Text>
                    )}

                  </View>

                  <View
                    style={{
                      backgroundColor: '#ffffff',
                      borderRadius: 18,
                      padding: 14,
                      marginBottom: 14,
                      borderWidth: 1,
                      borderColor: '#e5e7eb',
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 16,
                        fontWeight: '700',
                        marginBottom: 8,
                      }}
                    >
                      📊 Meeting Insights
                    </Text>

                    {meetingInsights.map((insight, i) => (
                      <Text key={i} style={{ fontSize: 14, marginBottom: 4 }}>
                        {insight}
                      </Text>
                    ))}
                  </View>

                  <Modal
                    visible={
                      screen === 'summary' &&
                      !isProUser &&
                      showFiveMeetingProModal
                    }
                    transparent
                    animationType="fade"
                    onRequestClose={closeFiveMeetingProModal}
                  >
                    <TouchableWithoutFeedback onPress={closeFiveMeetingProModal}>
                      <View style={styles.infoModalBackdrop}>
                        <TouchableWithoutFeedback onPress={() => {}}>
                          <View style={styles.proOfferModalCard}>
                            <View style={styles.proOfferModalIconWrap}>
                              <Text style={{ fontSize: 32 }}>🚀</Text>
                            </View>

                            <Text style={styles.proOfferModalTitle}>
                              {`You've used AgendaGlow for ${normalizedMeetingsCompletedCount} meeting${normalizedMeetingsCompletedCount === 1 ? '' : 's'}`}
                            </Text>

                            <Text style={styles.proOfferModalBody}>
                              You’re getting real value from it now. Upgrade to
                              AgendaGlow Pro for an ad-free experience and extra
                              features.
                            </Text>

                            <TouchableOpacity
                              onPress={handleFiveMeetingUpgradePress}
                              style={styles.proOfferModalPrimaryBtn}
                              accessibilityRole="button"
                              accessibilityLabel="Upgrade to AgendaGlow Pro"
                            >
                              <Text style={styles.proOfferModalPrimaryBtnText}>
                                Upgrade to Pro
                              </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              onPress={closeFiveMeetingProModal}
                              style={styles.proOfferModalSecondaryBtn}
                              accessibilityRole="button"
                              accessibilityLabel="Maybe later"
                            >
                              <Text style={styles.proOfferModalSecondaryBtnText}>
                                Maybe later
                              </Text>
                            </TouchableOpacity>
                          </View>
                        </TouchableWithoutFeedback>
                      </View>
                    </TouchableWithoutFeedback>
                  </Modal>

                  {!offlineMode && auth.currentUser?.isAnonymous && (
                    <View style={styles.summaryUpsellCard}>
                      <Text style={styles.summaryUpsellTitle}>
                        Save this agenda for next time
                      </Text>

                      <Text style={styles.summaryUpsellBody}>
                        Nice work — you ran a real meeting. Sign in to keep the meeting history and reuse this agenda across devices.
                      </Text>

                      <TouchableOpacity
                        onPress={() => {
                          logUserEvent('summary_signin_to_save_tapped', {}, 'summary');
                          setAuthScreenMode('upgrade');
                          setScreen('emailAuth');
                        }}
                        style={styles.summaryUpsellButton}
                        accessibilityRole="button"
                        accessibilityLabel="Sign in to save meeting history"
                      >
                        <Text style={styles.summaryUpsellButtonText}>
                          Sign in to save
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {!isProUser && showThreeMeetingCongrats && (
                    <View style={styles.summaryUpsellCard}>
                      <Text style={styles.summaryUpsellTitle}>
                        Nice! You've run 3 meetings with AgendaGlow 🚦
                      </Text>

                      <Text style={styles.summaryUpsellBody}>
                        If this helps your meetings stay on time, consider upgrading to
                        AgendaGlow Pro (ad-free + extra features).
                      </Text>

                      <TouchableOpacity
                        onPress={openProPlans}
                        style={styles.summaryUpsellButton}
                        accessibilityRole="button"
                        accessibilityLabel="View AgendaGlow Pro plans"
                      >
                        <Text style={styles.summaryUpsellButtonText}>
                          View Pro plans
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {!isProUser && showFiveMeetingProOffer && (
                    <View
                      style={[
                        styles.summaryUpsellCard,
                        {
                          backgroundColor: '#eefbf3',
                          borderColor: '#b7ebc6',
                        },
                      ]}
                    >
                      <Text style={styles.summaryUpsellTitle}>
                        {`You've used AgendaGlow for ${normalizedMeetingsCompletedCount} meeting${normalizedMeetingsCompletedCount === 1 ? '' : 's'} 🚀`}
                      </Text>

                      <Text style={styles.summaryUpsellBody}>
                        You're getting real value from it now. Upgrade to AgendaGlow
                        Pro for an ad-free experience and extra features.
                      </Text>

                      <TouchableOpacity
                        onPress={openProPlans}
                        style={[
                          styles.summaryUpsellButton,
                          { backgroundColor: '#00a651' },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="Upgrade to AgendaGlow Pro"
                      >
                        <Text style={styles.summaryUpsellButtonText}>
                          Upgrade to Pro
                        </Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  <ScrollView style={{ paddingHorizontal: 20 }}>
                    {summary.map((item, i) => (
                      <View
                        key={i}
                        style={{
                          marginBottom: 14,
                          borderBottomWidth: 1,
                          borderColor: '#e5e7eb',
                          paddingBottom: 6,
                        }}
                      >
                        <Text style={{ fontWeight: 'bold', marginBottom: 2 }}>
                          {i + 1}. {item.statusColor === 'red' ? '🔴' : '🟢'} {item.title}
                        </Text>
                        <Text style={{ lineHeight: 18 }}>
                          Duration: {item.duration} min
                        </Text>
                        <Text>Reached Yellow: {item.reachedYellow ? 'Yes' : 'No'}</Text>
                        <Text>Reached Red: {item.reachedRed ? 'Yes' : 'No'}</Text>
                        <Text>
                          Time Spent: {formatMMSS(Math.round(item.timeSpent || 0))} (Total:{' '}
                          {formatMMSS(Math.round((item.timeSpent || 0) + (item.pausedDuration || 0)))} )
                        </Text>
                        <Text style={{ fontSize: 13, color: '#6b7280' }}>
                          Started At: {item.startedAtUS}
                        </Text>
                        <Text style={{ fontSize: 13, color: '#6b7280' }}>
                          Completed At: {item.completedAtUS}
                        </Text>
                      </View>
                    ))}
                  </ScrollView>
                </>
              )}

              {screen === 'settings' && (
                <>
                  <View style={{ width: '75%', alignSelf: 'center' }}>
                    <Text
                      style={{
                        fontSize: 24,
                        marginVertical: 16,
                        textAlign: 'center',
                        fontWeight: '800',
                        color: '#111827',
                      }}
                    >
                      ⚙️ Settings
                    </Text>
                    <ScrollView
                      contentContainerStyle={{
                        paddingBottom: isProUser ? 140 : 220, // extra space for your bottom fixed UI + ad
                      }}
                      showsVerticalScrollIndicator={false}
                    >
                      {/* 🔗 Pro plans link (premium pill) */}
                      <TouchableOpacity
                        onPress={() => {
                          if (offlineMode) {
                            Alert.alert(
                              'Offline',
                              'Connect to the internet to view Pro plans.'
                            );
                            return;
                          }
                          setShowPlans((prev) => !prev);
                        }}
                        style={{
                          marginBottom: 14,
                          alignSelf: 'center',
                          backgroundColor: '#f7faff',
                          borderWidth: 1,
                          borderColor: '#cfe3ff',
                          paddingVertical: 10,
                          paddingHorizontal: 14,
                          borderRadius: 999,
                        }}
                      >
                        <Text
                          style={{ color: '#2f80ed', fontSize: 13, fontWeight: '700' }}
                        >
                          ⭐{' '}
                          {showPlans
                            ? 'Hide Pro plans'
                            : isProUser
                              ? 'View your Pro benefits'
                              : 'View Pro plans & remove ads'}
                        </Text>
                      </TouchableOpacity>

                      {/* 💎 AgendaGlow Pro Paywall Panel */}
                      {showPlans && (
                        <View
                          style={{
                            borderWidth: 1,
                            borderColor: '#2f80ed',
                            borderRadius: 12,
                            padding: 14,
                            backgroundColor: '#f7faff',
                            marginBottom: 20,
                          }}
                        >
                          <Text
                            style={{ fontSize: 16, fontWeight: '700', color: '#1f2933' }}
                          >
                            {isProUser
                              ? 'AgendaGlow Pro is active ✅'
                              : 'Upgrade to AgendaGlow Pro'}
                          </Text>

                          <Text
                            style={{
                              fontSize: 12,
                              color: '#4b5563',
                              marginTop: 4,
                              marginBottom: 12,
                            }}
                          >
                            {isProUser
                              ? 'Thank you for supporting AgendaGlow!'
                              : 'Remove ads, unlock Viewer Branding, and run smoother, more focused meetings.'}
                          </Text>
                          {/*}
                          {!isProUser && (
                            <Text
                              style={{
                                fontSize: 12,
                                color: '#111827',
                                marginTop: -6,
                                marginBottom: 12,
                                fontWeight: '700',
                              }}
                            >
                              {Platform.OS === 'android'
                                ? '🎁 Includes a 60-day free trial (new subscribers).'
                                : '🎁 Includes a 2-month free trial (new subscribers).'}
                            </Text>
                          )}
                          */}

                          {/* FEATURES */}
                          {!isProUser && (
                            <View style={{ marginBottom: 16 }}>
                              <Text style={{ fontSize: 12, color: '#374151' }}>
                                • No banner ads or interruptions
                              </Text>
                              <Text style={{ fontSize: 12, color: '#374151' }}>
                                • Faster, distraction-free timer
                              </Text>
                              <Text style={{ fontSize: 12, color: '#374151' }}>
                                • Brand the shared viewer (logo + message)
                              </Text>
                              <Text style={{ fontSize: 12, color: '#374151' }}>
                                • Supports ongoing improvements
                              </Text>
                            </View>
                          )}

                          {/* PLANS */}
                          {!isProUser && (
                            <View style={{ gap: 10 }}>
                              {/* MONTHLY */}
                              <TouchableOpacity
                                onPress={() => handlePurchasePro('monthly')}
                                disabled={!isRevenueCatReady}
                                style={{
                                  backgroundColor: '#2d74f5',
                                  paddingVertical: 10,
                                  paddingHorizontal: 12,
                                  borderRadius: 10,
                                  flexDirection: 'row',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  opacity: isRevenueCatReady ? 1 : 0.6,
                                }}
                              >
                                <View>
                                  <Text
                                    style={{
                                      color: '#fff',
                                      fontWeight: '700',
                                      fontSize: 14,
                                    }}
                                  >
                                    Monthly
                                  </Text>
                                  <Text style={{ fontSize: 11, color: '#e5e7eb' }}>
                                    Try Pro with the smallest commitment
                                  </Text>
                                </View>
                                <Text
                                  style={{
                                    color: '#fff',
                                    fontWeight: '700',
                                    fontSize: 14,
                                  }}
                                >
                                  {monthlyPrice ? `${monthlyPrice}/mo` : '$2.99/mo'}
                                </Text>
                              </TouchableOpacity>

                              {/* YEARLY — MOST POPULAR */}
                              <TouchableOpacity
                                onPress={() => handlePurchasePro('annual')}
                                disabled={!isRevenueCatReady}
                                style={{
                                  backgroundColor: '#14532d',
                                  paddingVertical: 10,
                                  paddingHorizontal: 12,
                                  borderRadius: 10,
                                  borderWidth: 2,
                                  borderColor: '#facc15',
                                  flexDirection: 'row',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  opacity: isRevenueCatReady ? 1 : 0.6,
                                }}
                              >
                                <View style={{ flexShrink: 1, paddingRight: 8 }}>
                                  <Text
                                    style={{
                                      fontSize: 10,
                                      fontWeight: '700',
                                      color: '#facc15',
                                      marginBottom: 2,
                                    }}
                                  >
                                    MOST POPULAR
                                  </Text>
                                  <Text
                                    style={{
                                      color: '#fff',
                                      fontWeight: '700',
                                      fontSize: 14,
                                    }}
                                  >
                                    Yearly
                                  </Text>
                                  <Text style={{ fontSize: 11, color: '#d1fae5' }}>
                                    Best value for regular meeting hosts
                                  </Text>
                                </View>

                                <Text
                                  style={{
                                    color: '#fff',
                                    fontWeight: '700',
                                    fontSize: 14,
                                  }}
                                >
                                  {annualPrice ? `${annualPrice}/yr` : '$24.99/yr'}
                                </Text>
                              </TouchableOpacity>

                              {/* LIFETIME — PAY ONCE */}
                              {/*
                <TouchableOpacity
                  onPress={() => handlePurchasePro('lifetime')}
                  disabled={!isRevenueCatReady}
                  style={{
                    backgroundColor: '#4b5563',
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderRadius: 10,
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    opacity: isRevenueCatReady ? 1 : 0.6,
                  }}
                >
                  <View style={{ flexShrink: 1, paddingRight: 8 }}>
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>
                      Lifetime
                    </Text>
                    <Text style={{ fontSize: 11, color: '#e5e7eb' }}>
                      Pay once, use AgendaGlow Pro forever
                    </Text>
                  </View>

                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>
                    {lifetimePrice ? lifetimePrice : '$49.99 one-time'}
                  </Text>
                </TouchableOpacity>
                */}

                              {!isRevenueCatReady && (
                                <Text
                                  style={{
                                    fontSize: 11,
                                    color: '#4b5563',
                                    textAlign: 'center',
                                    marginTop: 6,
                                  }}
                                >
                                  Checking secure purchase options…
                                </Text>
                              )}
                            </View>
                          )}

                          {isProUser && (
                            <Text
                              style={{ marginTop: 10, fontSize: 11, color: '#374151' }}
                            >
                              Your Pro access is linked to this account.
                            </Text>
                          )}

                          {/* 📄 Legal Links (Required by App Store Guideline 3.1.2) */}
                          <View style={{ marginTop: 20, alignItems: 'center' }}>
                            <Text
                              style={{
                                fontSize: 13,
                                color: '#2f80ed',
                                textDecorationLine: 'underline',
                                marginBottom: 8,
                              }}
                              onPress={() =>
                                Linking.openURL(
                                  'https://dozenred.com/agendaglow-terms-of-use/'
                                )
                              }
                            >
                              Terms of Use
                            </Text>

                            <Text
                              style={{
                                fontSize: 13,
                                color: '#2f80ed',
                                textDecorationLine: 'underline',
                              }}
                              onPress={() =>
                                Linking.openURL('https://dozenred.com/privacy-policy/')
                              }
                            >
                              Privacy Policy
                            </Text>
                          </View>
                        </View>
                      )}

                      {/* ===== MEETING BEHAVIOR ===== */}
                      <SectionHeader title="Meeting Behavior" />
                      <Card>
                        <SettingRow
                          title="Automatically move to next item"
                          subtitle="If off, timer enters overtime."
                          value={autoAdvanceEnabled}
                          onValueChange={async (v) => {
                            setAutoAdvanceEnabled(v);
                            try {
                              await AsyncStorage.setItem(
                                '@autoAdvanceEnabled',
                                String(v)
                              );
                            } catch {}
                          }}
                        />

                        <Divider />

                        <SettingRow
                          title="Respect planned meeting length"
                          subtitle="Warn before +1 min pushes the meeting beyond the original agenda duration."
                          value={respectPlannedMeetingLength}
                          onValueChange={async (v) => {
                            setRespectPlannedMeetingLength(v);
                            try {
                              await AsyncStorage.setItem(
                                '@respectPlannedMeetingLength',
                                String(v)
                              );
                            } catch {}
                          }}
                        />
                        
                        <Text style={{ fontSize: 11, fontWeight: '600', color: '#6b7280', marginTop: 12, marginBottom: 6, textTransform: 'uppercase' }}>
                          🟡  Yellow phase

                        </Text>
                        <SettingRow
                          title="Play yellow warning chime"
                          value={alarmEnabled}
                          onValueChange={async (v) => {
                            setAlarmEnabled(v);
                            try {
                              await AsyncStorage.setItem('@alarmEnabled', String(v));
                            } catch {}
                          }}
                        />

                        <Divider />

                        <SettingRow
                          title="Show yellow warning notification"
                          value={yellowNotifEnabled}
                          onValueChange={async (v) => {
                            setYellowNotifEnabled(v);
                            try {
                              await AsyncStorage.setItem('@yellowNotifEnabled', String(v));
                            } catch {}

                            if (v) {
                              maybeShowBgNotifReliabilityHelper();
                            }
                          }}
                        />

                        <Text style={{ fontSize: 11, fontWeight: '600', color: '#6b7280', marginTop: 14, marginBottom: 6, textTransform: 'uppercase' }}>
                          🔴  Red phase
                        </Text>

                        <SettingRow
                          title="Play red time’s-up alarm chirp"
                          value={buzzerEnabled}
                          onValueChange={async (v) => {
                            setBuzzerEnabled(v);
                            try {
                              await AsyncStorage.setItem('@buzzerEnabled', String(v));
                            } catch {}
                          }}
                        />

                        <Divider />

                        <SettingRow
                          title="Show red time’s-up notification"
                          value={redNotifEnabled}
                          onValueChange={async (v) => {
                            setRedNotifEnabled(v);
                            try {
                              await AsyncStorage.setItem('@redNotifEnabled', String(v));
                            } catch {}

                            if (v) {
                              maybeShowBgNotifReliabilityHelper();
                            }
                          }}
                        />
                      </Card>

                      {/* ===== FEEDBACK & CELEBRATION ===== */}
                      <SectionHeader title="Feedback & Celebration" />
                      <Card>
                        <SettingRow
                          title="Celebrate when you finish early 🎉"
                          subtitle="Off by default. Turn this on for a fun celebration after real meetings."
                          value={confettiEnabled}
                          onValueChange={async (v) => {
                            setConfettiEnabled(v);
                            try {
                              await AsyncStorage.setItem('@confettiEnabled', String(v));
                            } catch {}

                            // ✅ Sync to viewer flag (only if we’re online + signed-in)
                            try {
                              if (
                                !offlineMode &&
                                auth.currentUser &&
                                !auth.currentUser.isAnonymous
                              ) {
                                await ensureUserDoc(undefined, {
                                  viewerConfettiEnabled: v,
                                });
                                await syncViewerPublicFlags(auth.currentUser.uid, {
                                  viewerConfettiEnabled: v,
                                });
                              }
                            } catch (e) {
                              console.warn(
                                '⚠️ Failed to sync viewer confetti flag:',
                                e?.message || e
                              );
                            }
                          }}
                        />
                      </Card>

                      {/* ===== ADVANCED ===== */}
                      <SectionHeader title="Advanced" />
                      <Card>
                        <SettingRow
                          title="Advanced threshold editing"
                          subtitle="Edit yellow/red thresholds as % or time."
                          value={advancedThresholdsEnabled}
                          onValueChange={setAdvancedThresholdsEnabled}
                        />

                        {advancedThresholdsEnabled && (
                          <View style={{ marginTop: 10 }}>
                            <Text
                              style={{
                                marginBottom: 8,
                                fontWeight: '700',
                                color: '#111827',
                              }}
                            >
                              Threshold basis
                            </Text>

                            <View
                              style={{
                                flexDirection: 'row',
                                justifyContent: 'space-around',
                              }}
                            >
                              <TouchableOpacity
                                style={{
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  padding: 10,
                                  backgroundColor:
                                    thresholdBasis === 'percent' ? '#e9f2ff' : '#fff',
                                  borderWidth: 1,
                                  borderColor:
                                    thresholdBasis === 'percent' ? '#2f80ed' : '#d1d5db',
                                  borderRadius: 10,
                                }}
                                onPress={() => setThresholdBasis('percent')}
                              >
                                <Ionicons
                                  name={
                                    thresholdBasis === 'percent'
                                      ? 'radio-button-on'
                                      : 'radio-button-off'
                                  }
                                  size={18}
                                  color="#2f80ed"
                                  style={{ marginRight: 6 }}
                                />
                                <Text style={{ fontWeight: '600' }}>% based</Text>
                              </TouchableOpacity>

                              <TouchableOpacity
                                style={{
                                  flexDirection: 'row',
                                  alignItems: 'center',
                                  padding: 10,
                                  backgroundColor:
                                    thresholdBasis === 'seconds' ? '#e9f2ff' : '#fff',
                                  borderWidth: 1,
                                  borderColor:
                                    thresholdBasis === 'seconds' ? '#2f80ed' : '#d1d5db',
                                  borderRadius: 10,
                                }}
                                onPress={() => setThresholdBasis('seconds')}
                              >
                                <Ionicons
                                  name={
                                    thresholdBasis === 'seconds'
                                      ? 'radio-button-on'
                                      : 'radio-button-off'
                                  }
                                  size={18}
                                  color="#2f80ed"
                                  style={{ marginRight: 6 }}
                                />
                                <Text style={{ fontWeight: '600' }}>
                                  Time based (sec)
                                </Text>
                              </TouchableOpacity>
                            </View>

                            <View
                              style={{
                                marginTop: 12,
                                paddingTop: 10,
                                borderTopWidth: 1,
                                borderTopColor: '#f3f4f6',
                                flexDirection: 'row',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                              }}
                            >
                              <View style={{ flex: 1, paddingRight: 12 }}>
                                <Text
                                  style={{
                                    fontSize: 14,
                                    fontWeight: '600',
                                    color: '#111827',
                                  }}
                                >
                                  Show remaining time
                                </Text>
                                <Text
                                  style={{
                                    fontSize: 11,
                                    color: '#6b7280',
                                    marginTop: 3,
                                    lineHeight: 16,
                                  }}
                                >
                                  Display thresholds as remaining % or seconds (not
                                  elapsed).
                                </Text>
                              </View>

                              <Switch
                                value={showRemaining}
                                onValueChange={setShowRemaining}
                              />
                            </View>
                          </View>
                        )}
                      </Card>

                      {/* 🏫 Pro-only: Viewer Branding */}
                      {isProUser && (
                        <View
                          style={{
                            marginTop: 12,
                            marginBottom: 16,
                            borderWidth: 1,
                            borderColor: '#e5e7eb',
                            borderRadius: 16,
                            padding: 16,
                            backgroundColor: '#fbfdff',

                            // subtle card lift
                            shadowColor: '#000',
                            shadowOpacity: 0.06,
                            shadowRadius: 10,
                            shadowOffset: { width: 0, height: 4 },
                            elevation: 2,
                          }}
                        >
                          <Text
                            style={{ fontSize: 15, fontWeight: '700', marginBottom: 6 }}
                          >
                            🏷 Viewer branding (Pro)
                          </Text>

                          <View
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                            }}
                          >
                            <Text
                              style={{
                                fontSize: 12,
                                color: '#374151',
                                flex: 1,
                                paddingRight: 10,
                              }}
                            >
                              Show your organization logo and message on the viewer link.
                            </Text>
                            <Switch
                              value={viewerBrandingEnabled}
                              onValueChange={setViewerBrandingEnabled}
                            />
                          </View>

                          <Text
                            style={{
                              marginTop: 8,
                              fontSize: 11,
                              lineHeight: 15,
                              color: '#6b7280',
                            }}
                          >
                            You must have the rights to use this logo. AgendaGlow does not
                            endorse or verify third-party branding.
                          </Text>

                          {viewerBrandingEnabled && (
                            <View style={{ marginTop: 12 }}>
                              <Text style={{ fontSize: 12, marginBottom: 4 }}>
                                Logo URL
                              </Text>
                              <TextInput
                                value={viewerBrandLogoUrl}
                                onChangeText={setViewerBrandLogoUrl}
                                placeholder="https://example.com/logo.png"
                                autoCapitalize="none"
                                autoCorrect={false}
                                style={{
                                  borderWidth: 1,
                                  borderColor: '#e5e7eb',
                                  borderRadius: 8,
                                  padding: 8,
                                  fontSize: 12,
                                }}
                              />

                              <Text style={{ fontSize: 12, marginTop: 10 }}>
                                Message line 1
                              </Text>
                              <TextInput
                                value={viewerBrandLine1}
                                onChangeText={setViewerBrandLine1}
                                placeholder="Organization name"
                                style={{
                                  borderWidth: 1,
                                  borderColor: '#e5e7eb',
                                  borderRadius: 8,
                                  padding: 8,
                                  fontSize: 12,
                                }}
                              />

                              <Text style={{ fontSize: 12, marginTop: 10 }}>
                                Message line 2
                              </Text>
                              <TextInput
                                value={viewerBrandLine2}
                                onChangeText={setViewerBrandLine2}
                                placeholder="Optional subtitle"
                                style={{
                                  borderWidth: 1,
                                  borderColor: '#e5e7eb',
                                  borderRadius: 8,
                                  padding: 8,
                                  fontSize: 12,
                                }}
                              />
                            </View>
                          )}

                          {viewerBrandingEnabled && (
                            <TouchableOpacity
                              style={{
                                marginTop: 14,
                                backgroundColor: '#111827',
                                paddingVertical: 10,
                                borderRadius: 8,
                                alignItems: 'center',
                                opacity: offlineMode ? 0.6 : 1,
                              }}
                              disabled={offlineMode}
                              onPress={async () => {
                                if (!userId) return;

                                await ensureUserDoc(userId, {
                                  viewerBrandingEnabled,
                                  viewerBrandLogoUrl: viewerBrandLogoUrl.trim(),
                                  viewerBrandLine1: viewerBrandLine1.trim(),
                                  viewerBrandLine2: viewerBrandLine2.trim(),
                                });

                                Alert.alert('Saved', 'Viewer branding updated');
                              }}
                            >
                              <Text style={{ color: '#fff', fontWeight: '700' }}>
                                Save viewer branding
                              </Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      )}

                      {quickStartDisabled && (
                        <TouchableOpacity
                          onPress={handleResetQuickStart}
                          style={[styles.secondaryBtn, { marginTop: 14 }]}
                        >
                          <Text style={styles.secondaryBtnText}>
                            Show Quick-Start again
                          </Text>
                        </TouchableOpacity>
                      )}
                    </ScrollView>
                  </View>
                </>
              )}
            </ScrollView>
          )}

          {/* 🎊 Confetti overlay when meeting finishes early */}
          <ConfettiOverlay
            visible={
              screen === 'summary' &&
              confettiEnabled &&
              !isSampleMeeting &&
              !isSampleDemoActive &&
              finishedEarlyApp
            }
          />
        </View>

        {/* 🎛️ Protected facilitator controls */}
        <Modal
          visible={showMeetingControlsModal}
          transparent
          animationType="slide"
          onRequestClose={() => setShowMeetingControlsModal(false)}
        >
          <TouchableWithoutFeedback onPress={() => setShowMeetingControlsModal(false)}>
            <View
              style={{
                flex: 1,
                backgroundColor: 'rgba(0,0,0,0.35)',
                justifyContent: 'flex-end',
              }}
            >
              <TouchableWithoutFeedback>
                <View
                  style={{
                    backgroundColor: '#fff',
                    borderTopLeftRadius: 24,
                    borderTopRightRadius: 24,
                    paddingHorizontal: 20,
                    paddingTop: 16,
                    paddingBottom: Platform.OS === 'ios' ? 34 : 18,
                  }}
                >
                  <View
                    style={{
                      width: 44,
                      height: 5,
                      borderRadius: 999,
                      backgroundColor: '#d1d5db',
                      alignSelf: 'center',
                      marginBottom: 14,
                    }}
                  />

                  <Text
                    style={{
                      fontSize: 18,
                      fontWeight: '900',
                      color: '#111827',
                      textAlign: 'center',
                    }}
                  >
                    Meeting Controls
                  </Text>
                  <Text
                    style={{
                      fontSize: 13,
                      color: '#6b7280',
                      lineHeight: 18,
                      textAlign: 'center',
                      marginTop: 6,
                      marginBottom: 16,
                    }}
                  >
                    Use this protected control when you want to stop early without an accidental tap.
                  </Text>

                  <TouchableOpacity
                    onPress={confirmEndMeetingNow}
                    disabled={remoteControlBusy}
                    style={{
                      borderRadius: 16,
                      paddingVertical: 14,
                      paddingHorizontal: 14,
                      backgroundColor: '#fff1f2',
                      borderWidth: 1,
                      borderColor: '#fecdd3',
                      marginBottom: 10,
                      opacity: remoteControlBusy ? 0.6 : 1,
                    }}
                  >
                    <Text style={{ fontSize: 15, fontWeight: '900', color: '#be123c' }}>
                      ⏹ End meeting and show summary
                    </Text>
                    <Text style={{ fontSize: 12, color: '#9f1239', marginTop: 3 }}>
                      Protected by a confirmation so it cannot happen accidentally.
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => setShowMeetingControlsModal(false)}
                    style={{
                      borderRadius: 999,
                      paddingVertical: 12,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: '#111827',
                      marginTop: 4,
                    }}
                  >
                    <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800' }}>
                      Back to timer
                    </Text>
                  </TouchableOpacity>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {screen === 'summary' && (
          <View
            style={{
              marginTop: 8,
              paddingHorizontal: 20,
              paddingBottom: 8,
              alignItems: 'center',
            }}
          >


            {/* 🔁 Start New */}
            {isSampleDemoActive && screen === 'summary' && (
              <View style={{ alignItems: 'center', marginTop: 14 }}>
                <View style={styles.launchAgendaGlowBtnWrap}>
                  <TouchableOpacity
                    onPress={handleCreateFirstRealAgendaFromDemo}
                    style={styles.launchAgendaGlowBtn}
                  >
                    <Text style={styles.launchAgendaGlowBtnText}>
                      🚀 Create My First Real Agenda
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </View>
        )}

        {screen !== 'setup' &&
          screen !== 'emailAuth' &&
          screen !== 'settings' &&
          screen !== 'myagendas' &&
          screen !== 'templates' &&
          screen !== 'sharelink' &&
          screen !== 'more' && (
          <BrandingFooter
            pulseAnim={pulseAnim}
            aboveBranding={
            screen === 'timer' ? (
              isSampleDemoActive ? (
                <View style={{ alignItems: 'center', marginTop: 4 }}>
                  <View style={styles.endDemoBtnWrap}>
                    <TouchableOpacity
                      onPress={exitSampleDemoToPrestart}
                      style={styles.endDemoBtn}
                    >
                      <Text style={styles.endDemoBtnText}>🛑 End demo</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                // 🎛️ Facilitator remote controls
                <View style={{ marginTop: 4 }}>
                  <View
                    style={{
                      backgroundColor: '#ffffff',
                      borderRadius: 20,
                      borderWidth: 1,
                      borderColor: '#e5e7eb',
                      padding: 10,
                      shadowColor: '#000',
                      shadowOpacity: 0.08,
                      shadowRadius: 12,
                      shadowOffset: { width: 0, height: 4 },
                      elevation: 5,
                    }}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      {/* Pause / Resume */}
                      <TouchableOpacity
                        onPress={handleToggleTimerRunning}
                        style={{
                          flex: 1,
                          marginRight: 6,
                          borderRadius: 999,
                          paddingVertical: 12,
                          paddingHorizontal: 8,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: running ? '#111827' : '#00a651',
                        }}
                      >
                        <Text
                          style={{
                            color: '#fff',
                            fontWeight: '800',
                            fontSize: 14,
                            textAlign: 'center',
                          }}
                        >
                          {running ? '⏸ Pause' : '▶ Resume'}
                        </Text>
                      </TouchableOpacity>

                      {/* +1 minute */}
                      <TouchableOpacity
                        onPress={handleAddOneMinuteToCurrentItem}
                        style={{
                          width: 78,
                          marginHorizontal: 4,
                          borderRadius: 999,
                          paddingVertical: 12,
                          paddingHorizontal: 8,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: '#eef4ff',
                          borderWidth: 1,
                          borderColor: '#bfdbfe',
                        }}
                      >
                        <Text
                          style={{
                            color: '#2563eb',
                            fontWeight: '900',
                            fontSize: 14,
                            textAlign: 'center',
                          }}
                        >
                          +1 min
                        </Text>
                      </TouchableOpacity>

                      {/* Next / Finish */}
                      <Animated.View
                        style={{
                          flex: 1,
                          marginLeft: 6,
                          transform: [{ scale: nextPulseAnim }],
                          borderRadius: 999,
                          borderWidth: showOvertimeEscalation ? 3 : 0,
                          borderColor: showOvertimeEscalation ? '#facc15' : 'transparent',
                          shadowColor: '#facc15',
                          shadowOpacity: showOvertimeEscalation ? 0.55 : 0,
                          shadowRadius: showOvertimeEscalation ? 10 : 0,
                          shadowOffset: { width: 0, height: 0 },
                          elevation: showOvertimeEscalation ? 6 : 0,
                        }}
                      >
                        <TouchableOpacity
                          onPress={goToNextItem}
                          style={{
                            borderRadius: 999,
                            paddingVertical: 12,
                            paddingHorizontal: 8,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: '#2f80ed',
                          }}
                        >
                          <Text
                            style={{
                              color: '#fff',
                              fontWeight: '900',
                              fontSize: 14,
                              textAlign: 'center',
                            }}
                          >
                            {currentIndex === agendaItems.length - 1 ? 'Finish' : 'Next →'}
                          </Text>
                        </TouchableOpacity>
                      </Animated.View>
                    </View>

                    <TouchableOpacity
                      onPress={() => setShowMeetingControlsModal(true)}
                      style={{
                        marginTop: 8,
                        borderRadius: 999,
                        paddingVertical: 8,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: '#f9fafb',
                        borderWidth: 1,
                        borderColor: '#e5e7eb',
                      }}
                    >
                      <Text
                        style={{
                          color: '#4b5563',
                          fontSize: 12,
                          fontWeight: '800',
                          textAlign: 'center',
                        }}
                      >
                        ⋯ More meeting controls
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )
              ) : screen === 'prestart' && !autoDemoBooting ? (
                    isProUser ? (
                      // 🌟 Pro users see branding
                      <View style={{ alignItems: 'center', marginBottom: 6 }}>
                        <Text
                          style={{
                            fontSize: 13,
                            color: '#4b5563',
                            fontWeight: '500',
                            textAlign: 'center',
                          }}
                        >
                          Run meetings that stay on time.
                        </Text>
                        <Text
                          style={{
                            fontSize: 11,
                            color: '#9ca3af',
                            marginTop: 2,
                            textAlign: 'center',
                          }}
                        >
                          AgendaGlow by DozenRed
                        </Text>
                      </View>
                    ) : null // ✅ Free users: banner handled by bottom dock, not here
                  ) : null
            }
            showPauseStatus={
              screen === 'timer' && !isSampleDemoActive && !running && !!pauseStartRef.current
            }
            pauseSeconds={livePauseTime}
            showBranding={
              screen !== 'timer' &&
              screen !== 'summary' &&
              screen !== 'prestart'
            }
            compact={screen === 'timer' || screen === 'summary'}
          />
        )}

        {( // ⬇️ Bottom “dock” (BottomNav + your existing banner block)
          ['prestart', 'summary', 'myagendas', 'templates', 'me', 'more', 'emailAuth', 'settings', 'setup', 'sharelink'].includes(screen) ||
          (showBannerAds &&
            !isProUser &&
            !isNoAdsMode &&
            (
              ((screen === 'summary') && shouldShowSummaryUsageGatedAds) ||
              ((screen !== 'summary') && shouldShowUsageGatedAds)
            ) &&
            (screen === 'timer' ||
              screen === 'settings' ||
              screen === 'summary' ||
              screen === 'setup' ||
              screen === 'myagendas' ||
              screen === 'templates' ||
              screen === 'me' ||
              screen === 'sharelink'))
        ) && (
          <View style={{ width: '100%' }}>
            {screen === 'setup' && (
              <View style={styles.setupDockWrap}>
                <View style={styles.setupButtonsCard}>
                  <TouchableOpacity
                    onPress={handleBackFromSetup}
                    accessibilityRole="button"
                    accessibilityLabel="Back"
                    style={styles.setupBackPill}
                  >
                    <Text style={styles.setupBackPillText}>
                      ← Back
                    </Text>
                  </TouchableOpacity>
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      width: '100%',
                    }}
                  >
                    <TouchableOpacity
                      onPress={async () => {
                        Keyboard.dismiss();
                        const draft = (agendaTitleDraft ?? '').trim();
                        const current = (title ?? '').trim();
                        if (draft && draft !== current) {
                          await commitAgendaTitle(draft);
                        }
                        setShareLinkMode('share');
                        logUserEvent('viewer_share_opened', { source: currentAgendaSource || 'unknown' }, 'setup');
                        gateActionWithRewardedFirst('shareLink');
                      }}
                      style={[
                        styles.primaryBtn,
                        {
                          flex: 1,
                          paddingVertical: 10,
                          borderRadius: 999,
                          marginRight: 8,
                        },
                      ]}
                    >
                      <Text style={styles.primaryBtnText}>🔐 Save/🔗 Share</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={showShareCheckpointBeforeStart}
                      style={[
                        styles.primaryBtn,
                        {
                          flex: 1,
                          paddingVertical: 10,
                          borderRadius: 999,
                          marginLeft: 8,
                          backgroundColor: '#27ae60',

                          shadowColor: '#000',
                          shadowOpacity: 0.18,
                          shadowRadius: 6,
                          shadowOffset: { width: 0, height: 2 },
                          elevation: 4,
                        },
                      ]}
                    >
                      <Text style={styles.primaryBtnText}>▶️ Start</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            )}
            {/* ✅ Nav FIRST (so it sits ABOVE banner) */}
            {['prestart', 'summary', 'myagendas', 'templates', 'me', 'more', 'emailAuth', 'settings'].includes(screen) &&
              !(isSampleDemoActive && screen === 'summary') && (
              <BottomNav
                active={
                  screen === 'emailAuth'
                    ? 'me'
                    : screen === 'settings'
                    ? 'more'
                    : screen
                }
                onGo={goBottomNav}
                screen={screen}
                isTempAccount={isTempAccount}
                isProUser={isProUser}
              />
            )}

            {/* ✅ Banner SECOND */}
            {showBannerAds &&
              !isProUser &&
              !isNoAdsMode &&
              (
                ((screen === 'summary') && shouldShowSummaryUsageGatedAds) ||
                ((screen !== 'summary') && shouldShowUsageGatedAds)
              ) &&
              (screen === 'prestart' ||
                screen === 'timer' ||
                screen === 'settings' ||
                screen === 'summary' ||
                screen === 'setup' ||
                screen === 'myagendas' ||
                screen === 'templates' ||
                screen === 'me' ||
                screen === 'emailAuth' ||
                screen === 'more' ||
                screen === 'sharelink') && (
                <View
                  style={{
                    width: '100%',
                    alignItems: 'center',

                    // ✅ this creates the “grey strip” like your pre-start screenshot
                    backgroundColor: '#f3f4f6',
                    borderTopWidth: 1,
                    borderTopColor: '#e5e7eb',

                    // use padding instead of margins so the grey is visible
                    paddingTop: 6,
                    paddingBottom: 8,
                    paddingHorizontal: 12,
                  }}
                >
                  {/* 💡 Subtle reminder (free users): ads are removed with Pro */}
                  {!isProUser &&
                    [
                      'prestart',
                      'setup',
                      'sharelink',
                      'timer',
                      'myagendas',
                      'templates',
                      'emailAuth',
                      'more',
                      'settings',
                    ].includes(screen) && (
                    <Text
                      style={{
                        fontSize: 11,
                        color: '#6b7280',
                        marginBottom: 4,
                        opacity: 0.85,
                      }}
                    >
                      Ads are removed with AgendaGlow Pro
                    </Text>
                  )}
                  {/* If AdMob banner is available AND we’re not forcing the house ad, show the real ad */}
                  {!bannerFailed && !FORCE_HOUSE_BANNER ? (
                    <BannerAd
                      unitId={getAdUnit('BANNER')}
                      size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
                      requestOptions={{ requestNonPersonalizedAdsOnly: true }}
                      onAdLoaded={() => {
                        console.log('✅ Adaptive banner loaded');
                        setBannerFailed(false);
                      }}
                      onAdFailedToLoad={(error) => {
                        console.warn('🚨 Adaptive banner failed:', error);
                        setBannerFailed(true);
                      }}
                    />
                  ) : (
                    // 🪧 AgendaGlow House Banner (fallback) – styled like the viewer banner
                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={() => {
                        const url =
                          houseBannerVariant === 'linkedin'
                            ? 'https://www.linkedin.com/company/dozenred-llc'
                            : 'https://dozenred.com/blog/';
                        Linking.openURL(url);
                      }}
                      style={{
                        width: '100%',
                        maxWidth: 760,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: '#e5e7eb',
                        backgroundColor: '#111827',
                        paddingVertical: 10,
                        paddingHorizontal: 14,
                        flexDirection: 'row',
                        alignItems: 'center',
                      }}
                    >
                      {/* Left tag (Blog / LinkedIn) */}
                      <View style={{ marginRight: 12 }}>
                        <Text
                          style={{
                            fontSize: 11,
                            textTransform: 'uppercase',
                            letterSpacing: 1,
                            opacity: 0.7,
                            color: '#9ca3af',
                          }}
                        >
                          {houseBannerVariant === 'linkedin'
                            ? 'AgendaGlow on LinkedIn'
                            : 'AgendaGlow Blog'}
                        </Text>
                      </View>

                      {/* Middle copy (headline + subline) */}
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text
                          numberOfLines={1}
                          style={{
                            fontSize: 14,
                            fontWeight: '700',
                            color: '#f9fafb',
                            marginBottom: 2,
                          }}
                        >
                          {houseBannerVariant === 'linkedin'
                            ? 'Follow AgendaGlow & DozenRed on LinkedIn.'
                            : 'Meeting tips, templates & time-savers.'}
                        </Text>
                        <Text numberOfLines={1} style={{ fontSize: 11, color: '#9ca3af' }}>
                          {houseBannerVariant === 'linkedin'
                            ? 'Product updates + launch notes.'
                            : 'New posts weekly — free.'}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  )}
                </View>
              )}
          </View>
        )}

        {/* 🤖 AI Agenda Generator Modal */}
        <Modal
          visible={showAiAgendaModal}
          transparent
          animationType="fade"
          onRequestClose={() => {
            if (!aiAgendaBusy) {
              if (aiSpeechListening) stopAiPromptVoiceInput();
              setShowAiAgendaModal(false);
              setAiPromptFocused(false);
              setAiDurationFocused(false);
              setAiSpeechStatus('');
              setAiSpeechError('');
            }
          }}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <KeyboardAvoidingView
              style={styles.infoModalBackdrop}
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
              <TouchableWithoutFeedback onPress={() => {}}>
                <View
                  style={[
                    styles.infoModalCard,
                    {
                      maxWidth: 520,
                      maxHeight: aiKeyboardFocused ? height * 0.56 : height * 0.86,
                    },
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 20,
                      fontWeight: '800',
                      color: '#111827',
                      marginBottom: 6,
                    }}
                  >
                    ✨ Generate an Agenda
                  </Text>

                  {!aiKeyboardFocused && (
                    <Text
                      style={{
                        fontSize: 13,
                        color: '#4b5563',
                        lineHeight: 18,
                        marginBottom: 12,
                      }}
                    >
                      Tell AgendaGlow what the meeting is for. You can edit every item before starting.
                    </Text>
                  )}

                  {!aiKeyboardFocused && !isProUser && (
                    <Text
                      style={{
                        fontSize: 12,
                        color: aiAgendaFreeRemaining > 0 ? '#4b5563' : '#b45309',
                        backgroundColor: aiAgendaFreeRemaining > 0 ? '#f3f4f6' : '#fffbeb',
                        borderRadius: 10,
                        paddingVertical: 7,
                        paddingHorizontal: 10,
                        marginBottom: 10,
                      }}
                    >
                      {aiAgendaFreeRemaining > 0
                        ? `${aiAgendaFreeRemaining} free AI agenda draft${aiAgendaFreeRemaining === 1 ? '' : 's'} remaining.`
                        : 'Free AI agenda drafts used. Sign in or upgrade to keep generating.'}
                    </Text>
                  )}

                  {!aiKeyboardFocused && (
                    <>
                      <Text style={styles.infoModalLabel}>Try an example</Text>
                      <View style={{ marginBottom: 8 }}>
                        {aiPromptExamples.map((example) => (
                      <TouchableOpacity
                        key={example}
                        onPress={() => {
                          setAiPrompt(example);
                          const m = example.match(/(\d+)\s*-?\s*minute/i);
                          if (m?.[1]) setAiDurationMinutes(m[1]);
                        }}
                        disabled={aiAgendaBusy}
                        style={{
                          borderWidth: 1,
                          borderColor: '#dbeafe',
                          backgroundColor: '#f8fbff',
                          borderRadius: 12,
                          paddingVertical: 7,
                          paddingHorizontal: 10,
                          marginBottom: 6,
                          opacity: aiAgendaBusy ? 0.6 : 1,
                        }}
                      >
                        <Text style={{ color: '#2563eb', fontSize: 12, fontWeight: '600' }}>
                          {example}
                        </Text>
                      </TouchableOpacity>
                        ))}
                      </View>
                    </>
                  )}

                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginTop: aiKeyboardFocused ? 4 : 8,
                      marginBottom: 4,
                    }}
                  >
                    <Text style={[styles.infoModalLabel, { marginTop: 0, marginBottom: 0 }]}>
                      Meeting prompt
                    </Text>

                    <TouchableOpacity
                      onPress={handleAiPromptVoicePress}
                      disabled={aiAgendaBusy}
                      accessibilityRole="button"
                      accessibilityLabel={
                        Platform.OS === 'ios'
                          ? 'Use iPhone keyboard dictation'
                          : aiSpeechListening
                            ? 'Stop voice input'
                            : 'Speak meeting prompt'
                      }
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        borderWidth: 1,
                        borderColor: aiSpeechListening ? '#dc2626' : '#2f80ed',
                        backgroundColor: aiSpeechListening ? '#fef2f2' : '#eff6ff',
                        borderRadius: 999,
                        paddingVertical: 6,
                        paddingHorizontal: 10,
                        opacity: aiAgendaBusy ? 0.5 : 1,
                      }}
                    >
                      <Ionicons
                        name={aiSpeechListening ? 'stop-circle-outline' : 'mic-outline'}
                        size={16}
                        color={aiSpeechListening ? '#dc2626' : '#2f80ed'}
                        style={{ marginRight: 5 }}
                      />
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: '800',
                          color: aiSpeechListening ? '#dc2626' : '#2f80ed',
                        }}
                      >
                        {Platform.OS === 'ios' ? 'Use Dictation' : aiSpeechListening ? 'Stop' : 'Speak'}
                      </Text>
                    </TouchableOpacity>
                  </View>

                  <TextInput
                    ref={aiPromptInputRef}
                    value={aiPrompt}
                    onChangeText={(value) => {
                      setAiPrompt(value);
                      setAiSpeechError('');
                      setAiSpeechStatus('');
                    }}
                    editable={!aiAgendaBusy}
                    onFocus={() => {
                      setAiPromptFocused(true);
                      setAiDurationFocused(false);
                    }}
                    onBlur={() => setAiPromptFocused(false)}
                    multiline
                    maxLength={600}
                    keyboardType="default"
                    keyboardAppearance="light"
                    placeholderTextColor="#9ca3af"
                    selectionColor="#2f80ed"
                    inputAccessoryViewID={Platform.OS === 'ios' ? AI_PROMPT_ACCESSORY_ID : undefined}
                    returnKeyType="done"
                    blurOnSubmit={false}
                    onSubmitEditing={() => {
                      aiPromptInputRef.current?.blur?.();
                      Keyboard.dismiss();
                    }}
                    placeholder="Example: Create a 30-minute product roadmap review for 6 people. Include updates, risks, decisions, and next steps."
                    style={[
                      styles.infoModalInput,
                      {
                        minHeight: aiPromptFocused ? 160 : 110,
                        maxHeight: aiPromptFocused ? 190 : undefined,
                        textAlignVertical: 'top',
                        paddingTop: 10,
                        backgroundColor: '#ffffff',
                        color: '#111827',
                      },
                    ]}
                  />


                  {!!aiSpeechStatus && (
                    <Text
                      style={{
                        fontSize: 12,
                        color: aiSpeechListening ? '#2563eb' : '#4b5563',
                        marginTop: 6,
                        lineHeight: 16,
                      }}
                    >
                      {aiSpeechStatus}
                    </Text>
                  )}

                  {!!aiSpeechError && (
                    <Text
                      style={{
                        fontSize: 12,
                        color: '#b45309',
                        backgroundColor: '#fffbeb',
                        borderRadius: 8,
                        paddingVertical: 6,
                        paddingHorizontal: 8,
                        marginTop: 6,
                        lineHeight: 16,
                      }}
                    >
                      {aiSpeechError}
                    </Text>
                  )}

                  <Text
                    style={{
                      fontSize: 11,
                      color: '#6b7280',
                      marginTop: 6,
                      lineHeight: 15,
                    }}
                  >
                    {Platform.OS === 'ios'
                      ? aiPromptFocused
                        ? 'Dictation is active — your words appear above. Tap Done when finished.'
                        : 'On iPhone: tap Use Dictation, tap the keyboard microphone, then tap Done above the keyboard.'
                      : 'Speak your meeting goal, then review or edit before generating.'}
                  </Text>

                  <Text style={styles.infoModalCounter}>
                    {String(aiPrompt || '').length}/600
                  </Text>

                  <Text style={styles.infoModalLabel}>Target length in minutes</Text>
                  <TextInput
                    ref={aiDurationInputRef}
                    value={aiDurationMinutes}
                    onChangeText={(value) =>
                      setAiDurationMinutes(String(value || '').replace(/[^0-9]/g, '').slice(0, 3))
                    }
                    editable={!aiAgendaBusy}
                    onFocus={() => {
                      setAiDurationFocused(true);
                      setAiPromptFocused(false);
                    }}
                    onBlur={() => setAiDurationFocused(false)}
                    keyboardType="number-pad"
                    keyboardAppearance="light"
                    placeholderTextColor="#9ca3af"
                    selectionColor="#2f80ed"
                    inputAccessoryViewID={Platform.OS === 'ios' ? AI_DURATION_ACCESSORY_ID : undefined}
                    returnKeyType="done"
                    onSubmitEditing={() => {
                      aiDurationInputRef.current?.blur?.();
                      Keyboard.dismiss();
                    }}
                    placeholder="30"
                    style={[
                      styles.infoModalInput,
                      {
                        backgroundColor: '#ffffff',
                        color: '#111827',
                      },
                    ]}
                  />

                  <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
                    <TouchableOpacity
                      onPress={() => {
                        if (aiSpeechListening) stopAiPromptVoiceInput();
                        setShowAiAgendaModal(false);
                        setAiPromptFocused(false);
                        setAiDurationFocused(false);
                        setAiSpeechStatus('');
                        setAiSpeechError('');
                      }}
                      disabled={aiAgendaBusy}
                      style={[
                        styles.secondaryBtn,
                        { flex: 1, paddingVertical: 11, opacity: aiAgendaBusy ? 0.5 : 1 },
                      ]}
                    >
                      <Text style={styles.secondaryBtnText}>Cancel</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={createAgendaFromAiPrompt}
                      disabled={aiAgendaBusy}
                      style={[
                        styles.primaryBtn,
                        { flex: 1, paddingVertical: 11, opacity: aiAgendaBusy ? 0.7 : 1 },
                      ]}
                    >
                      {aiAgendaBusy ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={styles.primaryBtnText}>
                          {lastAiPrompt && aiPrompt === lastAiPrompt ? 'Regenerate' : 'Generate'}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>

                  {Platform.OS === 'ios' && (
                    <>
                      <InputAccessoryView nativeID={AI_PROMPT_ACCESSORY_ID}>
                        <View
                          style={{
                            backgroundColor: '#f9fafb',
                            borderTopWidth: 1,
                            borderTopColor: '#d1d5db',
                            paddingVertical: 8,
                            paddingHorizontal: 12,
                            alignItems: 'flex-end',
                          }}
                        >
                          <TouchableOpacity
                            onPress={() => {
                              aiPromptInputRef.current?.blur?.();
                              Keyboard.dismiss();
                              setAiPromptFocused(false);
                              setAiDurationFocused(false);
                              setAiSpeechListening(false);
                              setAiSpeechStatus((prev) =>
                                prev ? 'Dictation closed. Review or edit before generating.' : prev
                              );
                            }}
                            accessibilityRole="button"
                            accessibilityLabel="Done dictating meeting prompt"
                            style={{
                              backgroundColor: '#2f80ed',
                              borderRadius: 999,
                              paddingVertical: 7,
                              paddingHorizontal: 16,
                            }}
                          >
                            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>
                              Done
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </InputAccessoryView>

                      <InputAccessoryView nativeID={AI_DURATION_ACCESSORY_ID}>
                        <View
                          style={{
                            backgroundColor: '#f9fafb',
                            borderTopWidth: 1,
                            borderTopColor: '#d1d5db',
                            paddingVertical: 8,
                            paddingHorizontal: 12,
                            alignItems: 'flex-end',
                          }}
                        >
                          <TouchableOpacity
                            onPress={() => {
                              aiDurationInputRef.current?.blur?.();
                              Keyboard.dismiss();
                              setAiDurationFocused(false);
                            }}
                            accessibilityRole="button"
                            accessibilityLabel="Done editing target length"
                            style={{
                              backgroundColor: '#2f80ed',
                              borderRadius: 999,
                              paddingVertical: 7,
                              paddingHorizontal: 16,
                            }}
                          >
                            <Text style={{ color: '#fff', fontWeight: '800', fontSize: 14 }}>
                              Done
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </InputAccessoryView>
                    </>
                  )}
                </View>
              </TouchableWithoutFeedback>
            </KeyboardAvoidingView>
          </TouchableWithoutFeedback>
        </Modal>

        {/* 💡 3-step guide modal (Pre-start screen) */}
        <Modal
          visible={screen === 'prestart' && showQuickStart && !autoDemoBooting}
          transparent
          animationType="fade"
          onRequestClose={handleCloseQuickStart}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.infoModalBackdrop}>
              <TouchableWithoutFeedback onPress={() => {}}>
                <View
                  style={[
                    styles.infoModalCard,
                    { paddingVertical: 24, alignItems: 'center' },
                  ]}
                >
                  <View
                    style={{
                      width: 36,
                      height: 4,
                      borderRadius: 2,
                      backgroundColor: '#e5e7eb',
                      alignSelf: 'center',
                      marginTop: 4,
                      marginBottom: 12,
                    }}
                  />

                  {/* Simple illustration bubble – feels like the Wendy's card */}
                  <View
                    style={{
                      width: 96,
                      height: 96,
                      borderRadius: 48,
                      backgroundColor: '#e0f2fe',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: 16,
                    }}
                  >
                    <Image
                      source={brandLogoSource}
                      style={{ width: 56, height: 56, borderRadius: 14 }}
                      resizeMode="contain"
                    />
                  </View>

                  <Text
                    style={{
                      fontSize: 20,
                      fontWeight: '700',
                      textAlign: 'center',
                      marginBottom: 16,
                    }}
                  >
                    Keep the whole room on pace
                  </Text>

                  {/* Value bullets — same message for both the How-it-works and temporary-account cards. */}
                  <View style={{ alignSelf: 'stretch', marginBottom: 22, paddingHorizontal: 8 }}>
                    {[
                      'Live agenda + countdown',
                      'Yellow/red timing cues',
                      'QR/link sharing in one tap',
                    ].map((line) => (
                      <View
                        key={line}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          marginBottom: 10,
                        }}
                      >
                        <Text
                          style={{
                            width: 26,
                            fontSize: 20,
                            fontWeight: '900',
                            color: '#16a34a',
                            lineHeight: 24,
                          }}
                        >
                          ✓
                        </Text>
                        <Text
                          style={{
                            flex: 1,
                            fontSize: 15,
                            fontWeight: '700',
                            color: '#4b5563',
                            lineHeight: 20,
                          }}
                        >
                          {line}
                        </Text>
                      </View>
                    ))}
                  </View>

                  {/* =========================
                      CTA STACK
                      ========================= */}
                  <TouchableOpacity
                    onPress={handleDismissQuickStart}
                    style={[
                      styles.primaryBtn,
                      {
                        alignSelf: 'stretch',
                        borderRadius: 999,
                        paddingVertical: 11,
                        marginTop: 2,
                        marginBottom: 12,
                      },
                    ]}
                  >
                    <Text style={styles.primaryBtnText}>Start with a Template</Text>
                  </TouchableOpacity>

                  {!quickStartDontShowAgain && (
                    <TouchableOpacity
                      onPress={() => {
                        handleDismissQuickStart();
                        startSampleMeetingFromQuickStart();
                      }}
                      activeOpacity={0.65}
                      style={{ marginTop: 4, marginBottom: 8, paddingVertical: 6 }}
                    >
                      <Text
                        style={{
                          textAlign: 'center',
                          fontSize: 12,
                          fontWeight: '600',
                          color: '#2f80ed',
                          opacity: 0.7,
                        }}
                      >
                        {auth.currentUser?.isAnonymous ? 'Replay demo' : 'Watch sample demo again'}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {auth.currentUser?.isAnonymous && (
                    <TouchableOpacity
                      onPress={() => {
                        logUserEvent('quickstart_signin_to_save_tapped', {}, 'prestart');
                        handleDismissQuickStart();
                        setAuthScreenMode('upgrade');
                        setScreen('emailAuth');
                      }}
                      style={{ marginTop: 2, paddingVertical: 4 }}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={{
                          textAlign: 'center',
                          fontSize: 11,
                          fontWeight: '600',
                          color: '#6b7280',
                          opacity: 0.9,
                        }}
                      >
                        Sign in to save
                      </Text>
                    </TouchableOpacity>
                  )}

                  {/* ✅ Don't show again checkbox (signed-in users only) */}
                  {!auth.currentUser?.isAnonymous && (
                    <TouchableOpacity
                      onPress={() => setQuickStartDontShowAgain((v) => !v)}
                      activeOpacity={0.8}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        alignSelf: 'stretch',
                        marginTop: 10,
                        marginBottom: 2,
                        paddingVertical: 4,
                        paddingHorizontal: 4,
                      }}
                    >
                      <View
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: 6,
                          borderWidth: 1,
                          borderColor: '#9ca3af',
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: quickStartDontShowAgain ? '#111827' : 'transparent',
                          marginRight: 10,
                        }}
                      >
                        {quickStartDontShowAgain ? (
                          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '800' }}>✓</Text>
                        ) : null}
                      </View>

                      <Text style={{ fontSize: 12, color: '#6b7280', flex: 1 }}>
                        Don&apos;t show this again
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {/* 📝 Info + Presenter editor modal (triggered by Aa on Setup) */}
        <Modal
          visible={detailsModalItemId !== null}
          transparent
          animationType="slide"
          onRequestClose={handleCloseInfoModal}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.infoModalBackdrop}>
              <TouchableWithoutFeedback onPress={() => {}}>
                <View style={styles.infoModalCard}>
                  <Text style={styles.infoModalTitle}>Additional Details</Text>

                  {/* Presenter */}
                  <Text style={styles.infoModalLabel}>Presenter (optional)</Text>
                  <TextInput
                    style={styles.infoModalInput}
                    value={presenterDraft}
                    maxLength={PRESENTER_MAX_CHARS}
                    placeholder="e.g. Ken R. (facilitator)"
                    onChangeText={setPresenterDraft}
                  />

                  {/* Notes / Info */}
                  <Text style={styles.infoModalLabel}>
                    Extra context or notes for this item
                  </Text>
                  <TextInput
                    style={[
                      styles.infoModalInput,
                      { height: 96, textAlignVertical: 'top' },
                    ]}
                    value={infoDraft}
                    onChangeText={(text) => setInfoDraft(sanitizeInfo(text))}
                    multiline
                    maxLength={INFO_MAX_CHARS}
                    placeholder="Optional notes, key points, or reminders."
                  />
                  <Text style={styles.infoModalCounter}>
                    {infoDraft?.length || 0}/{INFO_MAX_CHARS}
                  </Text>

                  {/* Buttons */}
                  <View style={styles.infoModalButtonsRow}>
                    <TouchableOpacity
                      onPress={handleCloseInfoModal}
                      style={[styles.secondaryBtn, { flex: 1, marginRight: 6 }]}
                    >
                      <Text style={styles.secondaryBtnText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={handleSaveInfoModal}
                      style={[styles.primaryBtn, { flex: 1, marginLeft: 6 }]}
                    >
                      <Text style={styles.primaryBtnText}>Save</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {/* 🎬 House Interstitial Modal (fallback when network interstitial is missing) */}
        <Modal
          visible={showHouseInterstitial}
          transparent
          animationType="fade"
          onRequestClose={closeHouseInterstitial}
        >
          <TouchableWithoutFeedback onPress={closeHouseInterstitial}>
            <View style={styles.infoModalBackdrop}>
              <TouchableWithoutFeedback onPress={() => {}}>
                <View style={[styles.infoModalCard, { paddingVertical: 24 }]}>
                  <Text
                    style={{
                      fontSize: 18,
                      fontWeight: 'bold',
                      textAlign: 'center',
                      marginBottom: 8,
                    }}
                  >
                    Discover More with AgendaGlow ✨
                  </Text>

                  <Text style={{ fontSize: 11, color: '#6b7280', textAlign: 'center', marginBottom: 10 }}>
                    Ads are removed with AgendaGlow Pro
                  </Text>

                  <Text
                    style={{
                      fontSize: 14,
                      textAlign: 'center',
                      marginBottom: 16,
                    }}
                  >
                    Thanks for using AgendaGlow! For tips, templates, and meeting ideas,
                    visit the AgendaGlow blog on dozenred.com.
                  </Text>

                  <TouchableOpacity
                    onPress={() => {
                      try {
                        Linking.openURL('https://dozenred.com/blog/');
                      } catch (e) {
                        console.warn('Failed to open blog URL', e);
                      }
                      closeHouseInterstitial();
                    }}
                    style={[
                      styles.primaryBtn,
                      { marginBottom: 8, paddingVertical: 10, borderRadius: 999 },
                    ]}
                  >
                    <Text style={styles.primaryBtnText}>🔗 Visit the Blog</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => {
                      closeHouseInterstitial();
                      loadInterstitial(); // ✅ warm next
                    }}
                    style={[
                      styles.secondaryBtn,
                      { paddingVertical: 8, borderRadius: 999 },
                    ]}
                  >
                    <Text style={styles.secondaryBtnText}>Skip for now</Text>
                  </TouchableOpacity>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {/* 🎁 House Reward Modal (used when Rewarded/Interstitial ads aren’t available) */}
        <Modal
          visible={showHouseRewardModal}
          transparent
          animationType="fade"
          onRequestClose={() => {
            setShowHouseRewardModal(false);
            pendingAction.current = null; // cancel if user backs out
          }}
        >
          <TouchableWithoutFeedback
            onPress={() => {
              setShowHouseRewardModal(false);
              pendingAction.current = null;
            }}
          >
            <View style={styles.infoModalBackdrop}>
              <TouchableWithoutFeedback onPress={() => {}}>
                <View style={[styles.infoModalCard, { paddingVertical: 24 }]}>
                  <Text
                    style={{
                      fontSize: 18,
                      fontWeight: 'bold',
                      textAlign: 'center',
                      marginBottom: 6,
                    }}
                  >
                    Quick AgendaGlow Tip 💡
                  </Text>

                  <Text
                    style={{
                      fontSize: 14,
                      textAlign: 'center',
                      marginBottom: 14,
                    }}
                  >
                    Instead of a video ad, take a quick look at the AgendaGlow blog for
                    templates, meeting tips, and product updates. Then we’ll continue your
                    action.
                  </Text>

                  <TouchableOpacity
                    onPress={() => {
                      try {
                        Linking.openURL('https://dozenred.com/blog/');
                      } catch (e) {
                        console.warn('Failed to open blog URL', e);
                      }
                      // Treat this as “reward earned”
                      setShowHouseRewardModal(false);
                      runPendingActionImmediately();
                    }}
                    style={[
                      styles.primaryBtn,
                      { marginBottom: 8, paddingVertical: 10, borderRadius: 999 },
                    ]}
                  >
                    <Text style={styles.primaryBtnText}>✅ Visit Blog & Continue</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => {
                      // ✅ Close the modal either way
                      setShowHouseRewardModal(false);

                      // ✅ Let them proceed for "Share/Save" and "Export Summary"
                      const intent = pendingAction.current;
                      if (intent === 'shareLink' || intent === 'exportSummary') {
                        runPendingActionImmediately(); // this clears pendingAction internally
                        return;
                      }

                      // Otherwise keep the old behavior (e.g. loadCSV can still require the “reward”)
                      pendingAction.current = null;
                    }}
                    style={[
                      styles.secondaryBtn,
                      { paddingVertical: 8, borderRadius: 999 },
                    ]}
                  >
                    <Text style={styles.secondaryBtnText}>Not now</Text>
                  </TouchableOpacity>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {/* 🧨 Delete Account: extra-confirm modal (type "confirm") */}
        <Modal
          visible={showDeleteAccountModal}
          transparent
          animationType="fade"
          onRequestClose={() => {
            if (deleteAccountBusy) return;
            setShowDeleteAccountModal(false);
            setDeleteConfirmText('');
          }}
        >
          <TouchableWithoutFeedback
            onPress={() => {
              if (deleteAccountBusy) return;
              setShowDeleteAccountModal(false);
              setDeleteConfirmText('');
            }}
          >
            <View style={styles.infoModalBackdrop}>
              <TouchableWithoutFeedback onPress={() => {}}>
                <View
                  style={[
                    styles.infoModalCard,
                    { borderWidth: 1, borderColor: 'rgba(209,26,42,0.35)' },
                  ]}
                >
                  <Text style={[styles.infoModalTitle, { color: '#d11a2a' }]}>
                    Are you sure?
                  </Text>

                  <Text style={{ fontSize: 13, color: '#111827', lineHeight: 18 }}>
                    This will permanently delete your AgendaGlow account and all agendas.
                    This action is irreversible.
                  </Text>

                  <Text style={[styles.infoModalLabel, { marginTop: 14 }]}>
                    Please type "{DELETE_CONFIRM_WORD}" to enable deletion:
                  </Text>

                  <TextInput
                    value={deleteConfirmText}
                    onChangeText={setDeleteConfirmText}
                    editable={!deleteAccountBusy}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder={DELETE_CONFIRM_WORD}
                    style={[
                      styles.infoModalInput,
                      {
                        marginTop: 6,
                        borderColor:
                          deleteConfirmText.trim().toLowerCase() === DELETE_CONFIRM_WORD
                            ? '#16a34a'
                            : '#d0d0d0',
                      },
                    ]}
                  />

                  <View style={[styles.infoModalButtonsRow, { gap: 10 }]}>
                    <TouchableOpacity
                      onPress={() => {
                        if (deleteAccountBusy) return;
                        setShowDeleteAccountModal(false);
                        setDeleteConfirmText('');
                      }}
                      style={{
                        flex: 1,
                        paddingVertical: 12,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: '#e5e7eb',
                        backgroundColor: '#fff',
                        alignItems: 'center',
                      }}
                      disabled={deleteAccountBusy}
                    >
                      <Text style={{ fontWeight: '700', color: '#111827' }}>Cancel</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={async () => {
                        const ok =
                          deleteConfirmText.trim().toLowerCase() === DELETE_CONFIRM_WORD;
                        if (!ok || deleteAccountBusy) return;

                        // Close modal first (prevents double taps / weird UI)
                        setShowDeleteAccountModal(false);

                        await performAccountDeletion();

                        // Always reset the typed text afterwards
                        setDeleteConfirmText('');
                      }}
                      disabled={
                        deleteAccountBusy ||
                        deleteConfirmText.trim().toLowerCase() !== DELETE_CONFIRM_WORD
                      }
                      style={{
                        flex: 1,
                        paddingVertical: 12,
                        borderRadius: 10,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor:
                          deleteAccountBusy ||
                          deleteConfirmText.trim().toLowerCase() !== DELETE_CONFIRM_WORD
                            ? '#fca5a5'
                            : '#d11a2a',
                        opacity: deleteAccountBusy ? 0.8 : 1,
                      }}
                    >
                      {deleteAccountBusy ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={{ fontWeight: '800', color: '#fff' }}>Delete</Text>
                      )}
                    </TouchableOpacity>
                  </View>

                  <Text
                    style={{
                      fontSize: 11,
                      color: '#6b7280',
                      marginTop: 12,
                      lineHeight: 15,
                    }}
                  >
                    Tip: If you signed in more than a few minutes ago, we may ask you to
                    sign in again before deleting.
                  </Text>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {/* 🔐 Delete Account: email password re-auth */}
        <Modal
          visible={showDeleteReauthModal}
          transparent
          animationType="fade"
          onRequestClose={() => {
            if (deleteReauthBusy) return;
            setShowDeleteReauthModal(false);
            setDeletePassword('');
          }}
        >
          <TouchableWithoutFeedback
            onPress={() => {
              if (deleteReauthBusy) return;
              setShowDeleteReauthModal(false);
              setDeletePassword('');
            }}
          >
            <View style={styles.infoModalBackdrop}>
              <TouchableWithoutFeedback onPress={() => {}}>
                <View style={styles.infoModalCard}>
                  <Text style={styles.infoModalTitle}>Confirm password</Text>

                  <Text style={{ fontSize: 13, color: '#111827', lineHeight: 18 }}>
                    For security, please confirm your password to delete your account.
                  </Text>

                  <TextInput
                    value={deletePassword}
                    onChangeText={setDeletePassword}
                    editable={!deleteReauthBusy}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="Password"
                    style={[styles.infoModalInput, { marginTop: 10 }]}
                  />

                  <View style={[styles.infoModalButtonsRow, { gap: 10 }]}>
                    <TouchableOpacity
                      onPress={() => {
                        if (deleteReauthBusy) return;
                        setShowDeleteReauthModal(false);
                        setDeletePassword('');
                      }}
                      style={{
                        flex: 1,
                        paddingVertical: 12,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: '#e5e7eb',
                        backgroundColor: '#fff',
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ fontWeight: '700' }}>Cancel</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      disabled={deleteReauthBusy || !deletePassword}
                      onPress={async () => {
                        if (!deletePassword || deleteReauthBusy) return;

                        setDeleteReauthBusy(true);
                        try {
                          const u = auth.currentUser;
                          await reauthWithPasswordForDeletion(u, deletePassword);

                          setShowDeleteReauthModal(false);
                          setDeletePassword('');

                          // 🔁 Retry deletion now that auth is fresh
                          await performAccountDeletion();
                        } catch (e) {
                          alertSafe('Authentication failed', e, 'Incorrect password. Please try again.');
                        } finally {
                          setDeleteReauthBusy(false);
                        }
                      }}
                      style={{
                        flex: 1,
                        paddingVertical: 12,
                        borderRadius: 10,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor:
                          deleteReauthBusy || !deletePassword ? '#fca5a5' : '#d11a2a',
                      }}
                    >
                      {deleteReauthBusy ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={{ fontWeight: '800', color: '#fff' }}>Confirm</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>

        {/* ⋮ Overflow Menu */}
        <Modal
          visible={menuForItemId !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setMenuForItemId(null)}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: 'rgba(0,0,0,0.2)',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <View
              style={{
                width: 240,
                backgroundColor: '#fff',
                borderRadius: 14,
                paddingVertical: 10,
                paddingHorizontal: 4,
              }}
            >
              {/* ✏️ Edit notes & presenter */}
              <TouchableOpacity
                style={{ padding: 12 }}
                onPress={() => {
                  if (menuForItemId === null || menuForItemId === undefined) {
                    setMenuForItemId(null);
                    return;
                  }

                  const target =
                    agendaItems.find((it) => it.id === menuForItemId) ??
                    agendaItems[menuForItemId];

                  // close first so modal goes away even if something is off
                  setMenuForItemId(null);
                  if (!target) return;

                  setDetailsModalItemId(target.id ?? menuForItemId);
                  setInfoDraft(target.info || '');
                  setPresenterDraft(target.presenterTag || '');
                }}
              >
                <Text style={{ fontSize: 15 }}>✏️ Edit notes & presenter</Text>
              </TouchableOpacity>

              {/* ➕ Add item below */}
              <TouchableOpacity
                style={{ padding: 12 }}
                onPress={() => {
                  if (menuForItemId === null || menuForItemId === undefined) {
                    setMenuForItemId(null);
                    return;
                  }

                  setAgendaItems((prev) => {
                    const idx =
                      prev.findIndex((it) => it.id === menuForItemId) !== -1
                        ? prev.findIndex((it) => it.id === menuForItemId)
                        : typeof menuForItemId === 'number'
                          ? menuForItemId
                          : -1;
                    if (idx === -1) return prev;

                    const updated = [...prev];
                    const insertAt = Math.min(idx + 1, updated.length);
                    const base = createEmptyAgendaItem();
                    const newItem = {
                      ...base,
                      yellow: advancedThresholdsEnabled ? 0.66 : 0.66666,
                    };
                    updated.splice(insertAt, 0, newItem);
                    return updated;
                  });

                  setMenuForItemId(null);
                }}
              >
                <Text style={{ fontSize: 15 }}>➕ Add item below</Text>
              </TouchableOpacity>

              {/* 📋 Duplicate item */}
              <TouchableOpacity
                style={{ padding: 12 }}
                onPress={() => {
                  if (menuForItemId === null || menuForItemId === undefined) {
                    setMenuForItemId(null);
                    return;
                  }

                  setAgendaItems((prev) => {
                    const idx =
                      prev.findIndex((it) => it.id === menuForItemId) !== -1
                        ? prev.findIndex((it) => it.id === menuForItemId)
                        : typeof menuForItemId === 'number'
                          ? menuForItemId
                          : -1;
                    if (idx === -1) return prev;

                    const updated = [...prev];
                    const source = updated[idx];
                    const insertAt = Math.min(idx + 1, updated.length);

                    // Use createEmptyAgendaItem to get a fresh id, then copy fields
                    const base = createEmptyAgendaItem();
                    const duplicate = {
                      ...base,
                      title: source.title,
                      duration: source.duration,
                      yellow: source.yellow,
                      red: source.red,
                      info: source.info,
                      presenterTag: source.presenterTag,
                    };

                    updated.splice(insertAt, 0, duplicate);
                    return updated;
                  });

                  setMenuForItemId(null);
                }}
              >
                <Text style={{ fontSize: 15 }}>📋 Duplicate item</Text>
              </TouchableOpacity>

              {/* 🗑️ Delete item */}
              <TouchableOpacity
                style={{ padding: 12 }}
                disabled={agendaItems.length === 1}
                onPress={() => {
                  if (agendaItems.length === 1) return;

                  if (menuForItemId === null || menuForItemId === undefined) {
                    setMenuForItemId(null);
                    return;
                  }
                  setAgendaItems((prev) => {
                    if (prev.length === 1) return prev;

                    const idx =
                      prev.findIndex((it) => it.id === menuForItemId) !== -1
                        ? prev.findIndex((it) => it.id === menuForItemId)
                        : typeof menuForItemId === 'number'
                          ? menuForItemId
                          : -1;
                    if (idx === -1) return prev;

                    const updated = [...prev];
                    updated.splice(idx, 1);
                    return updated;
                  });

                  setMenuForItemId(null);
                }}
              >
                <Text
                  style={{
                    fontSize: 15,
                    color: agendaItems.length === 1 ? '#ccc' : '#d11a2a',
                  }}
                >
                  🗑️ Delete item
                </Text>
              </TouchableOpacity>

              
              {/* 🧩 Load agenda from template...there is a bug with this that it keeps the same title...maybe fix later */}
              {/*
              <TouchableOpacity
                style={{ padding: 12 }}
                onPress={() => {
                  // close menu first
                  setMenuForItemId(null);

                  // tell Templates screen to return to Setup + load into current agenda
                  setTemplateReturnScreen('setup');

                  // go to Templates screen
                  setScreen('templates');
                }}
              >
                <Text style={{ fontSize: 15 }}>🧩 Load from template</Text>
              </TouchableOpacity>
              */}

              {/* 📄 Load agenda from CSV */}
              <TouchableOpacity
                style={{ padding: 12 }}
                onPress={() => {
                  // close menu first
                  setMenuForItemId(null);

                  // then run the existing rewarded gate
                  setTimeout(() => gateActionWithRewardedFirst('loadCSV'), 0);
                }}
              >
                <Text style={{ fontSize: 15 }}>📥 Load agenda from CSV</Text>
              </TouchableOpacity>

              {/* ❌ Cancel */}
              <TouchableOpacity
                style={{
                  padding: 12,
                  borderTopWidth: 1,
                  borderTopColor: '#eee',
                  marginTop: 4,
                }}
                onPress={() => setMenuForItemId(null)}
              >
                <Text
                  style={{
                    fontSize: 15,
                    textAlign: 'center',
                    color: '#2f80ed', // on-brand neutral action
                  }}
                >
                  Cancel
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
        {startingMeeting && (
          <View
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: 'rgba(255,255,255,0.92)',
              alignItems: 'center',
              justifyContent: 'center',
              zIndex: 9999,
            }}
          >
            <ActivityIndicator size="large" />
            <Text style={{ marginTop: 12, color: '#111827', fontWeight: '600' }}>
              Starting…
            </Text>
          </View>
        )}
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}
