/// Typed models that mirror the TypeScript interfaces in
/// frontend/lib/api.ts. Hand-written (no codegen) because the web client
/// is hand-written too and the contracts are small.
class User {
  User({
    required this.id,
    required this.email,
    required this.firstName,
    required this.lastName,
    required this.role,
    this.phoneNumber,
    this.whatsappNumber,
    this.isVerified = false,
    this.emailVerified,
    this.twoFactorMethod,
    this.avatarUrl,
    this.lawyerCredentialsSubmitted,
  });

  final int id;
  final String email;
  final String firstName;
  final String lastName;
  final String role;
  final String? phoneNumber;
  final String? whatsappNumber;
  final bool isVerified;
  final bool? emailVerified;
  final String? twoFactorMethod;
  final String? avatarUrl;
  /// From lawyer_profile.credentials_submitted — false until the lawyer has
  /// submitted a practising certificate. Null for non-lawyers.
  final bool? lawyerCredentialsSubmitted;

  String get fullName {
    final n = '$firstName $lastName'.trim();
    return n.isEmpty ? email : n;
  }

  bool get isLawyer => role == 'lawyer';
  bool get isClient => role.startsWith('client');

  /// A lawyer who hasn't yet cleared the credential-verification gate. A
  /// missing lawyer_profile (null) counts as "not submitted" — same as the
  /// web gate — so an account with no profile row can't slip past KYC.
  bool get lawyerNeedsVerification =>
      isLawyer && lawyerCredentialsSubmitted != true;

  factory User.fromJson(Map<String, dynamic> j) {
    final lp = j['lawyer_profile'];
    return User(
      id: j['id'] as int,
      email: j['email'] as String? ?? '',
      firstName: j['first_name'] as String? ?? '',
      lastName: j['last_name'] as String? ?? '',
      role: j['role'] as String? ?? '',
      phoneNumber: j['phone_number'] as String?,
      whatsappNumber: j['whatsapp_number'] as String?,
      isVerified: j['is_verified'] as bool? ?? false,
      emailVerified: j['email_verified'] as bool?,
      twoFactorMethod: j['two_factor_method'] as String?,
      avatarUrl: j['avatar_url'] as String?,
      lawyerCredentialsSubmitted:
          lp is Map ? lp['credentials_submitted'] as bool? : null,
    );
  }
}

class MiniUser {
  MiniUser({
    required this.id,
    required this.email,
    required this.firstName,
    required this.lastName,
    required this.fullName,
    required this.role,
    this.avatarUrl,
  });

  final int id;
  final String email;
  final String firstName;
  final String lastName;
  final String fullName;
  final String role;
  final String? avatarUrl;

  factory MiniUser.fromJson(Map<String, dynamic> j) => MiniUser(
        id: j['id'] as int,
        email: j['email'] as String? ?? '',
        firstName: j['first_name'] as String? ?? '',
        lastName: j['last_name'] as String? ?? '',
        fullName: j['full_name'] as String? ?? '',
        role: j['role'] as String? ?? '',
        avatarUrl: j['avatar_url'] as String?,
      );
}

class LawyerProfile {
  LawyerProfile({
    required this.barNumber,
    required this.practisingCertificateNumber,
    required this.country,
    required this.jurisdictions,
    required this.practiceAreas,
    required this.languages,
    required this.yearsExperience,
    required this.bio,
    this.hourlyRate,
    this.consultationPrice,
  });
  final String barNumber;
  final String practisingCertificateNumber;
  final String country;
  final List<String> jurisdictions;
  final List<String> practiceAreas;
  final List<String> languages;
  final int yearsExperience;
  final String bio;
  final String? hourlyRate;
  final String? consultationPrice;

  /// Bar/roll number and practising-certificate number combined as one
  /// identifier ("A / B"), deduped — they're treated as the same credential.
  String get barOrCertLabel {
    final seen = <String>{};
    final parts = [barNumber, practisingCertificateNumber]
        .where((v) => v.trim().isNotEmpty && seen.add(v.trim()))
        .toList();
    return parts.join(' / ');
  }

  factory LawyerProfile.fromJson(Map<String, dynamic> j) => LawyerProfile(
        barNumber: j['bar_number'] as String? ?? '',
        practisingCertificateNumber: j['practising_certificate_number'] as String? ?? '',
        country: j['country'] as String? ?? '',
        jurisdictions: List<String>.from(j['jurisdictions'] ?? const []),
        practiceAreas: List<String>.from(j['practice_areas'] ?? const []),
        languages: List<String>.from(j['languages'] ?? const []),
        yearsExperience: (j['years_experience'] as num?)?.toInt() ?? 0,
        bio: j['bio'] as String? ?? '',
        hourlyRate: j['hourly_rate'] as String?,
        consultationPrice: j['consultation_price'] as String?,
      );
}

