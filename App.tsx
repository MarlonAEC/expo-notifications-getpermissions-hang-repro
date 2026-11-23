import * as Crypto from 'expo-crypto';
import * as Notifications from 'expo-notifications';
import { requestTrackingPermissionsAsync } from 'expo-tracking-transparency';
import { useEffect, useState } from 'react';
import { Button, ScrollView, StyleSheet, Text } from 'react-native';

type Line = { id: number; text: string };

let nextId = 0;
const started = Date.now();
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;

export default function App() {
  const [lines, setLines] = useState<Line[]>([]);

  const log = (text: string) => {
    const line = `[${elapsed()}] ${text}`;
    console.log(`REPRO ${line}`);
    setLines((previous) => [...previous, { id: nextId++, text: line }]);
  };

  const trackCall = (label: string, call: () => Promise<unknown>) => {
    log(`${label}: called`);
    call().then(
      (value) => log(`${label}: resolved ${JSON.stringify(value).slice(0, 60)}`),
      (error: unknown) => log(`${label}: rejected ${String(error)}`),
    );
  };

  const getPermissions = (label: string) =>
    trackCall(`getPermissionsAsync #${label}`, async () => (await Notifications.getPermissionsAsync()).status);

  const otherModuleCall = (label: string) =>
    trackCall(`Crypto.digestStringAsync #${label}`, () =>
      Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, label),
    );

  // The ATT prompt makes the app inactive; getPermissionsAsync is called while it is on screen.
  const runSequence = () => {
    trackCall('requestTrackingPermissionsAsync', async () => (await requestTrackingPermissionsAsync()).status);
    setTimeout(() => getPermissions('during prompt'), 1500);
    setTimeout(() => otherModuleCall('after'), 2500);
  };

  useEffect(() => {
    getPermissions('before prompt');
    setTimeout(runSequence, 1000);
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>expo-notifications getPermissionsAsync hang repro</Text>
      <Button title="Call getPermissionsAsync again" onPress={() => getPermissions(`tap ${elapsed()}`)} />
      <Button title="Call another module's async function" onPress={() => otherModuleCall(`tap ${elapsed()}`)} />
      {lines.map((line) => (
        <Text key={line.id} style={styles.line}>
          {line.text}
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { paddingTop: 80, paddingHorizontal: 16, gap: 8 },
  title: { fontSize: 16, fontWeight: '600' },
  line: { fontFamily: 'Menlo', fontSize: 11 },
});
