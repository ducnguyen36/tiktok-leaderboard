'use strict';
// Settings an administrator broadcasts to every approved TV, plus the per-group
// daily reset exceptions used by the board and the sheet checks. One document.
const COLLECTION='board_settings',ID='broadcast',MAX_CONFIG=24000;
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
  let doc=null,loaded=false,loading=null;
  async function load(){
    const db=getDb();if(!db)return doc;
    if(!loading)loading=db.collection(COLLECTION).findOne({_id:ID}).then(found=>{doc=found;loaded=true;return doc}).finally(()=>loading=null);
    return loading;
  }
  return{
    async current(){if(!loaded)await load().catch(()=>null);return doc},
    version(){return doc?.version||0},
    // null until an administrator saves rules: callers then use the built-in default (DPM 18:00).
    groupRules(){return doc?.groupResetHours||null},
    async save({config,groupResetHours},email){
      const db=getDb();if(!db)throw Error('Database unavailable');
      const cleanConfig=config===undefined?doc?.config||null:validConfig(config),rules=groupResetHours===undefined?doc?.groupResetHours||null:validRules(groupResetHours);
      if(config!==undefined&&!cleanConfig)throw new RangeError('Invalid settings');
      if(groupResetHours!==undefined&&!rules)throw new RangeError('Invalid group reset hours');
      await load();
      const next={_id:ID,version:(doc?.version||0)+1,config:cleanConfig,groupResetHours:rules,updatedAt:new Date(clock()).toISOString(),updatedBy:email||''};
      await db.collection(COLLECTION).replaceOne({_id:ID},next,{upsert:true});doc=next;loaded=true;return next;
    },
    reset(){loaded=false}
  };
}
module.exports={createBoardSettings,validRules,validConfig};
