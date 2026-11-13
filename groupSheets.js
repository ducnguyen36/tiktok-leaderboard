// Verified source workbooks for all eight groups.
const GROUP_SHEETS = Object.freeze([
  { group: 'LEVEL X', spreadsheetId: '15I7AdC6TDOqDIpJkS1e5L_fQwPMmo-w63lSg0jzQYo4' },
  { group: 'AURA', spreadsheetId: '1maf0zCkTV6-8-WPx2MptmO8DS3mbuhHVtkna9Bnq0Lw' },
  { group: 'VENYXIS', spreadsheetId: '15rWsGxCf2PoT2eQdJPrCWXixbzvjq0WIxdCAXDhVXhM' },
  { group: 'VELIX', spreadsheetId: '1O0keXNIhteFQ7wxrOpwk38um4xD0OmBxfOl9RodMzWA' },
  { group: 'NEXAR', spreadsheetId: '1rHeJNQ5fdLDpovxPB12bjT39ROswHjDw3WFiyVneZGk' },
  { group: 'VELVET GRACE', spreadsheetId: '17ksmH7zVysl8mPO2kq5v4vlSt3WklKJpIp5qKZUdWKs' },
  { group: 'ICONZ', spreadsheetId: '1y60Cv80-h7CmOSVrrng1rAi2iKlN5SS6nXKBfdHoBRQ' },
  { group: 'DPM', spreadsheetId: '1X_jRRyeHZp8NXuNhlUlZZpyqBH5o-h7KyOY99ee-fz0' }
]);
function findMonthTab(metadata, date) {
  const local = new Date(+date + 7 * 3600000), month = local.getUTCMonth() + 1, year = local.getUTCFullYear();
  const normalize = title => title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
  return metadata.sheets?.find(item => {
    const match = normalize(item.properties?.title || '').match(/^THANG\s+(\d{1,2})\.(\d{4})$/);
    return match && Number(match[1]) === month && Number(match[2]) === year;
  })?.properties;
}
module.exports = { GROUP_SHEETS, findMonthTab };
