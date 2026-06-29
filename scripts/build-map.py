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

# bbox: Liesing + Klebas (south, west, north, east)
S, W, N, E = 46.687, 12.804, 46.698, 12.828
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
    {"name": "Kultursaal / Volksmusikakademie", "cat": "venue", "st": "Liesing", "hn": "15"},
    {"name": "Pfarrkirche Hl. Nikolaus",        "cat": "venue", "osm": "Pfarrkirche Heiliger Nikolaus"},
    {"name": "Badstubn",          "cat": "food", "osm": "Badstubn"},
    {"name": "Gasthaus Wilhelmer", "cat": "food", "osm": "Gasthaus Wilhelmer"},
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
        if "hn" in poi:
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
        if geom:                                            # area feature → centroid + footprint
            p["xy"] = centroid(geom); p["fp"] = line(geom)
        else:                                               # bare node → its point
            p["xy"] = xy(hit["lat"], hit["lon"])
        pois.append(p)

    roads, buildings, water, land = [], [], [], []
    for w in ways:
        t = w.get("tags", {}); g = w["geometry"]
        if "highway" in t and t["highway"] in ROADS:
            roads.append({"k": ROADS[t["highway"]], "p": line(g)})
        elif "waterway" in t:
            water.append({"k": "river" if t["waterway"] == "river" else "stream", "p": line(g)})
        elif t.get("natural") == "water":
            water.append({"k": "body", "p": line(g)})
        elif t.get("leisure") == "park" or t.get("landuse") in ("cemetery", "grass", "meadow", "village_green"):
            land.append({"k": "green", "p": line(g)})
        elif "building" in t and w["id"] not in poi_ids:
            buildings.append({"p": line(g)})

    labels = [{"t": n["tags"]["name"], **dict(zip("xy", xy(n["lat"], n["lon"])))}
              for n in nodes if n.get("tags", {}).get("place") == "hamlet" and n["tags"].get("name")]
    labels = [{"t": l["t"], "xy": [l["x"], l["y"]]} for l in labels]

    meta = {"w": round((E - W) * KX), "h": round((N - S) * KY)}
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