class Lawyer {
  Lawyer({
    required this.id,
    required this.fullName,
    required this.firstName,
    required this.lastName,
    required this.isVerified,
    required this.onRetainer,
    required this.country,
    required this.reviewCount,
    this.email,
    this.profile,
    this.hourlyRate,
    this.avgRating,
    this.avatarUrl,
  });
  final int id;
  final String? email;
  final String firstName;
  final String lastName;
  final String fullName;
  final bool isVerified;
  final LawyerProfile? profile;
  final bool onRetainer;
  final String? hourlyRate;
  final String country;
  final double? avgRating;
  final int reviewCount;
  final String? avatarUrl;

  factory Lawyer.fromJson(Map<String, dynamic> j) => Lawyer(
        id: j['id'] as int,
        email: j['email'] as String?,
        firstName: j['first_name'] as String? ?? '',
        lastName: j['last_name'] as String? ?? '',
        fullName: j['full_name'] as String? ?? '',
        isVerified: j['is_verified'] as bool? ?? false,
        onRetainer: j['on_retainer'] as bool? ?? false,
        country: j['country'] as String? ?? '',
        hourlyRate: j['hourly_rate'] as String?,
        avgRating: (j['avg_rating'] as num?)?.toDouble(),
        reviewCount: (j['review_count'] as num?)?.toInt() ?? 0,
        avatarUrl: j['avatar_url'] as String?,
        profile: j['profile'] != null
            ? LawyerProfile.fromJson(j['profile'] as Map<String, dynamic>)
            : null,
      );
}

class Matter {
  Matter({
    required this.id,
    required this.title,
    required this.description,
    required this.status,
    required this.practiceArea,
    required this.jurisdiction,
    required this.billingModel,
    required this.createdAt,
    this.channelId,
    this.client,
    this.lawyers,
    this.onRetainer,
  });

  final int id;
  final String title;
  final String description;
  final String status;
  final String practiceArea;
  final String jurisdiction;
  final String billingModel;
  final String createdAt;
  final int? channelId;
  final MiniUser? client;
  final List<MiniUser>? lawyers;
  final bool? onRetainer;

  factory Matter.fromJson(Map<String, dynamic> j) => Matter(
        id: j['id'] as int,
        title: j['title'] as String? ?? '',
        description: j['description'] as String? ?? '',
        status: j['status'] as String? ?? '',
        practiceArea: j['practice_area'] as String? ?? '',
        jurisdiction: j['jurisdiction'] as String? ?? '',
        billingModel: j['billing_model'] as String? ?? '',
        createdAt: j['created_at'] as String? ?? '',
        channelId: j['channel_id'] as int?,
        client: j['client'] != null
            ? MiniUser.fromJson(j['client'] as Map<String, dynamic>)
            : null,
        lawyers: (j['lawyers'] as List?)
            ?.map((e) => MiniUser.fromJson(e as Map<String, dynamic>))
            .toList(),
        onRetainer: j['on_retainer'] as bool?,
      );
}

class Consultation {
  Consultation({
    required this.id,
    required this.matter,
    required this.matterTitle,
    required this.scheduledTime,
    required this.durationMinutes,
    required this.mode,
    required this.modeDisplay,
    required this.status,
    required this.statusDisplay,
    required this.practiceAreas,
    required this.notes,
    required this.createdAt,
    this.lawyer,
    this.client,
    this.price,
    this.channelId,
  });
  final int id;
  final int matter;
  final String matterTitle;
  final MiniUser? lawyer;
  final MiniUser? client;
  final String scheduledTime;
  final int durationMinutes;
  final String mode;
  final String modeDisplay;
  final String status;
  final String statusDisplay;
  final List<String> practiceAreas;
  final String? price;
  final String notes;
  final int? channelId;
  final String createdAt;

