from django.db import migrations


# Default purchasable AI-credit packs. Seeded only when no plans exist yet, so
# manual edits in prod are never overwritten.
DEFAULT_PLANS = [
    {'name': 'Bronze', 'slug': 'bronze', 'price': '10.00', 'token_credits': 50_000,
     'description': 'Starter pack — good for light use.'},
    {'name': 'Silver', 'slug': 'silver', 'price': '25.00', 'token_credits': 150_000,
     'description': 'Most popular — steady monthly use.'},
    {'name': 'Gold', 'slug': 'gold', 'price': '60.00', 'token_credits': 400_000,
     'description': 'Heavy use across AI Workflows.'},
    {'name': 'Platinum', 'slug': 'platinum', 'price': '120.00', 'token_credits': 1_000_000,
     'description': 'Firm-scale usage.'},
]


def seed_and_clamp(apps, schema_editor):
    AICreditPlan = apps.get_model('workflows', 'AICreditPlan')
    AICreditAccount = apps.get_model('workflows', 'AICreditAccount')

    # 1) Any account driven negative by a call overshoot floors at 0.
    AICreditAccount.objects.filter(balance__lt=0).update(balance=0)

    # 2) Seed the default packs so there's always somewhere to top up — only
    #    when the table is empty (don't clobber manually configured plans).
    if not AICreditPlan.objects.exists():
        for p in DEFAULT_PLANS:
            AICreditPlan.objects.create(
                name=p['name'], slug=p['slug'], price=p['price'],
                token_credits=p['token_credits'], description=p['description'],
                currency='USD', is_active=True,
            )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('workflows', '0012_alter_llmproviderconfig_options'),
    ]

    operations = [
        migrations.RunPython(seed_and_clamp, noop_reverse),
    ]
