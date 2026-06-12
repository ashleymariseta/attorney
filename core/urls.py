from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import (
    AcceptInviteView,
    ConfirmEmailVerifyView,
    ConfirmPasswordResetView,
    DeleteMyAccountView,
    ExportMyDataView,
    RequestEmailVerifyView,
    RequestPasswordResetView,
    TwoFactorConfirmSetupView,
    TwoFactorDisableView,
    TwoFactorSetupView,
    TwoFactorVerifyView,
    RegisterAPIView,
    UserViewSet,
    MyClientProfileView,
    MyLawyerProfileView,
    LawyerViewSet,
    FirmViewSet,
    JoinFirmView,
    MatterViewSet,
    ChannelViewSet,
    MessageViewSet,
    ConsultationViewSet,
    NotificationViewSet,
    PromoteFirmAdminView,
    RetainerViewSet,
    DocumentViewSet,
    PaymentAccountViewSet,
    ReviewViewSet,
    TimeEntryViewSet,
    TrustTransactionViewSet,
    LawyerClientDetailView,
    TransactionsView,
    TransactionsExportView,
    CustomTokenObtainPairView,
    CustomTokenRefreshView,
    LogoutView,
)

router = DefaultRouter()
router.register('users', UserViewSet, basename='user')
router.register('register', RegisterAPIView, basename='register')
router.register('lawyers', LawyerViewSet, basename='lawyer')
router.register('firms', FirmViewSet, basename='firm')
router.register('payment-accounts', PaymentAccountViewSet, basename='paymentaccount')
router.register('notifications', NotificationViewSet, basename='notification')
router.register('matters', MatterViewSet, basename='matter')
router.register('channels', ChannelViewSet, basename='channel')
router.register('messages', MessageViewSet, basename='message')
router.register('consultations', ConsultationViewSet, basename='consultation')
router.register('retainers', RetainerViewSet, basename='retainer')
router.register('documents', DocumentViewSet, basename='document')
router.register('reviews', ReviewViewSet, basename='review')
router.register('time-entries', TimeEntryViewSet, basename='timeentry')
router.register('trust-transactions', TrustTransactionViewSet, basename='trusttransaction')

urlpatterns = [
    path('', include(router.urls)),
    path('me/lawyer-profile/', MyLawyerProfileView.as_view(), name='my-lawyer-profile'),
    path('me/client-profile/', MyClientProfileView.as_view(), name='my-client-profile'),
    path('me/firm/', JoinFirmView.as_view(), name='me-firm'),
    path('firms/<int:pk>/admin/', PromoteFirmAdminView.as_view(), name='firm-promote-admin'),
    path('auth/accept-invite/', AcceptInviteView.as_view(), name='accept-invite'),
    path('auth/password-reset/', RequestPasswordResetView.as_view(), name='password-reset'),
    path('auth/password-reset/confirm/', ConfirmPasswordResetView.as_view(), name='password-reset-confirm'),
    path('auth/email-verify/request/', RequestEmailVerifyView.as_view(), name='email-verify-request'),
    path('auth/email-verify/confirm/', ConfirmEmailVerifyView.as_view(), name='email-verify-confirm'),
    path('auth/2fa/setup/', TwoFactorSetupView.as_view(), name='2fa-setup'),
    path('auth/2fa/setup/confirm/', TwoFactorConfirmSetupView.as_view(), name='2fa-setup-confirm'),
    path('auth/2fa/disable/', TwoFactorDisableView.as_view(), name='2fa-disable'),
    path('auth/2fa/verify/', TwoFactorVerifyView.as_view(), name='2fa-verify'),
    path('me/export/', ExportMyDataView.as_view(), name='me-export'),
    path('me/delete/', DeleteMyAccountView.as_view(), name='me-delete'),
    path('transactions/', TransactionsView.as_view(), name='transactions'),
    path('transactions/export.csv', TransactionsExportView.as_view(), name='transactions-export'),
    path('lawyer-clients/<int:client_id>/', LawyerClientDetailView.as_view(), name='lawyer-client-detail'),
    path('auth/token/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('auth/token/refresh/', CustomTokenRefreshView.as_view(), name='token_refresh'),
    path('auth/logout/', LogoutView.as_view(), name='logout'),
]
