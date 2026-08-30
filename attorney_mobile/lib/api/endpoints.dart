import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';

import 'api_client.dart';
import 'models.dart';

/// Sentinel thrown on every non-2xx response with a human-readable message.
class ApiException implements Exception {
  ApiException(this.statusCode, this.message, {this.body});
  final int? statusCode;
  final String message;
  final dynamic body;

  @override
  String toString() => message;
}

String _fieldLabel(String raw) {
  // "first_name" / "scheduled_time" → "First name" / "Scheduled time".
  return raw
      .replaceAll('_', ' ')
      .replaceFirstMapped(RegExp(r'^(.)'), (m) => m.group(1)!.toUpperCase());
}

String _stringifyDrfValue(dynamic v) {
  if (v is String) return v;
  if (v is List && v.isNotEmpty) return _stringifyDrfValue(v.first);
  if (v is Map && v.isNotEmpty) {
    final entry = v.entries.first;
    return '${_fieldLabel(entry.key.toString())}: ${_stringifyDrfValue(entry.value)}';
  }
  return v?.toString() ?? '';
}

/// Convert a DioException into our friendly ApiException.
///
///   * 0 / -1 / connection errors  → "Can't reach the server. Check your connection."
///   * 401                          → "Wrong email or password." (or DRF detail)
///   * 423                          → "Too many attempts — try again in 15 minutes."
///   * 5xx                          → "Something broke on our side. Try again."
///   * DRF field errors             → "Field: message"
ApiException _wrap(DioException e) {
  final res = e.response;
  final code = res?.statusCode;

  if (res == null) {
    // No HTTP response at all — connect / timeout / offline.
    final msg = switch (e.type) {
      DioExceptionType.connectionTimeout =>
        "Couldn't reach the server in time. Check your internet connection and try again.",
      DioExceptionType.receiveTimeout =>
        "The server took too long to respond. Try again in a moment.",
      DioExceptionType.connectionError =>
        "Can't connect to the server. Make sure you're online (and that the backend is reachable from the device).",
      _ => "Network error: ${e.message ?? 'unknown'}.",
    };
    return ApiException(null, msg);
  }

  final body = res.data;
  if (kDebugMode) {
    final preview = body is String
        ? body.substring(0, body.length.clamp(0, 240))
        : body.toString().substring(0, body.toString().length.clamp(0, 240));
    debugPrint('[api] ${res.requestOptions.method} ${res.requestOptions.path} -> $code · ${preview.replaceAll('\n', ' ')}');
  }

  // DRF style errors.
  if (body is Map) {
    if (body['detail'] is String) {
      return ApiException(code, body['detail'] as String, body: body);
    }
    if (body['non_field_errors'] is List && (body['non_field_errors'] as List).isNotEmpty) {
      return ApiException(code, _stringifyDrfValue(body['non_field_errors']), body: body);
    }
    if (body.isNotEmpty) {
      final first = body.entries.first;
      final label = _fieldLabel(first.key.toString());
      final msg = _stringifyDrfValue(first.value);
      return ApiException(code, '$label: $msg', body: body);
    }
  }
  if (body is String && body.isNotEmpty) {
    final trimmed = body.trimLeft();
    if (trimmed.startsWith('<') && (code ?? 0) >= 500) {
      // Django DEBUG=True returned a technical_500 HTML page. The real
      // exception is in the Django console — surface a clean message
      // here so the toast isn't a wall of HTML.
      return ApiException(code,
        'Server error — Django returned a debug page. Check the Django console for the traceback.',
        body: '<html truncated>',
      );
    }
    if (body.length < 240) {
      return ApiException(code, body, body: body);
    }
  }

  // Fallback by status code with copy that points the user at a next action.
  final fallback = switch (code) {
    400 => "We couldn't process that request. Double-check the fields and try again.",
    401 => "Your session has expired. Please log in again.",
    403 => "You don't have permission to do that.",
    404 => "We couldn't find that. It may have been deleted or moved.",
    409 => "That conflicts with the current state — refresh and try again.",
    422 => "Some fields look off — please review and resubmit.",
    423 => "Too many failed attempts. Try again in 15 minutes.",
    429 => "Slow down a moment — you've hit a rate limit.",
    500 || 502 || 503 || 504 =>
      "Something broke on our side. Try again in a moment.",
    _ => "Request failed (HTTP ${code ?? '?'}).",
  };
  return ApiException(code, fallback, body: body);
}

