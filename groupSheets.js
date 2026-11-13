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
// Bản sao THỬ (Drive "Backstage – Sheet THỬ"): Backstage ghi số cuối ca do Helios Control báo cáo thẳng vào đây
// để so với sheet điền tay trước khi ghi bản thật. Chỉ dùng cho /api/backstage/sheets (đọc/ghi), không đối soát.
const TEST_SHEETS = Object.freeze([
  { group: 'LEVEL X', spreadsheetId: '1eoyLUQdb1q04jPdKj0L8A2yRBzWn_Z7ThMKL8IB_IR4' },
  { group: 'AURA', spreadsheetId: '1sYBXHvpBVfg2pY5IyuLGti4qI445PAWeVEPBd9316_Q' },
  { group: 'VENYXIS', spreadsheetId: '1pwoGACx8Z_bwwletU8biXarJ1bCaXUdIeUTGuITIAi4' },
  { group: 'VELIX', spreadsheetId: '14SZL8TaTbywQDC-ZSh6xxxdCHGxXXfSm-XTE6_gesYU' },
  { group: 'NEXAR', spreadsheetId: '17QsdZHrugLXnyEBrzb70Q-H9nuL0xhq0Iz78Zev0tBE' },
  { group: 'VELVET GRACE', spreadsheetId: '120Ba8kc9T22iR3wKJY6Cion4W0PYeTEuC_SmeKk7WDc' },
  { group: 'ICONZ', spreadsheetId: '1fa9_154Mv0MQ-wJ4T7k4pXjLIilKrE2kQtyPhNo9odg' },
  { group: 'DPM', spreadsheetId: '16Ll-894wNVwVyODYJxRZ51qSb2GVLwk4Ku1Nn5N9Itw' }
]);
module.exports = { GROUP_SHEETS, TEST_SHEETS, findMonthTab };
