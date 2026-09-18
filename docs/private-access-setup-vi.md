# Kích hoạt đăng nhập Google và duyệt TV

## Trạng thái

Release này tạm tắt khóa truy cập theo yêu cầu để TV tiếp tục hoạt động: `LEADERBOARD_ACCESS_CONTROL` chưa đặt hoặc khác `true` thì bảng vẫn truy cập công khai. Chỉ bật `LEADERBOARD_ACCESS_CONTROL=true` sau khi cấu hình và kiểm thử Google trên staging. Khi đã bật, thiếu cấu hình Google sẽ khóa dữ liệu và hiện trang thiết lập.

Ba tài khoản quản trị mặc định:

- ducnguyen36@gmail.com
- heliostalentofficial@gmail.com
- kimlinh727@gmail.com

Tài khoản khác không được quyền quản trị. Đăng nhập Google trên điện thoại/máy tính của quản trị; không cần đăng nhập Google trên TV.

## 1. Chuẩn bị Google OAuth

Trong Google Cloud Console, chọn dự án phù hợp → Google Auth Platform → cấu hình Branding/Audience → tạo Client loại **Web application**. Nếu ứng dụng còn ở chế độ Testing, thêm cả ba email trên vào danh sách test users.

Chọn tên miền HTTPS cố định cho bản sẽ chạy. Nếu dùng tên miền đang ghi trong cấu hình NAS của dự án, callback là:

```text
https://ranking.heliostalent.online/auth/google/callback
```

Google phải được đăng ký đúng callback, kể cả giao thức và đường dẫn. Với staging dùng tên miền khác, đăng ký callback tương ứng cho staging. Không dùng URL tunnel thay đổi liên tục.

Lưu các biến sau trong môi trường riêng của server:

```dotenv
PUBLIC_ORIGIN=https://ranking.heliostalent.online
LEADERBOARD_ACCESS_CONTROL=true
GOOGLE_CLIENT_ID=<Client ID của Web application>
GOOGLE_CLIENT_SECRET=<Client Secret của Web application>
ADMIN_EMAILS=ducnguyen36@gmail.com,heliostalentofficial@gmail.com,kimlinh727@gmail.com
```

Không gửi Client Secret, mật khẩu Google hoặc mã xác thực vào chat; không đưa chúng vào Git. `PUBLIC_ORIGIN` không có dấu `/` ở cuối. Nếu đổi domain, cập nhật cả biến môi trường và callback trong Google.

Tham khảo chính thức: [Google OpenID Connect — thiết lập và server flow](https://developers.google.com/identity/openid-connect/openid-connect).

## 2. Kiểm thử trước khi chuyển bản đang dùng

Chạy staging riêng, không thay thế TV đang dùng ngay. Xác nhận:

- Cả ba tài khoản đăng nhập được; tài khoản ngoài danh sách bị từ chối.
- Trình duyệt ẩn danh không xem được điểm, avatar, lịch sử hoặc overlay qua link trực tiếp.
- TV tạo mã → quản trị duyệt đúng mã → TV tự mở bảng.
- Thu hồi TV đang mở bảng → bảng bị xóa khỏi màn hình và không lấy thêm được dữ liệu.
- Khởi động lại staging vẫn giữ các thiết bị đã duyệt; mất kết nối database thì khóa dữ liệu, không tự mở công khai.

Sau khi kiểm thử, thêm các biến trên vào `.env` cạnh `docker-compose.nas.yml` trên NAS. Chạy `docker compose -f docker-compose.nas.yml up -d --force-recreate leaderboard` để container nhận cấu hình mới (restart đơn thuần không cập nhật biến môi trường). Sau đó duyệt từng TV qua `/auth`. Kiểm tra quy tắc cache/CDN và xóa các phản hồi công khai đã được cache trước đó. Nếu cần hoãn kích hoạt, đặt `LEADERBOARD_ACCESS_CONTROL=false` rồi tạo lại container; lúc đó bảng lại công khai.

## 3. Dùng hằng ngày

Trên TV mở bảng và bấm **Tạo mã ghép nối**. Giữ trang đó mở. Quản trị mở `/auth` trên điện thoại, đăng nhập Google, nhập mã đang hiển thị trên đúng TV và đặt tên dễ nhận biết, ví dụ `TV HCM — tầng 1`.

Mã có hiệu lực tối đa 10 phút; tạo mã mới nếu mã đã hết hạn. Sau khi duyệt, TV tự mở bảng. Quyền của trình duyệt kéo dài 180 ngày nếu chưa bị thu hồi. Phiên quản trị kéo dài 12 giờ; hết phiên thì đăng nhập lại.

Tại `/auth`, quản trị xem danh sách trình duyệt và bấm **Thu hồi quyền** cho thiết bị cần khóa. Sau khi mất quyền, các dữ liệu xếp hạng và cài đặt đã lưu có chứa tên talent trên trình duyệt đó sẽ bị xóa; khi duyệt lại có thể cần thiết lập lại bộ lọc.

## Giới hạn cần biết

Quyền gắn với **trình duyệt/profile**, không khóa cứng vào phần cứng TV. Xóa cookie hoặc dùng trình duyệt khác sẽ cần xin cấp quyền lại. Không dùng chung trình duyệt đã được duyệt với người không có quyền.

Cơ chế này chặn người chưa được duyệt lấy dữ liệu từ hệ thống; không ngăn hoàn toàn việc chụp ảnh/quay màn hình hoặc thu hồi bản sao đã được lưu trước đó. Chi tiết vận hành và khôi phục có trong [tài liệu kỹ thuật](private-access.md).
