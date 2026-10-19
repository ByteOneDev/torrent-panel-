"""Relie Radarr à qBittorrent et Prowlarr (préfigure ce que fera l'assistant en phase 2).

Usage : python3 scripts/dev/wire-radarr.py   (relançable : ce qui existe déjà est conservé)
"""
import json, os, urllib.request, urllib.error

env = {}
for line in open(os.path.expanduser("~/Motflix/.env")):
    if "=" in line and not line.startswith("#"):
        k, v = line.rstrip("\n").split("=", 1)
        env[k] = v.strip("'")

def call(base, key, method, path, body=None):
    req = urllib.request.Request(base + path, method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"X-Api-Key": key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise SystemExit(f"{method} {path} → {e.code} {e.read().decode()[:400]}")

R = lambda m, p, b=None: call("http://127.0.0.1:7878/api/v3", env["RADARR_API_KEY"], m, p, b)
P = lambda m, p, b=None: call("http://127.0.0.1:9696/api/v1", env["PROWLARR_API_KEY"], m, p, b)

def set_fields(obj, values):
    for f in obj["fields"]:
        if f["name"] in values:
            f["value"] = values[f["name"]]
    return obj

# 1. Dossier racine
if not any(r["path"] == "/data/media/films" for r in R("GET", "/rootfolder")):
    R("POST", "/rootfolder", {"path": "/data/media/films"})
print("✓ Radarr : dossier racine /data/media/films")

# 2. Client de téléchargement
if not any(c["implementation"] == "QBittorrent" for c in R("GET", "/downloadclient")):
    schema = next(s for s in R("GET", "/downloadclient/schema") if s["implementation"] == "QBittorrent")
    schema.update(name="qBittorrent", enable=True, priority=1)
    set_fields(schema, {"host": "qbittorrent", "port": 8090, "movieCategory": "films", "username": "", "password": ""})
    R("POST", "/downloadclient", schema)
print("✓ Radarr : qBittorrent ajouté (catégorie « films »)")

# 3. Renommage « Titre (Année) »
naming = R("GET", "/config/naming")
naming.update(renameMovies=True, standardMovieFormat="{Movie Title} ({Release Year}) {Quality Full}",
              movieFolderFormat="{Movie Title} ({Release Year})")
R("PUT", f"/config/naming/{naming['id']}", naming)
mm = R("GET", "/config/mediamanagement")
mm.update(copyUsingHardlinks=True)
R("PUT", f"/config/mediamanagement/{mm['id']}", mm)
print("✓ Radarr : renommage et hardlinks activés")

# 4. Prowlarr → Radarr
if not any(a["implementation"] == "Radarr" for a in P("GET", "/applications")):
    schema = next(s for s in P("GET", "/applications/schema") if s["implementation"] == "Radarr")
    schema.update(name="Radarr", syncLevel="fullSync")
    set_fields(schema, {"prowlarrUrl": "http://prowlarr:9696", "baseUrl": "http://radarr:7878", "apiKey": env["RADARR_API_KEY"]})
    P("POST", "/applications", schema)
print("✓ Prowlarr : Radarr ajouté (synchronisation complète)")

# 5. Tests de connexion faits par Radarr lui-même
for c in R("GET", "/downloadclient"):
    R("POST", "/downloadclient/test", c)
    print(f"✓ Radarr → {c['name']} : test de connexion réussi")
for a in P("GET", "/applications"):
    P("POST", "/applications/test", a)
    print(f"✓ Prowlarr → {a['name']} : test de connexion réussi")
