const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { privateHtmlName, safeAvatarPath } = require('../privateAssets');
test('all encoded and platform HTML aliases select a guarded page', () => {
  for(const url of ['/','/index.html','/%69ndex.html','//index.html','/index.html.','/index.html%20','/%2findex.html']) assert.equal(privateHtmlName(url),'index.html',url);
  for(const url of ['/overlay.html','/%6fverlay.html','/OVERLAY.HTML','/overlay.html/']) assert.equal(privateHtmlName(url),'overlay.html',url);
  assert.equal(privateHtmlName('/app.js'),null);assert.equal(privateHtmlName('/access.html'),null);
});
test('avatars allow image basenames only and cannot escape any configured directory',()=>{
 const root=path.resolve(__dirname,'../avatars');
 for(const name of ['../.env','..\\.env','../public/logo.png','..\\public\\logo.png','.','..','x.jpg\0','server.js','sub/x.jpg','sub\\x.jpg','C:\\x.jpg']) assert.equal(safeAvatarPath(root,name),null,name);
 assert.equal(safeAvatarPath(root,'user_123.jpg'),path.join(root,'user_123.jpg'));
 assert.equal(safeAvatarPath(root,'user.png'),path.join(root,'user.png'));
});
