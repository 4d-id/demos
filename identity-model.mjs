// Pure data model for the public 4D-ID identity inspector.
// Parsing establishes syntax only. It never proves resolver knowledge, grounding,
// registry membership, location, authority, or identity truth.

export const SPEC_REVISION = '2.4';
export const FOURDID = /^4did:([A-Za-z0-9]{1,8}):((?:[A-Za-z0-9_-]{22,86}\.)?[A-Za-z0-9.-]{1,64})(?:;v=([A-Za-z0-9.-]{1,40}))?:([A-Za-z0-9_-]{22,86})(?::([0-9]{8}T[0-9]{6}(?:\.[0-9]{1,6})?Z))?$/;
const PRIVATE_HOME = /^[A-Fa-f0-9]{32,64}$/;

export const RELATIONSHIPS = Object.freeze([
  {
    type: 'identified_as', shape: 'entity to external registry identifier',
    means: 'An accepted external identifier names the same referent.',
    notMeans: 'It does not make the external registry a composition parent or prove the claim by syntax alone.',
  },
  {
    type: 'describes', shape: 'source record to entity',
    means: 'A document or dataset makes attributed claims about the entity.',
    notMeans: 'A description is not identity equivalence and is not automatically current or correct.',
  },
  {
    type: 'parent / contains', shape: 'child to one composition parent',
    means: 'Physical or structural hierarchy used for unique transform composition.',
    notMeans: 'Overlapping zones, districts, grids, and registrations do not become additional parents.',
  },
  {
    type: 'represents', shape: 'representation entity to depicted entity',
    means: 'A scan, model, image, mesh, or tileset depicts the target.',
    notMeans: 'It does not mean 4D-ID computed the registration or that the representation is the same entity.',
  },
]);

function failure(code, message, hint = '') { return { ok: false, code, message, hint }; }

function decodeDescriptor(local) {
  const asUuid7 = compactUuid(local);
  if (asUuid7) return { bytes: 16, uuidVersion: 7 };
  try {
    const bytes = BufferLike(local);
    if (bytes.length !== 16) return { bytes: bytes.length, uuidVersion: null };
    return { bytes: 16, uuidVersion: bytes[6] >> 4 };
  } catch { return { bytes: null, uuidVersion: null }; }
}

