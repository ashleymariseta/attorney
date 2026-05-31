from django.urls import include, path
from rest_framework.routers import DefaultRouter
from .views import (
    RegisterAPIView,
    UserViewSet,
    MyLawyerProfileView,
    LawyerViewSet,
    FirmViewSet,
    JoinFirmView,
    MatterViewSet,
    ChannelViewSet,
    MessageViewSet,
    ConsultationViewSet,
    RetainerViewSet,
    DocumentViewSet,
    PaymentAccountViewSet,
    ReviewViewSet,
    TimeEntryViewSet,
    TrustTransactionViewSet,
    TransactionsView,
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
    path('me/firm/', JoinFirmView.as_view(), name='me-firm'),
    path('transactions/', TransactionsView.as_view(), name='transactions'),
    path('auth/token/', CustomTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('auth/token/refresh/', CustomTokenRefreshView.as_view(), name='token_refresh'),
    path('auth/logout/', LogoutView.as_view(), name='logout'),
]
