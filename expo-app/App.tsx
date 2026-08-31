/**
 * SiteCheck QC — Expo Go test shell.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS
 *
 * A thin WebView wrapper around the real app, so it can be launched from Expo
 * Go on a phone without a Mac or a build. It is a harness for testing the
 * field UI: sunlight legibility, tap targets, safe areas, one-handed use.
 *
 * WHAT THIS IS NOT
 *
 * It cannot measure anything. Expo Go is a fixed prebuilt binary containing
 * only Expo SDK modules, so it cannot load the ARKit plugin — no amount of
 * restructuring changes that, and Expo removed its own AR support years ago.
 * The tape calibration study still needs a real iOS build from a Mac.
 *
 * It is deliberately a WebView rather than a React Native port. A port would
 * mean maintaining a second UI codebase that still could not measure, and the
 * two would drift apart within a week.
 * ---------------------------------------------------------------------------
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
// React Native's own SafeAreaView is deprecated in 0.81 and, on iOS, never
// handled the home indicator on the sides. This is the supported one, and
// getting insets right is the whole point of testing on hardware.
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type { WebViewNavigation } from 'react-native-webview/lib/WebViewTypes';

const STORAGE_KEY = 'sitecheck.serverUrl';

/** Port `npm run dev:lan` binds the web app to. */
const WEB_PORT = 5174;

/**
 * Where the web app is, derived from wherever Metro is being served from.
 *
 * Hard-coding an address does not survive contact with DHCP — the dev machine
 * picks up a new lease, the QR dies, and the address saved on the phone points
 * at nothing. Metro's host IS the dev machine, so asking Expo for it gets the
 * right answer every time without anyone typing an IP.
 */
function detectDevHost(): string | null {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost ??
    null;

  const host = hostUri?.split(':')[0]?.trim();
  return host ? `http://${host}:${WEB_PORT}` : null;
}

type Phase = 'loading-settings' | 'setup' | 'browsing';

export default function App() {
  // SafeAreaProvider must sit above anything that reads insets.
  return (
    <SafeAreaProvider>
      <AppShell />
    </SafeAreaProvider>
  );
}

