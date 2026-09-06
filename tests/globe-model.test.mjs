// Pure Node 18 regression tests; no DOM, network, npm, or real browser storage.
// Run: node --test tests/globe-model.test.mjs
import {describe, test} from 'node:test';
import assert from 'node:assert/strict';
import {
  STORE_KEY, MAX_ENTITIES, MAX_FILE_BYTES, EXAMPLES,
  validateCoordinates, parseCoordinates, normalizeGeoJSON, sampleDistrict, createStore,
} from '../globe-model.mjs';

const SHARED_KEY = 'x4did_sandbox_v1'; // Existing building/ship/demo resolver key.
const CELL = '8c29a0b646335ff';
const ZONE = '8629a0b67ffffff';
const TIME = '2026-09-06T12:34:56.000Z';
const SHARED_DATA = '{"entities":{"building":"keep me"},"ext":{"ship":"also keep me"}}';

function memoryStorage(initial = {}, {blockRead = false, blockWrite = false} = {}) {
  const data = new Map(Object.entries(initial));
  const reads = [], writes = [], removes = [];
  return {
    data, reads, writes, removes,
    getItem(key) {
      reads.push(key);
      if (blockRead) throw new Error('Storage access denied');
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      writes.push([key, String(value)]);
      if (blockWrite) throw new Error('Quota exceeded or writes blocked');
      data.set(key, String(value));
    },
    removeItem(key) { removes.push(key); data.delete(key); },
    clear() { throw new Error('Never clear unrelated browser storage'); },
  };
}

function canonicalMint() {
  let sequence = 0;
  const calls = [];
  const mint = (lat, lng) => {
    calls.push({lat, lng});
    // A real 16-byte base64url suffix, not merely a regex-shaped counter.
    // Starts AAAAAAAAAAAAAAAAAAAAAA; remains canonical and unique on every mint.
    const bytes = Buffer.alloc(16);
    bytes.writeUInt32BE(sequence++, 12);
    return {id: `4did:h3:${CELL}:${bytes.toString('base64url')}`, cell: CELL};
  };
  mint.calls = calls;
  return mint;
}

function harness(storage = memoryStorage(), overrides = {}) {
  const mint = canonicalMint();
  const zoneCalls = [];
  const options = {
    storage, mint,
    zoneOf(cell) { zoneCalls.push(cell); return ZONE; },
    now: () => TIME,
    ...overrides,
  };
  return {storage, mint, zoneCalls, options, store: createStore(options)};
}

function input(overrides = {}) {
  return {lat: 37.7955, lng: -122.3937, label: 'Ferry Building', ...overrides};
}
function point(coordinates = [-122.3937, 37.7955]) {
  return {type: 'Point', coordinates};
}
function feature(geometry = point(), properties = {}) {
  return {type: 'Feature', properties, geometry};
}
function collection(features) {
  return {type: 'FeatureCollection', features};
}
function polygon(ring, holes = []) {
  return {type: 'Polygon', coordinates: [ring, ...holes]};
}
function near(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) < tolerance, `${actual} should be near ${expected}`);
}
function seededStorage() {
  const h = harness(memoryStorage({[SHARED_KEY]: SHARED_DATA}));
  h.store.add(input({registry: 'address', external_id: '1 Ferry Building'}));
  return {entity: JSON.parse(h.storage.data.get(STORE_KEY))[0], raw: h.storage.data.get(STORE_KEY)};
}
function assertRetainsCorrupt(raw) {
  const storage = memoryStorage({[STORE_KEY]: raw, [SHARED_KEY]: SHARED_DATA});
  const h = harness(storage);
  assert.deepEqual(h.store.all(), [], 'reject the whole unreadable collection');
  assert.match(h.store.warning(), /unavailable|unreadable/i);
  const added = h.store.add(input());
  assert.equal(h.store.find({id: added.entity.id}).id, added.entity.id);
  assert.equal(h.store.export().features.length, 1, 'in-memory recovery remains usable');
  h.store.clear();
  assert.deepEqual(h.store.all(), []);
  assert.equal(storage.data.get(STORE_KEY), raw, 'do not overwrite or remove corrupt bytes');
  assert.equal(storage.data.get(SHARED_KEY), SHARED_DATA);
  assert.deepEqual(storage.writes, []);
  assert.deepEqual(storage.removes, []);
}