class Endpoints {
  Endpoints(this.api);
  final ApiClient api;

  Dio get _d => api.dio;

  Future<T> _get<T>(String path, T Function(dynamic) map, {Map<String, dynamic>? query}) async {
    try {
      final res = await _d.get(path, queryParameters: query);
      return map(res.data);
    } on DioException catch (e) {
      throw _wrap(e);
    }
  }

  Future<T> _post<T>(String path, T Function(dynamic) map, {dynamic data}) async {
    try {
      final res = await _d.post(path, data: data);
      return map(res.data);
    } on DioException catch (e) {
      throw _wrap(e);
    }
  }

  Future<T> _patch<T>(String path, T Function(dynamic) map, {dynamic data}) async {
    try {
      final res = await _d.patch(path, data: data);
      return map(res.data);
    } on DioException catch (e) {
      throw _wrap(e);
    }
  }

  Future<void> _delete(String path) async {
    try {
      await _d.delete(path);
    } on DioException catch (e) {
      throw _wrap(e);
    }
  }

  // ---- Auth ----

  /// Returns ``LoginResult`` with either tokens or a 2FA challenge.
  Future<LoginResult> login(String email, String password) async {
    try {
      final res = await _d.post('/api/v1/auth/token/',
          data: {'email': email, 'password': password});
      final body = res.data as Map<String, dynamic>;
      if (body['requires_2fa'] == true) {
        return LoginResult.twoFactor(
          challengeToken: body['challenge_token'] as String,
          method: body['method'] as String,
        );
      }
      await api.setTokens(
        access: body['access'] as String,
        refresh: body['refresh'] as String,
      );
      return LoginResult.tokens();
    } on DioException catch (e) {
      throw _wrap(e);
    }
  }

  Future<void> verify2fa(String challengeToken, String code) async {
    try {
      final res = await _d.post('/api/v1/auth/2fa/verify/',
          data: {'challenge_token': challengeToken, 'code': code});
      final body = res.data as Map<String, dynamic>;
      await api.setTokens(
        access: body['access'] as String,
        refresh: body['refresh'] as String,
      );
    } on DioException catch (e) {
      throw _wrap(e);
    }
  }

  Future<void> register({
    required String email,
    required String password,
    required String firstName,
    required String lastName,
    required String role,
  }) async {
    try {
      await _d.post('/api/v1/register/', data: {
        'email': email,
        'password': password,
        'first_name': firstName,
        'last_name': lastName,
        'role': role,
      });
    } on DioException catch (e) {
      throw _wrap(e);
    }
  }

  Future<void> logout() async {
    final refresh = await api.getRefresh();
    try {
      if (refresh != null) {
        await _d.post('/api/v1/auth/logout/', data: {'refresh': refresh});
      }
    } catch (_) {
      // ignore — clear locally either way.
    } finally {
      await api.clearTokens();
    }
  }

  Future<User> me() => _get('/api/v1/users/me/', (j) => User.fromJson(j as Map<String, dynamic>));

  /// Public app version/config for update prompts.
  Future<AppConfigInfo> getAppConfig() =>
      _get('/api/v1/app-config/', (j) => AppConfigInfo.fromJson(j as Map<String, dynamic>));

  /// Current subscription-gate state for the signed-in user.
  Future<SubscriptionState> getSubscription() =>
      _get('/api/v1/subscription/', (j) => SubscriptionState.fromJson(j as Map<String, dynamic>));

  /// Upload proof of payment for this month's subscription → pending review.
  Future<SubscriptionState> uploadSubscriptionPop(String filePath, String fileName) async {
    try {
      final form = FormData.fromMap({
        'proof_of_payment': await MultipartFile.fromFile(filePath, filename: fileName),
      });
      final res = await _d.post('/api/v1/subscription/', data: form);
      return SubscriptionState.fromJson((res.data as Map).cast<String, dynamic>());
    } on DioException catch (e) {
      throw _wrap(e);
    }
  }

  /// Register this device's FCM token so the backend can push to it.
  Future<void> registerDevice(String token, String platform) async {
    try {
      await _d.post('/api/v1/devices/', data: {'token': token, 'platform': platform});
    } on DioException catch (e) {
      throw _wrap(e);
    }
  }

