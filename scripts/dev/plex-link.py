"""Lie Plex au compte de l'utilisateur, crée la bibliothèque Films et branche Radarr dessus.

Usage : python3 scripts/dev/plex-link.py claim-XXXXXXXX
Le code vient de https://plex.tv/claim et expire en 4 minutes : lancer le script tout de suite.
Préfigure l'étape « Lecture » de l'assistant (phase 2).
"""
import json, os, re, subprocess, sys, time, urllib.parse, urllib.request

HOME = os.path.expanduser("~/Motflix")
ENV = os.path.join(HOME, ".env")
PREFS = os.path.join(HOME, "config/plex/Library/Application Support/Plex Media Server/Preferences.xml")
claim = sys.argv[1].strip()
if not re.fullmatch(r"claim-[A-Za-z0-9_-]+", claim):
    sys.exit("Code invalide : il doit commencer par « claim- ».")

def set_env(key, value):
    lines = open(ENV).read().splitlines()
    lines = [f"{key}='{value}'" if l.startswith(key + "=") else l for l in lines]
    open(ENV, "w").write("\n".join(lines) + "\n")

def compose(*args):
    subprocess.run(["docker", "compose", *args], cwd=HOME, check=True, capture_output=True)

def http(method, url, body=None, headers=None):
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Accept": "application/json", "Content-Type": "application/json", **(headers or {})})
    raw = urllib.request.urlopen(req, timeout=30).read()
    return json.loads(raw) if raw else None

# 1. Plex repart de zéro avec le code (un serveur déjà démarré ne lit plus PLEX_CLAIM).
set_env("PLEX_CLAIM", claim)
compose("rm", "-sf", "plex")
subprocess.run(["rm", "-rf", os.path.join(HOME, "config/plex")], check=True)
os.makedirs(os.path.join(HOME, "config/plex"))
compose("up", "-d", "plex")
print("✓ Plex redémarré avec le code de liaison")

token = None
for _ in range(90):
    if os.path.exists(PREFS):
        m = re.search(r'PlexOnlineToken="([^"]+)"', open(PREFS).read())
        if m:
            token = m.group(1)
            break
    time.sleep(2)
set_env("PLEX_CLAIM", "")
if not token:
    sys.exit("✗ Plex n'a pas été lié au compte (code expiré ?). Voir : docker logs motflix-plex")
user = re.search(r'PlexOnlineUsername="([^"]*)"', open(PREFS).read())
print("✓ Plex lié au compte", user.group(1) if user else "")

P = "http://127.0.0.1:32400"
T = {"X-Plex-Token": token}
for _ in range(30):
    try:
        http("GET", P + "/identity", headers=T)
        break
    except Exception:
        time.sleep(2)

# 2. Bibliothèque Films
sections = http("GET", P + "/library/sections", headers=T)["MediaContainer"].get("Directory", [])
section = next((s for s in sections if s["title"] == "Films"), None)
if not section:
    q = urllib.parse.urlencode({"name": "Films", "type": "movie", "agent": "tv.plex.agents.movie",
                                "scanner": "Plex Movie", "language": "fr-FR", "location": "/data/media/films"})
    http("POST", f"{P}/library/sections?{q}", headers=T)
    sections = http("GET", P + "/library/sections", headers=T)["MediaContainer"]["Directory"]
    section = next(s for s in sections if s["title"] == "Films")
print("✓ Bibliothèque « Films » sur /data/media/films")

# 3. Radarr prévient Plex après chaque import
env = dict(l.split("=", 1) for l in open(ENV).read().splitlines() if "=" in l and not l.startswith("#"))
R = "http://127.0.0.1:7878/api/v3"
RH = {"X-Api-Key": env["RADARR_API_KEY"].strip("'")}
for n in http("GET", R + "/notification", headers=RH):
    if n["implementation"] == "PlexServer":
        http("DELETE", f"{R}/notification/{n['id']}", headers=RH)
schema = next(s for s in http("GET", R + "/notification/schema", headers=RH) if s["implementation"] == "PlexServer")
values = {"host": "plex", "port": 32400, "useSsl": False, "authToken": token, "updateLibrary": True}
for f in schema["fields"]:
    if f["name"] in values:
        f["value"] = values[f["name"]]
schema.update(name="Plex", onDownload=True, onUpgrade=True, onRename=True, onMovieDelete=True, onMovieFileDelete=True)
http("POST", R + "/notification/test", schema, headers=RH)
http("POST", R + "/notification", schema, headers=RH)
print("✓ Radarr → Plex : test réussi, actualisation après chaque import")

# 4. Analyse de la bibliothèque
http("GET", f"{P}/library/sections/{section['key']}/refresh", headers=T)
for _ in range(45):
    items = http("GET", f"{P}/library/sections/{section['key']}/all", headers=T)["MediaContainer"].get("Metadata", [])
    if items:
        for it in items:
            print(f"✓ Plex affiche : {it['title']} ({it.get('year', '?')})")
        break
    time.sleep(2)
else:
    sys.exit("✗ Plex n'a encore rien trouvé dans /data/media/films")
