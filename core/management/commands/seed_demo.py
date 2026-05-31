from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand
from django.utils import timezone

from core.models import (
    ClientProfile,
    Firm,
    LawyerProfile,
    Matter,
    Retainer,
    RetainerStatus,
    Review,
)

User = get_user_model()

LAWYERS = [
    {
        'email': 'amara.dube@attorney.test',
        'first_name': 'Amara',
        'last_name': 'Dube',
        'practice_areas': ['Commercial', 'Contracts', 'Corporate'],
        'jurisdictions': ['Zimbabwe', 'South Africa'],
        'languages': ['English', 'Shona'],
        'years_experience': 11,
        'hourly_rate': Decimal('180.00'),
        'consultation_price': Decimal('60.00'),
        'bio': 'Commercial and corporate counsel for SMEs and startups.',
    },
    {
        'email': 'tendai.moyo@attorney.test',
        'first_name': 'Tendai',
        'last_name': 'Moyo',
        'practice_areas': ['Family', 'Divorce', 'Estates', 'Wills'],
        'jurisdictions': ['Zimbabwe'],
        'languages': ['English', 'Ndebele'],
        'years_experience': 7,
        'hourly_rate': Decimal('120.00'),
        'consultation_price': Decimal('40.00'),
        'bio': 'Compassionate family law and estate planning.',
    },
    {
        'email': 'naledi.khumalo@attorney.test',
        'first_name': 'Naledi',
        'last_name': 'Khumalo',
        'practice_areas': ['Labour', 'Employment', 'Disputes'],
        'jurisdictions': ['Zimbabwe', 'Botswana'],
        'languages': ['English', 'Setswana'],
        'years_experience': 14,
        'hourly_rate': Decimal('210.00'),
        'consultation_price': Decimal('75.00'),
        'bio': 'Labour disputes, CCMA, and workplace investigations.',
    },
    {
        'email': 'farai.ncube@attorney.test',
        'first_name': 'Farai',
        'last_name': 'Ncube',
        'practice_areas': ['Property', 'Conveyancing', 'Notary', 'Leases'],
        'jurisdictions': ['Zimbabwe'],
        'languages': ['English'],
        'years_experience': 9,
        'hourly_rate': Decimal('150.00'),
        'consultation_price': Decimal('50.00'),
        'bio': 'Property transfers, conveyancing, and lease disputes.',
    },
]

DEMO_CLIENT = {
    'email': 'client@attorney.test',
    'first_name': 'Chipo',
    'last_name': 'Marufu',
    'password': 'ClientPass123!',
}


class Command(BaseCommand):
    help = 'Seed demo lawyers, a demo client, and one retainer relationship.'

    def handle(self, *args, **options):
        firms_data = [
            {'name': 'Dube & Partners', 'slug': 'dube-partners', 'website': 'https://dubepartners.test', 'verified': True},
            {'name': 'Moyo Khumalo Inc.', 'slug': 'moyo-khumalo', 'website': 'https://moyokhumalo.test', 'verified': True},
        ]
        firms = []
        for f in firms_data:
            firm, _ = Firm.objects.get_or_create(slug=f['slug'], defaults=f)
            firms.append(firm)
        self.stdout.write(self.style.SUCCESS(f'Seeded {len(firms)} firms.'))

        created_lawyers = []
        for data in LAWYERS:
            user, created = User.objects.get_or_create(
                email=data['email'],
                defaults={
                    'first_name': data['first_name'],
                    'last_name': data['last_name'],
                    'role': 'lawyer',
                    'is_verified': True,
                },
            )
            if created:
                user.set_password('LawyerPass123!')
                user.save()
            profile, _ = LawyerProfile.objects.get_or_create(user=user)
            profile.practice_areas = data['practice_areas']
            profile.jurisdictions = data['jurisdictions']
            profile.languages = data['languages']
            profile.years_experience = data['years_experience']
            profile.hourly_rate = data['hourly_rate']
            profile.consultation_price = data['consultation_price']
            profile.bio = data['bio']
            profile.verified_at = timezone.now()
            # First two lawyers join firm #1, next two firm #2.
            profile.firm = firms[0] if len(created_lawyers) < 2 else firms[1]
            profile.save()
            created_lawyers.append(user)
        self.stdout.write(self.style.SUCCESS(f'Seeded {len(created_lawyers)} lawyers.'))

        client, created = User.objects.get_or_create(
            email=DEMO_CLIENT['email'],
            defaults={
                'first_name': DEMO_CLIENT['first_name'],
                'last_name': DEMO_CLIENT['last_name'],
                'role': 'client_individual',
            },
        )
        if created:
            client.set_password(DEMO_CLIENT['password'])
            client.save()
        ClientProfile.objects.get_or_create(user=client)
        self.stdout.write(self.style.SUCCESS(f'Demo client: {client.email} / {DEMO_CLIENT["password"]}'))

        # Put the first lawyer on retainer for the demo client.
        retainer, _ = Retainer.objects.get_or_create(
            client=client,
            lawyer=created_lawyers[0],
            defaults={
                'plan_name': 'Business Essentials',
                'cycle': 'monthly',
                'monthly_fee': Decimal('400.00'),
                'included_hours': 5,
                'status': RetainerStatus.ACTIVE,
            },
        )
        self.stdout.write(self.style.SUCCESS(f'Retainer: {retainer}'))

        # Seed a couple of reviews so lawyer cards show star ratings.
        sample = [
            (created_lawyers[0], 5, 'Sharp, responsive, and got the deal closed.'),
            (created_lawyers[1], 4, 'Very thorough with our estate planning.'),
            (created_lawyers[2], 5, 'Resolved our labour dispute quickly.'),
        ]
        for lawyer, rating, body in sample:
            matter, _ = Matter.objects.get_or_create(
                title=f'Past engagement with {lawyer.last_name}',
                client=client,
                defaults={'status': 'closed'},
            )
            matter.lawyers.add(lawyer)
            Review.objects.get_or_create(
                matter=matter,
                author=client,
                defaults={'lawyer': lawyer, 'rating': rating, 'body': body},
            )
        self.stdout.write(self.style.SUCCESS(f'Seeded {len(sample)} reviews.'))
        self.stdout.write(self.style.SUCCESS('Done.'))
