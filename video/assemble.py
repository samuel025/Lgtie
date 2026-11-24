#!/usr/bin/env python3
"""Builds out/lgtie-demo.mp4. The clips play at exactly real speed (nothing is sped up, slowed down, trimmed or stretched).
The narration follows the screen: while recording, each sentence's illustrating action is timed (beats.json). Where the screen is a bit behind
the voice, a natural pause is inserted before that sentence, so the narrator never talks about something that has not appeared yet.
Each page also appears LEAD seconds before the narrator speaks about it. Only real waiting (marked dead() while recording) is cut out.
No subtitles are burned in (a separate subtitles.srt is written). Light on resources: one ffmpeg at a time, 2 threads, `nice`, 24 fps, 720p.
Usage (from the folder that holds out/):  python3 assemble.py"""
import json, os, subprocess, textwrap

OUT = "out"; CLIPS = OUT + "/clips"; TMP = OUT + "/tmp"; os.makedirs(TMP, exist_ok=True)
FFMPEG = ["nice", "-n", "19", "ffmpeg", "-v", "error", "-y", "-threads", "2"]
def run(cmd): subprocess.run(cmd, check=True)
sentences = json.load(open(OUT + "/sentences.json")); scenes = json.load(open(OUT + "/scenes.json")); durs = json.load(open(CLIPS + "/durations.json"))
marks = json.load(open(CLIPS + "/marks.json")) if os.path.exists(CLIPS + "/marks.json") else {}
beats = json.load(open(CLIPS + "/beats.json")) if os.path.exists(CLIPS + "/beats.json") else {}
probe = lambda f, k: float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", k, "-of", "csv=p=0", f]).strip().splitlines()[0])
audio_len = probe(OUT + "/narration.mp3", "format=duration"); rate = int(probe(OUT + "/narration.mp3", "stream=sample_rate"))
LEAD, TAIL, MAX_PAUSE = 0.6, 1.2, 3.0
starts = [0.0] + [s["start"] for s in scenes[1:]]; ends = starts[1:] + [audio_len]

# 1. which sentences belong to which scene, and how far the screen is behind the narration at each one (the voice waits for it)
plan = []; cum = 0.0   # cum: seconds of pause added in earlier scenes
for i, sc in enumerate(scenes):
    ss = [x for x in sentences if starts[i] - 1e-6 <= x["start"] < ends[i] - 1e-6]
    b = beats.get(sc["id"], {}); run_max = 0.0; shifts = []
    for k in range(len(ss)):
        run_max = max(run_max, min(MAX_PAUSE, b.get(str(k), 0.0)) if str(k) in b else 0.0); shifts.append(run_max)
    end_shift = max(run_max, min(MAX_PAUSE * 2, b.get("end", 0.0)))
    plan.append({"id": sc["id"], "ss": ss, "shifts": shifts, "cum": cum, "end_shift": end_shift})
    cum += end_shift
total_pause = cum

# 2. one video segment per scene: exactly the recorded clip, minus the marked waiting
parts = []; seg_len = []
for i, sc in enumerate(scenes):
    clip = f"{CLIPS}/{sc['id']}.mp4"; src = durs[sc["id"]]
    cuts = [(a + 0.5, b - 0.2) for a, b in marks.get(sc["id"], []) if b - a > 0.9]          # real waiting: keep half a second, drop the rest
    kept = src - sum(b - a for a, b in cuts)
    D = (ends[i] - starts[i]) + (TAIL + LEAD if i == len(scenes) - 1 else 0) + plan[i]["end_shift"]
    vf = ["fps=24"]
    if cuts: vf += ["select='not(" + "+".join(f"between(t,{a:.2f},{b:.2f})" for a, b in cuts) + ")'", "setpts=N/(24*TB)"]
    vf += ["scale=1280:720:flags=bicubic", "setsar=1"]
    if kept < D: vf.append(f"tpad=stop_mode=clone:stop_duration={D - kept + 0.2:.3f}")   # only if the clip is a little short: hold the last frame
    vf += [f"trim=duration={D:.3f}", "setpts=PTS-STARTPTS", "fade=t=in:st=0:d=0.4", f"fade=t=out:st={max(0, D - 0.4):.3f}:d=0.4", "format=yuv420p"]
    out = f"{TMP}/scene_{i}.mp4"
    run(FFMPEG + ["-i", clip, "-vf", ",".join(vf), "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-r", "24", out])
    print(f"{sc['id']:9s} clip {src:5.1f}s" + (f"  cut {sum(b - a for a, b in cuts):.1f}s of waiting" if cuts else "") + f"  -> {D:5.1f}s on screen, voice waits for the screen {plan[i]['end_shift']:.1f}s in total")
    parts.append(out); seg_len.append(D)
open(f"{TMP}/list.txt", "w").write("".join(f"file '{os.path.abspath(p)}'\n" for p in parts))
run(FFMPEG + ["-f", "concat", "-safe", "0", "-i", f"{TMP}/list.txt", "-c", "copy", f"{TMP}/video.mp4"])
total = sum(seg_len)

# 3. the narration, cut at sentence boundaries, with a pause inserted wherever the screen needs a moment
placed = []   # (sentence, new start time)
pieces = []   # ("a", t0, t1) audio from the narration, or ("s", length) silence
prev_shift = 0.0; flat = [(p, x, p["shifts"][k]) for p in plan for k, x in enumerate(p["ss"])]
for n, (p, x, sh) in enumerate(flat):
    shift = p["cum"] + sh
    if shift - prev_shift > 0.05: pieces.append(("s", shift - prev_shift))
    t0 = x["start"] if n else 0.0; t1 = flat[n + 1][1]["start"] if n + 1 < len(flat) else audio_len
    pieces.append(("a", t0, t1)); placed.append((x, x["start"] + shift)); prev_shift = shift
fc = ""; labels = ""
for j, pc in enumerate(pieces):
    if pc[0] == "a": fc += f"[0:a]atrim=start={pc[1]:.3f}:end={pc[2]:.3f},asetpts=PTS-STARTPTS,aresample={rate}[p{j}];"
    else: fc += f"anullsrc=r={rate}:cl=mono,atrim=0:{pc[1]:.3f},asetpts=PTS-STARTPTS[p{j}];"
    labels += f"[p{j}]"
fc += f"{labels}concat=n={len(pieces)}:v=0:a=1,loudnorm=I=-16:TP=-1.5:LRA=11,adelay={int(LEAD * 1000)}|{int(LEAD * 1000)},apad,afade=t=out:st={total - 1.0:.2f}:d=1.0[a]"
run(FFMPEG + ["-i", OUT + "/narration.mp3", "-i", f"{TMP}/video.mp4", "-filter_complex", fc, "-map", "1:v", "-map", "[a]", "-t", f"{total:.2f}", "-c:v", "copy",
              "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", OUT + "/lgtie-demo.mp4"])

# 4. subtitles as a separate file (not burned in), matching the final timing
def fmt(t): t += LEAD; h = int(t // 3600); m = int(t % 3600 // 60); s = t % 60; return f"{h:02d}:{m:02d}:{int(s):02d},{int((s % 1) * 1000):03d}"
srt = ""
for n, (x, st) in enumerate(placed, 1): srt += f"{n}\n{fmt(st)} --> {fmt(st + x['end'] - x['start'])}\n" + "\n".join(textwrap.wrap(x["text"], 42)) + "\n\n"
open(f"{OUT}/subtitles.srt", "w").write(srt)
print("done:", OUT + "/lgtie-demo.mp4", f"{total:.1f}s (voice pauses added: {total_pause:.1f}s)")
