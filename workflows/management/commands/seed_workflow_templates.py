from django.core.management.base import BaseCommand

from workflows.models import LLMProvider, WorkflowTemplate


# Stage shape follows the spec in attorney-legal-workflows-module.pdf.
# Each entry becomes one WorkflowStage row at instantiation.
def _stages(extra=None):
    base = [
        {
            'slug': 'intake',
            'title': 'Intake',
            'purpose': 'Capture facts into a structured matrix.',
            'retrieval_scope': 'none',
            'default_provider': LLMProvider.ANTHROPIC,
            'default_model': '',
            'prompt_template': (
                'Read the supplied client narrative and produce a fact matrix:\n'
                '- parties\n- dates\n- causes of action\n- limitation / jurisdiction flags\n'
                'Output only facts grounded in the narrative.'
            ),
        },
        {
            'slug': 'issue-spotting',
            'title': 'Issue-spotting',
            'purpose': 'Map issues, causes of action, limitation/jurisdiction flags from facts.',
            'retrieval_scope': 'matter_docs',
            'default_provider': LLMProvider.ANTHROPIC,
            'default_model': '',
            'prompt_template': (
                'From the approved fact matrix only, list each legal issue with the cause of '
                'action it raises and any limitation, jurisdiction or service-of-process '
                'risk. Do not assert authority from memory.'
            ),
        },
        {
            'slug': 'research',
            'title': 'Research',
            'purpose': 'Find and reason over authority — RAG-grounded.',
            'retrieval_scope': 'zimlii_statutes_rules_precedents',
            'default_provider': LLMProvider.OPENAI,  # tool/browsing-strong by default
            'default_model': '',
            'prompt_template': (
                'For each issue, reason ONLY over the retrieved authority. Cite by case name '
                'or section reference; never assert a holding without a supporting chunk.'
            ),
        },
        {
            'slug': 'skeleton',
            'title': 'Skeleton',
            'purpose': 'Produce structure before prose.',
            'retrieval_scope': 'research_outputs',
            'default_provider': LLMProvider.ANTHROPIC,
            'default_model': '',
            'prompt_template': (
                'Produce a paragraph-by-paragraph outline. Each paragraph: heading, claim, '
                'authority placeholder. No prose yet.'
            ),
        },
        {
            'slug': 'draft',
            'title': 'Draft',
            'purpose': 'Fill sections from the approved skeleton.',
            'retrieval_scope': 'matter_precedents',
            'default_provider': LLMProvider.ANTHROPIC,
            'default_model': '',
            'prompt_template': (
                'Draft each section in formal Zimbabwean court register. Stay within the '
                'skeleton; do not introduce new issues. Mark every authority with a [cite] '
                'placeholder.'
            ),
        },
        {
            'slug': 'verify',
            'title': 'Verify',
            'purpose': 'Check every citation and averment.',
            'retrieval_scope': 'full_corpus',
            'default_provider': LLMProvider.OPENAI,
            'default_model': '',
            'prompt_template': (
                'For every [cite] in the draft, verify the citation against the retrieved '
                'corpus. Mark UNVERIFIED for anything not traceable to a chunk.'
            ),
        },
        {
            'slug': 'finalise',
            'title': 'Finalise',
            'purpose': 'Assemble court-ready document.',
            'retrieval_scope': 'none',
            'default_provider': LLMProvider.ANTHROPIC,
            'default_model': '',
            'prompt_template': (
                'Assemble approved blocks into a court-ready document with proper heading, '
                'case number, jurisdiction and deponent details.'
            ),
        },
    ]
    return base + (extra or [])


TEMPLATES = [
    {
        'slug': 'spoliation-application',
        'name': 'Spoliation Application',
        'matter_type': 'application',
        'description': (
            'Urgent mandament van spolie application — restore peaceful possession. '
            'Skeleton-first drafting with citation verification on the founding affidavit.'
        ),
        'stages': _stages(),
    },
    {
        'slug': 'conveyancing-transfer',
        'name': 'Conveyancing Transfer',
        'matter_type': 'conveyancing',
        'description': (
            'Property transfer pipeline: instruction, search, drafting of transfer documents, '
            'verification of deeds-office requirements, and finalisation.'
        ),
        'stages': _stages(),
    },
    {
        'slug': 'answering-affidavit',
        'name': 'Answering Affidavit',
        'matter_type': 'opposition',
        'description': (
            'Paragraph-by-paragraph response to a founding affidavit. The skeleton stage '
            'maps each answering paragraph to the founding paragraph it answers.'
        ),
        'stages': _stages(),
    },
]


class Command(BaseCommand):
    help = 'Seed the built-in AI workflow templates.'

    def handle(self, *args, **options):
        for data in TEMPLATES:
            tmpl, created = WorkflowTemplate.objects.update_or_create(
                slug=data['slug'],
                defaults={
                    'name': data['name'],
                    'description': data['description'],
                    'matter_type': data['matter_type'],
                    'stages': data['stages'],
                    'is_active': True,
                },
            )
            self.stdout.write(
                self.style.SUCCESS(f'{"Created" if created else "Updated"}: {tmpl.name}')
            )
