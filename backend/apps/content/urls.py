"""
URL routing for content app.
"""

from django.urls import path
from .views import VideoLookupView, ContributionIngestionView, VideoAnalysisView

urlpatterns = [
    path('youtube/<str:video_id>', VideoLookupView.as_view(), name='video-lookup'),
    path('youtube/<str:video_id>/contributions', ContributionIngestionView.as_view(), name='contribution-ingest'),
    path('youtube/<str:video_id>/analysis', VideoAnalysisView.as_view(), name='video-analysis'),
]