  factory Consultation.fromJson(Map<String, dynamic> j) => Consultation(
        id: j['id'] as int,
        matter: j['matter'] as int,
        matterTitle: j['matter_title'] as String? ?? '',
        lawyer: j['lawyer_detail'] != null
            ? MiniUser.fromJson(j['lawyer_detail'] as Map<String, dynamic>)
            : null,
        client: j['client_detail'] != null
            ? MiniUser.fromJson(j['client_detail'] as Map<String, dynamic>)
            : null,
        scheduledTime: j['scheduled_time'] as String? ?? '',
        durationMinutes: (j['duration_minutes'] as num?)?.toInt() ?? 0,
        mode: j['mode'] as String? ?? '',
        modeDisplay: j['mode_display'] as String? ?? '',
        status: j['status'] as String? ?? '',
        statusDisplay: j['status_display'] as String? ?? '',
        practiceAreas: List<String>.from(j['practice_areas'] ?? const []),
        price: j['price'] as String?,
        notes: j['notes'] as String? ?? '',
        channelId: j['channel_id'] as int?,
        createdAt: j['created_at'] as String? ?? '',
      );
}

class Notif {
  Notif({
    required this.id,
    required this.kind,
    required this.title,
    required this.body,
    required this.link,
    required this.createdAt,
    this.readAt,
  });
  final int id;
  final String kind;
  final String title;
  final String body;
  final String link;
  final String? readAt;
  final String createdAt;

  factory Notif.fromJson(Map<String, dynamic> j) => Notif(
        id: j['id'] as int,
        kind: j['kind'] as String? ?? '',
        title: j['title'] as String? ?? '',
        body: j['body'] as String? ?? '',
        link: j['link'] as String? ?? '',
        readAt: j['read_at'] as String?,
        createdAt: j['created_at'] as String? ?? '',
      );
}

class Paginated<T> {
  Paginated({required this.count, required this.results, this.next, this.previous});
  final int count;
  final List<T> results;
  final String? next;
  final String? previous;
}

class MessageReaction {
  MessageReaction({required this.emoji, required this.count, required this.userIds});
  final String emoji;
  final int count;
  final List<int> userIds;

  factory MessageReaction.fromJson(Map<String, dynamic> j) => MessageReaction(
        emoji: j['emoji'] as String? ?? '',
        count: (j['count'] as num?)?.toInt() ?? 0,
        userIds: ((j['user_ids'] as List?) ?? const [])
            .map((e) => (e as num).toInt())
            .toList(),
      );
}

class Message {
  Message({
    required this.id,
    required this.channel,
    required this.sender,
    required this.content,
    required this.createdAt,
    this.kind,
    this.parent,
    this.replyCount,
    this.reactions,
  });
  final int id;
  final int channel;
  final MiniUser sender;
  final String content;
  final String createdAt;
  final String? kind;
  final int? parent;
  final int? replyCount;
  final List<MessageReaction>? reactions;

  factory Message.fromJson(Map<String, dynamic> j) => Message(
        id: j['id'] as int,
        channel: (j['channel'] as num?)?.toInt() ?? 0,
        sender: MiniUser.fromJson(j['sender'] as Map<String, dynamic>),
        content: j['content'] as String? ?? '',
        kind: j['kind'] as String?,
        parent: (j['parent'] as num?)?.toInt(),
        replyCount: (j['reply_count'] as num?)?.toInt(),
        reactions: (j['reactions'] as List?)
            ?.map((e) => MessageReaction.fromJson(e as Map<String, dynamic>))
            .toList(),
        createdAt: j['created_at'] as String? ?? '',
      );
}

class DocumentItem {
  DocumentItem({
    required this.id,
    required this.matter,
    required this.title,
    required this.kind,
    required this.body,
    required this.version,
    required this.createdAt,
    this.uploaderDetail,
    this.fileUrl,
  });
  final int id;
  final int matter;
  final MiniUser? uploaderDetail;
  final String title;
  final String kind; // 'document' | 'draft'
  final String? fileUrl;
  final String body;
  final int version;
  final String createdAt;

  factory DocumentItem.fromJson(Map<String, dynamic> j) => DocumentItem(
        id: j['id'] as int,
        matter: (j['matter'] as num?)?.toInt() ?? 0,
        uploaderDetail: j['uploader_detail'] != null
            ? MiniUser.fromJson(j['uploader_detail'] as Map<String, dynamic>)
            : null,
        title: j['title'] as String? ?? '',
        kind: j['kind'] as String? ?? 'document',
        fileUrl: j['file_url'] as String?,
        body: j['body'] as String? ?? '',
        version: (j['version'] as num?)?.toInt() ?? 1,
        createdAt: j['created_at'] as String? ?? '',
      );
}

class PaymentReceipt {
  PaymentReceipt({
    required this.id,
    required this.amount,
    required this.status,
    required this.statusDisplay,
    required this.reference,
    required this.createdAt,
    this.proofUrl,
  });
  final int id;
  final String amount;
  final String status;
  final String statusDisplay;
  final String reference;
  final String? proofUrl;
  final String createdAt;

