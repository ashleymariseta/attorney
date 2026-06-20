from rest_framework.routers import DefaultRouter

from .views import (
    AICreditAccountView,
    AICreditOrderViewSet,
    AICreditPlanViewSet,
    LLMUsageAdminView,
    PrecedentTemplateViewSet,
    WorkflowDocumentViewSet,
    WorkflowStageViewSet,
    WorkflowTemplateViewSet,
    WorkflowViewSet,
)


router = DefaultRouter()
router.register(r'workflow-templates', WorkflowTemplateViewSet, basename='workflow-template')
router.register(r'workflows', WorkflowViewSet, basename='workflow')
router.register(r'workflow-stages', WorkflowStageViewSet, basename='workflow-stage')
router.register(r'llm-usage', LLMUsageAdminView, basename='llm-usage')
router.register(r'ai-credit-plans', AICreditPlanViewSet, basename='ai-credit-plan')
router.register(r'ai-credit-orders', AICreditOrderViewSet, basename='ai-credit-order')
router.register(r'ai-credit-account', AICreditAccountView, basename='ai-credit-account')
router.register(r'precedents', PrecedentTemplateViewSet, basename='precedent')
router.register(r'workflow-documents', WorkflowDocumentViewSet, basename='workflow-document')

urlpatterns = router.urls
