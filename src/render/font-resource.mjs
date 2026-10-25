const familyKey=name=>String(name||'').replaceAll('"','').toLowerCase();
export function fontCSS({family,weight='400',style='normal'}) {
  return `${style} ${weight} 24px "${String(family).replaceAll('"','')}"`;
}

// CSS font matching for the stored single-weight normal/italic faces. A missing
// exact variant keeps the browser's existing synthesis behavior. A failed exact
// variant must never silently fall back to another face.
export function selectCustomFont(font, records) {
  let candidates=records.filter(f=>familyKey(f.family)===familyKey(font.family)).map(f=>({record:f,family:f.family,weight:String(f.weight),style:f.style||'normal'}));
  if(!candidates.length)candidates=records.filter(f=>familyKey(f.name)===familyKey(font.family)).map(f=>({record:f,family:f.name,weight:'400',style:'normal'}));
  if(!candidates.length)return null;
  const styles=font.style==='normal'?['normal','oblique','italic']:font.style==='italic'?['italic','oblique','normal']:['oblique','italic','normal'];
  const style=styles.find(s=>candidates.some(f=>f.style===s));candidates=candidates.filter(f=>f.style===style);
  const weight=font.weight==='bold'?700:font.weight==='normal'?400:Number(font.weight)||400;
  const rank=w=>weight>=400&&weight<=500?(w>=weight&&w<=500?w-weight:w<weight?500-w:500+w):weight<400?(w<=weight?weight-w:1000+w):(w>=weight?w-weight:2000-w);
  return candidates.sort((a,b)=>rank(Number(a.weight))-rank(Number(b.weight)))[0];
}

export function createFontResources({createFace,fontSet}) {
  // This is the loadFontFace registry, not an independent export cache.
  const faces=new Map();
  function faceFor(record,family,weight,style) {
    const key=JSON.stringify([record.data,family,weight,style]);
    if(!faces.has(key)) {
      const face=createFace(family,`url(${JSON.stringify(record.data)})`,{weight,style});
      const completion=face.load();faces.set(key,{face,completion});
    }
    return faces.get(key);
  }
  async function loadFace(record,family,weight,style) {
    const resource=faceFor(record,family,weight,style);await resource.completion;
    if(resource.face.status!=='loaded')throw new Error('FontFace не готов');return resource.face;
  }
  async function prepare(record) {
    const result=[await loadFace(record,record.family,String(record.weight),record.style||'normal')];
    if(record.name&&record.name!==record.family)result.push(await loadFace(record,record.name,'400','normal'));
    return result;
  }
  function register(loaded) {for(const face of loaded)fontSet.add(face);}
  async function load(record) {const loaded=await prepare(record);register(loaded);return loaded;}
  async function ensure(font,records) {
    const selected=selectCustomFont(font,records);
    let expected=null;
    if(selected){expected=await loadFace(selected.record,selected.family,selected.weight,selected.style);fontSet.add(expected);}
    const loaded=await fontSet.load(fontCSS(font),font.text||' ');
    if(expected&&(!loaded.includes(expected)||expected.status!=='loaded'))throw new Error('Требуемый FontFace не выбран');
    // For system/builtin names [] is normal: FontFaceSet cannot attest that a
    // particular locally installed family (or every glyph) exists.
  }
  return {prepare,register,load,ensure};
}
