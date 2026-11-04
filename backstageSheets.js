'use strict';
// Đọc Sheet 8 nhóm cho Helios Backstage (cùng cách ranking đọc) — tách khỏi Express để Backstage chép
// nguyên file và tự đọc bằng kết nối Google của nó; ranking trên NAS là đường dự phòng.
const {GROUP_SHEETS,findMonthTab}=require('./groupSheets');
const {parseSheet,matchingProfile}=require('./sheetReconciliation');
const {sheetDays}=require('./backstageCore');

// Số từng ngày của 8 Sheet nhóm, tháng `month` (YYYY-MM). `sheets` = createSheetsConnection(...).
async function sheetsMonth({sheets,profiles,month,now=Date.now()}){
  const state=await sheets.status();
  if(!state.connected)return{status:'ok',connected:false,month,sources:[]};
  const sources=[];
  // Serial reads, as the reconciliation does, to stay inside the Sheets quota.
  for(const source of GROUP_SHEETS){
    const profile=matchingProfile(profiles,source.group),base={group:source.group,groupId:profile?String(profile._id):null};
    try{
      const metadata=await sheets.read({spreadsheetId:source.spreadsheetId,metadata:true});
      const tab=findMonthTab(metadata,new Date(Date.parse(month+'-15T00:00:00Z')));
      if(!tab){sources.push({...base,state:'month_tab_missing'});continue}
      const data=await sheets.read({spreadsheetId:source.spreadsheetId,range:`'${tab.title.replace(/'/g,"''")}'!A1:U${Math.min(100,tab.gridProperties.rowCount)}`});
      let names=Object.keys(profile?.talents||{}),parsed=parseSheet(data.values||[],month,names),groupOnly=false;
      if(parsed.error==='talent_names_unmatched'){names=[];parsed=parseSheet(data.values||[],month,names);groupOnly=true}
      if(parsed.error){sources.push({...base,state:parsed.error});continue}
      sources.push({...base,state:groupOnly?'group_only':'ok',tab:tab.title,sheetUrl:`https://docs.google.com/spreadsheets/d/${source.spreadsheetId}/edit#gid=${tab.sheetId}`,days:sheetDays(parsed,names)});
    }catch{sources.push({...base,state:'read_failed'})}
  }
  return{status:'ok',connected:true,month,asOf:new Date(now).toISOString(),sources};
}
// Đọc vài vùng (đã kiểm tra hợp lệ) — giá trị hiển thị + công thức song song.
async function sheetsReadRanges({sheets,spreadsheetId,ranges}){
  const valueRanges=[],formulas=[];
  for(const range of ranges.map(r=>r.normalize('NFC'))){
    const v=await sheets.read({spreadsheetId,range,render:'FORMATTED_VALUE'}),f=await sheets.read({spreadsheetId,range,render:'FORMULA'});
    valueRanges.push({range:v.range||range,values:v.values||[]});formulas.push({range:f.range||range,values:f.values||[]});
  }
  return{valueRanges,formulas};
}
module.exports={sheetsMonth,sheetsReadRanges};
