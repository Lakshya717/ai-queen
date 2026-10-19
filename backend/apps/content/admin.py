"""
Django Admin Configuration for AI Detection Content & Evidence.
Provides a visual inspection dashboard for videos, segments, intervals, contributions, and inference jobs.
"""

from django.contrib import admin
from .models import Video, VideoSegment, SegmentInterval, Contribution, VideoTranscript, InferenceJob, SegmentComponentScore


class SegmentIntervalInline(admin.TabularInline):
    model = SegmentInterval
    extra = 0
    readonly_fields = ('start_seconds', 'end_seconds')
    can_delete = True


class VideoSegmentInline(admin.TabularInline):
    model = VideoSegment
    extra = 0
    fields = ('segment_index', 'start_seconds', 'end_seconds', 'coverage_status', 'frame_count', 'audio_duration_seconds')
    readonly_fields = ('segment_index', 'start_seconds', 'end_seconds', 'coverage_status', 'frame_count', 'audio_duration_seconds')
    show_change_link = True


@admin.register(Video)
class VideoAdmin(admin.ModelAdmin):
    list_display = ('video_id', 'status', 'label', 'ai_reliance_score', 'confidence', 'segment_duration_seconds', 'created_at')
    list_filter = ('status', 'label', 'created_at')
    search_fields = ('video_id', 'title', 'channel')
    readonly_fields = ('created_at', 'updated_at')
    inlines = [VideoSegmentInline]


@admin.register(VideoSegment)
class VideoSegmentAdmin(admin.ModelAdmin):
    list_display = ('video', 'segment_index', 'start_seconds', 'end_seconds', 'coverage_status', 'frame_count', 'audio_duration_seconds', 'updated_at')
    list_filter = ('coverage_status', 'updated_at')
    search_fields = ('video__video_id',)
    inlines = [SegmentIntervalInline]


@admin.register(Contribution)
class ContributionAdmin(admin.ModelAdmin):
    list_display = ('contribution_id', 'video', 'segment_index', 'frame_count', 'audio_duration_seconds', 'transcript_scope', 'created_at')
    list_filter = ('transcript_scope', 'policy_version', 'created_at')
    search_fields = ('contribution_id', 'video__video_id', 'transcript_hash')
    readonly_fields = ('created_at',)


@admin.register(VideoTranscript)
class VideoTranscriptAdmin(admin.ModelAdmin):
    list_display = ('content_hash', 'video', 'language', 'scope', 'created_at')
    list_filter = ('scope', 'language', 'created_at')
    search_fields = ('content_hash', 'video__video_id')
    readonly_fields = ('created_at',)


@admin.register(InferenceJob)
class InferenceJobAdmin(admin.ModelAdmin):
    list_display = ('id', 'video', 'segment_index', 'status', 'manifest_path', 'created_at', 'updated_at')
    list_filter = ('status', 'created_at')
    search_fields = ('video__video_id', 'manifest_path')
    readonly_fields = ('created_at', 'updated_at')


@admin.register(SegmentComponentScore)
class SegmentComponentScoreAdmin(admin.ModelAdmin):
    list_display = ('id', 'segment', 'component_name', 'modality', 'score', 'confidence', 'status', 'execution_time_ms', 'created_at')
    list_filter = ('component_name', 'modality', 'status', 'created_at')
    search_fields = ('segment__video__video_id', 'component_name', 'modality')
    readonly_fields = ('created_at', 'updated_at')
