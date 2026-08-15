import ActivityKit
import Flutter
import Foundation

/// Bridges Dart ⇄ ActivityKit so the billables timer can drive a Live Activity.
///
/// Register from AppDelegate (see ios/LiveActivity/README.md):
///   LiveActivityBridge.register(with: controller.binaryMessenger)
///
/// Method channel `legalonline/live_activity`:
///   * start({ "matterTitle": String, "startedAtEpochMs": Int })
///   * stop()
/// All calls no-op gracefully on iOS < 16.1 or when Live Activities are
/// disabled by the user, so the Dart side can always call them.
@available(iOS 16.1, *)
enum LiveActivityBridge {
    private static var activity: Activity<TimerActivityAttributes>?

    static func register(with messenger: FlutterBinaryMessenger) {
        let channel = FlutterMethodChannel(
            name: "legalonline/live_activity", binaryMessenger: messenger)
        channel.setMethodCallHandler { call, result in
            switch call.method {
            case "start":
                start(args: call.arguments as? [String: Any])
                result(true)
            case "stop":
                stop()
                result(true)
            default:
                result(FlutterMethodNotImplemented)
            }
        }
    }

    private static func start(args: [String: Any]?) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled,
              let args = args,
              let matterTitle = args["matterTitle"] as? String,
              let epochMs = args["startedAtEpochMs"] as? NSNumber
        else { return }

        let startedAt = Date(timeIntervalSince1970: epochMs.doubleValue / 1000.0)
        let state = TimerActivityAttributes.ContentState(startedAt: startedAt)
        let attributes = TimerActivityAttributes(matterTitle: matterTitle)

        // Replace any stale activity first.
        stop()
        do {
            if #available(iOS 16.2, *) {
                activity = try Activity.request(
                    attributes: attributes,
                    content: .init(state: state, staleDate: nil))
            } else {
                activity = try Activity.request(
                    attributes: attributes, contentState: state)
            }
        } catch {
            activity = nil
        }
    }

    private static func stop() {
        guard let current = activity else { return }
        Task {
            if #available(iOS 16.2, *) {
                await current.end(nil, dismissalPolicy: .immediate)
            } else {
                await current.end(dismissalPolicy: .immediate)
            }
        }
        activity = nil
    }
}
