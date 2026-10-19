"""
Data Models for YouTube AI-Content Detection Backend.
Stores video metadata, segments, half-open interval coverage, contributions, transcripts, and inference jobs.
"""

from django.db import models


class Video(models.Model):
    STATUS_CHOICES = [
        ('not_found', 'Not Found'),
        ('partial', 'Partial Coverage'),
        ('processing', 'Processing'),
        ('complete', 'Complete'),
        ('insufficient_evidence', 'Insufficient Evidence'),
    ]

    LABEL_CHOICES = [
        ('UNKNOWN', 'Unknown'),
        ('AI_GENERATED', 'AI Generated'),
        ('HUMAN_MADE', 'Human Made'),
        ('MIXED', 'Mixed Content'),
    ]

    video_id = models.CharField(max_length=20, primary_key=True, help_text="YouTube 11-char Video ID")
    title = models.CharField(max_length=255, blank=True, default='')
    channel = models.CharField(max_length=255, blank=True, default='')
    duration_seconds = models.FloatField(default=0.0)
    segment_duration_seconds = models.IntegerField(default=30)
    status = models.CharField(max_length=30, choices=STATUS_CHOICES, default='not_found')
    label = models.CharField(max_length=30, choices=LABEL_CHOICES, default='UNKNOWN')
    ai_reliance_score = models.FloatField(null=True, blank=True, help_text="0.0 to 1.0 aggregate score")
    confidence = models.FloatField(null=True, blank=True, help_text="0.0 to 1.0 model confidence")
    analyzed_at = models.DateTimeField(null=True, blank=True)
    required_policy_version = models.CharField(max_length=10, default='v1')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'videos'
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.video_id} ({self.status}) - Score: {self.ai_reliance_score or 'N/A'}"


class VideoSegment(models.Model):
    COVERAGE_CHOICES = [
        ('missing', 'Missing'),
        ('partial', 'Partial'),
        ('complete', 'Complete'),
    ]

    video = models.ForeignKey(Video, on_delete=models.CASCADE, related_name='segments')
    segment_index = models.IntegerField()
    start_seconds = models.FloatField()
    end_seconds = models.FloatField()
    coverage_status = models.CharField(max_length=20, choices=COVERAGE_CHOICES, default='missing')
    ai_segment_score = models.FloatField(null=True, blank=True)
    frame_count = models.IntegerField(default=0)
    audio_duration_seconds = models.FloatField(default=0.0)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'video_segments'
        unique_together = ('video', 'segment_index')
        ordering = ['segment_index']

    def __str__(self):
        return f"Video {self.video_id} Seg #{self.segment_index} [{self.start_seconds}-{self.end_seconds}s] ({self.coverage_status})"


class SegmentInterval(models.Model):
    segment = models.ForeignKey(VideoSegment, on_delete=models.CASCADE, related_name='intervals')
    start_seconds = models.FloatField()
    end_seconds = models.FloatField()

    class Meta:
        db_table = 'segment_intervals'
        ordering = ['start_seconds']

    def __str__(self):
        return f"[{self.start_seconds:.2f}s - {self.end_seconds:.2f}s)"


class Contribution(models.Model):
    contribution_id = models.CharField(max_length=64, primary_key=True)
    video = models.ForeignKey(Video, on_delete=models.CASCADE, related_name='contributions')
    segment_index = models.IntegerField()
    policy_version = models.CharField(max_length=20, default='v1')
    frame_count = models.IntegerField(default=0)
    audio_duration_seconds = models.FloatField(default=0.0)
    transcript_scope = models.CharField(max_length=20, default='unavailable')
    transcript_hash = models.CharField(max_length=64, blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'contributions'
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.contribution_id} (Video {self.video_id}, Seg #{self.segment_index})"


class VideoTranscript(models.Model):
    content_hash = models.CharField(max_length=64, primary_key=True)
    video = models.ForeignKey(Video, on_delete=models.CASCADE, related_name='transcripts')
    language = models.CharField(max_length=12, default='en')
    scope = models.CharField(max_length=20, default='full')
    cues_json = models.JSONField(default=list)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'video_transcripts'
        ordering = ['-created_at']

    def __str__(self):
        return f"Transcript {self.content_hash[:8]}... (Video {self.video_id})"


class InferenceJob(models.Model):
    STATUS_CHOICES = [
        ('PENDING', 'Pending'),
        ('RUNNING', 'Running'),
        ('COMPLETED', 'Completed'),
        ('FAILED', 'Failed'),
    ]

    video = models.ForeignKey(Video, on_delete=models.CASCADE, related_name='inference_jobs')
    segment_index = models.IntegerField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='PENDING')
    manifest_path = models.CharField(max_length=500, blank=True, default='')
    error_message = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'inference_jobs'
        ordering = ['-created_at']

    def __str__(self):
        return f"Job #{self.id} (Video {self.video_id}, Seg #{self.segment_index}) [{self.status}]"


class SegmentComponentScore(models.Model):
    STATUS_CHOICES = [
        ('SUCCESS', 'Success'),
        ('SKIPPED', 'Skipped'),
        ('FAILED', 'Failed'),
    ]

    segment = models.ForeignKey(VideoSegment, on_delete=models.CASCADE, related_name='component_scores')
    component_name = models.CharField(max_length=64, db_index=True)
    modality = models.CharField(max_length=32, db_index=True)
    score = models.FloatField(null=True, blank=True, help_text="0.0 to 1.0 (1.0 = AI, 0.0 = Human)")
    confidence = models.FloatField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='SUCCESS')
    execution_time_ms = models.FloatField(default=0.0)
    details = models.JSONField(default=dict, help_text="Component-specific collected output details")
    error_message = models.TextField(blank=True, default='')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'segment_component_scores'
        unique_together = ('segment', 'component_name')
        ordering = ['segment', 'component_name']

    def __str__(self):
        return f"{self.component_name} ({self.modality}) on {self.segment}: {self.score} [{self.status}]"