describe('coordinates', () => {
  test('accepts signed decimals, whitespace, zero, and inclusive coordinate limits', () => {
    for (const [value, expected] of [
      ['37.7955, -122.3937', {lat: 37.7955, lng: -122.3937}],
      [' \t+51.909 , +4.487\n', {lat: 51.909, lng: 4.487}],
      ['.5,-.25', {lat: .5, lng: -.25}],
      ['0,0', {lat: 0, lng: 0}],
      ['90,180', {lat: 90, lng: 180}],
      ['-90,-180', {lat: -90, lng: -180}],
    ]) assert.deepEqual(parseCoordinates(value), expected, value);
    assert.ok(Object.is(parseCoordinates('-0,-0').lat, -0));
  });

  test('returns null for address/identity input and non-coordinate syntax', () => {
    for (const value of ['', '   ', '1 Ferry Building, San Francisco',
      `4did:h3:${CELL}:AAAAAAAAAAAAAAAAAAAAAA`, '1', '1 2', '1,2,3', '1;',
      ',2', '1,', '1e2,2', 'NaN,0', 'Infinity,0', '0x10,0', '--1,2',
      '12 degrees,34 degrees', '<img src=x onerror=alert(1)>', null, undefined, 42]) {
      assert.equal(parseCoordinates(value), null, String(value));
    }
  });

  test('throws for recognizable but invalid numeric/range input', () => {
    for (const value of ['90.00001,0', '-90.1,0', '0,180.1', '0,-180.1',
      '999,999', '1.2.3,4', '.,0', '1,+.', `${'9'.repeat(400)},0`]) {
      assert.throws(() => parseCoordinates(value), /latitude|longitude/i, value);
    }
  });

  test('numeric validator rejects coercion, non-finite values, and swapped ranges', () => {
    for (const value of [NaN, Infinity, -Infinity, '10', null, undefined, true, {}, []]) {
      assert.throws(() => validateCoordinates(value, 0));
      assert.throws(() => validateCoordinates(0, value));
    }
    assert.throws(() => validateCoordinates(-122.3937, 37.7955));
    assert.deepEqual(validateCoordinates(90, -180), {lat: 90, lng: -180});
  });
});

