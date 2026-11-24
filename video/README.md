# Demo video

`narration.json` holds the script. The video is rebuilt from it with a few small scripts. The finished file (`out/lgtie-demo.mp4`, about 2 minutes 20 seconds) and its subtitles (`out/subtitles.srt`) are not committed because they are build output.

**How it is made**

1. `tts.py` makes one continuous narration with a Microsoft neural voice (`en-US-AndrewNeural`) through the Edge online text-to-speech service, which needs no API key, and records when each sentence is spoken. The voice is synthetic; say so when you upload the video.
2. `rec-live.mjs` records the scenes that use the live site (https://lgtie.vercel.app) with puppeteer and Chrome's built-in screen recording, with a visible cursor.
3. `rec-fork.mjs` records the two scenes that need a real customer and reviewer flow. They run in a **test environment** (a fork of X Layer, test wallets, a Chrome virtual passkey) and are labelled as such on screen.
4. `assemble.py` fits each clip to its narration (tightening the pauses between sentences), adds subtitles and mixes the voice with ffmpeg.

The scripts need puppeteer-core, `ws`, ffmpeg, Foundry (for the fork scenes) and the Python package `edge-tts`. They are meant to run one process at a time and are light on the machine (720p, 24 fps, ffmpeg at low priority).
