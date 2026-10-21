export function validateShapeCatalog(input){
 if(!Array.isArray(input)||input.length>300)throw Error('Некорректный каталог фигур');
 const ids=new Set(),groups=new Set();return input.map(g=>{
  const name=String(g.name||'').trim().slice(0,100);if(!name)throw Error('Группа без названия');
  const shapes=(Array.isArray(g.shapes)?g.shapes:[]).slice(0,1500).map(s=>{
   const id=String(s.id||'').slice(0,100),d=String(s.d||'').slice(0,160000);
   if(!id||ids.has(id)||!d||!/^[\s\d.eE+\-,MmZzLlHhVvCcSsQqTtAa]+$/.test(d))throw Error('Некорректный контур: '+id);
   ids.add(id);const out={id,name:String(s.name||'Фигура').slice(0,100),d};
   for(const k of ['mode','lineStyle','capStart','capEnd'])if(s[k])out[k]=String(s[k]).slice(0,20);
   for(const k of ['outlineCaps'])if(s[k]!=null)out[k]=!!s[k];
   if(Array.isArray(s.parts))out.parts=s.parts.slice(0,500).map(part=>{
    const pd=String(part.d||'');if(!pd||pd.length>160000||!/^[\s\d.eE+\-,MmZzLlHhVvCcSsQqTtAa]+$/.test(pd))throw Error('Неверный SVG path');
    const m=Array.isArray(part.matrix)?part.matrix.map(Number):[1,0,0,1,0,0];if(m.length!==6||m.some(v=>!Number.isFinite(v)||Math.abs(v)>1e7))throw Error('Неверное SVG преобразование');return {d:pd,matrix:m};
   });return out;
  });groups.add(name);return {name,shapes};
 });
}
