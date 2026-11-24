# Demo video

`narration.json` holds the script. The video is rebuilt from it with a few small scripts. The finished file (`out/lgtie-demo.mp4`, about 2 minutes 20 seconds) and its subtitles (`out/subtitles.srt`) are not committed because they are build output.

**How it is made**

1. `tts.py` makes one continuous narration with a Microsoft neural voice (`en-US-AndrewNeural`, rate set in `narration.json`) through the Edge online text-to-speech service, which needs no API key, tightens the pauses between sentences, and records when each sentence is spoken. The voice is synthetic; say so when you upload the video.
2. `rec-live.mjs` records the scenes that use the live site (https://lgtie.vercel.app) as a normal 1366x768 browser window, with puppeteer and Chrome's built-in screen recording.
3. `rec-fork.mjs` records the two scenes that need a real customer and reviewer flow. They run in a **test environment** (a fork of X Layer, test wallets, a Chrome virtual passkey) and are labelled as such on screen, with the role (Customer, Business, Reviewer) shown for each page.
4. `assemble.py` joins the clips with ffmpeg. Nothing is sped up, slowed down or stretched. While recording, each sentence's illustrating action is timed; where the screen is a little behind the voice, the assembly inserts a natural pause in the narration, so the narrator never talks about something that has not appeared yet. Each page appears 0.6 s before it is discussed, with a short fade on every change of page. Real waiting (transactions, page loads) is cut out. No subtitles are burned in; a separate `subtitles.srt` is written for captions.

**Pacing.** Cursor moves, scrolls and typing are scaled by `PACE` in `lib.mjs` (smaller is brisker). The voice speed is `rate` in `narration.json` (run `tts.py` again after changing it). A pointer with a halo and click ripples shows where to look, and a soft orange outline marks the element being discussed.

The scripts need puppeteer-core, `ws`, ffmpeg, Foundry (for the fork scenes) and the Python package `edge-tts`. Run one process at a time: they are light on the machine (720p, 24 fps, ffmpeg at low priority), and the fork should only run while recording.
