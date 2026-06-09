"""Seed a minimal demo corpus across all five kinds.

Intentionally tiny — enough to make the Co-researcher demo answerable. Use
``--clear`` to wipe existing demo collections first; otherwise it upserts
by slug so re-running is safe.
"""
from django.core.management.base import BaseCommand
from django.db import transaction

from corpus.models import CorpusChunk, CorpusCollection, CorpusDocument, CorpusKind
from corpus.services import chunk_text


COLLECTIONS = [
    {
        'slug': 'constitution-zw-2013',
        'name': 'Constitution of Zimbabwe Amendment (No. 20) Act, 2013',
        'kind': CorpusKind.CONSTITUTION,
        'description': 'Supreme law of the Republic of Zimbabwe.',
        'documents': [
            {
                'title': 'Section 56 — Equality and non-discrimination',
                'citation': 'Constitution of Zimbabwe Amendment (No. 20) Act, 2013 s 56',
                'jurisdiction': 'Zimbabwe',
                'year': 2013,
                'body': (
                    'All persons are equal before the law and have the right to equal '
                    'protection and benefit of the law.\n\n'
                    'Women and men have the right to equal treatment, including the right '
                    'to equal opportunities in political, economic, cultural and social '
                    'spheres.\n\n'
                    'The State must take reasonable legislative and other measures to '
                    'promote the achievement of equality and to protect or advance people '
                    'or classes of people who have been disadvantaged by unfair '
                    'discrimination.'
                ),
            },
            {
                'title': 'Section 69 — Right to a fair hearing',
                'citation': 'Constitution of Zimbabwe Amendment (No. 20) Act, 2013 s 69',
                'jurisdiction': 'Zimbabwe',
                'year': 2013,
                'body': (
                    'Every person accused of an offence has the right to a fair and public '
                    'trial within a reasonable time before an independent and impartial '
                    'court.\n\n'
                    'In the determination of civil rights and obligations every person has '
                    'a right to a fair, speedy and public hearing within a reasonable time '
                    'before an independent and impartial court, tribunal or other forum '
                    'established by law.'
                ),
            },
        ],
    },
    {
        'slug': 'criminal-law-codification-act',
        'name': 'Criminal Law (Codification and Reform) Act [Chapter 9:23]',
        'kind': CorpusKind.STATUTE,
        'description': 'Codifies common-law offences in Zimbabwe.',
        'documents': [
            {
                'title': 'Section 4 — General principles of criminal liability',
                'citation': 'Criminal Law (Codification and Reform) Act [Chapter 9:23] s 4',
                'jurisdiction': 'Zimbabwe',
                'year': 2004,
                'body': (
                    'No person shall be guilty of a crime unless each essential element of '
                    'the crime is proved beyond a reasonable doubt.\n\n'
                    'A person shall not be liable for a crime in respect of conduct that '
                    'occurred at a time when that conduct did not constitute a crime.'
                ),
            },
        ],
    },
    {
        'slug': 'high-court-rules-2021',
        'name': 'High Court Rules, 2021 (SI 202/2021)',
        'kind': CorpusKind.RULES,
        'description': 'Procedural rules of the High Court of Zimbabwe.',
        'documents': [
            {
                'title': 'Order 32 — Urgent chamber applications',
                'citation': 'High Court Rules 2021, r 60',
                'jurisdiction': 'Zimbabwe',
                'year': 2021,
                'body': (
                    'A party seeking relief on an urgent basis must file a chamber '
                    'application supported by an affidavit setting out the reasons why the '
                    'matter is urgent and explaining the absence of substantial redress at '
                    'a hearing in due course.\n\n'
                    'The applicant must include a certificate of urgency signed by a legal '
                    'practitioner satisfying the court that the matter is genuinely urgent.'
                ),
            },
        ],
    },
    {
        'slug': 'cases-zw-spoliation',
        'name': 'Spoliation case-law digest',
        'kind': CorpusKind.CASE,
        'description': 'Leading Zimbabwean authorities on the mandament van spolie.',
        'documents': [
            {
                'title': 'Botha & Another v Barrett 1996 (2) ZLR 73 (S)',
                'citation': 'Botha & Anor v Barrett 1996 (2) ZLR 73 (S)',
                'jurisdiction': 'Zimbabwe',
                'year': 1996,
                'body': (
                    'The Supreme Court restated the requirements for the mandament van '
                    'spolie: the applicant must establish that he was in peaceful and '
                    'undisturbed possession of the thing and that he was unlawfully '
                    'deprived of such possession. The remedy is summary and concerned '
                    'solely with restoring possession; the merits of any underlying right '
                    'are not at issue at the spoliation stage.\n\n'
                    'The court emphasised that self-help is not permitted: a party who '
                    'considers himself entitled to take possession must approach the court '
                    'and not act unilaterally.'
                ),
            },
        ],
    },
    {
        'slug': 'judgements-zw-fair-hearing',
        'name': 'Fair-hearing judgements (Constitutional Court)',
        'kind': CorpusKind.JUDGEMENT,
        'description': 'Selected Constitutional Court judgements on section 69.',
        'documents': [
            {
                'title': 'S v Makwanyane-aligned reasoning — Zimbabwean adaptations',
                'citation': 'Notional digest entry',
                'jurisdiction': 'Zimbabwe',
                'year': 2017,
                'body': (
                    'In a series of judgements following the 2013 Constitution, the '
                    'Constitutional Court has emphasised that the right to a fair hearing '
                    'in section 69 includes (i) the right to be heard within a reasonable '
                    'time, (ii) the right to an independent and impartial forum, and (iii) '
                    'the right to legal representation where the interests of justice so '
                    'require.\n\n'
                    'Delay alone does not vitiate proceedings, but unreasonable delay '
                    'attributable to the State may amount to a breach of section 69 and '
                    'justify a permanent stay.'
                ),
            },
        ],
    },
]


class Command(BaseCommand):
    help = 'Seed a small demo legal corpus across cases, judgements, rules, constitution and statutes.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--clear',
            action='store_true',
            help='Delete existing demo collections (by slug) before seeding.',
        )

    @transaction.atomic
    def handle(self, *args, clear=False, **opts):
        if clear:
            slugs = [c['slug'] for c in COLLECTIONS]
            deleted, _ = CorpusCollection.objects.filter(slug__in=slugs).delete()
            self.stdout.write(self.style.WARNING(f'Cleared {deleted} rows.'))

        for spec in COLLECTIONS:
            coll, created = CorpusCollection.objects.update_or_create(
                slug=spec['slug'],
                defaults={
                    'name': spec['name'],
                    'kind': spec['kind'],
                    'description': spec['description'],
                    'is_active': True,
                },
            )
            for doc_spec in spec['documents']:
                doc, _ = CorpusDocument.objects.update_or_create(
                    collection=coll,
                    title=doc_spec['title'],
                    defaults={
                        'citation': doc_spec.get('citation', ''),
                        'jurisdiction': doc_spec.get('jurisdiction', ''),
                        'year': doc_spec.get('year'),
                        'body': doc_spec['body'],
                    },
                )
                doc.chunks.all().delete()
                for i, chunk_body in enumerate(chunk_text(doc.body)):
                    CorpusChunk.objects.create(document=doc, ordinal=i, text=chunk_body)
            self.stdout.write(
                self.style.SUCCESS(f'{"Created" if created else "Updated"}: {coll.name}')
            )
        self.stdout.write(self.style.SUCCESS('Corpus seeded.'))
