import {renderFeedback} from './feedback.js';

function displayMath(text){
  // Preserve explicit math delimiters; wrap only recognizable bare formula runs.
  return text.split(/(\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]|\$\$[\s\S]*?\$\$|\$[^$\n]+\$)/g).map((part,index)=>{
    if(index%2)return part;
    return part.replace(/[A-Za-z0-9\\{}_^=+\-−–*/()[\].<>≤≥Δ₀-₉²³·\s]+/g,run=>{
      if(!/\\(?:frac|sqrt|times|Delta|cdot)|[A-Za-z][₀-₉_^]|[A-Za-z][^\n]*[=≤≥]|[≤≥][^\n]*[A-Za-z]/.test(run))return run;
      const leading=run.match(/^\s*/)[0],trailing=run.match(/\s*$/)[0];
      let expression=run.trim().replace(/[₀-₉]/g,c=>'_'+('₀₁₂₃₄₅₆₇₈₉'.indexOf(c))).replace(/²/g,'^2').replace(/³/g,'^3').replace(/Δ/g,'\\Delta ').replace(/·/g,'\\cdot ').replace(/[−–]/g,'-').replace(/≤/g,'\\le ').replace(/≥/g,'\\ge ');
      return leading+'\\('+expression+'\\)'+trailing;
    });
  }).join('');
}

export function renderPresetPreview(target,text){
  target.replaceChildren();
  if(!text.trim()){const p=document.createElement('p');p.className='preview-empty';p.textContent='在左侧输入内容，这里实时显示排版结果。';target.append(p);return;}
  const lines=text.replace(/\r\n/g,'\n').replace(/([^\n])\s+(?=(?:第\s*)?[（(]\d+[）)]\s)/g,'$1\n').split('\n');
  let section=target;
  for(const raw of lines){
    const line=raw.trim();if(!line)continue;
    const heading=line.match(/^(?:#{1,6}\s*)?((?:第\s*)?[（(]\d+[）)](?:问)?|[①-⑳]|\d+[、．]|[一二三四五六七八九十]+、)\s*(.*)$/);
    if(heading){section=document.createElement('section');section.className='preview-question';target.append(section);const h=document.createElement('h3');h.textContent=heading[1];section.append(h);if(heading[2]){const body=document.createElement('div');renderFeedback(body,displayMath(heading[2]));section.append(body);}continue;}
    const body=document.createElement('div');body.className=/^[-*•]\s/.test(line)?'preview-point':'';
    renderFeedback(body,displayMath(line));section.append(body);
  }
}

export function setupPresetPreviews(){
  const refresh=()=>{for(const field of ['question','answer','rubric'])renderPresetPreview(document.getElementById(field+'Preview'),document.getElementById(field).value);};
  for(const field of ['question','answer','rubric']){
    const input=document.getElementById(field),label=input.closest('label'),media=document.getElementById(field+'ReferenceImages').closest('.field-media');
    const editor=document.createElement('section');editor.className='preset-editor wide';
    const left=document.createElement('div');left.className='preset-editor-source';
    const right=document.createElement('div');right.className='preset-editor-display';right.innerHTML='<div class="preview-heading">排版预览<span>实时更新</span></div>';
    const preview=document.createElement('div');preview.id=field+'Preview';preview.className='preset-text-preview';right.append(preview);
    media.classList.add('preset-editor-media');
    label.before(editor);left.append(label);editor.append(left,right,media);
    input.addEventListener('input',refresh);
  }
  document.addEventListener('preset-preview-refresh',refresh);refresh();
}
