#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = []
# ///
"""Bake the Liesing/Klebas vector basemap from OpenStreetMap into map-data.json.

One-shot, network-tolerant (like update-gids.py): fetches OSM via Overpass, slims it to
roads/buildings/water/land + the festival POIs, projects lat/lon → local planar metres
(integers), and writes ../map-data.json. On any network/parse failure it leaves the existing
file untouched and exits 0 — never blocks. Town geometry is ~static, so run it by hand only
when the POI list changes or OSM gains detail:  python3 scripts/build-map.py

POIS below is the single source of truth for the highlighted places (and resolves the
"accepted addresses awaiting OSM anchors" from the prototype): address-anchored entries snap
to their real building footprint by addr:housenumber+addr:street; OSM-named entries (the
restaurants, the church) snap to the tagged feature. © OpenStreetMap contributors (ODbL).
"""
import json, math, sys, urllib.parse, urllib.request

# bbox: Liesing + Klebas, widened to take in the surrounding peaks (south, west, north, east).
# scripts/build-terrain.py reads this back from map-data.json's meta so its rasters stay aligned.
S, W, N, E = 46.679, 12.797, 46.705, 12.835
OUT = __file__.rsplit("/", 2)[0] + "/map-data.json"
API = "https://overpass-api.de/api/interpreter"

# the places that matter. hn/st → anchor to a building footprint; osm → anchor to a named feature.
# names mirror roster.html so the two pages agree. mine = Jason's base (the one warm-brass accent).
POIS = [
    {"name": "Musikhof Lexer",          "cat": "lodging", "st": "Liesing", "hn": "11", "mine": True},
    {"name": "Lesachtalerhof",          "cat": "lodging", "st": "Liesing", "hn": "40"},
    {"name": "Ferienwohnung Wilhelmer", "cat": "lodging", "st": "Liesing", "hn": "51"},
    {"name": "Haus Anita",              "cat": "lodging", "st": "Liesing", "hn": "47"},
    {"name": "Gästehaus Ortner",        "cat": "lodging", "st": "Liesing", "hn": "8"},
    {"name": "Haus Lanzinger",          "cat": "lodging", "st": "Liesing", "hn": "21"},
    {"name": "Haus Obernosterer",       "cat": "lodging", "st": "Liesing", "hn": "25"},
    {"name": "Kleines Berghotel",       "cat": "lodging", "st": "Klebas",  "hn": "7"},
    {"name": "Kultursaal",               "cat": "venue", "st": "Liesing", "hn": "15", "aliases": ["A1", "A2", "AH"]},  # the Akademie; A1/A2/AH are rooms inside it
    {"name": "Werner",                   "cat": "venue", "st": "Liesing", "hn": "30"},   # yellow house down the street from Musikhof Lexer (the WERNER rehearsal room)
    {"name": "Band Room",                "cat": "venue", "st": "Liesing", "hn": "20"},   # the BAND ROOM rehearsal space; name lowercases to the schedule's room code, so the chip links without an alias
    {"name": "Pfarrkirche Hl. Nikolaus", "cat": "venue", "osm": "Pfarrkirche Heiliger Nikolaus", "aliases": ["CHAPEL"]},  # CHAPEL rehearsal room
    {"name": "Badstubn",     "cat": "food", "osm": "Badstubn", "aliases": ["KS"]},   # KS = the Konzertsaal in this building
    {"name": "GH Wilhelmer / Mascha Wirt", "cat": "food", "st": "Liesing", "hn": "24"},  # slash → line break in the label
    {"name": "Steineckenalm",            "cat": "food", "way": 438758257},  # Jausenstation up the Steinecken-Weg; OSM names it only as a node, so anchor the footprint by way id
]

ROADS = {"primary": "primary", "secondary": "primary", "tertiary": "primary",
         "unclassified": "minor", "residential": "minor",
         "service": "service", "living_street": "service",
         "track": "track", "path": "path", "footway": "path", "pedestrian": "path", "steps": "path"}

# projection: equirectangular about bbox centre, screen-oriented (x east, y south), metres.
KX = 111320 * math.cos(math.radians((S + N) / 2))
KY = 110540
def xy(lat, lon): return [round((lon - W) * KX), round((N - lat) * KY)]
def line(geom): return [c for p in geom for c in xy(p["lat"], p["lon"])]
def centroid(geom):
    xs = [xy(p["lat"], p["lon"]) for p in geom]
    return [round(sum(p[0] for p in xs) / len(xs)), round(sum(p[1] for p in xs) / len(xs))]

def fetch():
    q = ("[out:json][timeout:80];("
         + "".join(f'way["{k}"]({S},{W},{N},{E});' for k in
                   ("building", "highway", "waterway", "natural", "landuse", "leisure"))
         + f'node["place"]({S},{W},{N},{E});node["amenity"]({S},{W},{N},{E}););out geom;')
    req = urllib.request.Request(API, data=urllib.parse.urlencode({"data": q}).encode(),
                                 headers={"User-Agent": "akm-map-build"})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.load(r)["elements"]

