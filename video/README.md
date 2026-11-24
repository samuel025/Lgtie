# Demo video

`narration.json` holds the script. The video is rebuilt from it with a few small scripts. The finished file (`out/lgtie-demo.mp4`, about 2 minutes 20 seconds) and its subtitles (`out/subtitles.srt`) are not committed because they are build output.

**How it is made**

1. `tts.py` makes one continuous narration with a Microsoft neural voice (`en-US-AndrewNeural`, rate set in `narration.json`; pauses between sentences tightened to 0.35 s; about 170 words a minute overall) through the Edge online text-to-speech service, which needs no API key, and records when each sentence is spoken. The voice is synthetic; say so when you upload the video.
2. `rec-live.mjs` records the scenes that use the live site (https://lgtie.vercel.app) with puppeteer and Chrome's built-in screen recording.
3. `rec-fork.mjs` records the two scenes that need a real customer and reviewer flow. They run in a **test environment** (a fork of X Layer, test wallets, a Chrome virtual passkey) and are labelled as such on screen.
4. `assemble.py` fits each clip to its narration, cuts only real waiting (transactions, page loads), adds subtitles and mixes the voice with ffmpeg.

**Pacing.** Nothing is sped up or slowed down. Every on-screen action is scheduled against the timing of the sentence it illustrates (`lib.mjs`, `scene()`), so the picture waits for the words. The page is rendered at 1120x630 and captured at 1280x720 so text is larger. A big orange pointer with a halo and click ripples shows where to look, and an orange highlight box dims everything else while a point is made.

The scripts need puppeteer-core, `ws`, ffmpeg, Foundry (for the fork scenes) and the Python package `edge-tts`. Run one process at a time: they are light on the machine (720p, 24 fps, ffmpeg at low priority), and the fork should only run while recording.

**Tuning.** To change the speed of the voice, edit `rate` in `narration.json` and run `tts.py` again. To change how quickly the cursor moves, scrolls and types, edit `PACE` in `lib.mjs` (smaller is brisker) and record the scenes again.
