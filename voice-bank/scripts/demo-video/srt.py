"""Writes an SRT file from the captured timeline, chunked exactly like the on-screen subtitles.

Usage: python3 scripts/demo-video/srt.py <timeline.json> <out.srt>
"""
import json
import re
import sys


def chunks(text):
    parts = re.findall(r'[^。？！；]+[。？！；]?', text) or [text]
    out = []
    for p in parts:
        if out and len(out[-1] + p) <= 30:
            out[-1] += p
        else:
            out.append(p)
    return out


def stamp(t):
    ms = int(round(t * 1000))
    return f'{ms // 3600000:02}:{ms // 60000 % 60:02}:{ms // 1000 % 60:02},{ms % 1000:03}'


def main():
    tl = json.load(open(sys.argv[1]))
    rows = []
    for line in tl['lines']:
        cs = chunks(line['text'])
        total = sum(len(c) for c in cs)
        acc = 0
        for c in cs:
            start = line['start'] + (line['end'] - line['start']) * acc / total
            acc += len(c)
            end = line['start'] + (line['end'] - line['start']) * acc / total
            rows.append((start, end, f"{line['speaker']}：{c}"))
    with open(sys.argv[2], 'w', encoding='utf-8') as f:
        for i, (s, e, text) in enumerate(rows, 1):
            f.write(f'{i}\n{stamp(s)} --> {stamp(e)}\n{text}\n\n')
    print(f'{len(rows)} cues')


if __name__ == '__main__':
    main()
