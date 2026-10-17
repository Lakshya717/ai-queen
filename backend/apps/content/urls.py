"""
URL routing for content app.
"""

from django.urls import path
from .views import VideoLookupView, ContributionIngestionView

urlpatterns = [
    path('youtube/<str:video_id>', VideoLookupView.as_view(), name='video-lookup'),
    path('youtube/<str:video_id>/contributions', ContributionIngestionView.as_view(), name='contribution-ingest'),
]
