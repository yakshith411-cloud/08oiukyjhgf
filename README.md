# Meetflow

A local meeting-to-project workspace. Upload a recording for fast online transcription with AssemblyAI, or paste an existing transcript. Meetflow creates a summary, highlights explicit decisions, extracts action items with speaker/owner labels and mentioned due dates, and builds an exportable Markdown project brief.

## Start on Windows

1. Install Python 3.10 or newer.
2. Double-click `start.bat`.
3. The app opens at `http://127.0.0.1:54827` (or the next available port in the `54827` range).

The first start creates a local Python virtual environment; no Python packages need to be downloaded. AssemblyAI transcription is configured on the server via `ASSEMBLYAI_API_KEY` (pre-set in `start.bat` and server defaults).

Audio is sent to AssemblyAI over HTTPS for transcription. Transcripts, extracted tasks, and project documents are stored in the project's local `data` folder. Review AssemblyAI's terms before sending sensitive recordings. Cloud speed depends on recording length, upload bandwidth, and provider availability; short recordings are often transcribed in seconds, while a long meeting may take longer than a minute.

Use **Ask Meetflow** to ask questions across saved meeting transcripts, summaries, decisions, actions, owners, and deadlines. Connect a Groq API key in the assistant dialog, or set `GROQ_API_KEY` before starting the app. The key stays in server memory for that app session; questions and saved meeting context are sent to Groq over HTTPS to generate answers. The assistant is limited to the meeting records it receives and should say when they do not contain an answer.

To stop the app, close the console window or press Ctrl+C in it. To run the focused tests, activate `.venv` and run `python -m unittest discover -s tests`.

## Notes

Discussion summaries are extractive, not generated prose: Meetflow ranks up to five non-question, non-decision, non-action transcript sentences by distinct and recurring content words, skips introductions and incomplete utterances, penalizes topical overlap and timestamps within ten minutes, removes near-duplicates, and preserves each source utterance. The rank score is only an ordering aid, not a confidence estimate.

Decision, task, open-question, and risk detection use transparent text-matching rules, not a generative AI service. Each item includes the triggering cue, rationale, and source utterance so a reviewer can verify or reject it. Speaker labels come from AssemblyAI diarization; consecutive utterances from the same speaker are grouped under one label until the diarized speaker changes. Labels such as `Speaker 1` distinguish voices but do not identify people by name. Review generated owners and deadlines before treating them as commitments. The app accepts common audio/video files up to 250 MB.

When a task contains a deadline that can be normalized to a calendar date, Meetflow shows an in-app reminder during the two-day window before it is due. Use the clock button to opt in to browser notifications; they can appear only while this local app/browser is running, and are not email or offline reminders. Ambiguous phrases such as “next week” remain unscheduled rather than triggering a guessed date.