describe('GeoJSON normalization', () => {
  test('accepts bare Point, Feature, and FeatureCollection, preserving lng/lat order', () => {
    const expected = {lat: 37.7955, lng: -122.3937, label: 'Feature 1', cls: 'feature', source: 'geojson', address: undefined};
    for (const data of [point(), feature(), collection([feature()])]) {
      assert.deepEqual(normalizeGeoJSON(data), {points: [expected], skipped: 0, polygons: 0});
    }
    assert.equal(normalizeGeoJSON(point([180, -90, 123])).points[0].lat, -90);
  });

  test('normalizes property strings, fallbacks, and length limits without coercing objects', () => {
    const features = [
      feature(point(), {name: '  Primary  ', label: 'Fallback', class: ' built:structure ', address: '  Pier 1  '}),
      feature(point(), {name: ' ', label: ' Fallback ', class: false, address: 123}),
      feature(point(), {name: {}, label: [], class: {text: 'bad'}, address: {text: 'bad'}}),
      feature(point(), {name: 'x'.repeat(170), class: 'c'.repeat(180), address: 'a'.repeat(310)}),
      feature(point(), null),
    ];
    const {points} = normalizeGeoJSON(collection(features));
    assert.deepEqual(points[0], {lat: 37.7955, lng: -122.3937, label: 'Primary', cls: 'built:structure', source: 'geojson', address: 'Pier 1'});
    assert.equal(points[1].label, 'Fallback');
    assert.equal(points[1].cls, 'feature');
    assert.equal(points[1].address, undefined);
    assert.equal(points[2].label, 'Feature 3');
    assert.equal(points[2].cls, 'feature');
    assert.equal(points[2].address, undefined);
    assert.equal(points[3].label.length, 160);
    assert.equal(points[3].cls.length, 160);
    assert.equal(points[3].address.length, 300);
    assert.equal(points[4].label, 'Feature 5');
  });

  test('keeps malicious-looking properties inert strings through add, resolve, persistence, and export', () => {
    const payload = '<img src=x onerror="globalThis.__globeInjected=true">';
    const data = JSON.parse(JSON.stringify(feature(point(), {
      name: payload, class: '<script>alert(1)</script>', address: 'javascript:alert(1)',
    })));
    const {points} = normalizeGeoJSON(data);
    assert.equal(points[0].label, payload);
    assert.equal(typeof points[0].label, 'string');
    assert.equal(typeof points[0].cls, 'string');
    assert.equal(typeof points[0].address, 'string');
    const h = harness();
    const entity = h.store.addMany(points)[0].entity;
    assert.equal(h.store.context(entity.id).labels[0].text, payload);
    const reloaded = createStore(h.options);
    assert.equal(reloaded.find({registry: 'address', external_id: points[0].address}).id, entity.id);
    const properties = reloaded.export().features[0].properties;
    assert.equal(properties.name, payload);
    assert.equal(properties.class, '<script>alert(1)</script>');
    assert.equal(properties.relations[0].external_id, 'javascript:alert(1)');
    assert.equal(globalThis.__globeInjected, undefined);
    // These are intentionally not HTML-escaped: the renderer must use textContent.
  });

  test('ignores prototype-like GeoJSON keys instead of merging them into entities', () => {
    const props = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"name":"Safe"}');
    const normalized = normalizeGeoJSON(feature(point(), props));
    const h = harness();
    const entity = h.store.addMany(normalized.points)[0].entity;
    assert.equal(entity.labels[0].text, 'Safe');
    assert.equal(Object.hasOwn(entity, '__proto__'), false);
    assert.equal(Object.hasOwn(entity, 'constructor'), false);
    assert.equal({}.polluted, undefined);
  });

  test('uses the unclosed vertex mean, not a duplicate closing vertex or area centroid', () => {
    const data = polygon([[10, 0], [14, 0], [12, 6], [10, 0]]);
    for (const wrapper of [data, feature(data), collection([feature(data)])]) {
      const result = normalizeGeoJSON(wrapper);
      assert.equal(result.polygons, 1);
      assert.equal(result.skipped, 0);
      near(result.points[0].lat, 2);
      near(result.points[0].lng, 12);
    }
  });

  test('dateline-crossing polygons resolve near ±180°, not Greenwich', () => {
    const ring = [[179, 10], [-179, 10], [-179, 12], [179, 12], [179, 10]];
    for (const vertices of [ring, [...ring].reverse()]) {
      const {points} = normalizeGeoJSON(polygon(vertices));
      near(points[0].lat, 11);
      near(Math.abs(points[0].lng), 180);
    }
  });

  test('valid holes do not distort the representative outer-ring point', () => {
    const outer = [[10, 0], [14, 0], [14, 4], [10, 4], [10, 0]];
    const hole = [[10.5, .5], [11, .5], [11, 1], [10.5, .5]];
    assert.deepEqual(normalizeGeoJSON(polygon(outer, [hole])), normalizeGeoJSON(polygon(outer)));
  });

  test('rejects malformed supported geometry, including unclosed outer rings', () => {
    const bad = [
      point(null), point([]), point([1]), point(['1', 2]), point([1, '2']),
      point([181, 0]), point([0, -91]), point([Infinity, 0]), point([0, NaN]),
      {type: 'Polygon', coordinates: null}, polygon([]), polygon([[0, 0], [1, 0], [0, 0]]),
      polygon([[0, 0], [1, 0], [1, 1], [0, 1]]),
      polygon([[0, 0], [1], [1, 1], [0, 0]]),
      polygon([[0, 0], null, [1, 1], [0, 0]]),
      polygon([[0, 0], [181, 0], [1, 1], [0, 0]]),
      polygon([[0, 0], [1, '0'], [1, 1], [0, 0]]),
    ];
    for (const geometry of bad) assert.throws(() => normalizeGeoJSON(geometry), undefined, JSON.stringify(geometry));
  });

  test('rejects malformed interior rings as corrupt polygon data', () => {
    const outer = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
    for (const hole of [[], [[1, 1], [2, 1], [2, 2], [1, 2]],
      [[1, 1], [200, 1], [2, 2], [1, 1]], [[1, 1], null, [2, 2], [1, 1]]]) {
      assert.throws(() => normalizeGeoJSON(polygon(outer, [hole])), undefined, JSON.stringify(hole));
    }
  });

  test('skips unsupported geometry and null features while retaining supported ones', () => {
    const geometries = ['LineString', 'MultiPoint', 'MultiLineString', 'MultiPolygon', 'GeometryCollection'];
    const features = [null, feature(null), ...geometries.map(type => feature({type, coordinates: []})), feature(point(), {name: 'Kept'})];
    const normalized = normalizeGeoJSON(collection(features));
    assert.equal(normalized.skipped, 7);
    assert.equal(normalized.polygons, 0);
    assert.equal(normalized.points.length, 1);
    assert.equal(normalized.points[0].label, 'Kept');
    assert.throws(() => normalizeGeoJSON(collection(features.slice(0, -1))), /No supported features/);
  });

  test('rejects absent/empty/non-GeoJSON input', () => {
    for (const data of [null, undefined, 42, 'Point', [], {}, collection([]),
      {type: 'FeatureCollection'}, collection({}), {type: 'Feature', geometry: null},
      {type: 'LineString', coordinates: [[0, 0], [1, 1]]}]) {
      assert.throws(() => normalizeGeoJSON(data));
    }
  });

  test('accepts exactly 200 features and rejects 201, counting unsupported inputs too', () => {
    assert.equal(MAX_ENTITIES, 200);
    assert.equal(MAX_FILE_BYTES, 2 * 1024 * 1024);
    const features = Array.from({length: MAX_ENTITIES}, () => feature());
    assert.equal(normalizeGeoJSON(collection(features)).points.length, 200);
    assert.throws(() => normalizeGeoJSON(collection([...features, feature()])), /200/);
    assert.throws(() => normalizeGeoJSON(collection([...features, feature({type: 'LineString'})])), /200/);
  });

  test('does not modify input data and never writes a valid prefix of a corrupt import', () => {
    const data = collection([feature(), feature(point([0, 95]))]);
    const before = JSON.stringify(data);
    const h = harness();
    h.store.add(input({label: 'Already saved'}));
    const original = h.storage.data.get(STORE_KEY);
    const mintCount = h.mint.calls.length;
    assert.throws(() => h.store.addMany(normalizeGeoJSON(data).points));
    assert.equal(JSON.stringify(data), before);
    assert.equal(h.storage.data.get(STORE_KEY), original);
    assert.equal(h.store.all().length, 1);
    assert.equal(h.mint.calls.length, mintCount);
    assert.equal(h.storage.writes.length, 1);
  });
});

