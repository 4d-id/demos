# 4D-ID Demos

Interactive browser demos of the [4D-ID specification](https://github.com/4d-id/spec). Everything you see is a real minted 4D-ID running on `4did-lite.js`, a faithful in-browser build of the reference resolver, in a sandbox that never touches a live namespace.

**Live at [x4d-id.exe.xyz](https://x4d-id.exe.xyz/).**

| Demo | Shows |
|---|---|
| `demo.html` | A Cesium globe: type an address, get an identity; drop GeoJSON, get identities; toggle the H3 grid. |
| `building.html` | A robot and drone in a named building; observation handoff; a repair addressed to one sprinkler head. |
| `ship.html` | A ship of named containers; naive vs 4D-ID record counts, live. |

Static site, no build. The globe uses CesiumJS and Esri imagery; the three.js demos are fully self-contained (three.js vendored). See `HARNESS_TASK_DEMOS.md` for deployment.

Apache-2.0.
