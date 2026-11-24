#!/usr/bin/env python3
# Makes one continuous narration with a Microsoft neural voice (the Edge online text-to-speech service, no API key) and records when each
# sentence is spoken, so scenes and subtitles can be timed to it. Output: out/narration.mp3, out/sentences.json, out/scenes.json.
import asyncio, json, os
import edge_tts
here = os.path.dirname(os.path.abspath(__file__)); out = os.path.join(here, "out"); os.makedirs(out, exist_ok=True)
d = json.load(open(os.path.join(here, "narration.json")))
text = " ".join(s["text"] for s in d["scenes"])
norm = lambda s: " ".join(s.split()).lower()
async def main():
    com = edge_tts.Communicate(text, d["voice"], rate=d["rate"])
    sents, audio = [], bytearray()
    async for ch in com.stream():
        if ch["type"] == "audio": audio += ch["data"]
        elif ch["type"] == "SentenceBoundary": sents.append({"text": ch["text"], "start": ch["offset"] / 1e7, "end": (ch["offset"] + ch["duration"]) / 1e7})
    open(os.path.join(out, "narration.mp3"), "wb").write(bytes(audio)); json.dump(sents, open(os.path.join(out, "sentences.json"), "w"), indent=1)
    # assign each spoken sentence to the scene whose text contains it
    scenes = [{"id": s["id"], "start": None, "end": None} for s in d["scenes"]]; cur = 0
    for st in sents:
        while cur < len(d["scenes"]) and norm(st["text"])[:40] not in norm(d["scenes"][cur]["text"]): cur += 1
        if cur >= len(d["scenes"]): break
        sc = scenes[cur]; sc["start"] = st["start"] if sc["start"] is None else sc["start"]; sc["end"] = st["end"]
    json.dump(scenes, open(os.path.join(out, "scenes.json"), "w"), indent=1)
    print("sentences:", len(sents), "audio bytes:", len(audio)); [print(s) for s in scenes]
asyncio.run(main())
