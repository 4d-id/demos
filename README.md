# 4D-ID Demos

Interactive browser demos of the candidate [4D-ID specification](https://github.com/4d-id/spec). Everything you see is an isolated sandbox record created from caller-supplied grounding and running on `4did-lite.js`; it never touches a live namespace. Observations in the demos are evidence, and any matching evidence is supplied by the external matcher shown in the walkthroughs.

**Live at [4d-id.org](https://4d-id.org/).**

| Demo | Shows |
|---|---|
| `demo.html` | A Cesium globe: enter caller-supplied grounding, create an isolated sandbox record, and inspect its H3 cell. |
| `building.html` | A robot and drone in a named building; evidence handoff; a repair addressed to one sprinkler head. |
| `ship.html` | A ship of named containers; naive vs 4D-ID record counts, live. |

Static site, no build. The globe uses CesiumJS and Esri imagery; the three.js demos are fully self-contained (three.js vendored). Serve the repository root with any static HTTP server, for example `python3 -m http.server 8000`.

Apache-2.0.

## Globe explorer

`demo.html` now uses a dedicated responsive interface with real satellite detail and a local NASA Blue Marble overview. Enter caller-supplied coordinates or an address, use an example location, or drop a pin. The demo creates and resolves isolated sandbox records; it does not claim identity truth or write to a live resolver.

- Saved data uses a globe-only browser sandbox of isolated records; clearing it does not clear the building or ship demos. Existing older shared sandbox data is left untouched.
- Imports accept up to 200 features and 2 MB. Polygons use a representative vertex-mean point. Exports include record metadata; imports do not automatically register or preserve exported names in another resolver.
- Address search calls OpenStreetMap Nominatim only on explicit submission. Coordinates and example places use caller-supplied grounding without a geocoder.
- Cesium 1.120 is loaded from its pinned CDN. If the 3D engine is unavailable, record controls still work. Satellite failure retains the local overview. Attribution remains available in the map.

Run the dependency-free data tests:

```sh
node --test tests/globe-model.test.mjs
```

The data model is maintained in `globe-model.mjs` (Node tests) and served as byte-identical `globe-model.js` (browser-compatible MIME). Keep these files identical when editing the model.
