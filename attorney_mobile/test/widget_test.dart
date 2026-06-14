import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:attorney_mobile/main.dart';

void main() {
  testWidgets('App boots into the splash screen', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: AttorneyApp()));
    // First frame shows the splash brand mark.
    expect(find.text('Attorney'), findsOneWidget);
  });
}
