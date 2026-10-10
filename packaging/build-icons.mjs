import sharp from 'sharp';
import fs from 'node:fs';

// Render each Windows size directly; simplify tiny icons instead of reducing a large bitmap.
const sizes=[16,20,24,32,40,48,64,128,256],entries=[];
for(const size of sizes){
  const unit=size/32;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" rx="${Math.round(7*unit)}" fill="#176e52"/><rect x="${Math.round(8*unit)}" y="${Math.round(5*unit)}" width="${Math.round(17*unit)}" height="${Math.round(23*unit)}" rx="${Math.max(1,Math.round(unit))}" fill="white"/><path d="M${12*unit} ${17*unit} L${16*unit} ${21*unit} L${22*unit} ${12*unit}" fill="none" stroke="#176e52" stroke-width="${Math.max(2,Math.round(3*unit))}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const png=await sharp(Buffer.from(svg)).png().toBuffer();
  fs.writeFileSync(new URL(`../ui/icon-${size}.png`,import.meta.url),png);entries.push({size,png});
}
const header=Buffer.alloc(6+entries.length*16);header.writeUInt16LE(1,2);header.writeUInt16LE(entries.length,4);
let offset=header.length;
entries.forEach(({size,png},i)=>{const start=6+i*16;header[start]=size===256?0:size;header[start+1]=header[start];header.writeUInt16LE(1,start+4);header.writeUInt16LE(32,start+6);header.writeUInt32LE(png.length,start+8);header.writeUInt32LE(offset,start+12);offset+=png.length;});
fs.writeFileSync(new URL('../ui/icon.ico',import.meta.url),Buffer.concat([header,...entries.map(e=>e.png)]));
fs.writeFileSync(new URL('../ui/icon.svg',import.meta.url),'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#176e52"/><rect x="8" y="5" width="17" height="23" rx="1" fill="white"/><path d="m12 17 4 4 6-9" fill="none" stroke="#176e52" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>');