function compactUuid(value) {
  const clean = value.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(clean)) return null;
  if (parseInt(clean[12], 16) !== 7) return null;
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function BufferLike(value) {
  if (typeof Buffer !== 'undefined') return Buffer.from(value, 'base64url');
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const raw = atob(base64);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

function validInstant(marker) {
  if (!marker) return null;
  const m = marker.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.(\d{1,6}))?Z$/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ? '.' + m[7] : ''}Z`;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? { raw: marker, iso: new Date(value).toISOString() } : null;
}

export function parseIdentity(input) {
  if (typeof input !== 'string' || !input.trim()) return failure('empty', 'Paste a 4D-ID to inspect it.');
  const value = input.trim();
  if (/\s/.test(value)) return failure('whitespace', 'A 4D-ID contains no whitespace.');
  const match = FOURDID.exec(value);
  if (!match) return failure('shape', 'The identifier does not match the published 2.4 URI grammar.', 'Check the scheme, separators, descriptor length, and optional genesis marker.');
  const [, variant, homeOrCell, vref = null, local, marker = null] = match;
  const descriptor = decodeDescriptor(local);
  const warnings = [];
  if (variant === 'id') {
    if (!PRIVATE_HOME.test(homeOrCell)) warnings.push('The non-spatial home token is not a 32 to 64 character random hexadecimal token. Syntax alone cannot prove entropy or provenance.');
    if (vref) warnings.push('The non-spatial id variant must not carry a vertical reference.');
    if (marker) warnings.push('The non-spatial id variant must not carry a genesis timestamp.');
    if (descriptor.uuidVersion === 7) warnings.push('UUIDv7 embeds time and is not permitted in privacy mode.');
    return {
      ok: true, input: value, form: 'non-spatial', variant, home: homeOrCell,
      cell: null, vref, local, genesis: validInstant(marker), descriptor, warnings,
      compliant: warnings.length === 0,
      formLabel: 'Non-spatial identifier',
      summary: 'The home token routes resolution without identifying a place. The identifier carries no current location.',
    };
  }
  if (!marker && descriptor.uuidVersion !== 7) warnings.push('A legacy spatial identifier with a non-UUIDv7 descriptor requires an explicit genesis marker.');
  return {
    ok: true, input: value, form: 'spatial', variant, home: null, cell: homeOrCell,
    vref, local, genesis: validInstant(marker), descriptor, warnings,
    compliant: warnings.length === 0,
    formLabel: 'Legacy spatial identifier',
    summary: 'The cell is immutable mint and routing metadata. It is not grounding evidence and it is not current location.',
  };
}

export function knowledgeSplit(parsed) {
  if (!parsed?.ok) return { fromSyntax: [], fromResolver: [] };
  return {
    fromSyntax: [
      { label: 'Form', value: `${parsed.formLabel}; ${parsed.compliant ? 'no semantic warning detected' : 'review warnings below'}` },
      { label: 'Home or cell', value: parsed.home || `${parsed.variant}:${parsed.cell}` },
      { label: 'Descriptor', value: `${parsed.local}; opaque, ${parsed.descriptor.bytes ?? 'unknown'} decoded bytes` },
      { label: 'Genesis marker', value: parsed.genesis ? parsed.genesis.iso : 'not carried explicitly' },
      { label: 'Vertical reference', value: parsed.vref || 'not carried' },
    ],
    fromResolver: [
      { label: 'Referent', value: 'Which thing this denotes and what evidence grounds that claim.' },
      { label: 'Current location', value: 'Current state, composition pose, and valid accepted registrations.' },
      { label: 'Status', value: 'Whether it is active, redirected, merged, disputed, expired, or unknown.' },
      { label: 'Relationships', value: 'Aliases, source descriptions, hierarchy, and representation records.' },
      { label: 'Authority', value: 'Who attributed a decision and whether deployment policy authorized it.' },
    ],
  };
}

export function anchorContrast(parsed) {
  return {
    genesis: {
      title: 'Identifier metadata',
      value: parsed?.cell ? `${parsed.variant}:${parsed.cell}` : 'opaque non-spatial home token',
      points: ['Fixed for the life of the identifier.', 'Supports routing and partitioning.', 'Does not establish the referent.', 'Does not report current location.'],
    },
    anchor: {
      title: 'Current state and registrations', value: 'resolver records, not identifier bytes',
      points: ['May change over time.', 'Carry frame, validity, uncertainty, status, and provenance.', 'Can disagree without adding parents.', 'Are supplied by external localization and registration systems.'],
    },
    parentRule: 'Each non-root entity has one composition parent and may have many independent registrations.',
  };
}

export function gersExample() {
  const home = '5a89fc81f07739510a815e8c202160ac';
  const id = `4did:id:${home}:AAAAAAAAQACAAAAAAAAAAA`;
  return {
    external: { registry: 'overture.gers', id: 'fea28f69-7afa-460c-b270-61ef74cd340c' },
    entity: { id, label: 'Example mapped building' },
    evidence: [
      { source: 'registry capture', detail: 'GERS membership verified present in the declared capture.' },
      { source: 'source binding', detail: 'Trusted bridge or onboarding evidence says this record describes that GERS member.' },
      { source: 'resolver lookup', detail: 'Exact aliases checked before any reference-only mint.' },
    ],
    decision: {
      first: 'No acceptable 4D-ID exists in the declared store. Create one provisional reference-only identity and bind the accepted GERS alias.',
      second: 'The same GERS alias already resolves. Reuse the existing 4D-ID and mint nothing.',
    },
    boundary: 'The bridge verifies declared evidence and records a decision. It does not conflate geometry, ground an observation, or write to an authoritative resolver.',
  };
}

export function samples() {
  return [
    { label: 'Non-spatial 2.4', value: '4did:id:5a89fc81f07739510a815e8c202160ac:AAAAAAAAQACAAAAAAAAAAA' },
    { label: 'Spatial with marker', value: '4did:h3:8c2a100d2d0dbff:c3BhdGlhbCBzYW1wbGUgYQ:20260412T094500Z' },
    { label: 'Spatial UUIDv7 shorthand', value: '4did:h3:8928308280fffff:AZmR3kB8dH2qT7vLxN1pWg' },
    { label: 'Invalid privacy token', value: '4did:id:qs-west:AAAAAAAAQACAAAAAAAAAAA' },
  ];
}