describe('isolated identity store', () => {
  test('uses only the globe key; shared sandbox bytes remain unchanged across all operations', () => {
    assert.equal(STORE_KEY, '4did_globe_v2');
    assert.notEqual(STORE_KEY, SHARED_KEY);
    const h = harness(memoryStorage({[SHARED_KEY]: SHARED_DATA, unrelated: 'also untouched'}));
    assert.deepEqual(h.store.all(), []);
    assert.equal(h.store.warning(), '');
    const entity = h.store.add(input({address: 'Ferry Building'})).entity;
    h.store.find({id: entity.id});
    h.store.context(entity.id);
    h.store.export();
    const reloaded = createStore(h.options);
    assert.equal(reloaded.all().length, 1);
    reloaded.clear();
    assert.equal(h.storage.data.get(SHARED_KEY), SHARED_DATA);
    assert.equal(h.storage.data.get('unrelated'), 'also untouched');
    assert.ok(h.storage.reads.every(key => key === STORE_KEY));
    assert.ok(h.storage.writes.every(([key]) => key === STORE_KEY));
    assert.deepEqual(h.storage.removes, []);
  });

  test('adds canonical unique identities with complete anchor, position, and metadata', () => {
    const h = harness();
    const first = h.store.add(input({cls: 'built:structure', source: 'test source'}));
    assert.equal(first.existing, false);
    assert.deepEqual(first.entity, {
      id: `4did:h3:${CELL}:AAAAAAAAAAAAAAAAAAAAAA`,
      anchor: {variant: 'h3', cell: CELL, resolution: 12}, zone: ZONE,
      lat: 37.7955, lng: -122.3937, status: 'active', motion_mode: 'static',
      layer: 'globe-sandbox', class: 'built:structure',
      labels: [{text: 'Ferry Building', source: 'test source'}], minted: TIME, relations: [],
    });
    const second = h.store.add(input());
    assert.notEqual(second.entity.id, first.entity.id, 'same coordinates alone do not imply same identity');
    for (const entity of h.store.all()) {
      assert.match(entity.id, /^4did:h3:8c29a0b646335ff:[A-Za-z0-9_-]{22}$/);
      const suffix = entity.id.split(':').at(-1);
      assert.equal(Buffer.from(suffix, 'base64url').length, 16);
      assert.equal(Buffer.from(suffix, 'base64url').toString('base64url'), suffix);
    }
    assert.deepEqual(h.mint.calls, [{lat: 37.7955, lng: -122.3937}, {lat: 37.7955, lng: -122.3937}]);
    assert.deepEqual(h.zoneCalls, [CELL, CELL]);
  });

  test('supplies safe defaults for an unlabeled coordinate input', () => {
    const {entity} = harness().store.add({lat: 0, lng: 0});
    assert.equal(entity.class, 'place');
    assert.deepEqual(entity.labels, [{text: 'Named place', source: 'globe demo'}]);
    assert.deepEqual(entity.relations, []);
  });

  test('find and context resolve without minting, including unknown IDs and keys', () => {
    const h = harness();
    const original = h.store.add(input({registry: 'parcel.apn', external_id: 'Lot-AbC'})).entity;
    const writes = h.storage.writes.length;
    assert.equal(h.store.find({id: original.id}), original);
    assert.equal(h.store.find({registry: 'parcel.apn', external_id: 'LOT-ABC'}), original);
    assert.equal(h.store.find({registry: 'PARCEL.APN', external_id: 'Lot-AbC'}), null, 'registry names are exact');
    assert.equal(h.store.find({registry: 'other', external_id: 'Lot-AbC'}), null);
    assert.equal(h.store.find({id: 'unknown'}), null);
    assert.equal(h.store.find({}), null);
    assert.equal(h.store.context('unknown'), null);
    assert.equal(h.store.context(original.id).id, original.id);
    assert.equal(h.mint.calls.length, 1);
    assert.equal(h.storage.writes.length, writes);
  });

  test('deduplicates registry/external ID case-insensitively without changing first metadata', () => {
    const h = harness();
    const original = h.store.add(input({registry: 'globe.example', external_id: 'Ferry'})).entity;
    const again = h.store.add(input({lat: 1, lng: 2, label: 'Do not rename', registry: 'globe.example', external_id: 'FERRY'}));
    assert.equal(again.existing, true);
    assert.equal(again.entity, original);
    assert.equal(again.entity.labels[0].text, 'Ferry Building');
    assert.equal(again.entity.lat, 37.7955);
    assert.equal(h.mint.calls.length, 1);
    assert.equal(h.storage.writes.length, 1);
    const differentRegistry = h.store.add(input({registry: 'other', external_id: 'Ferry'}));
    assert.equal(differentRegistry.existing, false);
    assert.notEqual(differentRegistry.entity.id, original.id);
  });

  test('address shorthand and explicit address keys resolve to the same identity', () => {
    const h = harness();
    const first = h.store.add(input({address: '1 Ferry Building'}));
    assert.deepEqual(first.entity.relations, [{type: 'identified_as', registry: 'address', external_id: '1 Ferry Building'}]);
    assert.equal(h.store.add(input({address: '1 FERRY BUILDING'})).entity.id, first.entity.id);
    assert.equal(h.store.add(input({registry: 'address', external_id: '1 ferry building'})).entity.id, first.entity.id);
    assert.equal(h.store.find({registry: 'address', external_id: '1 FERRY BUILDING'}).id, first.entity.id);
    assert.equal(h.store.all().length, 1);
    assert.equal(h.mint.calls.length, 1);
  });

  test('deduplicates against previous and earlier batch items while retaining result order', () => {
    const h = harness();
    const old = h.store.add(input({registry: 'test', external_id: 'A'})).entity;
    const result = h.store.addMany([
      input({registry: 'test', external_id: 'a'}),
      input({registry: 'test', external_id: 'B'}),
      input({registry: 'test', external_id: 'b'}),
      input({registry: 'test', external_id: 'C'}),
    ]);
    assert.deepEqual(result.map(r => r.existing), [true, false, true, false]);
    assert.equal(result[0].entity.id, old.id);
    assert.equal(result[1].entity.id, result[2].entity.id);
    assert.equal(h.store.all().length, 3);
    assert.equal(h.mint.calls.length, 3);
    assert.equal(h.storage.writes.length, 2, 'one atomic write per accepted batch');
  });

  test('sample district has six distinct keys and is idempotent across repeated imports', () => {
    const h = harness();
    const sample = sampleDistrict();
    assert.equal(sample.length, 6);
    assert.equal(new Set(sample.map(i => i.external_id)).size, 6);
    assert.ok(sample.every(i => i.source === 'synthetic sample' && i.registry === 'globe.sample'));
    sample.forEach(i => validateCoordinates(i.lat, i.lng));
    const original = h.store.addMany(sample).map(r => r.entity.id);
    const again = h.store.addMany(sampleDistrict());
    assert.ok(again.every(r => r.existing));
    assert.deepEqual(again.map(r => r.entity.id), original);
    assert.equal(h.store.all().length, 6);
    sample[0].label = 'Changed only this returned sample';
    assert.equal(sampleDistrict()[0].label, 'Warehouse A');
    for (const example of Object.values(EXAMPLES)) validateCoordinates(example.lat, example.lng);
  });

  test('validates the whole batch before minting or writing any valid prefix', () => {
    const h = harness();
    const saved = h.store.add(input());
    const original = h.storage.data.get(STORE_KEY);
    for (const bad of [input({lat: 91}), input({lng: 181}), input({lat: '3'}), input({lng: NaN})]) {
      assert.throws(() => h.store.addMany([input(), bad]));
      assert.deepEqual(h.store.all(), [saved.entity]);
      assert.equal(h.storage.data.get(STORE_KEY), original);
      assert.equal(h.mint.calls.length, 1);
      assert.equal(h.storage.writes.length, 1);
    }
  });

  test('a mint, zone, or timestamp failure never commits a partially constructed batch', () => {
    for (const dependency of ['mint', 'zoneOf', 'now']) {
      const h = harness();
      const original = h.store.add(input()).entity;
      const before = h.storage.data.get(STORE_KEY);
      const implementation = h.options[dependency];
      let calls = 0;
      const store = createStore({...h.options, [dependency](...args) {
        if (++calls === 2) throw new Error(`Injected ${dependency} failure`);
        return implementation(...args);
      }});
      assert.throws(() => store.addMany([input(), input()]), /Injected/);
      assert.deepEqual(store.all(), [original], dependency);
      assert.equal(h.storage.data.get(STORE_KEY), before, dependency);
      assert.equal(h.storage.writes.length, 1, dependency);
    }
  });

  test('accepts an empty batch without changing identities', () => {
    const h = harness();
    assert.deepEqual(h.store.addMany([]), []);
    assert.deepEqual(h.store.all(), []);
    assert.equal(h.mint.calls.length, 0);
  });

  test('allows 200 identities, rejects a genuinely new 201st, and still resolves single duplicates', () => {
    const h = harness();
    const inputs = Array.from({length: 200}, (_, i) => input({registry: 'test', external_id: String(i)}));
    const added = h.store.addMany(inputs);
    assert.equal(added.length, 200);
    assert.equal(new Set(added.map(r => r.entity.id)).size, 200);
    const before = h.storage.data.get(STORE_KEY);
    assert.throws(() => h.store.add(input({registry: 'test', external_id: '201'})), /200/);
    assert.throws(() => h.store.addMany([input(), input()]), /200/);
    assert.equal(h.store.add(inputs[0]).existing, true);
    assert.equal(h.store.all().length, 200);
    assert.equal(h.storage.data.get(STORE_KEY), before);
    assert.equal(h.mint.calls.length, 200);
  });

  test('capacity counts new identities, not duplicate entries in a batch', () => {
    const h = harness();
    const inputs = Array.from({length: 199}, (_, i) => input({registry: 'test', external_id: String(i)}));
    h.store.addMany(inputs);
    const result = h.store.addMany([inputs[0], input({registry: 'test', external_id: 'last'}), inputs[1]]);
    assert.deepEqual(result.map(r => r.existing), [true, false, true]);
    assert.equal(h.store.all().length, 200);
    const repeated = h.store.addMany([inputs[0], inputs[1]]);
    assert.ok(repeated.every(r => r.existing));
    assert.equal(h.mint.calls.length, 200);
  });

  test('reload preserves exact IDs, metadata, lookups, and snapshot without reminting', () => {
    const h = harness();
    const entity = h.store.add(input({address: 'Ferry Building', cls: 'built:structure', source: 'user'})).entity;
    const originalContext = h.store.context(entity.id);
    const reloaded = createStore(h.options);
    assert.equal(reloaded.warning(), '');
    assert.deepEqual(reloaded.all(), h.store.all());
    assert.deepEqual(reloaded.context(entity.id), originalContext);
    assert.equal(reloaded.find({registry: 'address', external_id: 'FERRY BUILDING'}).id, entity.id);
    assert.equal(reloaded.add(input({address: 'ferry building'})).existing, true);
    assert.equal(h.mint.calls.length, 1);
    assert.equal(h.storage.writes.length, 1);
  });

  test('all returns an independent list container', () => {
    const h = harness();
    const entity = h.store.add(input()).entity;
    const list = h.store.all();
    list.pop();
    list.push({id: 'not in the store'});
    assert.deepEqual(h.store.all(), [entity]);
  });

  test('context contains identity metadata and an order-independent collection snapshot', () => {
    const h = harness();
    const a = h.store.add(input({address: 'A'})).entity;
    const initial = h.store.context(a.id);
    assert.deepEqual(initial, {
      id: a.id, class: 'place', labels: a.labels, anchor: a.anchor,
      position: {lat: a.lat, lng: a.lng}, zone: ZONE,
      snapshot_id: `globe-snap:${a.id}`, relations: a.relations, minted: TIME, layer: 'globe-sandbox',
    });
    const b = h.store.add(input({address: 'B'})).entity;
    const snapshot = `globe-snap:${[a.id, b.id].sort().join('|')}`;
    assert.equal(h.store.context(a.id).snapshot_id, snapshot);
    assert.equal(h.store.context(b.id).snapshot_id, snapshot);
    assert.notEqual(snapshot, initial.snapshot_id);
    const reversed = memoryStorage({[STORE_KEY]: JSON.stringify(h.store.all().reverse())});
    assert.equal(createStore({...h.options, storage: reversed}).context(a.id).snapshot_id, snapshot);
  });

  test('exports GeoJSON identity, anchor, relations, class, timestamp, and coordinates losslessly', () => {
    const h = harness();
    assert.deepEqual(h.store.export(), {type: 'FeatureCollection', features: []});
    const entity = h.store.add(input({address: 'Pier 1', cls: 'built:structure'})).entity;
    const exported = JSON.parse(JSON.stringify(h.store.export()));
    assert.deepEqual(exported, {
      type: 'FeatureCollection', features: [{
        type: 'Feature', id: entity.id,
        properties: {
          name: 'Ferry Building', class: 'built:structure', identity: entity.id,
          anchor: entity.anchor, zone: ZONE, minted: TIME,
          relations: entity.relations, source: '4D-ID globe sandbox',
        },
        geometry: {type: 'Point', coordinates: [-122.3937, 37.7955]},
      }],
    });
    assert.equal(h.mint.calls.length, 1);
    assert.equal(h.storage.writes.length, 1);
    assert.equal(normalizeGeoJSON(exported).points[0].label, 'Ferry Building');
  });

  test('clear removes only the globe collection and persists through reload', () => {
    const h = harness(memoryStorage({[SHARED_KEY]: SHARED_DATA}));
    const entity = h.store.add(input({address: 'Clear me'})).entity;
    h.store.clear();
    assert.deepEqual(h.store.all(), []);
    assert.equal(h.store.find({id: entity.id}), null);
    assert.equal(h.store.find({registry: 'address', external_id: 'Clear me'}), null);
    assert.equal(h.store.context(entity.id), null);
    assert.deepEqual(h.store.export(), {type: 'FeatureCollection', features: []});
    assert.deepEqual(createStore(h.options).all(), []);
    assert.equal(h.storage.data.get(SHARED_KEY), SHARED_DATA);
    assert.equal(h.storage.data.get(STORE_KEY), '[]');
    assert.equal(h.store.add(input({address: 'Clear me'})).existing, false);
  });
});

