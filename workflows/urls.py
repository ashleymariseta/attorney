from rest_framework.routers import DefaultRouter

from .views import (
    LLMProviderConfigViewSet,
    LLMUsageAdminView,
    WorkflowStageViewSet,
    WorkflowTemplateViewSet,
    WorkflowViewSet,
)


router = DefaultRouter()
router.register(r'workflow-templates', WorkflowTemplateViewSet, basename='workflow-template')
router.register(r'workflows', WorkflowViewSet, basename='workflow')
router.register(r'workflow-stages', WorkflowStageViewSet, basename='workflow-stage')
router.register(r'llm-providers', LLMProviderConfigViewSet, basename='llm-provider')
router.register(r'llm-usage', LLMUsageAdminView, basename='llm-usage')

urlpatterns = router.urls
