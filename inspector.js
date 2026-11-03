import { parseIdentity, knowledgeSplit, anchorContrast, RELATIONSHIPS, gersExample, samples } from './identity-model.js';

const $ = id => document.getElementById(id);
const form = $('inspectForm');
const input = $('identityInput');
const result = $('inspectResult');
const status = $('inspectStatus');

function text(node, value) { node.textContent = value; }
function facts(node, rows) {
  node.replaceChildren(...rows.flatMap(row => {
    const dt = document.createElement('dt'); dt.textContent = row.label;
    const dd = document.createElement('dd'); dd.textContent = row.value;
    return [dt, dd];
  }));
}
function points(node, rows) {
  node.replaceChildren(...rows.map(value => { const li = document.createElement('li'); li.textContent = value; return li; }));
}
function inspect(value) {
  const parsed = parseIdentity(value);
  if (!parsed.ok) {
    result.hidden = true;
    status.className = 'inspect-status error';
    status.textContent = `${parsed.message}${parsed.hint ? ' ' + parsed.hint : ''}`;
    return;
  }
  const split = knowledgeSplit(parsed);
  const contrast = anchorContrast(parsed);
  result.hidden = false;
  status.className = 'inspect-status ok';
  status.textContent = 'Parsed locally. No resolver or registry was contacted.';
  text($('formLabel'), parsed.formLabel);
  text($('resultId'), parsed.input);
  text($('resultSummary'), parsed.summary);
  text($('complianceBadge'), parsed.compliant ? 'No warning detected' : 'Review warnings');
  $('complianceBadge').className = `status-badge ${parsed.compliant ? 'ok' : 'warn'}`;
  $('warningList').replaceChildren(...parsed.warnings.map(value => { const p = document.createElement('p'); p.textContent = value; return p; }));
  $('warningList').hidden = parsed.warnings.length === 0;
  facts($('syntaxFacts'), split.fromSyntax);
  facts($('resolverFacts'), split.fromResolver);
  text($('genesisTitle'), contrast.genesis.title); text($('genesisValue'), contrast.genesis.value); points($('genesisPoints'), contrast.genesis.points);
  text($('anchorTitle'), contrast.anchor.title); text($('anchorValue'), contrast.anchor.value); points($('anchorPoints'), contrast.anchor.points);
  text($('parentRule'), contrast.parentRule);
}

$('sampleList').replaceChildren(...samples().map(sample => {
  const button = document.createElement('button'); button.type = 'button'; button.className = 'sample';
  button.innerHTML = `<strong>${sample.label}</strong><span>${sample.value}</span>`;
  button.addEventListener('click', () => { input.value = sample.value; inspect(sample.value); });
  return button;
}));

$('relationshipGrid').replaceChildren(...RELATIONSHIPS.map(rel => {
  const card = document.createElement('article'); card.className = 'relationship-card';
  const label = document.createElement('span'); label.className = 'eyebrow'; label.textContent = rel.type;
  const title = document.createElement('h3'); title.textContent = rel.shape;
  const yes = document.createElement('p'); yes.textContent = rel.means;
  const no = document.createElement('p'); no.className = 'not-means'; no.textContent = `Not this: ${rel.notMeans}`;
  card.append(label, title, yes, no); return card;
}));

const gers = gersExample();
$('gersExample').innerHTML = `<div class="gers-route"><span>${gers.external.registry}</span><strong>${gers.external.id}</strong><i>identified_as</i><span>4D-ID</span><strong>${gers.entity.id}</strong></div>
<div class="gers-columns"><div><h3>Evidence retained</h3><ul>${gers.evidence.map(item => `<li><strong>${item.source}</strong>${item.detail}</li>`).join('')}</ul></div><div><h3>Decision path</h3><ol><li><strong>First run</strong>${gers.decision.first}</li><li><strong>Second run</strong>${gers.decision.second}</li></ol></div></div><p class="gers-boundary">${gers.boundary}</p>`;

form.addEventListener('submit', event => { event.preventDefault(); inspect(input.value); });
const initial = samples()[0].value; input.value = initial; inspect(initial);
