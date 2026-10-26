'use strict';
// Settings an administrator broadcasts to every approved TV, plus the per-group
// daily reset exceptions used by the board and the sheet checks. One document.
// holdUntil, when set, replaces every TV's own "freeze daily scores until" time.
const COLLECTION='board_settings',ID='broadcast',MAX_CONFIG=24000,RELOAD=60000;
const validHold=value=>value===''||/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
function validRules(rules){
  if(!rules||typeof rules!=='object'||Array.isArray(rules))return null;
  const entries=Object.entries(rules);if(entries.length>50)return null;
  const clean={};for(const [id,hour] of entries){if(!/^[\w-]{1,40}$/.test(id)||!Number.isInteger(hour)||hour<0||hour>23)return null;clean[id]=hour}
  return clean;
}
function validConfig(config){
  if(!config||typeof config!=='object'||Array.isArray(config))return null;
  try{return JSON.stringify(config).length<=MAX_CONFIG?JSON.parse(JSON.stringify(config)):null}catch{return null}
}
function createBoardSettings({getDb,clock=Date.now}){
  let doc=null,loaded=0,loading=null;
  async function load(){
    const db=getDb();if(!db)return doc;
    if(!loading)loading=db.collection(COLLECTION).findOne({_id:ID}).then(found=>{doc=found;loaded=clock();return doc}).finally(()=>loading=null);
    return loading;
  }
  return{
    // Re-read once a minute so a change made directly in the database also reaches the TVs.
    async current(){if(!loaded)await load().catch(()=>null);else if(clock()-loaded>RELOAD)load().catch(()=>null);return doc},
    version(){return doc?.version||0},
    // null until an administrator saves rules: callers then use the built-in default (DPM 18:00).
    groupRules(){return doc?.groupResetHours||null},
    holdUntil(){return validHold(doc?.holdUntil??'')?doc?.holdUntil||'':''},
    async save({config,groupResetHours,holdUntil},email){
      const db=getDb();if(!db)throw Error('Database unavailable');
      const cleanConfig=config===undefined?doc?.config||null:validConfig(config),rules=groupResetHours===undefined?doc?.groupResetHours||null:validRules(groupResetHours);
      if(config!==undefined&&!cleanConfig)throw new RangeError('Invalid settings');
      if(groupResetHours!==undefined&&!rules)throw new RangeError('Invalid group reset hours');
      if(holdUntil!==undefined&&(typeof holdUntil!=='string'||!validHold(holdUntil)))throw new RangeError('Invalid hold time');
      await load();
      const next={_id:ID,version:(doc?.version||0)+1,config:cleanConfig,groupResetHours:rules,holdUntil:holdUntil===undefined?doc?.holdUntil||'':holdUntil,updatedAt:new Date(clock()).toISOString(),updatedBy:email||''};
      await db.collection(COLLECTION).replaceOne({_id:ID},next,{upsert:true});doc=next;loaded=clock();return next;
    },
    reset(){loaded=0}
  };
}
module.exports={createBoardSettings,validRules,validConfig};
