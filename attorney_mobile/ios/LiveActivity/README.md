# iOS Live Activity — running billables timer

The Android timer notification works out of the box (foreground service via
`flutter_foreground_task`). iOS needs a **native ActivityKit Live Activity**
(Dynamic Island + lock screen), which requires a Widget Extension target that
must be added in Xcode — it cannot be scaffolded from the Flutter/Dart side.

Until these steps are done, the Dart code no-ops on iOS (it catches the missing
channel) and falls back to a plain local notification. Nothing else breaks.

The Swift sources are already written and live in this folder / `ios/Runner`:

| File | Target it belongs to |
|------|----------------------|
| `TimerActivityAttributes.swift` | **both** Runner **and** the widget extension |
| `LegalOnlineTimerWidget.swift`  | widget extension **only** |
| `../Runner/LiveActivityBridge.swift` | Runner **only** |

## One-time Xcode setup

1. **Open the workspace**: `open ios/Runner.xcworkspace` (not the `.xcodeproj`).

2. **Add the Widget Extension target**
   - File ▸ New ▸ Target… ▸ **Widget Extension** → Next.
   - Product Name: `LegalOnlineTimerWidget`.
   - **Uncheck** "Include Configuration App Intent". **Check** "Include Live
     Activity" if offered.
   - Finish. When asked to activate the new scheme, click **Cancel** (keep the
     Runner scheme active).
   - Delete the placeholder `LegalOnlineTimerWidget.swift` / bundle file Xcode
     generated inside the new group — you'll use ours instead.

3. **Add our Swift files to the right targets**
   - Drag `ios/LiveActivity/LegalOnlineTimerWidget.swift` into the widget group.
     In the file inspector, Target Membership = **LegalOnlineTimerWidget only**.
   - Drag `ios/LiveActivity/TimerActivityAttributes.swift` in. Target
     Membership = **both Runner and LegalOnlineTimerWidget**.
   - `ios/Runner/LiveActivityBridge.swift` → Target Membership = **Runner only**
     (add it to the Runner group if it isn't already listed).

4. **Register the bridge** in `ios/Runner/AppDelegate.swift`, inside
   `application(_:didFinishLaunchingWithOptions:)`, after
   `GeneratedPluginRegistrant.register(with: self)`:

   ```swift
   if #available(iOS 16.1, *) {
     let controller = window?.rootViewController as! FlutterViewController
     LiveActivityBridge.register(with: controller.binaryMessenger)
   }
   ```

5. **Enable Live Activities** — add to `ios/Runner/Info.plist`:

   ```xml
   <key>NSSupportsLiveActivities</key>
   <true/>
   ```

6. **Deployment target** — the widget extension must target **iOS 16.1+**
   (set it in the target's Build Settings → iOS Deployment Target). Runner can
   stay lower; the bridge is `@available(iOS 16.1, *)` guarded.

7. Build & run on a real device or the iOS 16.1+ simulator. Start a timer in
   Billables → the Live Activity appears on the lock screen and Dynamic Island,
   ticking live (driven by `Text(… style: .timer)`, so the OS ticks it — no
   push updates needed). Stopping the timer ends the activity.

## How the pieces connect

- Dart `TimerNotificationService.start/stop` → `MethodChannel
  legalonline/live_activity` → `LiveActivityBridge` → `Activity.request/end`.
- The widget renders from `TimerActivityAttributes` (matter title, fixed) +
  `ContentState.startedAt` (the live clock anchor).
