// 4did-lite.js — a faithful, in-browser subset of the 4D-ID reference resolver.
// Same identifier grammar, same H3 anchoring, same mint/resolve/context semantics
// as the Phase 2 resolver, running entirely client-side for the sandbox demos.
// Sandbox identities live in the browser (localStorage) and never touch the live namespace.

// h3 is loaded as a global (window.h3) via h3-js.umd.js
const h3 = window.h3;

const LS_KEY = "x4did_sandbox_v1";
const ANCHOR_RES = 12;   // room/object-scale anchor
const ZONE_RES = 6;      // matches the reference resolver's declared zone resolution

function b64urlUuid() {
  const u = crypto.randomUUID().replace(/-/g, "");
  const bytes = u.match(/.{2}/g).map(h => parseInt(h, 16));
  let bin = ""; bytes.forEach(b => bin += String.fromCharCode(b));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function mintId(lat, lng, { vref = null } = {}) {
  const cell = h3.latLngToCell(lat, lng, ANCHOR_RES);
  const v = vref ? `;v=${vref}` : "";
  return { id: `4did:h3:${cell}${v}:${b64urlUuid()}`, cell, lat, lng };
}

export function zoneOf(cell) {
  return h3.getResolution(cell) > ZONE_RES ? h3.cellToParent(cell, ZONE_RES) : cell;
}

export function cellBoundary(cell) {
  return h3.cellToBoundary(cell); // [[lat,lng],...]
}

// ---- sandbox store ----
function load() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || { entities: {}, ext: {} }; }
  catch { return { entities: {}, ext: {} }; }
}
function save(db) { localStorage.setItem(LS_KEY, JSON.stringify(db)); }

export function all() { return Object.values(load().entities); }
export function clearAll() { localStorage.removeItem(LS_KEY); }

// mint + register in the sandbox; returns the full entity record
export function createEntity({ lat, lng, label, cls, address, apn, relations = [], vref = null }) {
  const db = load();
  const m = mintId(lat, lng, { vref });
  const ent = {
    id: m.id,
    anchor: { variant: "h3", cell: m.cell, resolution: ANCHOR_RES },
    zone: zoneOf(m.cell),
    lat, lng,
    status: "active",
    motion_mode: "static",
    layer: "sandbox",
    labels: label ? [{ text: label, source: "demo" }] : [],
    class: cls || null,
    minted: new Date().toISOString(),
    relations: [
      ...(address ? [{ type: "identified_as", registry: "address", external_id: address }] : []),
      ...(apn ? [{ type: "identified_as", registry: "parcel.apn", external_id: apn }] : []),
      ...relations
    ]
  };
  db.entities[ent.id] = ent;
  for (const r of ent.relations)
    if (r.type === "identified_as") db.ext[`${r.registry}\u0000${r.external_id.toLowerCase()}`] = ent.id;
  save(db);
  return ent;
}

export function resolve({ registry, external_id, id }) {
  const db = load();
  let target = id;
  if (!target && registry && external_id) target = db.ext[`${registry}\u0000${external_id.toLowerCase()}`];
  if (!target || !db.entities[target]) return null;
  const e = db.entities[target];
  return { id: e.id, locator: e.zone, snapshot_id: snapshotId() };
}

export function getEntity(id) { return load().entities[id] || null; }

export function context(id) {
  const e = getEntity(id); if (!e) return null;
  return {
    id: e.id,
    class: e.class,
    labels: e.labels,
    anchor: e.anchor,
    position: { lat: e.lat, lng: e.lng },
    zone: e.zone,
    snapshot_id: snapshotId(),
    relations: e.relations,
    minted: e.minted,
    layer: e.layer
  };
}

export function snapshotId() {
  const zones = {};
  for (const e of all()) zones[e.zone] = (zones[e.zone] || 0) + 1;
  const parts = Object.entries(zones).sort().map(([z, n]) => `${z}@${n}`);
  return "snap:" + (parts.join(",") || "empty");
}

// ---- geocoding (free, keyless): OpenStreetMap Nominatim ----
export async function geocode(address) {
  const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=" + encodeURIComponent(address);
  const r = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!r.ok) throw new Error("geocoder error");
  const j = await r.json();
  if (!j.length) return null;
  return { lat: parseFloat(j[0].lat), lng: parseFloat(j[0].lon), display: j[0].display_name };
}

// ---- optional: read the LIVE reference resolver (read-only) ----
export async function liveResolve(base, registry, external_id) {
  try {
    const r = await fetch(`${base}/resolve?registry=${encodeURIComponent(registry)}&external_id=${encodeURIComponent(external_id)}`);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}
