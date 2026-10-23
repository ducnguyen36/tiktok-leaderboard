'use strict';
// Open issues confirmed during the October 2026 audit. A daily report marks a
// matching difference as "explained" (with this reason) instead of unexplained,
// so known problems are not re-reported as new every day. Remove an entry once
// the sheet or data is fixed. group = sheet group name (groupSheets.js);
// talent = profile talent name, or null for the group row and every talent.
module.exports = Object.freeze([
  { id: 'VELIX-2026-10-18-missing-live', group: 'VELIX', date: '2026-10-18', talent: null, reason: 'HeliosControl không có phiên VELIX tối 18/10; sheet ghi 65.870 (cần nhập bù theo Backstage).' },
  { id: 'VELIX-2026-10-09-hani-sheet', group: 'VELIX', date: '2026-10-09', talent: 'Hani🦄🪽', reason: 'Sheet ghi Hani 11.108, database khoảng 1.000; Backstage cũng thấp hơn sheet khoảng 10K.' },
  { id: 'NEXAR-2026-10-08-missing-live', group: 'NEXAR', date: '2026-10-08', talent: null, reason: 'HeliosControl không có phiên NEXAR đêm 08/10; sheet ghi 35.597.' },
  { id: 'NEXAR-2026-10-19-shifted', group: 'NEXAR', date: '2026-10-19', talent: null, reason: 'Dòng 19/10 trên sheet là ca 20/10, số gõ "12.101" bị hiểu là thập phân; đêm 20/10 không live.' },
  { id: 'NEXAR-2026-10-20-shifted', group: 'NEXAR', date: '2026-10-20', talent: null, reason: 'Dòng 20/10 trên sheet là ca 21/10 và sai định dạng số (dấu chấm thành thập phân).' },
  { id: 'DPM-2026-10-13-shifted', group: 'DPM', date: '2026-10-13', talent: null, reason: 'Dòng 13/10 trên sheet là ca ngày công 14/10 (bắt đầu 01:28 ngày 15/10); dòng 14/10 để trống.' },
  { id: 'DPM-2026-10-14-shifted', group: 'DPM', date: '2026-10-14', talent: null, reason: 'Ca ngày công 14/10 nằm ở dòng 13/10 trên sheet.' },
  { id: 'DPM-2026-10-03-chung', group: 'DPM', date: '2026-10-03', talent: null, reason: 'Sheet có KC chung 1.222, database chỉ có 1 điểm quà tặng cả nhóm; cần xác nhận nguồn 1.222.' },
  { id: 'VENYXIS-2026-10-07-chung', group: 'VENYXIS', date: '2026-10-07', talent: null, reason: 'Sheet có Chung 2.297 (ngày KAI OFF bán thay ca), database chỉ có 81 điểm quà tặng cả nhóm.' },
  { id: 'VVG-2026-10-04-penalty', group: 'VELVET GRACE', date: '2026-10-04', talent: null, reason: 'Sheet trừ phạt gậy 25.497 chia đều; database không có khoản trừ này.' },
  { id: 'VVG-2026-10-20-yuni', group: 'VELVET GRACE', date: '2026-10-20', talent: 'Yunii🦄', reason: 'Ngày debut, Yuni có hai tên; sheet chỉ ghi 6.306.' },
  { id: 'ICONZ-2026-10-15-group-gift', group: 'ICONZ', date: '2026-10-15', talent: null, reason: 'Quà tặng cả nhóm 4.793 được bảng chia cho 6 bạn (≈798), sheet không chia khoản này.' },
]);
