import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
const root = new URL('../../', import.meta.url);
const allowed = new Set(['tests/spikes/fixture.html','tests/spikes/surface.mjs','src/render/rich-text-layout.mjs','src/model/rich-text.mjs','tests/fixtures/fonts/DejaVuSans.ttf','tests/fixtures/fonts/DejaVuSans-Bold.ttf','tests/fixtures/fonts/DejaVuSerif.ttf']);
createServer(async(req,res)=>{
 const path = new URL(req.url,'http://localhost').pathname.slice(1);
 if(!allowed.has(path)){res.writeHead(404).end();return;}
 const data=await readFile(new URL(path,root));
 res.setHeader('Content-Type',path.endsWith('.html')?'text/html':path.endsWith('.ttf')?'font/ttf':'text/javascript');res.end(data);
}).listen(4175,'127.0.0.1');
