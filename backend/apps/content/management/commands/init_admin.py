"""
Management command to create a default development superuser if none exists.
Usage: python manage.py init_admin
"""

from django.core.management.base import BaseCommand
from django.contrib.auth import get_user_model
import os

class Command(BaseCommand):
    help = 'Seeds a default development superuser for local inspection in Django Admin'

    def handle(self, *args, **options):
        User = get_user_model()
        username = os.environ.get('DJANGO_ADMIN_USER', 'admin')
        password = os.environ.get('DJANGO_ADMIN_PASSWORD', 'admin123')
        email = os.environ.get('DJANGO_ADMIN_EMAIL', 'admin@aidetect.local')

        if not User.objects.filter(username=username).exists():
            User.objects.create_superuser(username=username, email=email, password=password)
            self.stdout.write(self.style.SUCCESS(
                f"Successfully created development superuser: '{username}' (password: '{password}')"
            ))
        else:
            self.stdout.write(self.style.WARNING(
                f"Superuser '{username}' already exists. Skipping."
            ))
