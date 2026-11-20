import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {createApp, jsonResponse} from './proxy.mjs';

const files = ['index.html','style.css','engine.js','app.js'];
const assets = Object.fromEntries(await Promise.all(files.map(async file => [file,await readFile(new URL(`./dist/${file}`,import.meta.url),'utf8')])));
const app = createApp(assets);
const port = Number(process.env.LOOMOPS_PORT ?? 4173);
const host = '127.0.0.1';

createServer(async (incoming,outgoing) => {
  const abort = new AbortController();
  outgoing.on('close',()=>{if (!outgoing.writableFinished) abort.abort();});
  let result;
  try {
    const method = incoming.method;
    const options = {method,headers:incoming.headers,signal:abort.signal};
    if (method !== 'GET' && method !== 'HEAD') {
      options.body = Readable.toWeb(incoming);
      options.duplex = 'half';
    }
    const address = new URL(`http://${incoming.headers.host || `${host}:${port}`}`);
    if (!['127.0.0.1','localhost','[::1]'].includes(address.hostname) || !incoming.url.startsWith('/') || incoming.url.startsWith('//')) {
      result = jsonResponse({error:'无效的本机地址。'},400);
    } else {
      result = await app.fetch(new Request(new URL(incoming.url,address),options),process.env);
    }
  } catch { result = jsonResponse({error:'本机服务无法处理此请求。'},500); }
  if (outgoing.destroyed) return;
  outgoing.writeHead(result.status,Object.fromEntries(result.headers));
  outgoing.end(Buffer.from(await result.arrayBuffer()));
}).listen(port,host,()=>console.log(`LoomOps · http://${host}:${port}`));
