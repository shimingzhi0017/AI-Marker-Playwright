import katex from './katex/katex.mjs';
function inline(target,text) {
  const pattern=/\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$|\$([^$\n]+)\$/g;
  let previous=0;
  for(const match of text.matchAll(pattern)) {
    plain(target,text.slice(previous,match.index));
    const span=document.createElement('span');
    const expression=match.slice(1).find(x=>x!==undefined);
    try{katex.render(expression,span,{throwOnError:true,trust:false,output:'mathml',maxExpand:200});}
    catch{span.textContent=expression;}
    target.append(span);previous=match.index+match[0].length;
  }
  plain(target,text.slice(previous));
}
function plain(target,text) {
  const expression=/\b([A-Za-z](?:_(?:\{[A-Za-z0-9]+\}|[A-Za-z0-9]))?(?:\^(?:\{[A-Za-z0-9]+\}|[0-9]))?)\/\(([A-Za-z0-9]+)\)/g;
  let previous=0;
  for(const m of text.matchAll(expression)){
    target.append(document.createTextNode(text.slice(previous,m.index)));const span=document.createElement('span');
    try{katex.render(`\\frac{${m[1]}}{${m[2]}}`,span,{throwOnError:true,trust:false,output:'mathml'});}catch{span.textContent=m[0];}
    target.append(span);previous=m.index+m[0].length;
  }
  target.append(document.createTextNode(text.slice(previous)));
}
export function renderFeedback(target,text) {
  target.replaceChildren();target.classList.add('formatted-feedback');
  const lines=String(text || '').replace(/\s+(?=(?:第\s*[（(]\d+[）)]\s*问|[（(]\d+[）)]\s*满分|总分\s*[:：=]))/gu,'\n').split(/\n+/).filter(x=>x.trim());
  for(const line of lines){const p=document.createElement('p');inline(p,line.trim().replace(/^[-*]\s+/,''));target.append(p);}
}
