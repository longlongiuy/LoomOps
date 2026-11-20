import {mkdir, readFile, writeFile} from 'node:fs/promises';

const assets = {};
for (const file of ['index.html','style.css','engine.js','app.js']) {
  assets[file] = await readFile(new URL(`./dist/${file}`,import.meta.url),'utf8');
}
const proxy = await readFile(new URL('./proxy.mjs',import.meta.url),'utf8');
await mkdir(new URL('./dist/server/',import.meta.url),{recursive:true});
await writeFile(new URL('./dist/server/index.js',import.meta.url),`${proxy}\nexport default createApp(${JSON.stringify(assets)});\n`);
