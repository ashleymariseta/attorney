from rest_framework import serializers

from .models import (
    LLMProvider,
    LLMProviderConfig,
    StageResult,
    StageStatus,
    Workflow,
    WorkflowStage,
    WorkflowStatus,
    WorkflowTemplate,
)


class WorkflowTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = WorkflowTemplate
        fields = ['id', 'slug', 'name', 'description', 'matter_type', 'stages', 'is_active', 'created_at']
        read_only_fields = ['created_at']


class StageResultSerializer(serializers.ModelSerializer):
    class Meta:
        model = StageResult
        fields = [
            'id', 'provider', 'model', 'system_prompt', 'user_prompt', 'output_text',
            'retrieval_chunk_ids', 'tokens_in', 'tokens_out', 'error', 'created_at',
        ]
        read_only_fields = fields


class WorkflowStageSerializer(serializers.ModelSerializer):
    latest_result = serializers.SerializerMethodField()
    provider_display = serializers.CharField(source='get_provider_display', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = WorkflowStage
        fields = [
            'id', 'slug', 'title', 'purpose', 'retrieval_scope',
            'prompt_template', 'prompt_template_version',
            'provider', 'provider_display', 'model', 'order',
            'status', 'status_display', 'approved_by', 'approved_at',
            'latest_result',
        ]
        read_only_fields = ['approved_by', 'approved_at']

    def get_latest_result(self, obj):
        latest = obj.results.first()
        return StageResultSerializer(latest).data if latest else None


class WorkflowListSerializer(serializers.ModelSerializer):
    template_name = serializers.CharField(source='template.name', read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    stage_count = serializers.SerializerMethodField()
    approved_count = serializers.SerializerMethodField()

    class Meta:
        model = Workflow
        fields = [
            'id', 'name', 'status', 'status_display', 'template', 'template_name',
            'matter', 'stage_count', 'approved_count', 'created_at', 'updated_at',
        ]

    def get_stage_count(self, obj):
        return obj.stages.count()

    def get_approved_count(self, obj):
        return obj.stages.filter(status=StageStatus.APPROVED).count()


class WorkflowDetailSerializer(WorkflowListSerializer):
    stages = WorkflowStageSerializer(many=True, read_only=True)

    class Meta(WorkflowListSerializer.Meta):
        fields = WorkflowListSerializer.Meta.fields + ['stages']


class WorkflowCreateSerializer(serializers.Serializer):
    """Create a new workflow from a template, snapshotting its stages."""

    template = serializers.PrimaryKeyRelatedField(queryset=WorkflowTemplate.objects.all())
    name = serializers.CharField(max_length=200)
    matter = serializers.IntegerField(required=False, allow_null=True)

    def create(self, validated_data):
        owner = self.context['request'].user
        template = validated_data['template']
        matter_id = validated_data.get('matter')
        wf = Workflow.objects.create(
            owner=owner,
            template=template,
            matter_id=matter_id,
            name=validated_data['name'],
            status=WorkflowStatus.ACTIVE,
        )
        for idx, stage_def in enumerate(template.stages or []):
            WorkflowStage.objects.create(
                workflow=wf,
                slug=stage_def.get('slug', f'stage-{idx + 1}'),
                title=stage_def.get('title', f'Stage {idx + 1}'),
                purpose=stage_def.get('purpose', ''),
                retrieval_scope=stage_def.get('retrieval_scope', ''),
                prompt_template=stage_def.get('prompt_template', ''),
                provider=stage_def.get('default_provider') or LLMProvider.ANTHROPIC,
                model=stage_def.get('default_model', ''),
                order=idx,
                status=StageStatus.PENDING,
            )
        return wf


class LLMProviderConfigSerializer(serializers.ModelSerializer):
    provider_display = serializers.CharField(source='get_provider_display', read_only=True)
    has_api_key = serializers.SerializerMethodField()

    class Meta:
        model = LLMProviderConfig
        fields = [
            'id', 'provider', 'provider_display', 'label', 'api_key',
            'base_url', 'default_model', 'is_default', 'has_api_key',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']
        extra_kwargs = {
            # Never echo the saved key back in list/get responses.
            'api_key': {'write_only': True, 'required': False, 'allow_blank': True},
        }

    def get_has_api_key(self, obj):
        return bool(obj.api_key)
