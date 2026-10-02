"""data/ 의 고지문으로 audio/ 의 MP3를 생성한다 (edge-tts 뉴럴 음성).

사용법:
    pip install edge-tts
    python tools/generate_audio.py            # 바뀐 문장만 생성
    python tools/generate_audio.py --force    # 전부 다시 생성
    python tools/generate_audio.py --lang en  # 특정 언어만

문장 텍스트 + 음성 + 속도의 해시를 audio/manifest.json 에 기록해서,
고지문이 바뀐 파일만 다시 만든다. 앱은 이 해시를 캐시 무효화에 사용한다.
"""
import argparse
import asyncio
import hashlib
import json
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
AUDIO = ROOT / "audio"
RATE = "-8%"  # 현장에서 알아듣기 쉽도록 약간 느리게
KO = {"code": "ko", "voice": "ko-KR-SunHiNeural"}


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def segments(lang, crimes):
    """app.js 의 buildSegments 와 같은 규칙으로 (파일명, 텍스트) 를 만든다."""
    out = {}
    for c in crimes:
        out[f"arrest_{c['id']}"] = lang["arrest"].replace("{crime}", lang["crimes"][c["id"]])
    out["rights"] = " ".join(lang["rights"])
    # 임의동행: 소속·이름·장소명은 화면에만 표시하므로 음성은 공통 문장으로 만든다
    v = lang["voluntary"]
    out["vol_identity"] = v["identityAudio"]
    out["vol_request"] = v["request"]
    for k, t in v["purposes"].items():
        out[f"vol_purpose_{k}"] = t
    for k, t in v["reasons"].items():
        out[f"vol_reason_{k}"] = t
    for k, t in v["places"].items():
        out[f"vol_place_{k}"] = v["place"].replace("{place}", t)
    out["vol_notice"] = " ".join(v["notice"])
    out["consular"] = " ".join(lang["consular"])
    if lang.get("consularMandatory"):
        out["consular_mandatory"] = " ".join(lang["consularMandatory"])
    return out


def digest(voice, text):
    return hashlib.sha1(f"{voice}|{RATE}|{text}".encode("utf-8")).hexdigest()[:10]


async def synth(sem, voice, text, dest):
    async with sem:
        for attempt in range(3):
            try:
                await edge_tts.Communicate(text, voice, rate=RATE).save(str(dest))
                return
            except Exception as e:  # 네트워크 일시 오류 재시도
                if attempt == 2:
                    raise RuntimeError(f"{dest}: {e}") from e
                await asyncio.sleep(2)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--lang")
    args = ap.parse_args()

    crimes = load(DATA / "crimes.json")
    langs = [KO] + load(DATA / "languages.json")
    manifest_path = AUDIO / "manifest.json"
    manifest = load(manifest_path) if manifest_path.exists() else {}

    sem = asyncio.Semaphore(4)
    jobs, fresh = [], {}
    for meta in langs:
        code = meta["code"]
        lang = load(DATA / "lang" / f"{code}.json")
        (AUDIO / code).mkdir(parents=True, exist_ok=True)
        for name, text in segments(lang, crimes).items():
            key = f"{code}/{name}.mp3"
            h = digest(meta["voice"], text)
            dest = AUDIO / key
            if args.lang and args.lang != code:
                fresh[key] = manifest.get(key, h)
                continue
            fresh[key] = h
            if args.force or manifest.get(key) != h or not dest.exists():
                jobs.append(synth(sem, meta["voice"], text, dest))

    # 더 이상 쓰지 않는 파일 정리
    for key in set(manifest) - set(fresh):
        (AUDIO / key).unlink(missing_ok=True)

    print(f"생성할 파일: {len(jobs)}개")
    await asyncio.gather(*jobs)
    manifest_path.write_text(json.dumps(fresh, ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
    print("완료")


if __name__ == "__main__":
    asyncio.run(main())
