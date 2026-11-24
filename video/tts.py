#!/usr/bin/env python3
# Makes one continuous narration with a Microsoft neural voice (the Edge online text-to-speech service, no API key) and records when each
# sentence is spoken, so scenes and subtitles can be timed to it. Output: out/narration.mp3, out/sentences.json, out/scenes.json.
import asyncio, json, os, re, subprocess
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
    # tighten the pauses the voice leaves between sentences (about 0.5 s) to KEEP seconds so the speech has a natural, brisk rhythm,
    # and remap every timestamp. narration_raw.mp3 keeps the untouched synthesis.
    KEEP, MIN_SIL = 0.35, 0.40
    raw = os.path.join(out, "narration.mp3"); os.replace(raw, os.path.join(out, "narration_raw.mp3")); raw = os.path.join(out, "narration_raw.mp3")
    det = subprocess.run(["nice", "-n", "19", "ffmpeg", "-hide_banner", "-i", raw, "-af", f"silencedetect=noise=-38dB:d={MIN_SIL}", "-f", "null", "-"], capture_output=True, text=True).stderr
    st_ = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", det)]; en_ = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", det)]
    cuts = [(a + KEEP, b) for a, b in zip(st_, en_) if b - a > KEEP + 0.05]
    remap = lambda t: t - sum(min(t, b) - a for a, b in cuts if t > a)
    rl = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", raw]).strip())
    segs, pos = [], 0.0
    for a, b in cuts: segs.append((pos, a)); pos = b
    segs.append((pos, rl))
    fc = "".join(f"[0:a]atrim=start={a:.3f}:end={b:.3f},asetpts=PTS-STARTPTS[s{i}];" for i, (a, b) in enumerate(segs)) + "".join(f"[s{i}]" for i in range(len(segs))) + f"concat=n={len(segs)}:v=0:a=1[a]"
    subprocess.run(["nice", "-n", "19", "ffmpeg", "-v", "error", "-y", "-threads", "2", "-i", raw, "-filter_complex", fc, "-map", "[a]", os.path.join(out, "narration.mp3")], check=True)
    for x in sents: x["start"], x["end"] = remap(x["start"]), remap(x["end"])
    for x in scenes:
        if x["start"] is not None: x["start"], x["end"] = remap(x["start"]), remap(x["end"])
    json.dump(sents, open(os.path.join(out, "sentences.json"), "w"), indent=1); json.dump(scenes, open(os.path.join(out, "scenes.json"), "w"), indent=1)
    words = sum(len(x["text"].split()) for x in sents); spoken = sum(x["end"] - x["start"] for x in sents)
    print("sentences:", len(sents), "| pauses shortened:", len(cuts), "| speaking rate: %.2f words/s" % (words / spoken), "| total %.1fs" % (sents[-1]["end"])); [print(s) for s in scenes]
asyncio.run(main())
