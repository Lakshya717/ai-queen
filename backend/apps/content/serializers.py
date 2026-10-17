"""
Serializers for Ingestion and Lookup Endpoints.
Ensures seamless camelCase bidirectional interoperability with the Chrome Extension's HttpBackendApiAdapter.
"""

import math
from rest_framework import serializers
from .models import Video, VideoSegment, SegmentInterval, Contribution


class SegmentIntervalDtoSerializer(serializers.Serializer):
    startSeconds = serializers.FloatField(source='start_seconds')
    endSeconds = serializers.FloatField(source='end_seconds')


class VideoSegmentDtoSerializer(serializers.ModelSerializer):
    index = serializers.IntegerField(source='segment_index')
    startSeconds = serializers.FloatField(source='start_seconds')
    endSeconds = serializers.FloatField(source='end_seconds')
    coverage = serializers.CharField(source='coverage_status')

    class Meta:
        model = VideoSegment
        fields = ['index', 'startSeconds', 'endSeconds', 'coverage']


class VideoLookupSerializer(serializers.ModelSerializer):
    videoId = serializers.CharField(source='video_id')
    aiRelianceScore = serializers.FloatField(source='ai_reliance_score')
    confidence = serializers.FloatField()
    segmentDurationSeconds = serializers.IntegerField(source='segment_duration_seconds')
    analyzedAt = serializers.DateTimeField(source='analyzed_at')
    requiredPolicyVersion = serializers.CharField(source='required_policy_version')
    segments = serializers.SerializerMethodField()
    missingSegmentIndices = serializers.SerializerMethodField()

    class Meta:
        model = Video
        fields = [
            'videoId',
            'status',
            'label',
            'aiRelianceScore',
            'confidence',
            'segmentDurationSeconds',
            'segments',
            'missingSegmentIndices',
            'analyzedAt',
            'requiredPolicyVersion',
        ]

    def get_segments(self, obj):
        segs = {s.segment_index: s for s in obj.segments.all()}
        if obj.duration_seconds > 0:
            total_segments = int(math.ceil(obj.duration_seconds / obj.segment_duration_seconds))
            results = []
            for i in range(total_segments):
                start = float(i * obj.segment_duration_seconds)
                end = float(min((i + 1) * obj.segment_duration_seconds, obj.duration_seconds))
                if i in segs:
                    results.append({
                        'index': i,
                        'startSeconds': segs[i].start_seconds,
                        'endSeconds': segs[i].end_seconds,
                        'coverage': segs[i].coverage_status,
                    })
                else:
                    results.append({
                        'index': i,
                        'startSeconds': start,
                        'endSeconds': end,
                        'coverage': 'missing',
                    })
            return results
        return [
            {
                'index': s.segment_index,
                'startSeconds': s.start_seconds,
                'endSeconds': s.end_seconds,
                'coverage': s.coverage_status,
            }
            for s in obj.segments.all().order_by('segment_index')
        ]

    def get_missingSegmentIndices(self, obj):
        if obj.duration_seconds > 0:
            total_segments = int(math.ceil(obj.duration_seconds / obj.segment_duration_seconds))
            complete_indices = set(
                obj.segments.filter(coverage_status='complete').values_list('segment_index', flat=True)
            )
            return [i for i in range(total_segments) if i not in complete_indices]
        return list(
            obj.segments.filter(coverage_status__in=['missing', 'partial'])
            .order_by('segment_index')
            .values_list('segment_index', flat=True)
        )


class IntervalInputSerializer(serializers.Serializer):
    startSeconds = serializers.FloatField(required=False)
    endSeconds = serializers.FloatField(required=False)
    start_seconds = serializers.FloatField(required=False)
    end_seconds = serializers.FloatField(required=False)

    def to_internal_value(self, data):
        start = data.get('startSeconds') if 'startSeconds' in data else data.get('start_seconds')
        end = data.get('endSeconds') if 'endSeconds' in data else data.get('end_seconds')
        if start is None or end is None:
            raise serializers.ValidationError("Both start and end seconds are required for an interval.")
        return {'start_seconds': float(start), 'end_seconds': float(end)}


class FrameInputSerializer(serializers.Serializer):
    videoTimestampSeconds = serializers.FloatField(required=False)
    video_timestamp_seconds = serializers.FloatField(required=False)
    mimeType = serializers.CharField(required=False, default='image/jpeg')
    mime_type = serializers.CharField(required=False, default='image/jpeg')
    data = serializers.CharField(required=True)
    width = serializers.IntegerField(required=False, default=1280)
    height = serializers.IntegerField(required=False, default=720)


class AudioChunkInputSerializer(serializers.Serializer):
    startSeconds = serializers.FloatField(required=False)
    start_seconds = serializers.FloatField(required=False)
    endSeconds = serializers.FloatField(required=False)
    end_seconds = serializers.FloatField(required=False)
    mimeType = serializers.CharField(required=False, default='audio/webm;codecs=opus')
    mime_type = serializers.CharField(required=False, default='audio/webm;codecs=opus')
    data = serializers.CharField(required=True)
    alignmentDriftMs = serializers.IntegerField(required=False, default=0)
    alignment_drift_ms = serializers.IntegerField(required=False, default=0)


class ContributionInputSerializer(serializers.Serializer):
    videoId = serializers.CharField(required=False)
    video_id = serializers.CharField(required=False)
    videoDurationSeconds = serializers.FloatField(required=False)
    video_duration_seconds = serializers.FloatField(required=False)
    policyVersion = serializers.CharField(required=False, default='v1')
    policy_version = serializers.CharField(required=False, default='v1')
    segmentIndex = serializers.IntegerField(required=False)
    segment_index = serializers.IntegerField(required=False)
    segmentStartSeconds = serializers.FloatField(required=False)
    segment_start_seconds = serializers.FloatField(required=False)
    segmentEndSeconds = serializers.FloatField(required=False)
    segment_end_seconds = serializers.FloatField(required=False)
    observedIntervals = IntervalInputSerializer(many=True, required=False, default=list)
    observed_intervals = IntervalInputSerializer(many=True, required=False, default=list)
    frames = FrameInputSerializer(many=True, required=False, default=list)
    audioChunks = AudioChunkInputSerializer(many=True, required=False, default=list)
    audio_chunks = AudioChunkInputSerializer(many=True, required=False, default=list)
    transcript = serializers.DictField(required=False, allow_null=True)
    capabilities = serializers.DictField(required=False, allow_null=True)


class ContributionUploadResponseSerializer(serializers.Serializer):
    contributionId = serializers.CharField()
    acceptedIntervals = SegmentIntervalDtoSerializer(many=True)
    remainingIntervals = SegmentIntervalDtoSerializer(many=True)
    videoStatus = serializers.CharField()
