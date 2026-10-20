import katex from './katex/katex.mjs';
const mathOptions={throwOnError:true,trust:false,output:'mathml',maxExpand:200};
function mathNode(expression) {
  const span=document.createElement('span');
  try{katex.render(expression,span,mathOptions);}catch{span.textContent=expression;}
  return span;
}
function inline(target,text) {
  const pattern=/\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$|\$([^$\n]+)\$/g;
  let previous=0;
  for(const match of text.matchAll(pattern)) {
    plain(target,text.slice(previous,match.index));
    target.append(mathNode(match.slice(1).find(x=>x!==undefined)));
    previous=match.index+match[0].length;
  }
  plain(target,text.slice(previous));
}
const formulaCharacter=char=>/^[A-Za-z0-9\s\\{}\[\]().+\-−–*/=<>≤≥,·^_|]$/u.test(char);
// Some model/rubric labels contain raw LaTeX without delimiters. Keep the
// surrounding explanation as text, but render each balanced math-looking run.
function plainBare(target,text) {
  const startCommand=/\\(?:frac|dfrac|tfrac|sqrt|left|right|times|cdot|div|le|ge|leq|geq|neq|pm|Delta)(?![A-Za-z])/g;
  let previous=0;
  for(const match of text.matchAll(startCommand)) {
    if(match.index<previous)continue;
    let start=match.index;
    while(start>previous&&formulaCharacter(text[start-1]))start--;
    let end=match.index+match[0].length;
    while(end<text.length&&formulaCharacter(text[end]))end++;
    while(end>start&&/\s/u.test(text[end-1]))end--;
    target.append(document.createTextNode(text.slice(previous,start)));
    const expression=text.slice(start,end).replace(/[−–]/g,'-').replace(/≤/g,'\\le ').replace(/≥/g,'\\ge ').replace(/Δ/g,'\\Delta ').replace(/·/g,'\\cdot ');
    target.append(mathNode(expression));
    previous=end;
  }
  target.append(document.createTextNode(text.slice(previous)));
}
function plain(target,text) {
  const expression=/\b([A-Za-z](?:_(?:\{[A-Za-z0-9]+\}|[A-Za-z0-9]))?(?:\^(?:\{[A-Za-z0-9]+\}|[0-9]))?)\/\(([A-Za-z0-9]+)\)/g;
  let previous=0;
  for(const match of text.matchAll(expression)) {
    plainBare(target,text.slice(previous,match.index));
    target.append(mathNode(`\\frac{${match[1]}}{${match[2]}}`));
    previous=match.index+match[0].length;
  }
  plainBare(target,text.slice(previous));
}
export function renderInlineFeedback(target,text) {
  target.replaceChildren();inline(target,String(text || ''));
}
export function renderFeedback(target,text) {
  target.replaceChildren();target.classList.add('formatted-feedback');
  const lines=String(text || '').replace(/\s+(?=(?:第\s*[（(]\d+[）)]\s*问|[（(]\d+[）)]\s*满分|总分\s*[:：=]))/gu,'\n').split(/\n+/).filter(x=>x.trim());
  for(const line of lines){const p=document.createElement('p');renderInlineFeedback(p,line.trim().replace(/^[-*]\s+/,''));target.append(p);}
}
