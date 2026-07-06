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
# "was" = the pin's previous name, so a rename flows through the --offline reconcile (it matches
# the baked pin by old name, keeps the geometry, and takes everything else fresh from here).
# "also" = a second role — the pin renders split-colour (Lesachtalerhof is hotel AND restaurant).
# No baked "mine": "your base" is derived at runtime from the picked identity (map.js myBase).
POIS = [
    {"name": "Musikhof Lexer",          "cat": "lodging", "st": "Liesing", "hn": "11"},
    {"name": "Lesachtalerhof",          "cat": "lodging", "also": "food", "st": "Liesing", "hn": "40"},  # hotel + the dinner restaurant
    {"name": "Ferienwohnung Wilhelmer", "cat": "lodging", "st": "Liesing", "hn": "51"},
    {"name": "Haus Anita",              "cat": "lodging", "st": "Liesing", "hn": "47"},
    {"name": "Gästehaus Ortner",        "cat": "lodging", "st": "Liesing", "hn": "8"},
    {"name": "Haus Lanzinger",          "cat": "lodging", "st": "Liesing", "hn": "21"},
    {"name": "Haus Obernosterer",       "cat": "lodging", "st": "Liesing", "hn": "25"},  # Obernosterer *Apartment* lodging
    {"name": "Obernosterer AirBNB",      "cat": "lodging", "st": "Liesing", "hn": "50"},  # separate building next door to Haus Obernosterer
    {"name": "Kleines Berghotel",       "cat": "lodging", "st": "Klebas",  "hn": "7"},
    {"name": "Akademie", "was": "Kultursaal", "cat": "venue", "st": "Liesing", "hn": "15", "aliases": ["A1", "A2", "A3", "A4", "AH"]},  # the Volksmusik Akademie (VMA); the A-rooms + AH are inside it
    {"name": "Kultursaal", "was": "Badstubn", "cat": "venue", "also": "lodging", "st": "Klebas", "hn": "30", "osm": "Badstubn", "aliases": ["KS", "Badstubn"]},  # KS / "Kultursaal" in the schedule mean THIS building (Badstub'n, Klebas 30): concert venue + the Kultursaal apartment (lodging)
    {"name": "Werner",                   "cat": "venue", "st": "Liesing", "hn": "30"},   # yellow house down the street from Musikhof Lexer (the WERNER rehearsal room)
    {"name": "Band Room",                "cat": "venue", "st": "Liesing", "hn": "20"},   # the BAND ROOM rehearsal space; name lowercases to the schedule's room code, so the chip links without an alias
    {"name": "Theatre",                  "cat": "venue", "st": "Liesing", "hn": "5"},    # the THEATRE rehearsal room; name lowercases to the schedule's room code, so the chip links without an alias
    {"name": "Pfarrkirche Hl. Nikolaus", "cat": "venue", "osm": "Pfarrkirche Heiliger Nikolaus", "aliases": ["CHAPEL"]},  # CHAPEL rehearsal room
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
def fp_centroid(fp):                                        # same mean-of-vertices, but on a baked flat footprint
    n = len(fp) // 2
    return [round(sum(fp[i] for i in range(0, len(fp), 2)) / n),
            round(sum(fp[i + 1] for i in range(0, len(fp), 2)) / n)]

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
        if poi.get("also"): p["also"] = poi["also"]            # second role → split-colour pin
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

# Overpass-free path: reconcile POIS against the *already-baked* map-data.json. Every building is
# stored with its address (`a`) + footprint (`p`), so an address-anchored POI can be promoted to a
# pin — centroid + footprint — without the network. This is the code form of the CLAUDE.md hand-edit:
# use it when Overpass is unreachable and the edit is a new address-anchored POI or an alias change.
def promote_offline(data):
    have = {p["name"]: p for p in data["pois"]}
    # apply pending renames FIRST, and only once: a "was" is consumed only while the new name
    # doesn't exist yet. (Re-running after a rename must be a no-op — v1 of this matched "was"
    # unconditionally, so a second run stole the recycled old name's pin: Akademie ate Kultursaal.)
    for poi in POIS:
        w = poi.get("was")
        if w and poi["name"] not in have and w in have:
            have[poi["name"]] = have.pop(w)
    by_addr = {}
    for b in data["buildings"]:
        if b.get("a"): by_addr.setdefault(b["a"], b)
    def meta(poi):                                          # everything but geometry comes fresh from POIS
        p = {"name": poi["name"], "cat": poi["cat"]}
        if poi.get("also"): p["also"] = poi["also"]
        if poi.get("aliases"): p["aliases"] = poi["aliases"]
        return p
    pois, promoted, need_net = [], [], []
    for poi in POIS:
        src = have.pop(poi["name"], None)
        if src:                                             # already a pin — keep only its baked geometry
            p = meta(poi)
            p["xy"] = src["xy"]
            if src.get("fp"): p["fp"] = src["fp"]
            else:                                           # point-only pin (bare OSM node) + an address → adopt the baked footprint
                b = by_addr.get(f'{poi["st"]} {poi["hn"]}') if "hn" in poi else None
                if b and b.get("p"):
                    p["xy"], p["fp"] = fp_centroid(b["p"]), b["p"]; promoted.append((poi["name"], b["a"]))
            pois.append(p); continue
        b = by_addr.get(f'{poi["st"]} {poi["hn"]}') if "hn" in poi else None
        if b and b.get("p"):                                # address-anchored → promote from the baked footprint
            p = meta(poi)
            p["xy"], p["fp"] = fp_centroid(b["p"]), b["p"]
            pois.append(p); promoted.append((poi["name"], b["a"]))
        else:                                               # osm/way-anchored or no baked footprint → needs Overpass
            need_net.append(poi["name"])
    data["pois"] = pois
    dropped = {a for _, a in promoted}
    data["buildings"] = [b for b in data["buildings"] if b.get("a") not in dropped]
    # two pins on one building = almost certainly a reconcile bug, not geography — scream
    for i, a in enumerate(pois):
        for b in pois[i+1:]:
            if abs(a["xy"][0]-b["xy"][0]) < 8 and abs(a["xy"][1]-b["xy"][1]) < 8:
                print(f'WARNING {a["name"]} and {b["name"]} share a position {a["xy"]} — check POIS', file=sys.stderr)
    return promoted, need_net

def run_offline(reason):
    try:
        data = json.load(open(OUT))
    except Exception as e:
        print(f"{reason}; and no existing {OUT} to reconcile ({e}) — nothing to do", file=sys.stderr)
        return
    promoted, need_net = promote_offline(data)
    with open(OUT, "w") as f:
        json.dump(data, f, separators=(",", ":"), ensure_ascii=False)
    for name, addr in promoted:
        print(f"  promoted {name} ← baked building {addr}")
    print(f"{reason}: reconciled POIS offline — {len(promoted)} promoted, {len(data['pois'])} POIs total")
    if need_net:
        print("  WARNING these need Overpass (osm/way-anchored or no baked footprint):",
              ", ".join(need_net), file=sys.stderr)

def main():
    if "--offline" in sys.argv:                             # force the Overpass-free reconcile
        return run_offline("--offline")
    try:
        els = fetch()
    except Exception as e:
        return run_offline(f"offline / fetch failed ({e})")   # auto-fall back instead of leaving it stale
    data, missed = build(els)
    with open(OUT, "w") as f:
        json.dump(data, f, separators=(",", ":"), ensure_ascii=False)
    print(f"wrote {OUT}: {len(data['buildings'])} buildings, {len(data['roads'])} roads, "
          f"{len(data['water'])} water, {len(data['land'])} land, {len(data['pois'])} POIs")
    if missed:
        print("  WARNING unresolved POIs:", ", ".join(missed), file=sys.stderr)

if __name__ == "__main__":
    main()
