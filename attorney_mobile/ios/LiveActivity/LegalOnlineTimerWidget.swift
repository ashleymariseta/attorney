import ActivityKit
import SwiftUI
import WidgetKit

/// Lock-screen + Dynamic Island UI for the running billables timer.
///
/// This file belongs ONLY to the Widget Extension target
/// (LegalOnlineTimerWidget), not the Runner app.
@main
struct LegalOnlineTimerWidgetBundle: WidgetBundle {
    var body: some Widget {
        LegalOnlineTimerWidget()
    }
}

struct LegalOnlineTimerWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TimerActivityAttributes.self) { context in
            // Lock screen / banner presentation.
            HStack(spacing: 12) {
                Image(systemName: "timer")
                    .font(.title2)
                    .foregroundStyle(.tint)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Tracking")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text(context.attributes.matterTitle)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(1)
                }
                Spacer()
                Text(context.state.startedAt, style: .timer)
                    .font(.title2.weight(.bold).monospacedDigit())
                    .frame(minWidth: 90, alignment: .trailing)
            }
            .padding()
            .activityBackgroundTint(Color.black.opacity(0.75))
            .activitySystemActionForegroundColor(Color.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Image(systemName: "timer").foregroundStyle(.tint)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.state.startedAt, style: .timer)
                        .monospacedDigit()
                        .frame(minWidth: 70)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.attributes.matterTitle)
                        .font(.caption)
                        .lineLimit(1)
                }
            } compactLeading: {
                Image(systemName: "timer").foregroundStyle(.tint)
            } compactTrailing: {
                Text(context.state.startedAt, style: .timer)
                    .monospacedDigit()
                    .frame(maxWidth: 44)
            } minimal: {
                Image(systemName: "timer").foregroundStyle(.tint)
            }
        }
    }
}