  /// Deactivate an FCM token (called on logout / sign-out). Best-effort.
  Future<void> unregisterDevice(String token) async {
    try {
      await _d.delete('/api/v1/devices/', data: {'token': token});
    } catch (_) {
      // ignore — logging out shouldn't fail on this.
    }
  }

  /// Send the password-reset email.
  Future<void> requestPasswordReset(String email) async {
    await _post('/api/v1/auth/password-reset/', (_) => null, data: {'email': email});
  }

  /// Confirm the password-reset link and stash the returned tokens.
  Future<void> confirmPasswordReset({required String uid, required String token, required String password}) async {
    final res = await _post<Map<String, dynamic>>(
      '/api/v1/auth/password-reset/confirm/',
      (j) => j as Map<String, dynamic>,
      data: {'uid': uid, 'token': token, 'password': password},
    );
    await api.setTokens(access: res['access'] as String, refresh: res['refresh'] as String);
  }

  /// Verify the email link (uid + token).
  Future<void> confirmEmailVerify({required String uid, required String token}) async {
    await _post('/api/v1/auth/email-verify/confirm/', (_) => null,
        data: {'uid': uid, 'token': token});
  }

  /// Preview details for an invite token before the user activates.
  Future<Map<String, dynamic>> previewInvite(String token) =>
      _get('/api/v1/auth/accept-invite/',
          (j) => Map<String, dynamic>.from(j as Map),
          query: {'token': token});

  /// Activate the invited account and stash the returned tokens.
  Future<void> acceptInvite({required String token, required String password, String? email}) async {
    final body = <String, dynamic>{'token': token, 'password': password};
    if (email != null && email.isNotEmpty) body['email'] = email;
    final res = await _post<Map<String, dynamic>>(
      '/api/v1/auth/accept-invite/',
      (j) => j as Map<String, dynamic>,
      data: body,
    );
    await api.setTokens(access: res['access'] as String, refresh: res['refresh'] as String);
  }

  // ---- Lawyers + firms ----

  Future<List<Lawyer>> listLawyers({String search = ''}) async {
    final q = <String, dynamic>{};
    if (search.isNotEmpty) q['search'] = search;
    return _get('/api/v1/lawyers/', (j) {
      final results = (j['results'] as List? ?? const []);
      return results.map((e) => Lawyer.fromJson(e as Map<String, dynamic>)).toList();
    }, query: q);
  }

  Future<Lawyer> getLawyer(int id) =>
      _get('/api/v1/lawyers/$id/', (j) => Lawyer.fromJson(j as Map<String, dynamic>));

  /// Reviews authored against a lawyer — used on the public profile.
  Future<List<Map<String, dynamic>>> listLawyerReviews(int id) =>
      _get('/api/v1/lawyers/$id/reviews/', (j) {
        if (j is List) return j.cast<Map<String, dynamic>>();
        final results = (j['results'] as List? ?? const []);
        return results.cast<Map<String, dynamic>>();
      });

  /// Public list of verified firms (used on the directory tab).
  Future<List<Map<String, dynamic>>> listFirms() => _get('/api/v1/firms/', (j) {
        final results = (j['results'] as List? ?? const []);
        return results.cast<Map<String, dynamic>>();
      });

  /// My retainers — lawyers I keep on my legal team.
  Future<List<Map<String, dynamic>>> listRetainers() => _get('/api/v1/retainers/', (j) {
        final results = (j['results'] as List? ?? const []);
        return results.cast<Map<String, dynamic>>();
      });

  /// Add a lawyer to the current client's legal team.
  Future<Map<String, dynamic>> addRetainer(int lawyerId) =>
      _post('/api/v1/retainers/', (j) => j as Map<String, dynamic>,
          data: {'lawyer': lawyerId});

  /// Create a matter (and seed a consultation + optional payment).
  Future<Map<String, dynamic>> createMatter(Map<String, dynamic> payload) =>
      _post('/api/v1/matters/', (j) => j as Map<String, dynamic>, data: payload);

  /// Lawyer opens a matter for a client — either an existing client
  /// (`client_id`) or a new contact who gets invited by email
  /// (`contact: {first_name, last_name, email?, phone_number?}`).
  /// Returns the created Matter plus `invited` / `client_email` flags.
  Future<Map<String, dynamic>> createMatterForClient(Map<String, dynamic> payload) =>
      _post('/api/v1/matters/create-for-client/', (j) => j as Map<String, dynamic>, data: payload);

  // ---- Matters ----

