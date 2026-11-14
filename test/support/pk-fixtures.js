// competitions.pkStage fixtures (PK stage contract + the organiser's update): one competition = one track, built
// around the competition fixture's talents LILY 🍉, RYAN, Chanee🌸 plus four non-participants (D, E, F, G).
// Seed (rank when the PK stage started): LILY, RYAN, Chanee, D, E, F, G.
//  A1 LILY vs RYAN: V1 LILY, V2 tie (replayed), V3 LILY (2-0) cancelled by RYAN's revive (gap target 1.200),
//     back to 1-0; V4 RYAN, V5 RYAN (1-2); LILY's revive (fixed 2.000) failed. RYAN wins.
//  A2 Chanee vs D: mid-PK running 1-1; later Chanee wins 2-1, D does not revive.
//  A3 E vs F vs G: V1 tie E/G (F waits), V2 E, V3 G, V4 G; E's revive (formula 900) failed. G wins.
// Upper table: RYAN, (Chanee), G. Lower: LILY, (D), E, F. takeLower 2.
const SEED=['LILY 🍉','RYAN','Chanee🌸','D','E','F','G'];
const TRACKS=[{id:'A',label:'Track 1–7',fromRank:1,toRank:7}];
function matchesAt(now,{a2Done=false}={}){
 const t=ms=>new Date(now-ms),dia=(a,b)=>({'LILY 🍉':a,RYAN:b});
 return [
  {id:'A1',track:'A',order:1,talents:['LILY 🍉','RYAN'],status:'done',points:{'LILY 🍉':1,RYAN:2},winner:'RYAN',losers:['LILY 🍉'],
   rounds:[{n:1,winner:'LILY 🍉',tied:[],diamonds:dia(500,300)},{n:2,winner:null,tied:['LILY 🍉','RYAN'],diamonds:dia(400,400)},{n:3,winner:'LILY 🍉',tied:[],diamonds:dia(900,300),cancelledByRevive:'RYAN'},
    {n:4,winner:'RYAN',tied:[],diamonds:dia(100,700)},{n:5,winner:'RYAN',tied:[],diamonds:dia(200,800)}],
   revives:[{talentName:'RYAN',at:t(900000),success:true,mode:'gap',target:1200,round:3},{talentName:'LILY 🍉',at:t(600000),success:false,mode:'fixed',target:2000,round:5}],startedAt:t(1200000),endedAt:t(600000)},
  a2Done?{id:'A2',track:'A',order:2,talents:['Chanee🌸','D'],status:'done',points:{'Chanee🌸':2,D:1},winner:'Chanee🌸',losers:['D'],
    rounds:[{n:1,winner:'Chanee🌸',tied:[],diamonds:{}},{n:2,winner:'D',tied:[],diamonds:{}},{n:3,winner:'Chanee🌸',tied:[],diamonds:{}}],revives:[],startedAt:t(500000),endedAt:t(300000)}
   :{id:'A2',track:'A',order:2,talents:['Chanee🌸','D'],status:'running',points:{'Chanee🌸':1,D:1},winner:null,losers:[],
    rounds:[{n:1,winner:'Chanee🌸',tied:[],diamonds:{}},{n:2,winner:'D',tied:[],diamonds:{}}],revives:[],startedAt:t(500000),endedAt:null},
  {id:'A3',track:'A',order:3,talents:['E','F','G'],status:'done',points:{E:1,F:0,G:2},winner:'G',losers:['E','F'],
   rounds:[{n:1,winner:null,tied:['E','G'],diamonds:{E:300,F:100,G:300}},{n:2,winner:'E',tied:[],diamonds:{}},{n:3,winner:'G',tied:[],diamonds:{}},{n:4,winner:'G',tied:[],diamonds:{}}],
   revives:[{talentName:'E',at:t(700000),success:false,mode:'formula',target:900,round:4}],startedAt:t(1100000),endedAt:t(700000)}
 ];
}
function midPk(now=Date.now()){
 return{updatedAt:new Date(now),phase:'pk',firstTo:2,takeLower:2,seed:SEED,tracks:TRACKS,matches:matchesAt(now),revivesUsed:['RYAN','LILY 🍉','E'],
  tables:{upper:['RYAN','G'],lower:['LILY 🍉','E','F'],cut:['F'],lowerBy:'seed'},voting:{order:[],done:[],current:null,status:'pending'}};
}
function voting(now=Date.now()){
 return{...midPk(now),phase:'voting',matches:matchesAt(now,{a2Done:true}),tables:{upper:['RYAN','Chanee🌸','G'],lower:['LILY 🍉','D','E','F'],cut:['E','F'],lowerBy:'seed'},
  voting:{order:['RYAN','Chanee🌸','G','LILY 🍉','D'],done:['RYAN','Chanee🌸'],current:'G',status:'running'}};
}
function chasing(now=Date.now()){const v=voting(now);return{...v,phase:'chasing',voting:{...v.voting,done:[...v.voting.order],current:null,status:'done'}}}
// The lower table decided by score after a chasing: written in seed order, the site orders it by score.
function done(now=Date.now()){const c=chasing(now);return{...c,phase:'done',tables:{...c.tables,lower:['D','E','LILY 🍉','F'],cut:['E','F'],lowerBy:'score'}}}
module.exports={SEED,midPk,voting,chasing,done};
