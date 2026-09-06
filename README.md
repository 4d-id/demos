# 4D-ID Demos

Interactive browser demos of the [4D-ID specification](https://github.com/4d-id/spec). Everything you see is a real minted 4D-ID running on `4did-lite.js`, a faithful in-browser build of the reference resolver, in a sandbox that never touches a live namespace.

**Live at [4d-id.org](https://4d-id.org/).**

| Demo | Shows |
|---|---|
| `demo.html` | A Cesium globe: type an address, get an identity; drop GeoJSON, get identities; toggle the H3 grid. |
| `building.html` | A robot and drone in a named building; observation handoff; a repair addressed to one sprinkler head. |
| `ship.html` | A ship of named containers; naive vs 4D-ID record counts, live. |

Static site, no build. The globe uses CesiumJS and Esri imagery; the three.js demos are fully self-contained (three.js vendored). Serve the repository root with any static HTTP server, for example `python3 -m http.server 8000`.

Apache-2.0.

## Globe explorer

`demo.html` now uses a dedicated responsive interface with real satellite detail and a local NASA Blue Marble overview. Search an address, enter coordinates, use an example location, or drop a pin. Resolve the same name again, inspect its H3 cell, import GeoJSON, and export the collection. The shared site CTA opens the demos hub rather than selecting this demo automatically.

- Saved data uses a globe-only browser sandbox; clearing it does not clear the building or ship demos. Existing older shared sandbox data is left untouched.
- Imports accept up to 200 features and 2 MB. Polygons use a representative vertex-mean point. Exports include identity metadata; imports do not automatically register or preserve exported names in another resolver.
- Address search calls OpenStreetMap Nominatim on explicit submission. Coordinates and example places need no geocoder.
- Cesium 1.120 is loaded from its pinned CDN. If the 3D engine is unavailable, identity operations still work. Satellite failure retains the local overview. Attribution remains available in the map.

Run the dependency-free data tests:

```sh
node --test tests/globe-model.test.mjs
```
