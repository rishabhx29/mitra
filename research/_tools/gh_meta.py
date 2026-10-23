import json, time, urllib.request

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "buildathon-research", "Accept": "application/vnd.github+json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r), r.status
    except urllib.error.HTTPError as e:
        return {"error": str(e)}, e.code

REPOS = [
    # topic 01: desktop voice assistants / jarvis-like
    "leon-ai/leon", "OpenVoiceOS/ovos-core", "NeonGecko/NeonCore", "MycroftAI/mycroft-core",
    "rhasspy/rhasspy", "toverainc/willow", "fossasia/susi_server", "jasperproject/jasper-client",
    "szczyglisdev/py-gpt", "OpenWhispr/openwhispr", "Starmel/OpenSuperWhisper",
    # topic 02: computer-use / agent frameworks + integrations
    "OpenInterpreter/open-interpreter", "microsoft/UFO", "OS-Copilot/OS-Copilot",
    "OthersideAI/self-operating-computer", "simular-ai/Agent-S", "OpenAdaptAI/OpenAdapt",
    "browser-use/browser-use", "bytedance/UI-TARS", "wonderwhy-er/DesktopCommanderMCP",
    "makenotion/notion-mcp-server", "sst/opencode", "microsoft/playwright-mcp",
    "modelcontextprotocol/servers", "anthropics/anthropic-quickstarts", "AgentDeskAI/AgentDesk",
]

print("=== REPO METADATA ===")
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

SEARCHES = [
    ("jarvis assistant", "jarvis+assistant"),
    ("voice assistant desktop", "voice+assistant+desktop"),
    ("whispering dictation", "whispering+dictation"),
    ("computer use agent", "computer+use+agent"),
    ("ai computer control voice", "voice+controlled+computer"),
]
print("\n=== SEARCH DISCOVERY ===")
for label, q in SEARCHES:
    d, code = get(f"https://api.github.com/search/repositories?q={q}&sort=stars&order=desc&per_page=8")
    print(f"\n--- {label} ---")
    if "items" not in d:
        print(f"  ERR {d.get('error') or d.get('message')}")
    else:
        for it in d["items"]:
            desc = (it.get("description") or "").replace("|", "/")[:90]
            print(f"  {it['full_name']} | {it['stargazers_count']}★ | {(it.get('license') or {}).get('spdx_id','?')} | {desc}")
    time.sleep(7)
