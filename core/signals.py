"""Signal receivers for core.

Keeps role-dependent profile rows in sync. Registration creates the right
profile up front (see RegisterSerializer), but an account whose role is changed
later — a client promoted to lawyer in the admin — would otherwise be left with
no LawyerProfile at all, which quietly skips the credential-verification gate.
"""

from django.db.models.signals import post_save
from django.dispatch import receiver

from .models import LawyerProfile, User, UserRole


@receiver(post_save, sender=User)
def ensure_lawyer_profile(sender, instance, **kwargs):
    """Give every lawyer account a profile row, whenever it became a lawyer."""
    if instance.role == UserRole.LAWYER:
        LawyerProfile.objects.get_or_create(user=instance)
