# expo-notifications `getPermissionsAsync` blocks Expo's shared async-function queue (iOS)

Minimal reproduction for an expo-notifications iOS bug. A blank SDK 57 app (`create-expo-app --template blank-typescript@sdk-57`) plus `expo-notifications`, `expo-tracking-transparency`, `expo-crypto` and `expo-build-properties` (only to set `ios.enableSceneSupport`, which Xcode 27 builds need).

## What the app does

On launch, `App.tsx` logs each call and when it settles, on screen and with `console.log` (prefix `REPRO`):

1. `Notifications.getPermissionsAsync()`
2. 1 s later: `requestTrackingPermissionsAsync()`, which shows the ATT prompt and makes the app inactive
3. 2.5 s: `Notifications.getPermissionsAsync()` again
4. 3.5 s: `Crypto.digestStringAsync()`, an unrelated module's `AsyncFunction`

## Steps

```sh
npm install
npx expo prebuild --platform ios
cd ios && xcodebuild -workspace notifhangrepro.xcworkspace -scheme notifhangrepro \
  -configuration Release -sdk iphonesimulator -derivedDataPath build CODE_SIGNING_ALLOWED=NO build
```

Then, on an iOS 27.2 simulator (Xcode 27.2):

```sh
xcrun simctl shutdown <udid>; xcrun simctl boot <udid>; xcrun simctl bootstatus <udid> -b
xcrun simctl install <udid> ios/build/Build/Products/Release-iphonesimulator/notifhangrepro.app
xcrun simctl spawn <udid> log stream --level info --style compact --predicate 'eventMessage CONTAINS "REPRO ["' &
xcrun simctl launch <udid> com.example.notifhangrepro
```

Launching right after the simulator boots makes `getNotificationSettings` reply slowly, which makes the blocking visible. No taps are needed; leave the ATT prompt on screen.

## Expected

`Crypto.digestStringAsync` resolves right away (a few ms), whatever `getPermissionsAsync` is waiting for.

## Actual

`Crypto.digestStringAsync` cannot run until the earlier `getPermissionsAsync` call returns. Three cold-boot runs in a row:

```
[3.5s] Crypto.digestStringAsync #after: called
[11.6s] getPermissionsAsync #before prompt: resolved "undetermined"
[11.7s] getPermissionsAsync #during prompt: resolved "undetermined"
[11.7s] Crypto.digestStringAsync #after: resolved "f395…"
```

(the other runs: 15.5 s and 16.6 s). On a warm simulator every call resolves in a few ms.

## Why

`PermissionsModule`'s `getPermissionsAsync` runs on the default `expo.modules.AsyncFunctionQueue` (serial, shared by every module's `AsyncFunction`). It reaches `ExpoNotificationsPermissionsRequester.getPermissions()`, which calls `UNUserNotificationCenter.getNotificationSettings` and then `semaphore.wait()` with no timeout. A thread sample during the wait shows that queue blocked in `ExpoNotificationsPermissionsRequester.getPermissions()` → `_dispatch_semaphore_wait_slow`. If the settings reply never arrives, the queue stays blocked for the life of the process.

## Suggested fix

`suggested-fix.patch` (applies to `expo-notifications@57.0.26` with `patch -p1 -d node_modules/expo-notifications`): resolve `getPermissionsAsync` from the requester's existing async `notificationSettings()` path inside a `Task`, as `requestPermissionsAsync` already does. With it applied, the same cold-boot runs resolve `Crypto.digestStringAsync` at 3.5 s, while `getPermissionsAsync` still takes as long as iOS needs (8 s in one run).
