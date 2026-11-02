// Loopback-only helper for the in-app browser recording: serves the user-line clips and
// accepts the recorded assistant audio and event log. CORS is limited to the local app origins.
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.argv[2]||5203);
const allowed=/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/;
http.createServer((req,res)=>{
 const origin=req.headers.origin||'';if(allowed.test(origin)){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Methods','GET,POST');res.setHeader('Access-Control-Allow-Headers','Content-Type');}
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 const url=new URL(req.url,'http://x');
 if(req.method==='GET'&&/^\/audio\/[\w-]+\.wav$/.test(url.pathname)){const file=path.join(root,'out',url.pathname);if(!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':'audio/wav'});fs.createReadStream(file).pipe(res);return;}
 if(req.method==='POST'&&url.pathname==='/save'){
  const run=String(url.searchParams.get('run')||''),name=String(url.searchParams.get('name')||'');
  if(!/^[\w-]{1,80}$/.test(run)||!/^[\w.-]{1,80}$/.test(name)){res.writeHead(400);res.end('bad name');return;}
  const dir=path.join(root,'work',run);fs.mkdirSync(dir,{recursive:true});
  const out=fs.createWriteStream(path.join(dir,name));req.pipe(out);out.on('finish',()=>{res.writeHead(200);res.end('saved');});return;
 }
 if(req.method==='GET'&&url.pathname==='/hooks.js'){res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});fs.createReadStream(path.join(root,'scripts/pane-hooks.js')).pipe(res);return;}
 if(req.method==='GET'&&url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/plain'});res.end('film helper');return;}
 res.writeHead(404);res.end();
}).listen(port,'127.0.0.1',()=>console.log('film helper on',port));