  factory PaymentReceipt.fromJson(Map<String, dynamic> j) => PaymentReceipt(
        id: j['id'] as int,
        amount: '${j['amount'] ?? '0'}',
        status: j['status'] as String? ?? '',
        statusDisplay: j['status_display'] as String? ?? '',
        reference: j['reference'] as String? ?? '',
        proofUrl: j['proof_of_payment_url'] as String?,
        createdAt: j['created_at'] as String? ?? '',
      );
}

class Payment {
  Payment({
    required this.id,
    required this.matter,
    required this.amount,
    required this.currency,
    required this.provider,
    required this.purpose,
    required this.reference,
    required this.status,
    required this.statusDisplay,
    required this.createdAt,
    this.proofOfPaymentUrl,
    this.receipts,
    this.totalPaid,
    this.outstandingAmount,
  });
  final int id;
  final int matter;
  final String amount;
  final String currency;
  final String provider;
  final String purpose;
  final String reference;
  final String status;
  final String statusDisplay;
  final String? proofOfPaymentUrl;
  final List<PaymentReceipt>? receipts;
  final String? totalPaid;
  final String? outstandingAmount;
  final String createdAt;

  factory Payment.fromJson(Map<String, dynamic> j) => Payment(
        id: j['id'] as int,
        matter: (j['matter'] as num?)?.toInt() ?? 0,
        amount: '${j['amount'] ?? '0'}',
        currency: j['currency'] as String? ?? 'USD',
        provider: j['provider'] as String? ?? '',
        purpose: j['purpose'] as String? ?? '',
        reference: j['reference'] as String? ?? '',
        status: j['status'] as String? ?? '',
        statusDisplay: j['status_display'] as String? ?? '',
        proofOfPaymentUrl: j['proof_of_payment_url'] as String?,
        receipts: (j['receipts'] as List?)
            ?.map((e) => PaymentReceipt.fromJson(e as Map<String, dynamic>))
            .toList(),
        totalPaid: j['total_paid']?.toString(),
        outstandingAmount: j['outstanding_amount']?.toString(),
        createdAt: j['created_at'] as String? ?? '',
      );
}

class TimeEntry {
  TimeEntry({
    required this.id,
    required this.matter,
    required this.matterTitle,
    required this.description,
    required this.startedAt,
    required this.minutes,
    required this.isBillable,
    required this.isRunning,
    this.clientDetail,
    this.lawyerDetail,
    this.endedAt,
    this.amount,
    this.invoice,
  });
  final int id;
  final int matter;
  final String matterTitle;
  final MiniUser? clientDetail;
  final MiniUser? lawyerDetail;
  final String description;
  final String startedAt;
  final String? endedAt;
  final int minutes;
  final String? amount;
  final bool isBillable;
  final bool isRunning;
  final int? invoice;

  factory TimeEntry.fromJson(Map<String, dynamic> j) => TimeEntry(
        id: j['id'] as int,
        matter: (j['matter'] as num?)?.toInt() ?? 0,
        matterTitle: j['matter_title'] as String? ?? '',
        clientDetail: j['client_detail'] != null
            ? MiniUser.fromJson(j['client_detail'] as Map<String, dynamic>)
            : null,
        lawyerDetail: j['lawyer_detail'] != null
            ? MiniUser.fromJson(j['lawyer_detail'] as Map<String, dynamic>)
            : null,
        description: j['description'] as String? ?? '',
        startedAt: j['started_at'] as String? ?? '',
        endedAt: j['ended_at'] as String?,
        minutes: (j['minutes'] as num?)?.toInt() ?? 0,
        amount: j['amount']?.toString(),
        isBillable: j['is_billable'] as bool? ?? true,
        isRunning: j['is_running'] as bool? ?? false,
        invoice: (j['invoice'] as num?)?.toInt(),
      );
}

class Review {
  Review({
    required this.id,
    required this.matter,
    required this.rating,
    required this.body,
    required this.createdAt,
    this.authorDetail,
  });
  final int id;
  final int matter;
  final int rating;
  final String body;
  final MiniUser? authorDetail;
  final String createdAt;

  factory Review.fromJson(Map<String, dynamic> j) => Review(
        id: j['id'] as int,
        matter: (j['matter'] as num?)?.toInt() ?? 0,
        rating: (j['rating'] as num?)?.toInt() ?? 0,
        body: j['body'] as String? ?? '',
        authorDetail: j['author_detail'] != null
            ? MiniUser.fromJson(j['author_detail'] as Map<String, dynamic>)
            : null,
        createdAt: j['created_at'] as String? ?? '',
      );
}
