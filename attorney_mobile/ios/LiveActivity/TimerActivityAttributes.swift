import ActivityKit
import Foundation

/// Shared attributes describing the running billables timer Live Activity.
///
/// This file is compiled into BOTH targets:
///  * the Runner app (to start/stop/update the activity from Dart via a
///    method channel), and
///  * the LegalOnlineTimerWidget extension (to render the lock-screen /
///    Dynamic Island UI).
///
/// Add it to both targets' "Target Membership" in Xcode.
struct TimerActivityAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// When the timer started — the widget renders a live-ticking clock
        /// from this using SwiftUI's `Text(timerInterval:)`, so the OS ticks
        /// it every second without us pushing updates.
        var startedAt: Date
    }

    /// The matter the timer is billing against (fixed for the activity's life).
    var matterTitle: String
}
