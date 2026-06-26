export default {
  expo: {
    name: "FocusGlow",
    slug: "focusglow",
    version: "1.0.0",

    icon: "./assets/icon.png",
    jsEngine: "hermes",
    assetBundlePatterns: ["assets/*"],

    scheme: "focusglow",

    splash: {
      backgroundColor: "#000000",
      resizeMode: "contain",
      image: "./assets/blank.png"
    },

    android: {
      package: "com.kengena.focusglow",
      versionCode: 1,

      permissions: [
        "android.permission.RECORD_AUDIO",
        "android.permission.SCHEDULE_EXACT_ALARM",
        "android.permission.POST_NOTIFICATIONS"
      ],

      adaptiveIcon: {
        foregroundImage: "./assets/icon-foreground.png",
        backgroundColor: "#000000"
      },

      softwareKeyboardLayoutMode: "resize"
    },

    ios: {
      bundleIdentifier: "com.kengena.focusglow",
      supportsTablet: true,
      buildNumber: "1",

      infoPlist: {
        NSMicrophoneUsageDescription:
          "Allow FocusGlow to use the microphone so you can speak an AI prompt.",

        NSSpeechRecognitionUsageDescription:
          "Allow FocusGlow to use speech recognition to turn your spoken focus prompt into text.",

        ITSAppUsesNonExemptEncryption: false,

        UIBackgroundModes: ["remote-notification"]
      }
    },

    plugins: [
      "expo-web-browser",

      "expo-audio",

      [
        "expo-speech-recognition",
        {
          microphonePermission:
            "Allow FocusGlow to use the microphone so you can speak an AI prompt.",

          speechRecognitionPermission:
            "Allow FocusGlow to use speech recognition to turn your spoken focus prompt into text.",

          androidSpeechServicePackages: [
            "com.google.android.googlequicksearchbox"
          ]
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
        projectId: "7fd09a31-39a5-44e5-b188-163df7ce9c03"
      }
    }
  }
};