// Minimal typed API client. Calls hit the Django backend directly; CORS is
// configured server-side for the frontend origin. Override the host with
// NEXT_PUBLIC_API_BASE when deploying behind a different domain.

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://127.0.0.1:8000';

const ACCESS_KEY = 'attorney.access';
const REFRESH_KEY = 'attorney.refresh';

export function getAccess(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(ACCESS_KEY);
}
export function getRefresh(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(REFRESH_KEY);
}
export function setTokens(access: string, refresh: string) {
  window.localStorage.setItem(ACCESS_KEY, access);
  window.localStorage.setItem(REFRESH_KEY, refresh);
}
export function clearTokens() {
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(REFRESH_KEY);
}
export function isAuthed(): boolean {
  return !!getAccess();
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function describe(body: unknown): string {
  if (!body || typeof body !== 'object') return 'Request failed';
  const obj = body as Record<string, unknown>;
  if (typeof obj.detail === 'string') return obj.detail;
  // Surface the first field error (e.g. {"amount": ["Must be > 0"]}).
  const first = Object.entries(obj)[0];
  if (first) {
    const [field, val] = first;
    const msg = Array.isArray(val) ? val[0] : val;
    return `${field}: ${msg}`;
  }
  return 'Request failed';
}

// In-flight refresh promise so concurrent requests that all hit 401 only
// trigger ONE refresh roundtrip and then retry in parallel.
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refresh = getRefresh();
  if (!refresh) return null;
  try {
    const res = await fetch(`${API_BASE}/api/v1/auth/token/refresh/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh }),
    });
    if (!res.ok) {
      clearTokens();
      return null;
    }
    const data = (await res.json()) as { access?: string; refresh?: string };
    if (!data.access) {
      clearTokens();
      return null;
    }
    // SimpleJWT can be configured to rotate refresh tokens; honor it.
    window.localStorage.setItem(ACCESS_KEY, data.access);
    if (data.refresh) window.localStorage.setItem(REFRESH_KEY, data.refresh);
    return data.access;
  } catch {
    return null;
  }
}

function shouldTryRefresh(body: unknown): boolean {
  // SimpleJWT returns one of these codes on an expired/invalid access token.
  if (!body || typeof body !== 'object') return true;
  const code = (body as { code?: string }).code;
  return code === 'token_not_valid' || code === undefined;
}

export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
  { auth = true, _retried = false }: { auth?: boolean; _retried?: boolean } = {}
): Promise<T> {
  const headers = new Headers(options.headers);
  const isForm = options.body instanceof FormData;
  if (!isForm && options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (auth) {
    const token = getAccess();
    if (token) headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 204 || res.status === 205) return undefined as T;

  const text = await res.text();
  const body = text ? JSON.parse(text) : null;

  if (res.status === 401 && auth && !_retried && shouldTryRefresh(body) && getRefresh()) {
    // Re-using a single in-flight refresh promise across concurrent failures.
    refreshInFlight = refreshInFlight ?? refreshAccessToken();
    const fresh = await refreshInFlight;
    refreshInFlight = null;
    if (fresh) {
      return api<T>(path, options, { auth, _retried: true });
    }
  }

  if (!res.ok) {
    throw new ApiError(res.status, body, describe(body));
  }
  return body as T;
}

// ---- Domain types ----
export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  phone_number?: string;
  whatsapp_number?: string;
  role: string;
  is_verified: boolean;
  is_staff?: boolean;
  email_verified?: boolean;
  two_factor_method?: 'off' | 'email' | 'whatsapp';
  avatar_url?: string | null;
}
export interface MiniUser {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  role: string;
  avatar_url?: string | null;
}
export interface Matter {
  id: number;
  title: string;
  description: string;
  status: string;
  practice_area: string;
  jurisdiction: string;
  billing_model: string;
  created_at: string;
  channel_id: number | null;
  client?: MiniUser;
  lawyers?: MiniUser[];
  on_retainer?: boolean;
  consultation_id?: number | null;
  consultation?: Consultation | null;
  payment_id?: number | null;
}
export interface LawyerProfile {
  bar_number: string;
  country: string;
  jurisdictions: string[];
  practice_areas: string[];
  languages: string[];
  years_experience: number;
  hourly_rate: string | null;
  consultation_price: string | null;
  bio: string;
}
export interface Lawyer {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  is_verified: boolean;
  profile: LawyerProfile | null;
  on_retainer: boolean;
  hourly_rate: string | null;
  country: string;
  avg_rating: number | null;
  review_count: number;
}
export interface Consultation {
  id: number;
  matter: number;
  matter_title: string;
  lawyer_detail: MiniUser | null;
  client_detail: MiniUser | null;
  scheduled_time: string;
  duration_minutes: number;
  mode: string;
  mode_display: string;
  payment_method: string;
  practice_areas: string[];
  status: string;
  status_display: string;
  price: string | null;
  rate_snapshot: string | null;
  notes: string;
  confirmed_at: string | null;
  channel_id: number | null;
  created_at: string;
}
export interface Review {
  id: number;
  matter: number;
  rating: number;
  body: string;
  author_detail: MiniUser;
  created_at: string;
}
export interface TimeEntry {
  id: number;
  matter: number;
  matter_title: string;
  client_detail: MiniUser | null;
  lawyer_detail: MiniUser | null;
  description: string;
  started_at: string;
  ended_at: string | null;
  minutes: number;
  amount: string | null;
  rate_snapshot: string | null;
  is_billable: boolean;
  is_running: boolean;
  invoice: number | null;
}
export interface Transaction {
  id: string;
  kind: 'payment' | 'trust';
  matter: number;
  matter_title: string;
  label: string;
  amount: string;
  currency: string;
  status: string;
  status_display: string;
  created_at: string;
  payment_id?: number;
  purpose?: string;
  payer_id?: number;
  has_proof?: boolean;
  proof_of_payment_url?: string | null;
  total_paid?: string;
  outstanding_amount?: string;
  can_review?: boolean;
  note?: string;
  review_note?: string;
}
export interface LawyerProfileEdit {
  bar_number: string;
  practising_certificate_number: string;
  practising_certificate_expires: string | null;
  practising_certificate_file_url: string | null;
  country: string;
  jurisdictions: string[];
  practice_areas: string[];
  languages: string[];
  years_experience: number;
  /** Auto-derived from the LawyerRateTier table — read-only on the API. */
  hourly_rate: string | null;
  hourly_rate_min: string | null;
  hourly_rate_max: string | null;
  consultation_price: string | null;
  bio: string;
  firm: number | null;
  firm_detail: { id: number; name: string; slug: string; website: string; verified: boolean } | null;
}

export interface FirmCard {
  id: number;
  name: string;
  slug: string;
  website: string;
  description?: string;
  admin?: number | null;
  default_hourly_rate?: string | null;
  default_consultation_price?: string | null;
  verified: boolean;
  country: string;
  lawyer_count: number;
  practice_areas: string[];
  jurisdictions: string[];
  starting_rate: string | null;
}

export interface PaymentAccount {
  id: number;
  account_type: 'ecocash' | 'onemoney' | 'bank' | 'innbucks' | 'omari' | 'cash' | string;
  account_type_display: string;
  identifier: string;
  account_name: string;
  bank_name: string;
  branch: string;
  swift_code: string;
  notes: string;
  is_active: boolean;
  owner_user: number | null;
  owner_firm: number | null;
  created_at: string;
  updated_at: string;
}
export interface Retainer {
  id: number;
  lawyer_detail: MiniUser;
  client_detail: MiniUser;
  plan_name: string;
  cycle: string;
  monthly_fee: string | null;
  included_hours: number;
  status: string;
  created_at: string;
}
export interface Message {
  id: number;
  channel: number;
  sender: MiniUser;
  content: string;
  kind?: 'regular' | 'milestone';
  created_at: string;
  parent?: number | null;
  reply_count?: number;
  reactions?: { emoji: string; count: number; user_ids: number[] }[];
}
export interface DocumentItem {
  id: number;
  matter: number;
  uploader_detail: MiniUser | null;
  title: string;
  kind: 'document' | 'draft';
  file_url: string | null;
  body: string;
  version: number;
  created_at: string;
  signed_by?: number | null;
  signed_by_detail?: MiniUser | null;
  signed_at?: string | null;
  signature_data?: string;
}
export interface PaymentReceiptItem {
  id: number;
  payment: number;
  amount: string;
  reference: string;
  note: string;
  status: 'pending_review' | 'partial' | 'verified' | 'rejected' | 'failed' | string;
  status_display: string;
  review_note: string;
  submitted_by: number | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
  proof_of_payment_url: string | null;
  created_at: string;
}

export interface Payment {
  id: number;
  matter: number;
  amount: string;
  currency: string;
  provider: string;
  purpose: string;
  reference: string;
  status: string;
  status_display: string;
  proof_of_payment_url: string | null;
  receipts?: PaymentReceiptItem[];
  total_paid?: string;
  total_pending?: string;
  outstanding_amount?: string;
  created_at: string;
}
export interface Paginated<T> {
  count: number;
  results: T[];
}

// ---- Endpoints ----
export const auth = {
  async register(payload: {
    email: string;
    password: string;
    first_name: string;
    last_name: string;
    role: string;
  }) {
    return api('/api/v1/register/', { method: 'POST', body: JSON.stringify(payload) }, { auth: false });
  },
  async login(email: string, password: string) {
    // Login either returns tokens directly OR a 2FA challenge — callers must
    // check `requires_2fa` and pass the user through the verify step.
    const res = await api<
      | { access: string; refresh: string; requires_2fa?: never }
      | { requires_2fa: true; method: 'email' | 'whatsapp'; challenge_token: string; detail: string }
    >(
      '/api/v1/auth/token/',
      { method: 'POST', body: JSON.stringify({ email, password }) },
      { auth: false }
    );
    if (!('requires_2fa' in res)) {
      setTokens(res.access, res.refresh);
    }
    return res;
  },
  async verify2fa(challengeToken: string, code: string) {
    const tok = await api<{ access: string; refresh: string }>(
      '/api/v1/auth/2fa/verify/',
      { method: 'POST', body: JSON.stringify({ challenge_token: challengeToken, code }) },
      { auth: false }
    );
    setTokens(tok.access, tok.refresh);
    return tok;
  },
  async logout() {
    const refresh = getRefresh();
    try {
      if (refresh) await api('/api/v1/auth/logout/', { method: 'POST', body: JSON.stringify({ refresh }) });
    } finally {
      clearTokens();
    }
  },
  me() {
    return api<User>('/api/v1/users/me/');
  },
};

export const matters = {
  list() {
    return api<Paginated<Matter>>('/api/v1/matters/');
  },
  get(id: number) {
    return api<Matter>(`/api/v1/matters/${id}/`);
  },
  create(payload: {
    title: string;
    lawyer: number;
    description?: string;
    practice_areas?: string[];
    jurisdiction?: string;
    scheduled_time?: string | null;
    duration_minutes?: number;
    consult_method?: string;
    payment_method?: string;
  }) {
    return api<Matter>('/api/v1/matters/', { method: 'POST', body: JSON.stringify(payload) });
  },
  lawyerClients() {
    return api<{ count: number; results: LawyerClient[] }>('/api/v1/matters/lawyer-clients/');
  },
  createForClient(payload: {
    title: string;
    description?: string;
    practice_area?: string;
    client_id?: number;
    contact?: { first_name: string; last_name: string; email?: string; phone_number?: string };
  }) {
    return api<Matter & { invited?: boolean; client_email?: string }>(
      '/api/v1/matters/create-for-client/',
      { method: 'POST', body: JSON.stringify(payload) }
    );
  },
};

export const consultations = {
  list() {
    return api<Paginated<Consultation>>('/api/v1/consultations/');
  },
  get(id: number) {
    return api<Consultation>(`/api/v1/consultations/${id}/`);
  },
  confirm(id: number) {
    return api<Consultation>(`/api/v1/consultations/${id}/confirm/`, { method: 'POST' });
  },
  cancel(id: number) {
    return api<Consultation>(`/api/v1/consultations/${id}/cancel/`, { method: 'POST' });
  },
  complete(id: number) {
    return api<Consultation>(`/api/v1/consultations/${id}/complete/`, { method: 'POST' });
  },
  reschedule(id: number, scheduledTime: string, note?: string) {
    return api<Consultation>(`/api/v1/consultations/${id}/reschedule/`, {
      method: 'POST',
      body: JSON.stringify({ scheduled_time: scheduledTime, note: note ?? '' }),
    });
  },
};

export const firms = {
  list() {
    return api<Paginated<FirmCard>>('/api/v1/firms/', {}, { auth: isAuthed() });
  },
  get(id: number) {
    return api<FirmCard>(`/api/v1/firms/${id}/`, {}, { auth: isAuthed() });
  },
  update(id: number, payload: Partial<FirmCard>) {
    return api<FirmCard>(`/api/v1/firms/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
  join(firmId: number) {
    return api<FirmCard>('/api/v1/me/firm/', {
      method: 'POST',
      body: JSON.stringify({ firm_id: firmId }),
    });
  },
  leave() {
    return api<void>('/api/v1/me/firm/', { method: 'DELETE' });
  },
};

export const paymentAccounts = {
  mine() {
    return api<Paginated<PaymentAccount>>('/api/v1/payment-accounts/?scope=mine');
  },
  forMatter(matterId: number) {
    return api<Paginated<PaymentAccount>>(`/api/v1/payment-accounts/?matter=${matterId}`);
  },
  create(payload: Partial<PaymentAccount>) {
    return api<PaymentAccount>('/api/v1/payment-accounts/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  update(id: number, payload: Partial<PaymentAccount>) {
    return api<PaymentAccount>(`/api/v1/payment-accounts/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
  remove(id: number) {
    return api<void>(`/api/v1/payment-accounts/${id}/`, { method: 'DELETE' });
  },
};

export const userMe = {
  uploadAvatar(file: File) {
    const form = new FormData();
    form.append('avatar', file);
    return api<User>('/api/v1/users/me/avatar/', { method: 'POST', body: form });
  },
  removeAvatar() {
    return api<User>('/api/v1/users/me/avatar/', { method: 'DELETE' });
  },
};

export interface ClientProfileEdit {
  business_name: string;
  is_business: boolean;
  id_document_type: string;
  id_document_number: string;
  id_document_file_url: string | null;
  kyc_status: string;
  kyc_status_display: string;
  kyc_submitted: boolean;
}

export const clientProfile = {
  get() {
    return api<ClientProfileEdit>('/api/v1/me/client-profile/');
  },
  update(form: FormData) {
    return api<ClientProfileEdit>('/api/v1/me/client-profile/', { method: 'PATCH', body: form });
  },
};

export interface Notif {
  id: number;
  kind: string;
  title: string;
  body: string;
  link: string;
  sent_email: boolean;
  read_at: string | null;
  created_at: string;
}

export const notifications = {
  list() {
    return api<Paginated<Notif>>('/api/v1/notifications/');
  },
  markAllRead() {
    return api<{ detail: string }>('/api/v1/notifications/mark-all-read/', { method: 'POST' });
  },
  markRead(id: number) {
    return api<Notif>(`/api/v1/notifications/${id}/mark-read/`, { method: 'POST' });
  },
};

export const auth_invite = {
  preview(token: string) {
    return api<{ email: string; first_name: string; last_name: string; phone_number: string; matter_title: string }>(
      `/api/v1/auth/accept-invite/?token=${encodeURIComponent(token)}`,
      {},
      { auth: false }
    );
  },
  accept(payload: { token: string; email?: string; password: string }) {
    return api<{ access: string; refresh: string }>(
      '/api/v1/auth/accept-invite/',
      { method: 'POST', body: JSON.stringify(payload) },
      { auth: false }
    );
  },
};

export const passwordReset = {
  request(email: string) {
    return api<{ detail: string }>(
      '/api/v1/auth/password-reset/',
      { method: 'POST', body: JSON.stringify({ email }) },
      { auth: false }
    );
  },
  confirm(payload: { uid: string; token: string; password: string }) {
    return api<{ access: string; refresh: string }>(
      '/api/v1/auth/password-reset/confirm/',
      { method: 'POST', body: JSON.stringify(payload) },
      { auth: false }
    );
  },
};

export const twoFactor = {
  setup(method: 'email' | 'whatsapp', whatsappNumber?: string) {
    return api<{ challenge_token: string; method: 'email' | 'whatsapp' }>('/api/v1/auth/2fa/setup/', {
      method: 'POST',
      body: JSON.stringify({ method, whatsapp_number: whatsappNumber }),
    });
  },
  confirmSetup(challengeToken: string, code: string) {
    return api<{ two_factor_method: 'off' | 'email' | 'whatsapp' }>('/api/v1/auth/2fa/setup/confirm/', {
      method: 'POST',
      body: JSON.stringify({ challenge_token: challengeToken, code }),
    });
  },
  disable(challengeToken: string, code: string) {
    return api<{ two_factor_method: 'off' }>('/api/v1/auth/2fa/disable/', {
      method: 'POST',
      body: JSON.stringify({ challenge_token: challengeToken, code }),
    });
  },
};

export const accountActions = {
  exportData() {
    return api<Record<string, unknown>>('/api/v1/me/export/');
  },
  deleteAccount() {
    return api<{ detail: string }>('/api/v1/me/delete/', {
      method: 'POST',
      body: JSON.stringify({ confirm: 'DELETE' }),
    });
  },
};

export const emailVerify = {
  request() {
    return api<{ detail: string }>('/api/v1/auth/email-verify/request/', { method: 'POST' });
  },
  confirm(payload: { uid: string; token: string }) {
    return api<{ detail: string }>(
      '/api/v1/auth/email-verify/confirm/',
      { method: 'POST', body: JSON.stringify(payload) },
      { auth: false }
    );
  },
};

export const firmAdmin = {
  promote(firmId: number, userId: number) {
    return api<FirmCard>(`/api/v1/firms/${firmId}/admin/`, {
      method: 'POST',
      body: JSON.stringify({ user_id: userId }),
    });
  },
};

export const reviews = {
  forLawyer(lawyerId: number) {
    return api<Paginated<Review>>(`/api/v1/reviews/?lawyer=${lawyerId}`);
  },
  forMatter(matterId: number) {
    return api<Paginated<Review>>(`/api/v1/reviews/?matter=${matterId}`);
  },
  create(matterId: number, rating: number, body: string) {
    return api<Review>('/api/v1/reviews/', {
      method: 'POST',
      body: JSON.stringify({ matter: matterId, rating, body }),
    });
  },
};

export const timeEntries = {
  forMatter(matterId: number) {
    return api<Paginated<TimeEntry>>(`/api/v1/time-entries/?matter=${matterId}`);
  },
  all() {
    return api<Paginated<TimeEntry>>('/api/v1/time-entries/');
  },
  running() {
    return api<TimeEntry | null>('/api/v1/time-entries/running/');
  },
  start(matterId: number, description = '') {
    return api<TimeEntry>('/api/v1/time-entries/start/', {
      method: 'POST',
      body: JSON.stringify({ matter: matterId, description }),
    });
  },
  stop(id: number) {
    return api<TimeEntry>(`/api/v1/time-entries/${id}/stop/`, { method: 'POST' });
  },
  log(payload: { matter: number; minutes: number; description?: string; started_at?: string; is_billable?: boolean }) {
    return api<TimeEntry>('/api/v1/time-entries/log/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};

export interface LawyerClient {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  full_name: string;
  phone_number: string;
  whatsapp_number?: string;
  avatar_url?: string | null;
  relationship: 'retainer' | 'prior_work';
  matters_count?: number;
  active_matters_count?: number;
  invoiced_total?: string;
  outstanding_total?: string;
  paid_total?: string;
  last_consultation_at?: string | null;
}

export interface ClientPayment extends Payment {
  matter_title: string;
}

export interface LawyerClientDetail {
  client: {
    id: number;
    email: string;
    first_name: string;
    last_name: string;
    full_name: string;
    phone_number: string;
    whatsapp_number?: string;
    avatar_url?: string | null;
  };
  summary: LawyerClient | null;
  matters: Matter[];
  payments: ClientPayment[];
  consultations: Consultation[];
}

export const lawyerClients = {
  detail(clientId: number) {
    return api<LawyerClientDetail>(`/api/v1/lawyer-clients/${clientId}/`);
  },
};

export const transactions = {
  list() {
    return api<{ count: number; total_escrow: string; results: Transaction[] }>('/api/v1/transactions/');
  },
  async downloadCsv() {
    const token = getAccess();
    const base = process.env.NEXT_PUBLIC_API_BASE ?? 'http://127.0.0.1:8000';
    const res = await fetch(`${base}/api/v1/transactions/export.csv`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) throw new ApiError(res.status, null, 'Could not export transactions.');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};

export const lawyerProfile = {
  get() {
    return api<LawyerProfileEdit>('/api/v1/me/lawyer-profile/');
  },
  update(payload: Partial<LawyerProfileEdit>) {
    return api<LawyerProfileEdit>('/api/v1/me/lawyer-profile/', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
  uploadCertificate(file: File) {
    const form = new FormData();
    form.append('practising_certificate_file', file);
    return api<LawyerProfileEdit>('/api/v1/me/lawyer-profile/', { method: 'PATCH', body: form });
  },
};

export const lawyers = {
  list(search = '') {
    const q = search ? `?search=${encodeURIComponent(search)}` : '';
    return api<Paginated<Lawyer>>(`/api/v1/lawyers/${q}`, {}, { auth: isAuthed() });
  },
  get(id: number) {
    return api<Lawyer>(`/api/v1/lawyers/${id}/`, {}, { auth: isAuthed() });
  },
  reviews(id: number) {
    return api<Review[]>(`/api/v1/lawyers/${id}/reviews/`, {}, { auth: isAuthed() });
  },
};

export const retainers = {
  list() {
    return api<Paginated<Retainer>>('/api/v1/retainers/');
  },
  add(lawyerId: number) {
    return api<Retainer>('/api/v1/retainers/', {
      method: 'POST',
      body: JSON.stringify({ lawyer: lawyerId }),
    });
  },
};

export const messages = {
  listForChannel(channelId: number) {
    return api<Paginated<Message>>(`/api/v1/messages/?channel=${channelId}`);
  },
  listForChannelPage(channelId: number, page = 1) {
    return api<{ count: number; next: string | null; previous: string | null; results: Message[] }>(
      `/api/v1/messages/?channel=${channelId}&page=${page}&ordering=-created_at`
    );
  },
  send(channelId: number, content: string, parent?: number, kind?: 'regular' | 'milestone') {
    const body: any = { channel: channelId, content };
    if (parent) body.parent = parent;
    if (kind && kind !== 'regular') body.kind = kind;
    return api<Message>('/api/v1/messages/', { method: 'POST', body: JSON.stringify(body) });
  },
  replies(messageId: number) {
    return api<Message[]>(`/api/v1/messages/${messageId}/replies/`);
  },
  react(messageId: number, emoji: string) {
    return api<Message>(`/api/v1/messages/${messageId}/react/`, {
      method: 'POST',
      body: JSON.stringify({ emoji }),
    });
  },
};

export const documents = {
  listForMatter(matterId: number, kind?: 'document' | 'draft') {
    const k = kind ? `&kind=${kind}` : '';
    return api<Paginated<DocumentItem>>(`/api/v1/documents/?matter=${matterId}${k}`);
  },
  createDraft(matterId: number, title: string, body: string) {
    return api<DocumentItem>('/api/v1/documents/', {
      method: 'POST',
      body: JSON.stringify({ matter: matterId, title, kind: 'draft', body }),
    });
  },
  upload(matterId: number, file: File, title: string) {
    const form = new FormData();
    form.append('matter', String(matterId));
    form.append('title', title);
    form.append('kind', 'document');
    form.append('file', file);
    return api<DocumentItem>('/api/v1/documents/', { method: 'POST', body: form });
  },
  sign(documentId: number, signatureData: string) {
    return api<DocumentItem>(`/api/v1/documents/${documentId}/sign/`, {
      method: 'POST',
      body: JSON.stringify({ signature_data: signatureData }),
    });
  },
};

// ---- Legal corpus & Co-researcher ----
export type CorpusKind = 'case' | 'judgement' | 'rules' | 'constitution' | 'statute';

export interface CorpusCollectionItem {
  id: number;
  slug: string;
  name: string;
  kind: CorpusKind;
  kind_display: string;
  description: string;
  source_url: string;
  document_count: number;
}

export interface ResearchCitationDoc {
  id: number;
  title: string;
  citation: string;
  jurisdiction: string;
  year: number | null;
  source_url: string;
  kind: CorpusKind;
  kind_display: string;
  collection_name: string;
}

export interface ResearchCitation {
  id: number;
  rank: number;
  score: number;
  document: ResearchCitationDoc;
  excerpt: string;
}

export interface ResearchQueryData {
  id: number;
  question: string;
  scope: CorpusKind[];
  answer_text: string;
  provider: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  error: string;
  created_at: string;
  citations: ResearchCitation[];
}

export const coResearcher = {
  collections() {
    return api<Paginated<CorpusCollectionItem>>('/api/v1/corpus-collections/');
  },
  ask(payload: { question: string; scope?: CorpusKind[]; provider_config_id?: number; model?: string }) {
    return api<ResearchQueryData>('/api/v1/co-researcher/ask/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  history() {
    return api<Paginated<ResearchQueryData>>('/api/v1/research-queries/');
  },
};

// ---- AI Workflows ----
export type LlmProviderId = 'anthropic' | 'openai' | 'local';

export interface WorkflowTemplate {
  id: number;
  slug: string;
  name: string;
  description: string;
  matter_type: string;
  stages: Array<{
    slug: string;
    title: string;
    purpose: string;
    retrieval_scope: string;
    default_provider: LlmProviderId;
    default_model: string;
    prompt_template: string;
  }>;
  is_active: boolean;
  created_at: string;
}

export interface StageResultData {
  id: number;
  provider: LlmProviderId;
  model: string;
  system_prompt: string;
  user_prompt: string;
  output_text: string;
  retrieval_chunk_ids: number[];
  tokens_in: number;
  tokens_out: number;
  error: string;
  created_at: string;
}

export interface WorkflowStageData {
  id: number;
  slug: string;
  title: string;
  purpose: string;
  retrieval_scope: string;
  prompt_template: string;
  prompt_template_version: number;
  provider: LlmProviderId;
  provider_display: string;
  model: string;
  order: number;
  status: 'pending' | 'in_progress' | 'awaiting_approval' | 'approved';
  status_display: string;
  approved_by: number | null;
  approved_at: string | null;
  latest_result: StageResultData | null;
}

export interface WorkflowListItem {
  id: number;
  name: string;
  status: 'active' | 'completed' | 'archived';
  status_display: string;
  template: number | null;
  template_name: string | null;
  matter: number | null;
  stage_count: number;
  approved_count: number;
  created_at: string;
  updated_at: string;
}

export interface WorkflowDetail extends WorkflowListItem {
  stages: WorkflowStageData[];
}

export interface LlmProviderConfig {
  id: number;
  provider: LlmProviderId;
  provider_display: string;
  label: string;
  base_url: string;
  default_model: string;
  is_default: boolean;
  has_api_key: boolean;
  created_at: string;
  updated_at: string;
}

export interface LlmProviderSupport {
  value: LlmProviderId;
  label: string;
  default_model: string;
  needs_api_key: boolean;
  needs_base_url: boolean;
}

export const workflows = {
  templates() {
    return api<Paginated<WorkflowTemplate>>('/api/v1/workflow-templates/');
  },
  list() {
    return api<Paginated<WorkflowListItem>>('/api/v1/workflows/');
  },
  get(id: number) {
    return api<WorkflowDetail>(`/api/v1/workflows/${id}/`);
  },
  create(payload: { template: number; name: string; matter?: number | null }) {
    return api<WorkflowDetail>('/api/v1/workflows/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  remove(id: number) {
    return api<void>(`/api/v1/workflows/${id}/`, { method: 'DELETE' });
  },
};

export const workflowStages = {
  patch(id: number, payload: Partial<WorkflowStageData>) {
    return api<WorkflowStageData>(`/api/v1/workflow-stages/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
  approve(id: number) {
    return api<WorkflowStageData>(`/api/v1/workflow-stages/${id}/approve/`, { method: 'POST' });
  },
  run(
    id: number,
    payload: { system_prompt?: string; user_prompt?: string; model?: string; provider_config_id?: number }
  ) {
    return api<StageResultData>(`/api/v1/workflow-stages/${id}/run/`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};

export interface LlmUsageRow {
  user_id: number;
  email: string;
  full_name: string;
  role: string;
  pool_tokens: number;
  byok_tokens: number;
  last_used: string | null;
  monthly_quota: number;
  rate_limit_per_minute: number;
  pool_disabled: boolean;
}

export interface LlmUsageSummary {
  month_start: string;
  defaults: { monthly_quota: number; rate_limit_per_minute: number };
  pool_configured: { anthropic: boolean; openai: boolean; local: boolean };
  results: LlmUsageRow[];
}

export const llmUsage = {
  /** Platform admin: every tenant's current-month usage. */
  list() {
    return api<LlmUsageSummary>('/api/v1/llm-usage/');
  },
  /** Caller's own current-month usage — non-admin lawyers see this. */
  me() {
    return api<LlmUsageSummary>('/api/v1/llm-usage/me/');
  },
};

export const llmProviders = {
  list() {
    return api<Paginated<LlmProviderConfig>>('/api/v1/llm-providers/');
  },
  supported() {
    return api<LlmProviderSupport[]>('/api/v1/llm-providers/supported/');
  },
  create(payload: Partial<LlmProviderConfig> & { api_key?: string }) {
    return api<LlmProviderConfig>('/api/v1/llm-providers/', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  update(id: number, payload: Partial<LlmProviderConfig> & { api_key?: string }) {
    return api<LlmProviderConfig>(`/api/v1/llm-providers/${id}/`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
  remove(id: number) {
    return api<void>(`/api/v1/llm-providers/${id}/`, { method: 'DELETE' });
  },
};

export const payments = {
  list(params?: { matter?: number; status?: string; purpose?: string }) {
    const qs = params
      ? '?' +
        new URLSearchParams(
          Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]
        ).toString()
      : '';
    return api<Paginated<Payment>>(`/api/v1/payments/${qs}`);
  },
  listForMatter(matterId: number) {
    return api<Paginated<Payment>>(`/api/v1/payments/?matter=${matterId}`);
  },
  create(payload: { matter: number; amount: string; currency: string; provider: string; purpose: string }) {
    return api<Payment>('/api/v1/payments/', { method: 'POST', body: JSON.stringify(payload) });
  },
  uploadProof(paymentId: number, file: File, reference: string, note: string, amount?: string | number) {
    const form = new FormData();
    form.append('proof_of_payment', file);
    if (amount !== undefined && amount !== null && String(amount).length > 0) {
      form.append('amount', String(amount));
    }
    if (reference) form.append('reference', reference);
    if (note) form.append('note', note);
    return api<Payment>(`/api/v1/payments/${paymentId}/upload-proof/`, { method: 'POST', body: form });
  },
  get(id: number) {
    return api<Payment>(`/api/v1/payments/${id}/`);
  },
  review(id: number, payload: { status: 'verified' | 'rejected'; review_note?: string }) {
    return api<Payment>(`/api/v1/payments/${id}/review/`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  comment(id: number, body: string) {
    return api<Payment>(`/api/v1/payments/${id}/comment/`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  },
  generateInvoice(matterId: number) {
    return api<Payment>('/api/v1/payments/generate-invoice/', {
      method: 'POST',
      body: JSON.stringify({ matter: matterId }),
    });
  },
  invoicePdfUrl(paymentId: number): string {
    const base = process.env.NEXT_PUBLIC_API_BASE ?? 'http://127.0.0.1:8000';
    return `${base}/api/v1/payments/${paymentId}/invoice-pdf/`;
  },
  async downloadInvoicePdf(paymentId: number) {
    const token = getAccess();
    const base = process.env.NEXT_PUBLIC_API_BASE ?? 'http://127.0.0.1:8000';
    const res = await fetch(`${base}/api/v1/payments/${paymentId}/invoice-pdf/`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });
    if (!res.ok) throw new ApiError(res.status, null, 'Could not download invoice.');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Invoice-INV-${String(paymentId).padStart(5, '0')}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
