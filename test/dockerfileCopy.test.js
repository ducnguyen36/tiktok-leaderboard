const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
// The Dockerfile copies root modules by name; a module server.js reaches but the
// image lacks crash-loops the container with MODULE_NOT_FOUND (502 for every TV).
test('every root module server.js loads is copied into the image',()=>{
 const root=path.join(__dirname,'..'),copied=new Set();
 for(const line of fs.readFileSync(path.join(root,'Dockerfile'),'utf8').split(/\r?\n/))if(/^COPY\s/.test(line))for(const part of line.split(/\s+/).slice(1,-1))copied.add(part);
 const seen=new Set(),queue=['server.js'];
 while(queue.length){
  const file=queue.shift();if(seen.has(file))continue;seen.add(file);
  for(const match of fs.readFileSync(path.join(root,file),'utf8').matchAll(/require\(\s*['"]\.\/([\w.-]+?)(?:\.js)?['"]\s*\)/g)){const next=match[1]+'.js';if(fs.existsSync(path.join(root,next)))queue.push(next)}
 }
 const missing=[...seen].filter(file=>!copied.has(file));
 assert.deepEqual(missing,[],'add these to a COPY line in the Dockerfile');
});
