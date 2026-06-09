from django.contrib import admin

from .models import (
    LLMProviderConfig,
    StageResult,
    Workflow,
    WorkflowStage,
    WorkflowTemplate,
)


@admin.register(WorkflowTemplate)
class WorkflowTemplateAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug', 'matter_type', 'is_active', 'created_at')
    list_filter = ('is_active', 'matter_type')
    search_fields = ('name', 'slug', 'matter_type')


@admin.register(Workflow)
class WorkflowAdmin(admin.ModelAdmin):
    list_display = ('name', 'owner', 'template', 'matter', 'status', 'created_at')
    list_filter = ('status',)
    search_fields = ('name', 'owner__email', 'template__name')


@admin.register(WorkflowStage)
class WorkflowStageAdmin(admin.ModelAdmin):
    list_display = ('workflow', 'order', 'title', 'provider', 'status', 'approved_at')
    list_filter = ('status', 'provider')
    search_fields = ('workflow__name', 'title')


@admin.register(StageResult)
class StageResultAdmin(admin.ModelAdmin):
    list_display = ('stage', 'provider', 'model', 'tokens_in', 'tokens_out', 'created_at')
    list_filter = ('provider',)
    search_fields = ('stage__workflow__name', 'stage__title')


@admin.register(LLMProviderConfig)
class LLMProviderConfigAdmin(admin.ModelAdmin):
    list_display = ('owner', 'provider', 'label', 'default_model', 'is_default', 'updated_at')
    list_filter = ('provider', 'is_default')
    search_fields = ('owner__email', 'label')
