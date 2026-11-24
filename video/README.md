# Demo video

`narration.json` holds the script. The video is rebuilt from it with a few small scripts. The finished file (`out/lgtie-demo.mp4`, about 2 minutes 20 seconds) and its subtitles (`out/subtitles.srt`) are not committed because they are build output.

**What the video is.** An explainer told as one story: Maya buys a laptop from Acme and it breaks. Title cards say which part we are in. Short callout bubbles with arrows say, in plain words, what each part of the screen means, so it can be followed with the sound off. The passkey part is broken into steps (Maya answers, her device asks for a fingerprint, the signed answers go to Acme's inbox, Acme submits, evidence, the optional helper), each with its own explanation. The fingerprint prompt is an **illustration** (labelled as such on screen), because the test setup has no sensor.

**How it is made**

1. `tts.py` makes one continuous narration with a Microsoft neural voice (`en-US-AndrewNeural`, rate set in `narration.json`) through the Edge online text-to-speech service, which needs no API key, tightens the pauses between sentences, and records when each sentence is spoken. The voice is synthetic; say so when you upload the video.
2. `rec-live.mjs` records the scenes that use the live site (https://lgtie.vercel.app) as a normal 1366x768 browser window, with puppeteer and Chrome's built-in screen recording.
3. `rec-fork.mjs` records the two scenes that need a real customer and reviewer flow. They run in a **test environment** (a fork of X Layer, test wallets, a Chrome virtual passkey) and are labelled as such on screen, with the role (Maya, Acme, reviewer) shown for each page.
4. `assemble.py` joins the clips with ffmpeg. Nothing is sped up, slowed down or stretched. While recording, if an action takes longer than its sentence, everything after it moves back by the same amount, and the assembly makes the voice wait that long, so the screen and the voice stay in step. Each scene appears before the narrator speaks about it (so a title card can show first), with a short fade on every change of page. Real waiting (transactions, page loads) is cut out. No subtitles are burned in; a separate `subtitles.srt` is written for captions.

**Tuning.** Cursor moves, scrolls and typing are scaled by `PACE` in `lib.mjs`. The voice speed is `rate` in `narration.json` (run `tts.py` again after changing it). Callout text and title cards live in `rec-live.mjs` and `rec-fork.mjs`.

The scripts need puppeteer-core, `ws`, ffmpeg, Foundry (for the fork scenes) and the Python package `edge-tts`. Run one process at a time: they are light on the machine (720p, 24 fps, ffmpeg at low priority), and the fork should only run while recording.
