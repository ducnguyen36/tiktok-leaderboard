# Một người một dòng trên BXH idol (`RANKING_IDENTITY`)

Công tắc: biến môi trường `RANKING_IDENTITY` của container Ranking.

| Giá trị | Bảng idol (ngày, hôm qua, tháng, lịch sử tháng, bảng mới) |
|---|---|
| `old` | Như cũ: mỗi tên trong mỗi profile là một dòng, nhãn nhóm theo profile đọc sau cùng. |
| bỏ trống / `new` (mặc định từ 28/11) | Một người một dòng (xem dưới). |

Tổng nhóm vẫn tính bằng đường cũ; ở `new` chỉ khác một chỗ: biệt danh trong hồ sơ sự kiện
(vd `Henry` trong CROWN WAR II) tính cho nhóm thật của người đó, trừ quà trong live riêng của sự kiện.
Đối chiếu Google Sheet và báo cáo hằng ngày luôn chạy đường cũ.

## Ở `new`

- **Cùng người**: talent trùng uid TikTok (hoặc trùng @uniqueId khi thiếu uid) ở nhiều profile là một người,
  hiện dưới tên ở nhóm thật: không phải hồ sơ sự kiện, không phải nhóm đã giải tán, rồi nhóm cập nhật gần nhất.
  Tên khác, uid khác, @uniqueId khác của người đó đều dẫn về dòng này.
- **Tài khoản khác đã xác nhận** (`CONFIRMED_SAME_PERSON` trong `talentIdentity.js`): `Andee-J ☘️` / @andeej.htnexar → `Andee-J`;
  `mimiibakhitrentunghatbi` → `mimi🐿️`; `TTS-Anthonyyyy 🦋`, `🐦‍🔥🐺Z A NH` → `Anthonyyyy 🦋`.
- **Thành viên Backstage có mà profile HC thiếu** (`CONFIRMED_GROUP_MEMBERS`, 28/11): NEXAR thêm `Anthonyyyy 🦋` (Antony, @ch.danh50),
  `Note`, `TTS-HT Cryo` — chỉ cho BXH idol; quà của họ trong live NEXAR và các sự kiện tính cho họ dưới NEXAR.
- **Hồ sơ sự kiện** không tạo người, không đổi nhãn nhóm. Nhận ra bằng: profile mà một cuộc thi được tạo từ đó
  (`competitions.convertedFrom.profileId`), hoặc profile không có uid host mà mọi thành viên đều là bản sao
  thành viên nhóm khác, hoặc danh sách `EVENT_PROFILE_IDS` (CROWN WAR II).
- **Tài khoản nhóm** (`TEAM A`, `TEAM B`, `nexar`, `velix`, talent có uid trùng uid host của chính nhóm) không lên BXH idol;
  kim cương vẫn tính cho nhóm như cũ.
- **Nhóm giải tán** (`DISBANDED_PROFILE_IDS`: KAYZEN, VELORA, hoặc `status` = disbanded/inactive/…) và `inactiveTalents`:
  ẩn dòng khi 0 KC trong kỳ, có KC thì vẫn hiện.

## Thử và quay về

- Thử trên máy: `RANKING_IDENTITY=new npm start`, hoặc chạy test `node --test test/talentIdentity.test.js`.
- Từ 28/11 `new` là mặc định (không cần biến môi trường).
- Quay về CŨ: thêm `RANKING_IDENTITY=old` vào `.env` cạnh `docker-compose.nas.yml`, khởi động lại container. Không có dữ liệu nào bị ghi khác đi.
- Lưu ý: lịch sử tháng (`leaderboard_monthly_snapshots`) chỉ ghi một lần khi tháng đóng (sáng 1/12),
  theo chế độ đang bật lúc đó.
