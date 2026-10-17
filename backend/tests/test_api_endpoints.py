"""
Integration Tests for REST API Endpoints:
- GET /v1/content/youtube/<video_id>
- POST /v1/content/youtube/<video_id>/contributions
"""

import base64
from django.test import TestCase
from rest_framework.test import APIClient
from apps.content.models import Video, VideoSegment, SegmentInterval, Contribution, InferenceJob


class ApiEndpointTests(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_lookup_unmapped_video(self):
        # Spec Section 2.1: returns 200 with status='not_found'
        resp = self.client.get('/v1/content/youtube/unmappedVideo1')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['videoId'], 'unmappedVideo1')
        self.assertEqual(data['status'], 'not_found')
        self.assertIsNone(data['aiRelianceScore'])
        self.assertEqual(data['segments'], [])
        self.assertEqual(data['missingSegmentIndices'], [])

    def test_submit_contribution_and_lookup(self):
        video_id = "testVid999"
        dummy_frame = base64.b64encode(b"\xFF\xD8\xFFDUMMY_IMAGE").decode('ascii')
        dummy_audio = base64.b64encode(b"\x1A\x45\xDF\xA3DUMMY_AUDIO").decode('ascii')

        payload = {
            "videoId": video_id,
            "policyVersion": "v1",
            "segmentIndex": 1,
            "segmentStartSeconds": 30.0,
            "segmentEndSeconds": 60.0,
            "observedIntervals": [
                {"startSeconds": 30.0, "endSeconds": 48.0}
            ],
            "frames": [
                {
                    "videoTimestampSeconds": 35.0,
                    "mimeType": "image/jpeg",
                    "data": dummy_frame,
                    "width": 1280,
                    "height": 720,
                },
                {
                    "videoTimestampSeconds": 40.0,
                    "mimeType": "image/jpeg",
                    "data": dummy_frame,
                    "width": 1280,
                    "height": 720,
                }
            ],
            "audioChunks": [
                {
                    "startSeconds": 30.0,
                    "endSeconds": 48.0,
                    "mimeType": "audio/webm;codecs=opus",
                    "data": dummy_audio,
                    "alignmentDriftMs": 10,
                }
            ],
            "transcript": {
                "scope": "full",
                "language": "en",
                "segments": [
                    {"startSeconds": 0.0, "endSeconds": 5.0, "text": "Welcome to test."}
                ],
            },
            "capabilities": {
                "screenshots": True,
                "tab_audio": True,
                "transcript_scope": "full"
            }
        }

        # Submit contribution
        resp = self.client.post(
            f'/v1/content/youtube/{video_id}/contributions',
            data=payload,
            format='json'
        )
        self.assertEqual(resp.status_code, 200)
        res_data = resp.json()

        # Check response matches ContributionUploadResponseDto
        self.assertTrue(res_data['contributionId'].startswith('contrib_'))
        self.assertEqual(res_data['acceptedIntervals'], [{'startSeconds': 30.0, 'endSeconds': 48.0}])
        self.assertEqual(res_data['remainingIntervals'], [{'startSeconds': 48.0, 'endSeconds': 60.0}])
        self.assertEqual(res_data['videoStatus'], 'partial')

        # Check database records
        video = Video.objects.get(video_id=video_id)
        self.assertEqual(video.status, 'partial')

        segment = VideoSegment.objects.get(video=video, segment_index=1)
        self.assertEqual(segment.coverage_status, 'partial')  # 18s / 30s = 60% < 95%
        self.assertEqual(segment.frame_count, 2)

        intervals = list(segment.intervals.all())
        self.assertEqual(len(intervals), 1)
        self.assertEqual(intervals[0].start_seconds, 30.0)
        self.assertEqual(intervals[0].end_seconds, 48.0)

        # Check that InferenceJob was created
        jobs = InferenceJob.objects.filter(video=video, segment_index=1)
        self.assertEqual(jobs.count(), 1)
        self.assertEqual(jobs.first().status, 'PENDING')

        # Lookup video coverage via GET
        lookup_resp = self.client.get(f'/v1/content/youtube/{video_id}')
        self.assertEqual(lookup_resp.status_code, 200)
        lookup_data = lookup_resp.json()

        self.assertEqual(lookup_data['videoId'], video_id)
        self.assertEqual(lookup_data['status'], 'partial')
        self.assertEqual(len(lookup_data['segments']), 1)
        self.assertEqual(lookup_data['segments'][0]['index'], 1)
        self.assertEqual(lookup_data['segments'][0]['coverage'], 'partial')
        self.assertEqual(lookup_data['missingSegmentIndices'], [1])

    def test_multi_viewer_full_segment_completion(self):
        video_id = "completeSegVideo"
        dummy_frame = base64.b64encode(b"\xFF\xD8\xFFDUMMY_IMAGE").decode('ascii')

        # Viewer A contributes [0, 20)
        payload_a = {
            "videoId": video_id,
            "segmentIndex": 0,
            "segmentStartSeconds": 0.0,
            "segmentEndSeconds": 30.0,
            "observedIntervals": [{"startSeconds": 0.0, "endSeconds": 20.0}],
            "frames": [
                {"videoTimestampSeconds": 5.0, "data": dummy_frame},
                {"videoTimestampSeconds": 15.0, "data": dummy_frame},
            ]
        }
        resp_a = self.client.post(f'/v1/content/youtube/{video_id}/contributions', data=payload_a, format='json')
        self.assertEqual(resp_a.status_code, 200)

        seg = VideoSegment.objects.get(video__video_id=video_id, segment_index=0)
        self.assertEqual(seg.coverage_status, 'partial')

        # Viewer B contributes [20, 30) -> now [0, 30) is covered (100% >= 95% and >=2 frames)
        payload_b = {
            "videoId": video_id,
            "segmentIndex": 0,
            "segmentStartSeconds": 0.0,
            "segmentEndSeconds": 30.0,
            "observedIntervals": [{"startSeconds": 20.0, "endSeconds": 30.0}],
            "frames": [
                {"videoTimestampSeconds": 25.0, "data": dummy_frame},
            ]
        }
        resp_b = self.client.post(f'/v1/content/youtube/{video_id}/contributions', data=payload_b, format='json')
        self.assertEqual(resp_b.status_code, 200)
        res_b_data = resp_b.json()

        # Check that intervals merged to complete [0, 30)
        self.assertEqual(res_b_data['acceptedIntervals'], [{'startSeconds': 0.0, 'endSeconds': 30.0}])
        self.assertEqual(res_b_data['remainingIntervals'], [])

        # Check DB status is now complete
        seg.refresh_from_db()
        self.assertEqual(seg.coverage_status, 'complete')

        # GET lookup should now show missingSegmentIndices as empty for segment 0
        lookup_resp = self.client.get(f'/v1/content/youtube/{video_id}')
        self.assertEqual(lookup_resp.status_code, 200)
        lookup_data = lookup_resp.json()
        self.assertEqual(lookup_data['missingSegmentIndices'], [])
        self.assertEqual(lookup_data['segments'][0]['coverage'], 'complete')

    def test_lookup_unmapped_with_duration_query_param(self):
        # When extension queries with ?duration=95, it should synthesize 4 segments (0, 1, 2, 3)
        resp = self.client.get('/v1/content/youtube/newVidWithDuration?duration=95')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['status'], 'not_found')
        self.assertEqual(len(data['segments']), 4)
        self.assertEqual(data['missingSegmentIndices'], [0, 1, 2, 3])
        self.assertEqual(data['segments'][0]['startSeconds'], 0.0)
        self.assertEqual(data['segments'][0]['endSeconds'], 30.0)
        self.assertEqual(data['segments'][3]['startSeconds'], 90.0)
        self.assertEqual(data['segments'][3]['endSeconds'], 95.0)

    def test_contribution_with_video_duration_preserves_remaining_segments(self):
        video_id = "multiSegVideo"
        dummy_frame = base64.b64encode(b"\xFF\xD8\xFFDUMMY_IMAGE").decode('ascii')

        # Upload contribution for segment 0 with 90s total video duration (3 segments: 0, 1, 2)
        payload = {
            "videoId": video_id,
            "videoDurationSeconds": 90.0,
            "segmentIndex": 0,
            "segmentStartSeconds": 0.0,
            "segmentEndSeconds": 30.0,
            "observedIntervals": [{"startSeconds": 0.0, "endSeconds": 30.0}],
            "frames": [
                {"videoTimestampSeconds": 5.0, "data": dummy_frame},
                {"videoTimestampSeconds": 15.0, "data": dummy_frame},
            ]
        }
        resp = self.client.post(f'/v1/content/youtube/{video_id}/contributions', data=payload, format='json')
        self.assertEqual(resp.status_code, 200)

        # Lookup should now report 3 total segments, with segment 0 complete and segments 1 and 2 missing!
        lookup_resp = self.client.get(f'/v1/content/youtube/{video_id}')
        self.assertEqual(lookup_resp.status_code, 200)
        lookup_data = lookup_resp.json()
        self.assertEqual(len(lookup_data['segments']), 3)
        self.assertEqual(lookup_data['segments'][0]['coverage'], 'complete')
        self.assertEqual(lookup_data['segments'][1]['coverage'], 'missing')
        self.assertEqual(lookup_data['segments'][2]['coverage'], 'missing')
        self.assertEqual(lookup_data['missingSegmentIndices'], [1, 2])
        # Video is partial, not complete, because segments 1 & 2 are still missing
        self.assertEqual(lookup_data['status'], 'partial')