  Future<List<Matter>> listMatters() => _get('/api/v1/matters/', (j) {
        final results = (j['results'] as List? ?? const []);
        return results.map((e) => Matter.fromJson(e as Map<String, dynamic>)).toList();
      });

  Future<Matter> getMatter(int id) =>
      _get('/api/v1/matters/$id/', (j) => Matter.fromJson(j as Map<String, dynamic>));

  // ---- Lawyer clients (CRM) ----

  Future<List<Map<String, dynamic>>> listLawyerClients() =>
      _get('/api/v1/matters/lawyer-clients/', (j) {
        final results = (j['results'] as List? ?? const []);
        return results.cast<Map<String, dynamic>>();
      });

  Future<Map<String, dynamic>> getLawyerClient(int clientId) =>
      _get('/api/v1/lawyer-clients/$clientId/', (j) => j as Map<String, dynamic>);

  // ---- Consultations ----

  Future<List<Consultation>> listConsultations() => _get('/api/v1/consultations/', (j) {
        final results = (j['results'] as List? ?? const []);
        return results.map((e) => Consultation.fromJson(e as Map<String, dynamic>)).toList();
      });

  Future<Consultation> confirmConsultation(int id) => _post(
      '/api/v1/consultations/$id/confirm/', (j) => Consultation.fromJson(j as Map<String, dynamic>));

  Future<Consultation> cancelConsultation(int id) => _post(
      '/api/v1/consultations/$id/cancel/', (j) => Consultation.fromJson(j as Map<String, dynamic>));

  Future<Consultation> rescheduleConsultation(int id, String iso, {String note = ''}) =>
      _post('/api/v1/consultations/$id/reschedule/',
          (j) => Consultation.fromJson(j as Map<String, dynamic>),
          data: {'scheduled_time': iso, 'note': note});

  Future<Consultation> completeConsultation(int id) => _post(
      '/api/v1/consultations/$id/complete/',
      (j) => Consultation.fromJson(j as Map<String, dynamic>));

  // ---- Time entries / Payments / Transactions ----

  Future<List<Map<String, dynamic>>> listTimeEntries() => _get('/api/v1/time-entries/', (j) {
        final results = (j['results'] as List? ?? const []);
        return results.cast<Map<String, dynamic>>();
      });

  Future<List<Map<String, dynamic>>> listPaymentInvoices() =>
      _get('/api/v1/payments/?purpose=invoice', (j) {
        final results = (j['results'] as List? ?? const []);
        return results.cast<Map<String, dynamic>>();
      });

  Future<Map<String, dynamic>> generateInvoice(int matterId) =>
      _post('/api/v1/payments/generate-invoice/', (j) => j as Map<String, dynamic>,
          data: {'matter': matterId});

  Future<Map<String, dynamic>> listTransactions() =>
      _get('/api/v1/transactions/', (j) => j as Map<String, dynamic>);

  Future<Map<String, dynamic>> reviewPayment(int id, String status, {String? note}) =>
      _post('/api/v1/payments/$id/review/', (j) => j as Map<String, dynamic>,
          data: {'status': status, if (note != null && note.isNotEmpty) 'review_note': note});

  Future<Map<String, dynamic>> commentPayment(int id, String body) =>
      _post('/api/v1/payments/$id/comment/', (j) => j as Map<String, dynamic>,
          data: {'body': body});

  /// Streams CSV bytes for the transactions export.
  Future<List<int>> downloadTransactionsCsv() async {
    try {
      final res = await _d.get<List<int>>(
        '/api/v1/transactions/export.csv',
        options: Options(responseType: ResponseType.bytes),
      );
      return res.data ?? const [];
    } on DioException catch (e) {
      throw _wrap(e);
    }
  }

  /// Streams PDF bytes for the branded transactions statement.
  Future<List<int>> downloadTransactionsPdf() async {
    try {
      final res = await _d.get<List<int>>(
        '/api/v1/transactions/export.pdf',
        options: Options(responseType: ResponseType.bytes),
      );
      return res.data ?? const [];
    } on DioException catch (e) {
      throw _wrap(e);
    }
  }

  /// Build the absolute invoice PDF URL — used to launch the system viewer.
  String invoicePdfUrl(int paymentId) =>
      '${api.dio.options.baseUrl}/api/v1/payments/$paymentId/invoice-pdf/';

