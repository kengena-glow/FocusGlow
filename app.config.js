export default {
  expo: {
    name: "AgendaGlow",
    slug: "AgendaGlow",
    version: "1.0.41",
    icon: "./assets/icon.png",
    jsEngine: "hermes",
    assetBundlePatterns: ["assets/*"],

    scheme: [
      "agendaglow",
      // Register Google installed-app redirect scheme on iOS too:
      "com.googleusercontent.apps.241646235139-09vk3lisbe3ggiqsvshsujvn9081ar5u"
    ],

    splash: {
      backgroundColor: "#000000",
      resizeMode: "contain",
      image: "./assets/blank.png"
    },

    android: {
      package: "com.kengena.agendaglow",
      versionCode: 77,
      googleServicesFile: "./firebase/google-services.json",
      permissions: [
        "com.google.android.gms.permission.AD_ID",
        "android.permission.RECORD_AUDIO",
        "android.permission.SCHEDULE_EXACT_ALARM",
        "android.permission.POST_NOTIFICATIONS"
      ],
      intentFilters: [
        {
          action: "VIEW",
          category: ["BROWSABLE", "DEFAULT"],
          data: [
            {
              scheme:
                "com.googleusercontent.apps.241646235139-09vk3lisbe3ggiqsvshsujvn9081ar5u"
            }
          ]
        }
      ],
      adaptiveIcon: {
        foregroundImage: "./assets/icon-foreground.png",
        backgroundColor: "#000000"
      },
      softwareKeyboardLayoutMode: "resize"
    },

    ios: {
      bundleIdentifier: "com.kengena.agendaglow",
      supportsTablet: true,
      buildNumber: "77",
      googleServicesFile: "./firebase/GoogleService-Info.plist",
      usesAppleSignIn: true,
      infoPlist: {
        NSMicrophoneUsageDescription:
          "Allow AgendaGlow to use the microphone so you can speak an AI agenda prompt.",
        NSSpeechRecognitionUsageDescription:
          "Allow AgendaGlow to use speech recognition to turn your spoken meeting prompt into text.",
        ITSAppUsesNonExemptEncryption: false,
        UIBackgroundModes: ["remote-notification"]
      }
    },

    plugins: [
      "@react-native-firebase/app",
      [
        "@react-native-firebase/analytics",
        {
          ios: {
            googleAppMeasurementOnDeviceConversion: true
          }
        }
      ],
      "expo-web-browser",
      "expo-apple-authentication",
      [
        "react-native-google-mobile-ads",
        {
          androidAppId: "ca-app-pub-8778090938099386~5655801685",
          iosAppId: "ca-app-pub-8778090938099386~4281227643"
        }
      ],
      "expo-audio",
      [
        "expo-speech-recognition",
        {
          microphonePermission:
            "Allow AgendaGlow to use the microphone so you can speak an AI agenda prompt.",
          speechRecognitionPermission:
            "Allow AgendaGlow to use speech recognition to turn your spoken meeting prompt into text.",
          androidSpeechServicePackages: ["com.google.android.googlequicksearchbox"]
        }
      ],
      "expo-document-picker",
      "expo-mail-composer",
      "expo-asset",
      [
        "expo-build-properties",
        {
          ios: {
            useFrameworks: "static"
          }
        }
      ]
    ],

    extra: {
      eas: {
        projectId: "18107f9b-9b2b-46ac-aa4a-c43ec4e3e328"
      },
      revenuecat: {
        iosApiKey: "appl_cbZkenHCYNfRCKoJQkBUyrhNIef",
        androidApiKey: "goog_iAtpYnIoMUjawMGTxNEdsoqusMK",
        entitlementId: "pro" // the exact entitlement I created
      }
    }
  }
};
