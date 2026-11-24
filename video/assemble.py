#!/usr/bin/env python3
"""Builds out/lgtie-demo.mp4: fits each recorded clip to its narration, adds subtitles, mixes the voice.
No speed-ups: clips were recorded at normal speed, timed to the narration. Only real waiting (marked with dead() while recording) is cut out.
Light on resources on purpose: one ffmpeg at a time, 2 threads, `nice`, 24 fps, 720p.
Usage (from the folder that holds out/):  python3 assemble.py"""
import json, os, subprocess, textwrap

OUT = "out"; CLIPS = OUT + "/clips"; TMP = OUT + "/tmp"; os.makedirs(TMP, exist_ok=True)
FFMPEG = ["nice", "-n", "19", "ffmpeg", "-v", "error", "-y", "-threads", "2"]
def run(cmd): subprocess.run(cmd, check=True)
sentences = json.load(open(OUT + "/sentences.json")); scenes = json.load(open(OUT + "/scenes.json")); durs = json.load(open(CLIPS + "/durations.json"))
marks = json.load(open(CLIPS + "/marks.json")) if os.path.exists(CLIPS + "/marks.json") else {}
audio_len = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", OUT + "/narration.mp3"]).strip())
TAIL = 1.2; MIN_SPEED, MAX_SPEED = 0.92, 1.08

# 1. one video segment per scene, as long as its narration (the next scene starts where this one's words begin)
starts = [0.0] + [s["start"] for s in scenes[1:]]; ends = starts[1:] + [audio_len + TAIL]
parts = []
for i, sc in enumerate(scenes):
    D = ends[i] - starts[i]; clip = f"{CLIPS}/{sc['id']}.mp4"; src = durs[sc["id"]]
    cuts = [(a + 0.5, b - 0.2) for a, b in marks.get(sc["id"], []) if b - a > 0.9]          # real waiting: keep half a second, drop the rest
    kept = src - sum(b - a for a, b in cuts)
    f = max(MIN_SPEED, min(MAX_SPEED, kept / D)); stretched = kept / f
    vf = ["fps=24"]
    if cuts: vf += ["select='not(" + "+".join(f"between(t,{a:.2f},{b:.2f})" for a, b in cuts) + ")'", "setpts=N/(24*TB)"]
    vf += [f"setpts=PTS/{f:.4f}", "scale=1280:720:flags=bicubic", "setsar=1"]
    if stretched < D: vf.append(f"tpad=stop_mode=clone:stop_duration={D - stretched + 0.2:.3f}")   # hold the last frame if the clip is short
    vf += [f"trim=duration={D:.3f}", "setpts=PTS-STARTPTS", "fade=t=in:st=0:d=0.3", f"fade=t=out:st={max(0, D - 0.3):.3f}:d=0.3", "format=yuv420p"]
    out = f"{TMP}/scene_{i}.mp4"
    run(FFMPEG + ["-i", clip, "-vf", ",".join(vf), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-r", "24", out])
    note = ("  cut %.1fs of waiting" % sum(b - a for a, b in cuts)) if cuts else ""
    print(f"{sc['id']:9s} narration {D:5.1f}s  clip {src:5.1f}s{note}  speed x{f:.2f}" + ("  (held last frame)" if stretched < D - 0.05 else "") + ("  (trimmed end)" if stretched > D + 0.05 else ""))
    parts.append(out)
open(f"{TMP}/list.txt", "w").write("".join(f"file '{os.path.abspath(p)}'\n" for p in parts))
run(FFMPEG + ["-f", "concat", "-safe", "0", "-i", f"{TMP}/list.txt", "-c", "copy", f"{TMP}/video.mp4"])

# 2. subtitles: each spoken sentence split into short lines, shown for the time it is spoken
def fmt(t): h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60; return f"{h:02d}:{m:02d}:{int(s):02d},{int((s % 1) * 1000):03d}"
cues = []
for s in sentences:
    words = s["text"].split(); chunks, cur = [], []
    for w in words:
        cur.append(w)
        if len(" ".join(cur)) >= 64: chunks.append(" ".join(cur)); cur = []
    if cur: chunks.append(" ".join(cur))
    if len(chunks) > 1 and len(chunks[-1]) < 14: last = chunks.pop(); chunks[-1] += " " + last
    total = sum(len(c) for c in chunks); t = s["start"]
    for c in chunks:
        d = (s["end"] - s["start"]) * len(c) / total; cues.append((t, t + d, c)); t += d
srt = ""
for n, (a, b, c) in enumerate(cues, 1):
    body = "\n".join(textwrap.wrap(c, 38))
    srt += f"{n}\n{fmt(a)} --> {fmt(b)}\n{body}\n\n"
open(f"{OUT}/subtitles.srt", "w").write(srt)

# 3. burn the subtitles in and mix the narration (voice only, levelled, with a short fade at the end)
style = "FontName=DejaVu Sans,Fontsize=11,Bold=0,PrimaryColour=&H00FFFFFF,OutlineColour=&H99000000,BorderStyle=3,Outline=4,Shadow=0,Alignment=2,MarginV=14"
total = ends[-1]
run(FFMPEG + ["-i", f"{TMP}/video.mp4", "-i", OUT + "/narration.mp3", "-filter_complex",
              f"[0:v]subtitles={OUT}/subtitles.srt:force_style='{style}'[v];[1:a]loudnorm=I=-16:TP=-1.5:LRA=11,apad,afade=t=out:st={total - 1.0:.2f}:d=1.0[a]",
              "-map", "[v]", "-map", "[a]", "-t", f"{total:.2f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-pix_fmt", "yuv420p", "-r", "24",
              "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", OUT + "/lgtie-demo.mp4"])
print("done:", OUT + "/lgtie-demo.mp4", f"{total:.1f}s")
