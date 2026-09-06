// Pure data helpers for the globe sandbox. No network or renderer dependencies.
export const STORE_KEY = '4did_globe_v2';
export const MAX_ENTITIES = 200;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const EXAMPLES = Object.freeze({
  'san-francisco': {lat:37.7955,lng:-122.3937,label:'San Francisco · Ferry Building'},
  rotterdam: {lat:51.909,lng:4.487,label:'Rotterdam · Erasmus Bridge'},
  singapore: {lat:1.2868,lng:103.8545,label:'Singapore · Marina Bay'},
});
export function validateCoordinates(lat,lng) {
  if (typeof lat!=='number'||typeof lng!=='number'||!Number.isFinite(lat)||!Number.isFinite(lng)||lat < -90||lat > 90||lng < -180||lng > 180) throw new Error('Use latitude −90 to 90 and longitude −180 to 180.');
  return {lat,lng};
}
export function parseCoordinates(text) {
  if (!/^\s*[+-]?[\d.]+\s*,\s*[+-]?[\d.]+\s*$/.test(text)) return null;
  const [lat,lng]=text.split(',').map(Number);
  return validateCoordinates(lat,lng);
}
function text(value,fallback) { return typeof value==='string'&&value.trim() ? value.trim().slice(0,160) : fallback; }
export function normalizeGeoJSON(data) {
  if (!data||typeof data!=='object') throw new Error('Choose a GeoJSON FeatureCollection, Feature, Point, or Polygon.');
  const features=data.type==='FeatureCollection' ? data.features : [data.type==='Feature' ? data : {type:'Feature',geometry:data}];
  if (!Array.isArray(features)||!features.length) throw new Error('The file contains no features.');
  if (features.length>MAX_ENTITIES) throw new Error(`Import up to ${MAX_ENTITIES} features at a time.`);
  const points=[];let skipped=0,polygons=0;
  for (const [i,f] of features.entries()) {
    const g=f?.geometry;
    if (!g||!['Point','Polygon'].includes(g.type)) {skipped++;continue;}
    let lat,lng;
    if (g.type==='Point') {
      if (!Array.isArray(g.coordinates)||g.coordinates.length<2) throw new Error(`Feature ${i+1}: invalid point coordinates.`);
      [lng,lat]=g.coordinates;validateCoordinates(lat,lng);
    } else {
      if(!Array.isArray(g.coordinates)||!g.coordinates.length)throw new Error(`Feature ${i+1}: a polygon needs a closed ring.`);
      for(const boundary of g.coordinates) {
        if(!Array.isArray(boundary)||boundary.length<4)throw new Error(`Feature ${i+1}: a polygon needs a closed ring.`);
        for(const p of boundary){if(!Array.isArray(p)||p.length<2)throw new Error(`Feature ${i+1}: invalid ring.`);validateCoordinates(p[1],p[0]);}
        const first=boundary[0],last=boundary[boundary.length-1];
        if(first[0]!==last[0]||first[1]!==last[1])throw new Error(`Feature ${i+1}: close the polygon ring.`);
      }
      const ring=g.coordinates[0];
      const vertices=ring.slice(0,-1);
      // Representative vertex mean, not an area centroid. Circular longitude
      // handles footprints crossing the international date line.
      lat=vertices.reduce((s,p)=>s+p[1],0)/vertices.length;
      lng=Math.atan2(vertices.reduce((s,p)=>s+Math.sin(p[0]*Math.PI/180),0),vertices.reduce((s,p)=>s+Math.cos(p[0]*Math.PI/180),0))*180/Math.PI;
      validateCoordinates(lat,lng);polygons++;
    }
    const props=f.properties||{};
    points.push({lat,lng,label:text(props.name,text(props.label,`Feature ${i+1}`)),cls:text(props.class,'feature'),source:'geojson',address:typeof props.address==='string'?props.address.trim().slice(0,300):undefined});
  }
  if(!points.length) throw new Error('No supported features. Use Points or Polygons.');
  return {points,skipped,polygons};
}
export function sampleDistrict() {
  const names=['Warehouse A','Warehouse B','Office','Gatehouse','Tank','Loading dock'];
  const offsets=[[0,0],[.0014,0],[.0007,.0015],[-.0005,.001],[-.001,.0001],[.0015,-.0015]];
  return names.map((label,i)=>({lat:37.7955+offsets[i][0],lng:-122.3937+offsets[i][1],label,cls:'built:structure',source:'synthetic sample',registry:'globe.sample',external_id:`district:${i}`}));
}
export function createStore({storage,mint,zoneOf,now=()=>new Date().toISOString()}) {
  let entities=[];let warning='';let persistent=true;
  try {
    const raw=storage.getItem(STORE_KEY);
    if(raw) {
      const parsed=JSON.parse(raw);
      if(!Array.isArray(parsed)||parsed.length>MAX_ENTITIES) throw new Error('Invalid stored collection.');
      for(const e of parsed) {validateCoordinates(e.lat,e.lng);if(typeof e.id!=='string'||!/^4did:h3:[a-f0-9]+:[A-Za-z0-9_-]{22}$/.test(e.id)||!e.anchor?.cell||!Array.isArray(e.labels)||!Array.isArray(e.relations)||e.labels.some(l=>!l||typeof l.text!=='string')||e.relations.some(r=>!r||typeof r.registry!=='string'||typeof r.external_id!=='string'))throw new Error('Invalid stored identity.');}
      if(new Set(parsed.map(e=>e.id)).size!==parsed.length)throw new Error('Duplicate stored identity.');
      entities=parsed;
    }
  } catch {persistent=false;warning='Browser storage is unavailable or contains unreadable data. This collection lasts until reload; existing data is untouched.';}
  function save(next) {
    if(persistent) {try{storage.setItem(STORE_KEY,JSON.stringify(next));}catch{persistent=false;warning='Browser storage is full or blocked. Export this collection before leaving; new changes last only until reload.';}}
    entities=next;
  }
  function find(query) {
    if(query.id) return entities.find(e=>e.id===query.id)||null;
    return entities.find(e=>e.relations.some(r=>r.registry===query.registry&&r.external_id.toLowerCase()===String(query.external_id).toLowerCase()))||null;
  }
  function addMany(inputs) {
    if(!Array.isArray(inputs))throw new Error('Expected a list of places.');
    // Validate the complete batch before committing anything.
    inputs.forEach(i=>validateCoordinates(i.lat,i.lng));
    const next=[...entities],result=[];
    for(const input of inputs) {
      const registry=input.registry||(input.address?'address':null);
      const external_id=input.external_id||input.address;
      const existing=registry&&external_id&&next.find(e=>e.relations.some(r=>r.registry===registry&&r.external_id.toLowerCase()===external_id.toLowerCase()));
      if(existing) {result.push({entity:existing,existing:true});continue;}
      if(next.length>=MAX_ENTITIES)throw new Error(`This demo holds ${MAX_ENTITIES} identities. Export or clear the globe collection first.`);
      const m=mint(input.lat,input.lng);
      const entity={id:m.id,anchor:{variant:'h3',cell:m.cell,resolution:12},zone:zoneOf(m.cell),lat:input.lat,lng:input.lng,status:'active',motion_mode:'static',layer:'globe-sandbox',class:input.cls||'place',labels:[{text:input.label||'Named place',source:input.source||'globe demo'}],minted:now(),relations:registry&&external_id?[{type:'identified_as',registry,external_id}]:[]};
      next.push(entity);result.push({entity,existing:false});
    }
    save(next);return result;
  }
  return {all:()=>[...entities],find,addMany,add(input){const existing=input.registry&&input.external_id?find(input):input.address?find({registry:'address',external_id:input.address}):null;return existing?{entity:existing,existing:true}:addMany([input])[0];},clear(){save([]);},warning:()=>warning,context(id){const e=find({id});return e?{id:e.id,class:e.class,labels:e.labels,anchor:e.anchor,position:{lat:e.lat,lng:e.lng},zone:e.zone,snapshot_id:`globe-snap:${entities.map(x=>x.id).sort().join('|')}`,relations:e.relations,minted:e.minted,layer:e.layer}:null;},export(){return {type:'FeatureCollection',features:entities.map(e=>({type:'Feature',id:e.id,properties:{name:e.labels[0]?.text,class:e.class,identity:e.id,anchor:e.anchor,zone:e.zone,minted:e.minted,relations:e.relations,source:'4D-ID globe sandbox'},geometry:{type:'Point',coordinates:[e.lng,e.lat]}}))};}};
}
