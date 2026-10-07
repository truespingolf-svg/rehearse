# RehearseFlow

A dark-mode, local-first worship rehearsal web app for practicing with a YouTube reference recording and an authorized chord/lyric chart.

## What works now

- YouTube link -> embedded player.
- Chord/lyric PDF upload and browser-side text extraction.
- Heuristic section/chord detection.
- Optional Gemini analysis through a Netlify Function.
- Precision section syncing using the actual YouTube playback clock.
- BPM-synced click with downbeat offset calibration.
- 2-bar count-in control UI.
- Playback speed controls.
- Section looping.
- Click any arrangement section to jump there.
- Saved songs in browser localStorage.
- Responsive dark interface designed for rehearsal use.

## Important accuracy note

A YouTube recording is not exposed as a raw audio file by this app. That is intentional. The app uses the official YouTube embedded player as the playback clock and anchors your chart to exact YouTube timestamps. For reliable rehearsal timing, use the "Set here" buttons while the song is playing to place section starts, and use "Tap downbeat" to calibrate the click.

Chord timing inside a section is currently distributed by `beatsPerChord`. This is editable in code/arrangement data and is deliberately not presented as automatic audio transcription.

## Netlify deployment

1. Unzip this project.
2. Drag the `RehearseFlow` folder to Netlify Drop, or connect it to a Git repository. Netlify documents drag-and-drop deployment here: https://docs.netlify.com/deploy/create-deploys/
3. The site publishes as a Netlify URL.
4. The app works without a YouTube API key when users paste a direct YouTube URL, because playback uses the YouTube IFrame Player API.
5. If you want server-side YouTube Data API search/metadata, add a restricted `YOUTUBE_API_KEY` environment variable and a serverless endpoint.
6. If you want the optional Gemini chart analysis, add a `GEMINI_API_KEY` environment variable. Never paste API keys into `app.js` or commit them to Git.

## Security

The YouTube API key previously pasted into chat should be considered compromised. Revoke/rotate that key in Google Cloud and create a replacement restricted to the APIs and website origins you actually need.
