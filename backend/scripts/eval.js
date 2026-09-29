// Runs 5 products through the API and prints a markdown table for the README "Test evidence" section.
// Usage: start the backend, then `npm run eval`.
const B = process.env.API || 'http://localhost:3001/api';
const products = ['oversized graphic tee', 'protein dark chocolate', 'white running sneakers', 'leather crossbody bag', 'wireless earbuds'];
console.log('| Product | Instagram good | Meta good | Best match reason |\n|---|---|---|---|');
for (const query of products) {
  const { id } = await (await fetch(`${B}/search`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) })).json();
  let j; do { await new Promise(r => setTimeout(r, 2000)); j = await (await fetch(`${B}/search/${id}`)).json(); } while (!['done', 'error'].includes(j.status));
  const r = j.results || {}, best = [...(r.instagram?.items || []), ...(r.meta?.items || [])].filter(v => !v.seenBefore).sort((a, b) => b.score - a.score)[0];
  console.log(`| ${query} | ${r.instagram?.good}/20 | ${r.meta?.good}/20 | ${best ? best.score + ': ' + best.reason : 'n/a'} |`);
}