function AppShell() {
  const detected = detectDevHost();
  const [phase, setPhase] = useState<Phase>('loading-settings');
  const [url, setUrl] = useState('');
  const [draftUrl, setDraftUrl] = useState(detected ?? '');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const webRef = useRef<WebView>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (saved) {
          setUrl(saved);
          setDraftUrl(saved);
          setPhase('browsing');
        } else if (detected) {
          // Nothing saved but Metro told us where it lives: go straight in.
          setUrl(detected);
          setDraftUrl(detected);
          setPhase('browsing');
        } else {
          setPhase('setup');
        }
      })
      .catch(() => setPhase('setup'));
    // Detected host is fixed for the lifetime of the process.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Reset to whatever Metro is served from — the fix when the dev machine's IP moves. */
  const useDetected = useCallback(() => {
    if (!detected) return;
    setUrl(detected);
    setDraftUrl(detected);
    setLoadError(null);
    AsyncStorage.setItem(STORAGE_KEY, detected).catch(() => {});
  }, [detected]);

  const connect = useCallback(async () => {
    const cleaned = normaliseUrl(draftUrl);
    if (!cleaned) return;

    setUrl(cleaned);
    setDraftUrl(cleaned);
    setLoadError(null);
    setPhase('browsing');
    // Failing to remember the address is not worth blocking on.
    AsyncStorage.setItem(STORAGE_KEY, cleaned).catch(() => {});
  }, [draftUrl]);

  if (phase === 'loading-settings') {
    return (
      <View style={styles.centre}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (phase === 'setup') {
    return (
      <SetupScreen
        value={draftUrl}
        onChange={setDraftUrl}
        onConnect={connect}
        error={loadError}
        canCancel={url !== ''}
        onCancel={() => setPhase('browsing')}
      />
    );
  }

  return (
    <View style={styles.fill}>
      <StatusBar style="auto" />
      <WebView
        ref={webRef}
        source={{ uri: url }}
        style={styles.fill}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        // The app is entirely IndexedDB-backed. WKWebView provides it for
        // http(s) origins, which is why this loads over the network rather
        // than from a bundled file — file:// origins do not get storage.
        incognito={false}
        cacheEnabled
        allowsInlineMediaPlayback
        mediaCapturePermissionGrantType="grant"
        setSupportMultipleWindows={false}
        pullToRefreshEnabled
        allowsBackForwardNavigationGestures
        onNavigationStateChange={(nav: WebViewNavigation) => setBusy(nav.loading)}
        onError={(event) =>
          setLoadError(event.nativeEvent.description || 'The page could not be loaded.')
        }
        onHttpError={(event) =>
          setLoadError(`Server responded ${event.nativeEvent.statusCode}.`)
        }
        renderLoading={() => (
          <View style={styles.centre}>
            <ActivityIndicator size="large" />
          </View>
        )}
      />

      {loadError && (
        <SafeAreaView style={styles.errorSheet}>
          <Text style={styles.errorTitle}>Cannot reach {hostOf(url)}</Text>
          <Text style={styles.errorBody}>{loadError}</Text>
          <Text style={styles.errorBody}>
            Check that the dev server is running with{' '}
            <Text style={styles.mono}>npm run dev:lan</Text>, that this phone is on the same
            Wi-Fi, and that Windows Firewall is allowing the port on private networks.
          </Text>
          {/*
            Offered first when the saved address no longer matches where Metro
            is being served from — i.e. the dev machine changed IP, which is
            by far the most common reason this sheet appears.
          */}
          {detected && detected !== url && (
            <Pressable style={[styles.button, styles.buttonWide]} onPress={useDetected}>
              <Text style={styles.buttonText}>Use {hostOf(detected)}</Text>
            </Pressable>
          )}

          <View style={styles.errorButtons}>
            <Pressable
              style={[styles.button, styles.buttonGhost]}
              onPress={() => setPhase('setup')}
            >
              <Text style={styles.buttonGhostText}>Change address</Text>
            </Pressable>
            <Pressable
              style={styles.button}
              onPress={() => {
                setLoadError(null);
                webRef.current?.reload();
              }}
            >
              <Text style={styles.buttonText}>Retry</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      )}

      {/*
        Deliberately small and low-contrast: this is a harness control, and it
        must not compete with the app being tested or cover its content. It
        sits bottom-left because every primary action in the web app is either
        full-width or bottom-right.
      */}
      {!loadError && (
        <Pressable style={styles.gear} onPress={() => setPhase('setup')} hitSlop={12}>
          <Text style={styles.gearText}>{busy ? '···' : '⚙'}</Text>
        </Pressable>
      )}
    </View>
  );
}

function SetupScreen({
  value,
  onChange,
  onConnect,
  error,
  canCancel,
  onCancel,
}: {
  value: string;
  onChange: (v: string) => void;
  onConnect: () => void;
  error: string | null;
  canCancel: boolean;
  onCancel: () => void;
}) {
  const valid = normaliseUrl(value) !== null;

  return (
    <SafeAreaView style={styles.fill}>
      <StatusBar style="auto" />
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.setup} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>SiteCheck QC</Text>
          <Text style={styles.subtitle}>Expo Go test shell</Text>

          <Text style={styles.label}>Dev server address</Text>
          <TextInput
            style={styles.input}
            value={value}
            onChangeText={onChange}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="http://192.168.1.10:5174"
            returnKeyType="go"
            onSubmitEditing={onConnect}
          />
          <Text style={styles.hint}>
            On the Windows machine run <Text style={styles.mono}>npm run dev:lan</Text> and use the
            Network address it prints. Both devices must be on the same Wi-Fi.
          </Text>

          {error && <Text style={styles.error}>{error}</Text>}

          <Pressable
            style={[styles.button, styles.buttonWide, !valid && styles.buttonDisabled]}
            onPress={onConnect}
            disabled={!valid}
          >
            <Text style={styles.buttonText}>Connect</Text>
          </Pressable>

          {canCancel && (
            <Pressable style={[styles.button, styles.buttonGhost, styles.buttonWide]} onPress={onCancel}>
              <Text style={styles.buttonGhostText}>Cancel</Text>
            </Pressable>
          )}

          <View style={styles.note}>
            <Text style={styles.noteTitle}>This shell cannot measure</Text>
            <Text style={styles.noteBody}>
              Expo Go cannot load custom native code, so ARKit is unavailable here. Use this to
              test the field interface — sunlight legibility, tap targets, one-handed use. The
              accuracy study needs a real iOS build from a Mac.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** Accepts `192.168.1.101:5174` as readily as a full URL; returns null if unusable. */
function normaliseUrl(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;

  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;

  try {
    const parsed = new URL(withScheme);
    if (!parsed.hostname) return null;
    return withScheme.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#ffffff' },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ffffff' },

  setup: { padding: 24, gap: 10 },
  title: { fontSize: 26, fontWeight: '700', color: '#14181d' },
  subtitle: { fontSize: 15, color: '#5b6672', marginBottom: 18 },
  label: { fontSize: 14, color: '#5b6672', fontWeight: '600' },
  input: {
    borderWidth: 2,
    borderColor: '#d3dae2',
    borderRadius: 10,
    paddingHorizontal: 14,
    minHeight: 52,
    fontSize: 17,
    color: '#14181d',
  },
  hint: { fontSize: 14, color: '#5b6672', lineHeight: 20 },
  mono: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  error: { color: '#b3261e', fontWeight: '600' },

  button: {
    minHeight: 52,
    borderRadius: 10,
    backgroundColor: '#1558d6',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  buttonWide: { alignSelf: 'stretch', marginTop: 8 },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#ffffff', fontSize: 17, fontWeight: '700' },
  buttonGhost: { backgroundColor: 'transparent', borderWidth: 2, borderColor: '#d3dae2' },
  buttonGhostText: { color: '#14181d', fontSize: 17, fontWeight: '700' },

  note: { marginTop: 28, padding: 14, borderRadius: 10, backgroundColor: '#fdf1dc' },
  noteTitle: { fontWeight: '700', color: '#8a5a00', marginBottom: 4 },
  noteBody: { color: '#5c3200', lineHeight: 20 },

  errorSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#ffffff',
    borderTopWidth: 2,
    borderTopColor: '#b3261e',
    padding: 20,
    gap: 8,
  },
  errorTitle: { fontSize: 18, fontWeight: '700', color: '#b3261e' },
  errorBody: { color: '#2c3540', lineHeight: 20 },
  errorButtons: { flexDirection: 'row', gap: 10, marginTop: 8 },

  gear: {
    position: 'absolute',
    left: 12,
    bottom: 34,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gearText: { color: '#ffffff', fontSize: 17 },
});
