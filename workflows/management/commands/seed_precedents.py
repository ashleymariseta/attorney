"""Seed a starter set of document precedents (Markdown + fillable variables).

Idempotent: re-running updates the existing rows by slug.

    python manage.py seed_precedents
"""
from django.core.management.base import BaseCommand

from workflows.models import PrecedentTemplate

ANSWERING_AFFIDAVIT = r"""IN THE {{court}}

HELD AT {{place}}

Case No. {{case_number}}

In the matter between:

**{{applicant}}**  ........................................  Applicant

and

**{{respondent}}**  ........................................  Respondent

---

# ANSWERING AFFIDAVIT

I, the undersigned, **{{deponent_name}}**, do hereby make oath and state that:

1. I am the {{deponent_capacity}} in this matter and the facts deposed to herein are within my personal knowledge, save where the context indicates otherwise, and are to the best of my belief both true and correct.

2. I have read the founding affidavit deposed to by the Applicant and respond thereto as set out below. Where I do not specifically deal with an allegation, it must not be taken as an admission thereof.

## AD SERIATIM RESPONSE

{{answer}}

## POINTS IN LIMINE

{{points_in_limine}}

## CONCLUSION

3. In the premises, I respectfully pray that the application be dismissed with costs.

WHEREFORE the Respondent prays for an order in the following terms:

1. The application is dismissed.
2. The Applicant pays the costs of suit.

---

THUS DONE AND SWORN at {{place}} on this {{date}}, the deponent having acknowledged that he/she knows and understands the contents of this affidavit.

\
_______________________________
**{{deponent_name}}**
DEPONENT

\
_______________________________
COMMISSIONER OF OATHS
"""

FOUNDING_AFFIDAVIT = r"""IN THE {{court}}

HELD AT {{place}}

Case No. {{case_number}}

In the matter between:

**{{applicant}}**  ........................................  Applicant

and

**{{respondent}}**  ........................................  Respondent

---

# FOUNDING AFFIDAVIT

I, the undersigned, **{{deponent_name}}**, do hereby make oath and state that:

1. I am the {{deponent_capacity}} and duly authorised to depose to this affidavit. The facts herein are within my personal knowledge and are true and correct.

## THE PARTIES

{{parties}}

## BACKGROUND FACTS

{{background}}

## THE RELIEF SOUGHT AND GROUNDS

{{grounds}}

## CONCLUSION

2. In the premises, I pray for an order in terms of the draft order annexed hereto.

---

THUS DONE AND SWORN at {{place}} on this {{date}}.

\
_______________________________
**{{deponent_name}}**
DEPONENT

\
_______________________________
COMMISSIONER OF OATHS
"""

NOTICE_OF_OPPOSITION = r"""IN THE {{court}}

HELD AT {{place}}

Case No. {{case_number}}

In the matter between:

**{{applicant}}**  ........................................  Applicant

and

**{{respondent}}**  ........................................  Respondent

---

# NOTICE OF OPPOSITION

BE PLEASED TO TAKE NOTICE THAT the Respondent intends to oppose the relief sought in this application and has appointed the address below as the address at which it will accept service of all process in these proceedings.

DATED at {{place}} on this {{date}}.

\
_______________________________
{{legal_practitioner}}
Legal Practitioner for the Respondent
{{practitioner_address}}

**TO:** The Registrar, {{court}}

**AND TO:** {{applicant}} / its legal practitioners
"""

DEMAND_LETTER = r"""{{firm_letterhead}}

{{date}}

{{recipient_name}}
{{recipient_address}}

Dear Sir/Madam,

**RE: LETTER OF DEMAND — {{subject}}**

We act for **{{client_name}}** ("our client") and write on their instructions.

{{body}}

In the circumstances, we hereby **DEMAND** payment of the sum of **{{amount}}** within **{{deadline}}** of the date of this letter, failing which we hold instructions to institute legal proceedings against you for recovery of the said sum together with interest and costs, without further notice.

This letter is written without prejudice to our client's rights, all of which are expressly reserved.

Yours faithfully,

\
_______________________________
{{legal_practitioner}}
{{firm_name}}
"""

_COURT_VARS = [
    {'key': 'court', 'label': 'Court', 'help': 'e.g. HIGH COURT OF ZIMBABWE', 'required': True, 'type': 'text'},
    {'key': 'place', 'label': 'Place', 'help': 'e.g. HARARE', 'required': True, 'type': 'text'},
    {'key': 'case_number', 'label': 'Case number', 'required': True, 'type': 'text'},
    {'key': 'applicant', 'label': 'Applicant', 'required': True, 'type': 'text'},
    {'key': 'respondent', 'label': 'Respondent', 'required': True, 'type': 'text'},
    {'key': 'deponent_name', 'label': 'Deponent full name', 'required': True, 'type': 'text'},
    {'key': 'deponent_capacity', 'label': 'Deponent capacity', 'help': 'e.g. Respondent / director of the Respondent', 'required': True, 'type': 'text'},
    {'key': 'date', 'label': 'Date', 'help': 'e.g. 20th day of June 2026', 'required': True, 'type': 'text'},
]