describe('blocked and corrupt storage', () => {
  test('blocked reads fall back to a usable ephemeral collection without any writes', () => {
    const storage = memoryStorage({[STORE_KEY]: 'retained', [SHARED_KEY]: SHARED_DATA}, {blockRead: true});
    const h = harness(storage);
    assert.match(h.store.warning(), /unavailable|unreadable/i);
    const entity = h.store.add(input({address: 'Temporary'})).entity;
    assert.equal(h.store.find({id: entity.id}).id, entity.id);
    assert.equal(h.store.export().features.length, 1);
    h.store.clear();
    assert.deepEqual(h.store.all(), []);
    assert.equal(storage.data.get(STORE_KEY), 'retained');
    assert.equal(storage.data.get(SHARED_KEY), SHARED_DATA);
    assert.deepEqual(storage.writes, []);
    assert.deepEqual(storage.removes, []);
  });

  test('missing storage API also falls back to memory', () => {
    for (const storage of [undefined, null, {}]) {
      const h = harness(storage, {storage});
      assert.ok(h.store.warning());
      assert.equal(h.store.add(input()).existing, false);
      assert.equal(h.store.all().length, 1);
      h.store.clear();
      assert.deepEqual(h.store.all(), []);
    }
  });

  test('quota/write failures retain existing persisted bytes and all in-memory batch items', () => {
    const {raw} = seededStorage();
    const storage = memoryStorage({[STORE_KEY]: raw, [SHARED_KEY]: SHARED_DATA}, {blockWrite: true});
    const mint = canonicalMint();
    mint(0, 0); // Skip the suffix already in the persisted fixture.
    const h = harness(storage, {mint});
    assert.equal(h.store.warning(), '');
    assert.equal(h.store.addMany([input(), input()]).length, 2);
    assert.equal(h.store.all().length, 3);
    assert.equal(h.store.export().features.length, 3);
    assert.match(h.store.warning(), /full|blocked/i);
    assert.equal(storage.data.get(STORE_KEY), raw);
    h.store.add(input());
    h.store.clear();
    assert.deepEqual(h.store.all(), []);
    assert.equal(storage.writes.length, 1, 'stop retrying known-blocked persistence');
    assert.equal(storage.data.get(STORE_KEY), raw);
    assert.equal(storage.data.get(SHARED_KEY), SHARED_DATA);
    assert.equal(createStore({...h.options, storage: memoryStorage({[STORE_KEY]: raw})}).all().length, 1);
  });

  test('empty persisted array loads normally', () => {
    const h = harness(memoryStorage({[STORE_KEY]: '[]'}));
    assert.deepEqual(h.store.all(), []);
    assert.equal(h.store.warning(), '');
    h.store.add(input());
    assert.equal(h.storage.writes.length, 1);
  });

  for (const [label, raw] of [
    ['malformed JSON', '{"truncated":'], ['HTML', '<!doctype html>'],
    ['null', 'null'], ['object', '{}'], ['string', '"not an array"'],
    ['null entity', '[null]'], ['incomplete identity', '[{"lat":0,"lng":0}]'],
  ]) test(`retains ${label} storage byte-for-byte`, () => assertRetainsCorrupt(raw));

  test('a corrupt trailing identity rejects the whole stored collection', () => {
    const {entity} = seededStorage();
    assertRetainsCorrupt(JSON.stringify([entity, {...entity, lat: 91}]));
  });

  test('rejects duplicate IDs in persisted storage without overwriting it', () => {
    const {entity} = seededStorage();
    assertRetainsCorrupt(JSON.stringify([entity, entity]));
  });

  test('rejects over-capacity persisted collections without overwriting them', () => {
    const {entity} = seededStorage();
    const mint = canonicalMint();
    assertRetainsCorrupt(JSON.stringify(Array.from({length: 201}, () => ({...entity, id: mint(0, 0).id}))));
  });

  for (const [label, change] of [
    ['invalid ID', {id: 'not-a-4did'}],
    ['short suffix', {id: `4did:h3:${CELL}:AAA`}],
    ['missing anchor', {anchor: null}],
    ['empty cell', {anchor: {cell: ''}}],
    ['string latitude', {lat: '37.7955'}],
    ['invalid longitude', {lng: 181}],
    ['non-array labels', {labels: {text: 'bad'}}],
    ['non-array relations', {relations: {registry: 'address'}}],
  ]) test(`retains stored identity with ${label}`, () => {
    const {entity} = seededStorage();
    assertRetainsCorrupt(JSON.stringify([{...entity, ...change}]));
  });

  test('rejects malformed relation entries before a later find/dedup can crash', () => {
    const {entity} = seededStorage();
    for (const relations of [[null], [{registry: 'address', external_id: 123}], [{registry: 'address'}]]) {
      assertRetainsCorrupt(JSON.stringify([{...entity, relations}]));
    }
  });

  test('rejects non-string persisted display labels rather than trusting arbitrary objects', () => {
    const {entity} = seededStorage();
    assertRetainsCorrupt(JSON.stringify([{...entity, labels: [{text: {html: '<script>bad</script>'}}]}]));
  });
});
