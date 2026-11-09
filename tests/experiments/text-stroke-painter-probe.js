// Paste into Firefox's Web Console on the Preview. No network/storage writes.
// Pair with the two conditional breakpoints documented in docs/range-stroke-firefox-abc.md.
(()=>{
 const key='__kartochnayaStrokeProbe';if(globalThis[key])return;
 const proto=CanvasRenderingContext2D.prototype,original={},wrappers={},pending=new WeakMap(),canvasIds=new WeakMap(),epochs=new WeakMap();let nextId=0;
 const probe={rows:[],label:'',dropped:0,
  reset(label=''){this.rows.length=0;this.label=label;this.dropped=0;},
  mark(ctx,element,part,pass){pending.set(ctx,{layerId:element.id,elementStrokeStyle:element.strokeStyle??null,part:{text:part.text,start:part.start,end:part.end,strokeStyle:part.style.strokeStyle??null},pass});return false;},
  report(){
   const groups=new Map();for(const row of this.rows){const k=JSON.stringify([row.label,row.canvas,row.epoch,row.layerId??'UNMARKED']);if(!groups.has(k))groups.set(k,{label:row.label,canvas:row.canvas,epoch:row.epoch,layerId:row.layerId??'UNMARKED',fillText:0,strokeText:0});groups.get(k)[row.method]++;}
   return{userAgent:navigator.userAgent,dpr:devicePixelRatio,dropped:this.dropped,counts:[...groups.values()],rows:this.rows.slice()};
  },
  stop(){for(const [method,wrapper]of Object.entries(wrappers))if(proto[method]===wrapper)proto[method]=original[method];delete globalThis[key];},
 };
 for(const method of ['clearRect','fillText','strokeText']){
  original[method]=proto[method];wrappers[method]=function(...args){
   if(method==='clearRect')epochs.set(this,(epochs.get(this)||0)+1);
   else{
    const metadata=pending.get(this);pending.delete(this);
    if(!canvasIds.has(this.canvas))canvasIds.set(this.canvas,++nextId);
    const t=this.getTransform();
    if(probe.rows.length<10000)probe.rows.push({label:probe.label,canvas:canvasIds.get(this.canvas),epoch:epochs.get(this)||0,canvasId:this.canvas.id??'',overlay:this.canvas.hasAttribute?.('data-text-stroke-overlay')??false,connected:this.canvas.isConnected??false,size:[this.canvas.width,this.canvas.height],method,text:String(args[0]),x:args[1],y:args[2],...metadata,marked:!!metadata,dash:this.getLineDash(),lineCap:this.lineCap,lineWidth:this.lineWidth,globalAlpha:this.globalAlpha,color:method==='strokeText'?String(this.strokeStyle):String(this.fillStyle),font:this.font,letterSpacing:this.letterSpacing,transform:[t.a,t.b,t.c,t.d,t.e,t.f]});else probe.dropped++;
   }
   return Reflect.apply(original[method],this,args);
  };proto[method]=wrappers[method];
 }
 globalThis[key]=probe;
})();
