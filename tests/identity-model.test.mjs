import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIdentity, knowledgeSplit, anchorContrast, RELATIONSHIPS, gersExample, samples } from '../identity-model.mjs';

const privateId='4did:id:5a89fc81f07739510a815e8c202160ac:AAAAAAAAQACAAAAAAAAAAA';
const spatial='4did:h3:8c2a100d2d0dbff:c3BhdGlhbCBzYW1wbGUgYQ:20260412T094500Z';

test('parses conforming non-spatial identifier',()=>{const p=parseIdentity(privateId);assert.equal(p.ok,true);assert.equal(p.form,'non-spatial');assert.equal(p.compliant,true);assert.equal(p.home.length,32);assert.equal(p.cell,null);});
test('non-spatial form rejects semantic leaks with warnings',()=>{for(const id of ['4did:id:short:AAAAAAAAQACAAAAAAAAAAA','4did:id:5a89fc81f07739510a815e8c202160ac;v=floor.2:AAAAAAAAQACAAAAAAAAAAA','4did:id:5a89fc81f07739510a815e8c202160ac:AAAAAAAAQACAAAAAAAAAAA:20260412T094500Z']){const p=parseIdentity(id);assert.equal(p.ok,true);assert.equal(p.compliant,false);assert.ok(p.warnings.length);}});
test('parses legacy spatial form and marker',()=>{const p=parseIdentity(spatial);assert.equal(p.ok,true);assert.equal(p.form,'spatial');assert.equal(p.cell,'8c2a100d2d0dbff');assert.equal(p.genesis.raw,'20260412T094500Z');assert.equal(p.compliant,true);});
test('recognizes UUIDv7 shorthand',()=>{const p=parseIdentity('4did:h3:8928308280fffff:AZmR3kB8dH2qT7vLxN1pWg');assert.equal(p.ok,true);assert.equal(p.descriptor.uuidVersion,7);assert.equal(p.compliant,true);});
test('warns when spatial random descriptor omits marker',()=>{const p=parseIdentity('4did:h3:8928308280fffff:AAAAAAAAQACAAAAAAAAAAA');assert.equal(p.ok,true);assert.equal(p.compliant,false);assert.match(p.warnings[0],/requires an explicit genesis/);});
test('parses vertical reference',()=>{const p=parseIdentity('4did:h3:8928308280fffff;v=floor.12.b7:AZmR3kB8dH2qT7vLxN1pWg');assert.equal(p.vref,'floor.12.b7');});
test('rejects malformed inputs without throwing',()=>{for(const value of ['',null,'not-an-id','4did:h3:cell:short',' 4did :x'])assert.equal(parseIdentity(value).ok,false);});
test('knowledge split never invents resolver facts',()=>{const k=knowledgeSplit(parseIdentity(privateId));assert.equal(k.fromSyntax.length,5);assert.equal(k.fromResolver.length,5);assert.ok(k.fromResolver.some(x=>/Current location/.test(x.label)));});
test('anchor contrast separates identifier and current records',()=>{const a=anchorContrast(parseIdentity(spatial));assert.match(a.genesis.value,/h3:/);assert.match(a.anchor.value,/resolver records/);assert.match(a.parentRule,/one composition parent/);});
test('relationship meanings stay distinct',()=>{assert.deepEqual(RELATIONSHIPS.map(x=>x.type),['identified_as','describes','parent / contains','represents']);assert.equal(new Set(RELATIONSHIPS.map(x=>x.means)).size,4);});
test('GERS example shows mint then reuse and honest boundary',()=>{const g=gersExample();assert.equal(parseIdentity(g.entity.id).compliant,true);assert.match(g.decision.first,/provisional reference-only/);assert.match(g.decision.second,/Reuse/);assert.match(g.boundary,/does not conflate/);});
test('all UI samples are deterministic and include one intentional warning',()=>{const rows=samples();assert.equal(rows.length,4);assert.equal(rows.filter(x=>parseIdentity(x.value).ok).length,4);assert.equal(rows.filter(x=>parseIdentity(x.value).compliant).length,3);});