PRECEDENTS = [
    {
        'slug': 'answering-affidavit',
        'name': 'Answering Affidavit',
        'category': 'Affidavits',
        'matter_type': 'Litigation',
        'description': 'Respondent’s opposing affidavit in motion proceedings.',
        'body': ANSWERING_AFFIDAVIT,
        'variables': _COURT_VARS + [
            {'key': 'answer', 'label': 'Ad seriatim response', 'help': 'Your paragraph-by-paragraph response to the founding affidavit.', 'required': False, 'type': 'textarea'},
            {'key': 'points_in_limine', 'label': 'Points in limine', 'help': 'Preliminary points, if any.', 'required': False, 'type': 'textarea'},
        ],
    },
    {
        'slug': 'founding-affidavit',
        'name': 'Founding Affidavit',
        'category': 'Affidavits',
        'matter_type': 'Litigation',
        'description': 'Applicant’s founding affidavit launching motion proceedings.',
        'body': FOUNDING_AFFIDAVIT,
        'variables': _COURT_VARS + [
            {'key': 'parties', 'label': 'The parties', 'required': False, 'type': 'textarea'},
            {'key': 'background', 'label': 'Background facts', 'required': False, 'type': 'textarea'},
            {'key': 'grounds', 'label': 'Relief sought & grounds', 'required': False, 'type': 'textarea'},
        ],
    },
    {
        'slug': 'notice-of-opposition',
        'name': 'Notice of Opposition',
        'category': 'Pleadings',
        'matter_type': 'Litigation',
        'description': 'Short notice that the respondent intends to oppose an application.',
        'body': NOTICE_OF_OPPOSITION,
        'variables': [
            {'key': 'court', 'label': 'Court', 'required': True, 'type': 'text'},
            {'key': 'place', 'label': 'Place', 'required': True, 'type': 'text'},
            {'key': 'case_number', 'label': 'Case number', 'required': True, 'type': 'text'},
            {'key': 'applicant', 'label': 'Applicant', 'required': True, 'type': 'text'},
            {'key': 'respondent', 'label': 'Respondent', 'required': True, 'type': 'text'},
            {'key': 'date', 'label': 'Date', 'required': True, 'type': 'text'},
            {'key': 'legal_practitioner', 'label': 'Legal practitioner', 'required': True, 'type': 'text'},
            {'key': 'practitioner_address', 'label': 'Practitioner address', 'required': False, 'type': 'textarea'},
        ],
    },
    {
        'slug': 'letter-of-demand',
        'name': 'Letter of Demand',
        'category': 'Letters',
        'matter_type': 'Debt recovery',
        'description': 'Pre-litigation demand for payment.',
        'body': DEMAND_LETTER,
        'variables': [
            {'key': 'firm_letterhead', 'label': 'Firm letterhead', 'help': 'Firm name & address block.', 'required': False, 'type': 'textarea'},
            {'key': 'date', 'label': 'Date', 'required': True, 'type': 'text'},
            {'key': 'recipient_name', 'label': 'Recipient name', 'required': True, 'type': 'text'},
            {'key': 'recipient_address', 'label': 'Recipient address', 'required': False, 'type': 'textarea'},
            {'key': 'subject', 'label': 'Subject', 'required': True, 'type': 'text'},
            {'key': 'client_name', 'label': 'Client name', 'required': True, 'type': 'text'},
            {'key': 'body', 'label': 'Body / facts', 'required': False, 'type': 'textarea'},
            {'key': 'amount', 'label': 'Amount demanded', 'required': True, 'type': 'text'},
            {'key': 'deadline', 'label': 'Deadline', 'help': 'e.g. 7 (seven) days', 'required': True, 'type': 'text'},
            {'key': 'legal_practitioner', 'label': 'Legal practitioner', 'required': True, 'type': 'text'},
            {'key': 'firm_name', 'label': 'Firm name', 'required': False, 'type': 'text'},
        ],
    },
]


class Command(BaseCommand):
    help = 'Seed/refresh the document precedents catalogue.'

    def handle(self, *args, **options):
        for p in PRECEDENTS:
            obj, created = PrecedentTemplate.objects.update_or_create(
                slug=p['slug'],
                defaults={
                    'name': p['name'],
                    'description': p['description'],
                    'category': p['category'],
                    'matter_type': p['matter_type'],
                    'body': p['body'],
                    'variables': p['variables'],
                    'is_active': True,
                },
            )
            self.stdout.write(('Created ' if created else 'Updated ') + obj.name)
        self.stdout.write(self.style.SUCCESS(f'Done. {PrecedentTemplate.objects.count()} precedents total.'))
