import json, time, urllib.request

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "buildathon-research", "Accept": "application/vnd.github+json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r), r.status
    except urllib.error.HTTPError as e:
        return {"error": str(e)}, e.code

REPOS = [
    "Bolna-ai/Bolna", "pipecat-ai/pipecat", "livekit/agents", "livekit/client-sdk-js",
    "TEN-framework/ten-agent", "fixie/ultravox", "openai/openai-realtime-console",
    "dscripka/openWakeWord", "snakers4/silero-vad", "deepgram/starters",
    "openai/openai-webrtc", "vapi-io? none",
]
REPOS = [r for r in REPOS if " " not in r]

print("=== VOICE STACK REPOS ===")
for repo in REPOS:
    d, code = get(f"https://api.github.com/repos/{repo}")
    if code == 404:
        print(f"{repo} | 404 NOT FOUND")
    elif "error" in d:
        print(f"{repo} | ERR {d['error']}")
    else:
        lic = (d.get("license") or {}).get("spdx_id", "none")
        desc = (d.get("description") or "").replace("|", "/")[:100]
        print(f"{d['full_name']} | stars={d['stargazers_count']} | license={lic} | pushed={d['pushed_at'][:10]} | archived={d['archived']} | {desc}")
    time.sleep(0.4)

print("\n=== SEARCH: realtime voice agent TS starter ===")
d, _ = get("https://api.github.com/search/repositories?q=voice+agent+typescript+realtime&sort=stars&order=desc&per_page=6")
for it in d.get("items", []):
    desc = (it.get("description") or "").replace("|", "/")[:90]
    print(f"  {it['full_name']} | {it['stargazers_count']}★ | {(it.get('license') or {}).get('spdx_id','?')} | {desc}")