  /// Download the branded invoice PDF bytes (authenticated). The raw URL can't
  /// be opened directly in an external browser because it carries no JWT, so
  /// callers save these bytes to a temp file and open that instead.
  Future<List<int>> downloadInvoicePdf(int paymentId) async {
    try {
      final res = await _d.get<List<int>>(
        '/api/v1/payments/$paymentId/invoice-pdf/',
        options: Options(responseType: ResponseType.bytes),
      );
      return res.data ?? const [];
    } on DioException catch (e) {
      throw _wrap(e);
    }
  }

  // ---- Messages (chat) ----

  /// Fetch a page of messages newest-first. Returns the paginated envelope
  /// so callers can lazy-load older pages by checking ``next``.
  Future<Paginated<Message>> listMessagesPage(int channelId, {int page = 1}) =>
      _get(
        '/api/v1/messages/',
        (j) => Paginated<Message>(
          count: (j['count'] as num?)?.toInt() ?? 0,
          next: j['next'] as String?,
          previous: j['previous'] as String?,
          results: ((j['results'] as List?) ?? const [])
              .map((e) => Message.fromJson(e as Map<String, dynamic>))
              .toList(),
        ),
        query: {'channel': channelId, 'page': page, 'ordering': '-created_at'},
      );

  Future<Message> sendMessage(int channelId, String content, {int? parent, String? kind}) {
    final body = <String, dynamic>{'channel': channelId, 'content': content};
    if (parent != null) body['parent'] = parent;
    if (kind != null && kind != 'regular') body['kind'] = kind;
    return _post('/api/v1/messages/',
        (j) => Message.fromJson(j as Map<String, dynamic>),
        data: body);
  }

  Future<List<Message>> messageReplies(int messageId) =>
      _get('/api/v1/messages/$messageId/replies/', (j) {
        if (j is List) {
          return j.map((e) => Message.fromJson(e as Map<String, dynamic>)).toList();
        }
        final results = (j['results'] as List? ?? const []);
        return results.map((e) => Message.fromJson(e as Map<String, dynamic>)).toList();
      });

  Future<Message> reactToMessage(int messageId, String emoji) =>
      _post('/api/v1/messages/$messageId/react/',
          (j) => Message.fromJson(j as Map<String, dynamic>),
          data: {'emoji': emoji});

  // ---- Documents ----

  Future<List<DocumentItem>> listDocumentsForMatter(int matterId, {String? kind}) {
    final q = <String, dynamic>{'matter': matterId};
    if (kind != null) q['kind'] = kind;
    return _get('/api/v1/documents/', (j) {
      final results = (j['results'] as List? ?? const []);
      return results.map((e) => DocumentItem.fromJson(e as Map<String, dynamic>)).toList();
    }, query: q);
  }

  Future<DocumentItem> createDraft(int matterId, String title, String body) =>
      _post('/api/v1/documents/',
          (j) => DocumentItem.fromJson(j as Map<String, dynamic>),
          data: {'matter': matterId, 'title': title, 'kind': 'draft', 'body': body});

