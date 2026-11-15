// Portable ZIP (stored entries): no system zip utility or platform dependency.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const root=new URL('../browser-extension/',import.meta.url);
const files=['background.js','client.mjs','icon.png','island.mjs','manifest.json','options.html','options.js','page-task.mjs','popup.html','popup.js','sync-core.mjs','sync.css','usage-selection.mjs'];
const manifest=JSON.parse(await readFile(new URL('manifest.json',root),'utf8'));
if(manifest.manifest_version!==3||manifest.permissions.includes('cookies')||manifest.host_permissions?.length)throw Error('unsafe manifest');
const crc32=bytes=>{let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^(crc&1?0xedb88320:0)}return (crc^0xffffffff)>>>0};
const local=[],central=[];let offset=0;
for(const file of files){const name=Buffer.from(file),data=await readFile(new URL(file,root)),crc=crc32(data);const h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x5c21,12);h.writeUInt32LE(crc,14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(name.length,26);local.push(h,name,data);
 const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x5c21,14);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);central.push(c,name);offset+=h.length+name.length+data.length;
}
const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
await mkdir('dist',{recursive:true});await writeFile('dist/ai-quota-sync-extension.zip',Buffer.concat([...local,directory,end]));
console.log(`Built dist/ai-quota-sync-extension.zip (${files.length} files, deterministic stored ZIP)`);
