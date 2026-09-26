import json
import unittest
from datetime import date, datetime
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from urllib.parse import parse_qs, urlparse
from urllib.error import HTTPError

import app as meetflow_app
from app import ANALYSIS_VERSION, build_analysis, clear_saved_meetings, compact_speaker_turns, create_meeting, extract_actions, format_deepgram_response, make_summary, migrate_meeting_analysis, parse_deadline, refresh_analysis, remove_meeting_task, transcribe_with_deepgram, write_meetings


class MeetingAnalysisTests(unittest.TestCase):
    def test_extracts_decisions_assignees_and_deadlines(self):
        transcript = "We agreed to keep the first release focused. Jordan will share the screens by Friday."
        decisions, tasks = extract_actions(transcript)

        self.assertEqual(len(decisions), 1)
        self.assertEqual(tasks[0]["owner"], "Jordan")
        self.assertEqual(tasks[0]["due"], "Friday")
        self.assertTrue(tasks[0]["due_date"])
        self.assertIn("share the screens", tasks[0]["title"])

    def test_explicit_deadlines_normalize_and_ambiguous_week_does_not(self):
        reference = date(2026, 9, 26)

        self.assertEqual(parse_deadline("Friday", date(2026, 9, 23)), date(2026, 9, 25))
        self.assertEqual(parse_deadline("next Tuesday", reference), date(2026, 10, 6))
        self.assertEqual(parse_deadline("March 3", reference), date(2027, 3, 3))
        self.assertEqual(parse_deadline("the 18th", reference), date(2026, 10, 18))
        self.assertIsNone(parse_deadline("next week", reference))

    def test_task_stores_normalized_due_date_for_reminders(self):
        meeting = create_meeting("Launch", "Maya will send the plan by next Tuesday.", "notes")

        task = meeting["tasks"][0]
        reference = datetime.fromisoformat(meeting["createdAt"])

        self.assertEqual(task["due_date"], parse_deadline("next Tuesday", reference).isoformat())
        self.assertIsNone(task["reminder_sent_for"])

    def test_unassigned_task_is_not_given_a_guessed_owner(self):
        _, tasks = extract_actions("We need to review the onboarding copy before launch.")

        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0]["owner"], "Unassigned")
        self.assertEqual(tasks[0]["due"], "Unscheduled")

    def test_speaker_prefix_is_used_as_owner_and_decision_is_not_a_task(self):
        decisions, tasks = extract_actions("Maya: Decision: we will move the review to Friday.\nJordan: I will share the screens by Friday.")

        self.assertEqual(len(decisions), 1)
        self.assertEqual(decisions[0], "we will move the review to Friday.")
        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0]["owner"], "Jordan")
        self.assertEqual(tasks[0]["title"], "share the screens by Friday.")

    def test_group_suggestion_does_not_assign_the_speaker_as_owner(self):
        _, tasks = extract_actions("Maya: Let's confirm the launch email before Thursday.")

        self.assertEqual(tasks[0]["owner"], "Unassigned")

    def test_transcription_timestamps_do_not_hide_explicit_owners(self):
        _, tasks = extract_actions("[00:00] Maya will send the launch plan by Friday. We agreed to the updated schedule.")

        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0]["owner"], "Maya")
        self.assertEqual(tasks[0]["due"], "Friday")

    def test_diarized_utterance_keeps_timestamp_and_speaker_owner(self):
        transcript, language = format_deepgram_response({
            "results": {
                "channels": [{"detected_language": "en", "alternatives": [{"transcript": "I will send the launch plan."}]}],
                "utterances": [{"start": 3.2, "speaker": 0, "transcript": "I will send the launch plan by Friday."}],
            },
        })
        _, tasks = extract_actions(transcript)

        self.assertEqual(language, "en")
        self.assertEqual(transcript, "[00:03] Speaker 1: I will send the launch plan by Friday.")
        self.assertEqual(tasks[0]["owner"], "Speaker 1")

    def test_same_speaker_pause_fragments_keep_one_label_and_one_task(self):
        transcript, _ = format_deepgram_response({
            "results": {
                "channels": [{"detected_language": "en", "alternatives": [{"transcript": "I will update the screens."}]}],
                "utterances": [
                    {"start": 2.0, "speaker": 0, "transcript": "I will, um,"},
                    {"start": 7.0, "speaker": 0, "transcript": "so, like, update the screens by Friday."},
                    {"start": 13.0, "speaker": 1, "transcript": "Does that cover checkout?"},
                    {"start": 18.0, "speaker": 0, "transcript": "Yes, I will send the revised plan."},
                ],
            },
        })
        _, tasks = extract_actions(transcript)

        self.assertEqual(transcript.splitlines()[0], "[00:02] Speaker 1: I will, um,")
        self.assertEqual(transcript.splitlines()[1], "[00:07] so, like, update the screens by Friday.")
        self.assertTrue(transcript.splitlines()[2].startswith("[00:13] Speaker 2:"))
        self.assertTrue(transcript.splitlines()[3].startswith("[00:18] Speaker 1:"))
        self.assertEqual(len(tasks), 2)
        self.assertEqual(tasks[0]["owner"], "Speaker 1")
        self.assertEqual(tasks[0]["due"], "Friday")
        self.assertEqual(tasks[1]["owner"], "Speaker 1")

    def test_legacy_transcript_compaction_relabels_only_after_speaker_changes(self):
        transcript = "[00:01] Speaker 1: Opening.\n[00:04] Speaker 1: Continued after a pause.\n[00:09] Speaker 2: New speaker.\n[00:12] Speaker 1: Speaker returns."

        self.assertEqual(
            compact_speaker_turns(transcript),
            "[00:01] Speaker 1: Opening.\n[00:04] Continued after a pause.\n[00:09] Speaker 2: New speaker.\n[00:12] Speaker 1: Speaker returns.",
        )

    @patch("app.urlopen")
    def test_cloud_request_uses_nova_three_and_keeps_key_in_header(self, mock_urlopen):
        mock_urlopen.return_value = BytesIO(json.dumps({
            "results": {
                "channels": [{"detected_language": "en", "alternatives": [{"transcript": "Hello there."}]}],
                "utterances": [],
            },
        }).encode())

        transcript, language = transcribe_with_deepgram("meeting.wav", b"audio-bytes", "test-key-that-is-not-real")

        request = mock_urlopen.call_args.args[0]
        parameters = parse_qs(urlparse(request.full_url).query)
        self.assertEqual(parameters["model"], ["nova-3"])
        self.assertEqual(request.get_header("Authorization"), "Token test-key-that-is-not-real")
        self.assertEqual(request.data, b"audio-bytes")
        self.assertEqual((transcript, language), ("Hello there.", "en"))

    @patch("app.urlopen")
    def test_groq_assistant_receives_meeting_context_and_chat_history(self, mock_urlopen):
        mock_urlopen.return_value = BytesIO(json.dumps({
            "choices": [{"message": {"content": "Maya owns the launch plan, due Friday."}}],
        }).encode())
        meeting = create_meeting("Launch", "Maya will send the final plan by Friday.", "notes")

        answer = meetflow_app.ask_groq(
            "Who owns the plan?",
            [meeting],
            "groq-test-key-that-is-not-real",
            [{"role": "user", "content": "What action did we discuss?"}],
        )

        request = mock_urlopen.call_args.args[0]
        payload = json.loads(request.data)
        self.assertEqual(request.full_url, "https://api.groq.com/openai/v1/chat/completions")
        self.assertEqual(request.get_header("Authorization"), "Bearer groq-test-key-that-is-not-real")
        self.assertEqual(payload["model"], meetflow_app.GROQ_MODEL)
        self.assertIn("Maya will send the final plan", payload["messages"][1]["content"])
        self.assertEqual(payload["messages"][-2], {"role": "user", "content": "What action did we discuss?"})
        self.assertEqual(answer, "Maya owns the launch plan, due Friday.")

    @patch("app.urlopen")
    def test_groq_key_verification_checks_auth_and_model_access(self, mock_urlopen):
        mock_urlopen.return_value = BytesIO(json.dumps({"data": [{"id": meetflow_app.GROQ_MODEL}]}).encode())

        meetflow_app.validate_groq_api_key("gsk-test-key-that-is-not-real")

        request = mock_urlopen.call_args.args[0]
        self.assertEqual(request.full_url, "https://api.groq.com/openai/v1/models")
        self.assertEqual(request.get_header("Authorization"), "Bearer gsk-test-key-that-is-not-real")

    @patch("app.urlopen")
    def test_groq_key_verification_explains_rejected_key(self, mock_urlopen):
        mock_urlopen.side_effect = HTTPError(
            "https://api.groq.com/openai/v1/models",
            401,
            "Unauthorized",
            {},
            BytesIO(b'{"error":{"message":"Invalid API Key"}}'),
        )

        with self.assertRaisesRegex(ValueError, r"Groq could not verify this API key \(401\): Invalid API Key"):
            meetflow_app.validate_groq_api_key("gsk-test-key-that-is-not-real")

    def test_meeting_contains_summary_and_action_timeline(self):
        meeting = create_meeting("Launch", "We approved the new checklist. Maya will draft the plan by Monday.", "notes")

        self.assertEqual(meeting["title"], "Launch")
        self.assertTrue(meeting["summary"])
        self.assertGreaterEqual(len(meeting["events"]), 4)
        self.assertEqual(meeting["tasks"][0]["owner"], "Maya")

    def test_reanalysis_preserves_completed_unchanged_tasks(self):
        transcript = "Maya will send the launch plan by Friday."
        meeting = create_meeting("Launch", transcript, "notes")
        meeting["tasks"][0]["completed"] = True
        meeting["tasks"][0]["reminder_sent_for"] = meeting["tasks"][0]["due_date"]

        refresh_analysis(meeting, transcript)

        self.assertTrue(meeting["tasks"][0]["completed"])
        self.assertEqual(meeting["tasks"][0]["reminder_sent_for"], meeting["tasks"][0]["due_date"])

    def test_summary_points_and_every_extraction_include_audit_evidence(self):
        transcript = (
            "[00:01] Speaker 1: The checkout process loses many new customers before they finish account setup.\n"
            "[00:08] Speaker 2: Mobile users report repeated confusion about the confirmation screen.\n"
            "[00:15] Speaker 1: I will revise the mobile flow by Friday.\n"
            "[00:19] Speaker 2: Decision: we will remove the secondary form.\n"
            "[00:25] Speaker 2: Does everyone agree to use the new wording?"
        )

        analysis = build_analysis(transcript)

        self.assertEqual(len(analysis["main_points"]), 2)
        self.assertIn("checkout process", analysis["main_points"][0]["text"])
        self.assertTrue(all(point["evidence"].startswith("[00:") for point in analysis["main_points"]))
        self.assertEqual(analysis["tasks"][0]["owner"], "Speaker 1")
        self.assertIn("by Friday", analysis["tasks"][0]["audit"]["due_evidence"])
        self.assertEqual(analysis["decision_audit"][0]["matched_cue"], "Decision:")
        self.assertIn("[00:19] Speaker 2:", analysis["decision_audit"][0]["evidence"])
        self.assertTrue(analysis["open_questions"])
        evidence_items = [point["evidence"] for point in analysis["main_points"]]
        evidence_items.extend(item["evidence"] for item in analysis["decision_audit"])
        evidence_items.extend(task["audit"]["source"] for task in analysis["tasks"])
        self.assertTrue(all(evidence in transcript for evidence in evidence_items))

    def test_second_sentence_quotes_the_exact_original_speaker_line(self):
        transcript = "Maya: Opening context. We agreed to postpone launch until Friday."
        analysis = build_analysis(transcript)

        self.assertEqual(analysis["decision_audit"][0]["evidence"], transcript)

    def test_summary_ranking_covers_repeated_topics_across_the_meeting(self):
        transcript = (
            "[00:00] Speaker 1: The team is discussing how price might impact sales in every region because price strategy needs to change across markets.\n"
            "[00:30] Speaker 2: A lower price in another market changes the pricing strategy because sales are sensitive to price and regional market size.\n"
            "[06:00] Speaker 2: Customer support says new customers cannot finish setup when the confirmation form has too many fields.\n"
            "[06:30] Speaker 1: Account setup is confusing on mobile and causes customers to leave before confirming purchases.\n"
            "[12:00] Speaker 2: Engineering reports the data export depends on the partner API and the release date is at risk.\n"
            "[18:00] Speaker 1: So anything else anybody wants to add to the agenda?"
        )

        points = build_analysis(transcript)["main_points"]
        point_text = " ".join(point["text"].casefold() for point in points)

        self.assertIn("price", point_text)
        self.assertIn("setup", point_text)
        self.assertIn("data export", point_text)
        self.assertNotIn("anything else", point_text)

    def test_summary_skips_introductions_and_incomplete_utterances(self):
        transcript = (
            "[00:00] Speaker 1: First of all, let's make sure that we all know each other before the product discussion.\n"
            "[00:15] Speaker 1: My name is Laura and I am the project manager for this workshop.\n"
            "[00:20] Speaker 1: This is just what we're gonna be doing over the next twenty five minutes.\n"
            "[00:30] Speaker 1: The design team needs to reduce setup friction for new customers across mobile checkout.\n"
            "[06:00] Speaker 2: The regional sales forecast depends on pricing changes and current market size.\n"
            "[13:00] Speaker 2: Remote control customers value consolidated home lighting and television control.\n"
            "[19:00] Speaker 1: There is one additional category or"
        )

        point_text = " ".join(point["text"].casefold() for point in build_analysis(transcript)["main_points"])

        self.assertNotIn("know each other", point_text)
        self.assertNotIn("my name is", point_text)
        self.assertNotIn("next twenty five minutes", point_text)
        self.assertNotIn("category or", point_text)

    def test_facilitator_prompt_is_flagged_as_an_open_question(self):
        analysis = build_analysis("Maya: Anything else anybody wants to add about the release date?")

        self.assertFalse(analysis["main_points"])
        self.assertTrue(analysis["open_questions"])

    def test_legacy_meeting_is_upgraded_with_audit_fields(self):
        meeting = {"transcript": "The team discussed checkout. Maya will update the flow by Friday.", "tasks": []}

        self.assertTrue(migrate_meeting_analysis(meeting))
        self.assertEqual(meeting["analysis_version"], ANALYSIS_VERSION)
        self.assertIn("main_points", meeting)
        self.assertIn("audit", meeting["tasks"][0])

    def test_empty_summary_prompts_for_transcript(self):
        self.assertIn("transcript", make_summary(""))

    def test_remove_task_preserves_other_actions(self):
        meeting = create_meeting("Launch", "Maya will send the plan by Friday. Leo will review the copy by Monday.", "notes")
        removed_id = meeting["tasks"][0]["id"]

        removed = remove_meeting_task(meeting, removed_id)

        self.assertEqual(removed["id"], removed_id)
        self.assertEqual(len(meeting["tasks"]), 1)
        self.assertEqual(meeting["tasks"][0]["owner"], "Leo")

    def test_clear_saved_meetings_empties_store_and_invalidates_jobs(self):
        with TemporaryDirectory() as temporary_directory:
            directory = Path(temporary_directory)
            with patch.object(meetflow_app, "DATA_DIR", directory), patch.object(meetflow_app, "DATA_FILE", directory / "meetings.json"), patch.object(meetflow_app, "DATA_EPOCH", 4):
                meetflow_app.write_meetings([{"id": "first"}, {"id": "second"}])

                cleared = meetflow_app.clear_saved_meetings()

                self.assertEqual(cleared, 2)
                self.assertEqual(meetflow_app.read_meetings(), [])
                self.assertEqual(meetflow_app.DATA_EPOCH, 5)

    def test_conversational_filler_is_stripped_and_summary_is_concise(self):
        text = "So I think, yeah, this is like, let's take the stuff from 14.0 and add a few more to hit different areas of press or give, give our PR team fodder to go out with."
        analysis = build_analysis(f"[00:01] Speaker 1: {text}")
        self.assertNotIn("So I think", analysis["main_points"][0]["text"])
        self.assertNotIn("give, give", analysis["main_points"][0]["text"])
        self.assertTrue(analysis["summary"])
        self.assertLessEqual(len(analysis["summary"].split()), 40)

    def test_meeting_chatbot_answers_summary_tasks_and_decisions(self):
        transcript = (
            "[00:01] Speaker 1: We decided to keep the security release date on Friday.\n"
            "[00:10] Speaker 2: Maya will prepare the announcement by Thursday.\n"
            "[00:20] Speaker 1: Does anyone have questions about vulnerability management?"
        )
        meeting = create_meeting("Weekly Sync", transcript, "notes")
        
        # Test summary intent
        ans_summary = meetflow_app.answer_meeting_question("Can you summarize the meeting?", meeting)
        self.assertIn("Overview of", ans_summary)
        self.assertIn("Weekly Sync", ans_summary)

        # Test decisions intent
        ans_decisions = meetflow_app.answer_meeting_question("What decisions were made?", meeting)
        self.assertIn("Decisions", ans_decisions)
        self.assertIn("keep the security release date on Friday", ans_decisions)

        # Test tasks intent
        ans_tasks = meetflow_app.answer_meeting_question("What are our action items and tasks?", meeting)
        self.assertIn("Action Items", ans_tasks)
        self.assertIn("Maya", ans_tasks)

        # Test deadlines intent
        ans_deadlines = meetflow_app.answer_meeting_question("What deadlines were mentioned?", meeting)
        self.assertIn("Deadlines", ans_deadlines)

        # Test topic search intent
        ans_topic = meetflow_app.answer_meeting_question("What about vulnerability management?", meeting)
        self.assertIn("vulnerability management", ans_topic)
        self.assertIn("Speaker 1", ans_topic)


    def test_employee_auth_and_session_flow(self):
        with TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            with patch("app.DATA_DIR", temp_path):
                meetflow_app.init_db()
                # Test default seeded user
                user_rec = meetflow_app.db_query("SELECT * FROM employees WHERE email = ?", ("alex@meetflow.ai",), fetch="one")
                self.assertIsNotNone(user_rec)
                self.assertEqual(user_rec["name"], "Alex Morgan")
                self.assertTrue(meetflow_app.verify_password("meetflow123", user_rec["password_hash"], user_rec["salt"]))
                self.assertFalse(meetflow_app.verify_password("wrongpassword", user_rec["password_hash"], user_rec["salt"]))

                # Test creating session and resolving current user
                token = meetflow_app.create_session(user_rec["id"])
                self.assertTrue(token)
                resolved = meetflow_app.get_current_user_from_headers({"Authorization": f"Bearer {token}"})
                self.assertIsNotNone(resolved)
                self.assertEqual(resolved["id"], user_rec["id"])
                self.assertEqual(resolved["email"], "alex@meetflow.ai")

    def test_monthly_attendance_graph_data(self):
        with TemporaryDirectory() as temp_dir:
            temp_path = Path(temp_dir)
            with patch("app.DATA_DIR", temp_path):
                meetflow_app.init_db()
                analytics = meetflow_app.get_monthly_attendance_graph("emp_alex", range_months=12)
                self.assertEqual(analytics["employeeId"], "emp_alex")
                self.assertGreater(analytics["totalMeetings"], 0)
                self.assertGreater(analytics["totalHours"], 0)
                self.assertEqual(len(analytics["months"]), 12)
                self.assertTrue(any(m["count"] > 0 for m in analytics["months"]))
                self.assertTrue(len(analytics["recentMeetings"]) > 0)


if __name__ == "__main__":
    unittest.main()