def build(els):
    ways = [e for e in els if e["type"] == "way" and e.get("geometry")]
    nodes = [e for e in els if e["type"] == "node"]
    poi_ids, pois, missed = set(), [], []
    for poi in POIS:
        hit = geom = None
        if "way" in poi:                                    # explicit OSM way id, for footprints OSM names only on a node
            for w in ways:
                if w["id"] == poi["way"]:
                    hit, geom = w, w["geometry"]; poi_ids.add(w["id"]); break
        elif "hn" in poi:
            for w in ways:
                t = w.get("tags", {})
                if t.get("addr:housenumber") == poi["hn"] and t.get("addr:street") == poi["st"]:
                    hit, geom = w, w["geometry"]; poi_ids.add(w["id"]); break
        else:
            for e in els:                                   # node or way named in OSM
                if e.get("tags", {}).get("name") == poi["osm"]:
                    hit = e
                    geom = e.get("geometry")
                    if geom: poi_ids.add(e.get("id"))
                    break
        if not hit:
            missed.append(poi["name"]); continue
        p = {"name": poi["name"], "cat": poi["cat"]}
        if poi.get("mine"): p["mine"] = True
        if poi.get("aliases"): p["aliases"] = poi["aliases"]   # schedule room codes (A2/AH/KS) → shown on the pin
        if geom:                                            # area feature → centroid + footprint
            p["xy"] = centroid(geom); p["fp"] = line(geom)
        else:                                               # bare node → its point
            p["xy"] = xy(hit["lat"], hit["lon"])
        pois.append(p)

    mw, mh = round((E - W) * KX), round((N - S) * KY)
    def anchor(p):                                           # the on-line vertex nearest map centre, if in frame
        best, bd = None, 1e18
        for i in range(0, len(p), 2):
            d = (p[i] - mw / 2) ** 2 + (p[i + 1] - mh / 2) ** 2
            if d < bd and 0 <= p[i] <= mw and 0 <= p[i + 1] <= mh: best, bd = [p[i], p[i + 1]], d
        return best

    def length(p): return sum(math.dist(p[i:i + 2], p[i + 2:i + 4]) for i in range(0, len(p) - 2, 2))
    def label_pos(p):                                       # (#in-frame vertices, offset at middle of the in-frame run)
        inf = [i for i in range(0, len(p), 2) if 0 <= p[i] <= mw and 0 <= p[i + 1] <= mh]
        if not inf: return None
        mid, tot = inf[len(inf) // 2], length(p) or 1
        acc = sum(math.dist(p[i - 2:i], p[i:i + 2]) for i in range(2, mid + 1, 2))
        return len(inf), min(0.85, max(0.15, acc / tot))      # keep off the path ends so glyphs aren't clipped

    roads, buildings, water, land, labels = [], [], [], [], []
    named = {}                                              # road name → (road index, in-frame coverage, label-offset)
    for w in ways:
        t = w.get("tags", {}); g = w["geometry"]
        if "highway" in t and t["highway"] in ROADS:
            k = ROADS[t["highway"]]; p = line(g); roads.append({"k": k, "p": p})
            nm = t.get("name")
            if nm and "Zufahrt" in nm or (nm and "brücke" in nm.lower()): nm = None  # skip driveways/bridges
            lp = label_pos(p) if nm and k in ("primary", "minor") else None
            if lp and (nm not in named or lp[0] > named[nm][1]):   # keep the segment most in view
                named[nm] = (len(roads) - 1, lp[0], round(lp[1], 3))
        elif "waterway" in t:
            k = "river" if t["waterway"] == "river" else "stream"
            p = line(g); water.append({"k": k, "p": p})
            at = anchor(p)
            if t.get("name") and at: labels.append({"t": t["name"], "xy": at, "k": "water"})
        elif t.get("natural") == "water":
            p = line(g); water.append({"k": "body", "p": p})
            nm = t.get("name") or ("Badeteich" if t.get("sport") == "swimming" else None)
            if nm: labels.append({"t": nm, "xy": centroid(g), "k": "water"})
        elif t.get("leisure") == "park" or t.get("landuse") in ("cemetery", "grass", "meadow", "village_green"):
            land.append({"k": "green", "p": line(g)})
        elif "building" in t and w["id"] not in poi_ids:
            b = {"p": line(g)}
            hn, st = t.get("addr:housenumber"), t.get("addr:street")
            if hn: b["a"] = f"{st} {hn}" if st else hn        # "Liesing 24" → shown on tap
            if t.get("name"): b["n"] = t["name"]
            buildings.append(b)

    for nm, (i, _, off) in named.items():                   # one label per road name, on its most useful segment
        roads[i]["name"] = nm; roads[i]["no"] = off

    for n in nodes:                                          # hamlet names
        t = n.get("tags", {})
        if t.get("place") == "hamlet" and t.get("name"):
            labels.append({"t": t["name"], "xy": xy(n["lat"], n["lon"]), "k": "hamlet"})

    meta = {"w": mw, "h": mh, "bbox": [S, W, N, E]}
    return {"meta": meta, "roads": roads, "buildings": buildings,
            "water": water, "land": land, "labels": labels, "pois": pois}, missed

def main():
    try:
        els = fetch()
    except Exception as e:
        print(f"offline / fetch failed ({e}); keeping existing map-data.json", file=sys.stderr)
        return
    data, missed = build(els)
    with open(OUT, "w") as f:
        json.dump(data, f, separators=(",", ":"), ensure_ascii=False)
    print(f"wrote {OUT}: {len(data['buildings'])} buildings, {len(data['roads'])} roads, "
          f"{len(data['water'])} water, {len(data['land'])} land, {len(data['pois'])} POIs")
    if missed:
        print("  WARNING unresolved POIs:", ", ".join(missed), file=sys.stderr)

if __name__ == "__main__":
    main()