  /// Upload a binary file via multipart/form-data and create a Document.
  Future<DocumentItem> uploadDocument(int matterId, String filePath, String title) async {
    try {
      final form = FormData.fromMap({
        'matter': matterId,
        'title': title,
        'kind': 'document',
        'file': await MultipartFile.fromFile(filePath, filename: title),
      });
      final res = await _d.post('/api/v1/documents/', data: form);
      return DocumentItem.fromJson(res.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw _wrap(e);
    }
  }

  // ---- Payments (typed) ----

  Future<List<Payment>> listPaymentsForMatter(int matterId) =>
      _get('/api/v1/payments/', (j) {
        final results = (j['results'] as List? ?? const []);
        return results.map((e) => Payment.fromJson(e as Map<String, dynamic>)).toList();
      }, query: {'matter': matterId});

  Future<Payment> createPayment({
    required int matterId,
    required String amount,
    required String currency,
    required String provider,
    required String purpose,
  }) =>
      _post('/api/v1/payments/',
          (j) => Payment.fromJson(j as Map<String, dynamic>),
          data: {
            'matter': matterId,
            'amount': amount,
            'currency': currency,
            'provider': provider,
            'purpose': purpose,
          });

  /// Upload proof-of-payment as multipart, optionally with an explicit
  /// amount (for partial payments) and a free-form reference.
  Future<Payment> uploadProofOfPayment(int paymentId, String filePath,
      {String? amount, String? reference, String? note}) async {
    try {
      final form = FormData.fromMap({
        if (amount != null && amount.isNotEmpty) 'amount': amount,
        if (reference != null && reference.isNotEmpty) 'reference': reference,
        if (note != null && note.isNotEmpty) 'note': note,
        'proof_of_payment': await MultipartFile.fromFile(filePath),
      });
      final res = await _d.post('/api/v1/payments/$paymentId/upload-proof/', data: form);
      return Payment.fromJson(res.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw _wrap(e);
    }
  }

  Future<Payment> reviewPaymentTyped(int paymentId, String status, {String? reviewNote}) =>
      _post('/api/v1/payments/$paymentId/review/',
          (j) => Payment.fromJson(j as Map<String, dynamic>),
          data: {
            'status': status,
            if (reviewNote != null) 'review_note': reviewNote,
          });

  // ---- Time entries (typed) ----

  Future<List<TimeEntry>> listTimeForMatter(int matterId) =>
      _get('/api/v1/time-entries/', (j) {
        final results = (j['results'] as List? ?? const []);
        return results.map((e) => TimeEntry.fromJson(e as Map<String, dynamic>)).toList();
      }, query: {'matter': matterId});

  Future<TimeEntry> startTimer(int matterId, {String description = ''}) =>
      _post('/api/v1/time-entries/start/',
          (j) => TimeEntry.fromJson(j as Map<String, dynamic>),
          data: {'matter': matterId, 'description': description});

  Future<TimeEntry> stopTimer(int timerId) =>
      _post('/api/v1/time-entries/$timerId/stop/',
          (j) => TimeEntry.fromJson(j as Map<String, dynamic>));

  Future<TimeEntry?> getRunningTimer() async {
    try {
      final res = await _d.get('/api/v1/time-entries/running/');
      if (res.data == null) return null;
      if (res.data is Map && (res.data as Map).isEmpty) return null;
      return TimeEntry.fromJson(res.data as Map<String, dynamic>);
    } on DioException catch (e) {
      throw _wrap(e);
    }
  }

  Future<TimeEntry> logTime({
    required int matterId,
    required int minutes,
    String description = '',
    String? startedAt,
  }) =>
      _post('/api/v1/time-entries/log/',
          (j) => TimeEntry.fromJson(j as Map<String, dynamic>),
          data: {
            'matter': matterId,
            'minutes': minutes,
            'description': description,
            'is_billable': true,
            if (startedAt != null) 'started_at': startedAt,
          });

  // ---- Reviews ----

  Future<List<Review>> listReviewsForMatter(int matterId) =>
      _get('/api/v1/reviews/', (j) {
        final results = (j['results'] as List? ?? const []);
        return results.map((e) => Review.fromJson(e as Map<String, dynamic>)).toList();
      }, query: {'matter': matterId});

  Future<Review> createReview(int matterId, int rating, String body) =>
      _post('/api/v1/reviews/',
          (j) => Review.fromJson(j as Map<String, dynamic>),
          data: {'matter': matterId, 'rating': rating, 'body': body});

  // ---- AI Workflows / LLM ----

  /// All workflows for the caller (lawyer).
  Future<List<Map<String, dynamic>>> listWorkflows() =>
      _get('/api/v1/workflows/', (j) {
        final results = (j['results'] as List? ?? const []);
        return results.cast<Map<String, dynamic>>();
      });

  Future<Map<String, dynamic>> getWorkflow(int id) =>
      _get('/api/v1/workflows/$id/', (j) => j as Map<String, dynamic>);

  Future<Map<String, dynamic>> createWorkflow(Map<String, dynamic> payload) =>
      _post('/api/v1/workflows/', (j) => j as Map<String, dynamic>, data: payload);

  Future<List<Map<String, dynamic>>> listWorkflowTemplates() =>
      _get('/api/v1/workflow-templates/', (j) {
        final results = (j['results'] as List? ?? const []);
        return results.cast<Map<String, dynamic>>();
      });

  Future<Map<String, dynamic>> runWorkflowStage(int stageId, Map<String, dynamic> payload) =>
      _post('/api/v1/workflow-stages/$stageId/run/',
          (j) => j as Map<String, dynamic>, data: payload);

  Future<Map<String, dynamic>> approveWorkflowStage(int stageId) =>
      _post('/api/v1/workflow-stages/$stageId/approve/', (j) => j as Map<String, dynamic>);

  // --- AI credits / subscriptions ---
  Future<List<Map<String, dynamic>>> listAiCreditPlans() =>
      _get('/api/v1/ai-credit-plans/', (j) {
        final results = (j['results'] as List? ?? const []);
        return results.cast<Map<String, dynamic>>();
      });

  Future<Map<String, dynamic>> aiCreditAccount() =>
      _get('/api/v1/ai-credit-account/', (j) => j as Map<String, dynamic>);

  Future<List<Map<String, dynamic>>> listAiCreditOrders() =>
      _get('/api/v1/ai-credit-orders/', (j) {
        final results = (j['results'] as List? ?? const []);
        return results.cast<Map<String, dynamic>>();
      });

  Future<Map<String, dynamic>> createAiCreditOrder({
    required int planId,
    required String filePath,
    String? reference,
    String? method,
    String? note,
  }) async {
    try {
      final form = FormData.fromMap({
        'plan': planId,
        if (reference != null && reference.isNotEmpty) 'reference': reference,
        if (method != null && method.isNotEmpty) 'method': method,
        if (note != null && note.isNotEmpty) 'note': note,
        'proof_of_payment': await MultipartFile.fromFile(filePath),
      });
      final res = await _d.post('/api/v1/ai-credit-orders/', data: form);
      return res.data as Map<String, dynamic>;
    } on DioException catch (e) {
      throw _wrap(e);
    }
  }

  Future<List<Map<String, dynamic>>> listCorpusCollections() =>
      _get('/api/v1/corpus-collections/', (j) {
        final results = (j['results'] as List? ?? const []);
        return results.cast<Map<String, dynamic>>();
      });

  Future<List<Map<String, dynamic>>> listResearchQueries() =>
      _get('/api/v1/research-queries/', (j) {
        final results = (j['results'] as List? ?? const []);
        return results.cast<Map<String, dynamic>>();
      });

  Future<Map<String, dynamic>> askCoResearcher(Map<String, dynamic> payload) =>
      _post('/api/v1/co-researcher/ask/', (j) => j as Map<String, dynamic>, data: payload);

  /// Admin: every tenant's current-month usage.
  Future<Map<String, dynamic>> llmUsageAll() =>
      _get('/api/v1/llm-usage/', (j) => j as Map<String, dynamic>);

  /// Caller's own current-month usage.
  Future<Map<String, dynamic>> llmUsageMe() =>
      _get('/api/v1/llm-usage/me/', (j) => j as Map<String, dynamic>);

  // ---- Notifications ----

  Future<List<Notif>> listNotifications() => _get('/api/v1/notifications/', (j) {
        final results = (j['results'] as List? ?? const []);
        return results.map((e) => Notif.fromJson(e as Map<String, dynamic>)).toList();
      });

  Future<void> markAllNotificationsRead() async {
    await _post('/api/v1/notifications/mark-all-read/', (_) => null);
  }

  /// Generic helpers exposed for screens that still need raw access.
  Future<dynamic> rawGet(String path, {Map<String, dynamic>? query}) =>
      _get(path, (j) => j, query: query);
  Future<dynamic> rawPost(String path, {dynamic data}) =>
      _post(path, (j) => j, data: data);
  Future<dynamic> rawPatch(String path, {dynamic data}) =>
      _patch(path, (j) => j, data: data);
  Future<void> rawDelete(String path) => _delete(path);

  /// PATCH with a multipart payload (file uploads / mixed form data).
  Future<dynamic> rawPatchMultipart(String path, FormData data) async {
    try {
      final res = await _d.patch(path, data: data);
      return res.data;
    } on DioException catch (e) {
      throw _wrap(e);
    }
  }

  /// POST with a multipart payload.
  Future<dynamic> rawPostMultipart(String path, FormData data) async {
    try {
      final res = await _d.post(path, data: data);
      return res.data;
    } on DioException catch (e) {
      throw _wrap(e);
    }
  }
}

class LoginResult {
  LoginResult._(this.requires2fa, this.challengeToken, this.method);
  factory LoginResult.tokens() => LoginResult._(false, null, null);
  factory LoginResult.twoFactor({required String challengeToken, required String method}) =>
      LoginResult._(true, challengeToken, method);
  final bool requires2fa;
  final String? challengeToken;
  final String? method;
}
