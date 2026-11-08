# Thiết Kế Tổng Hợp `v3.7.1`: Dọn Sạch Code Camera QR, Giao Diện Giảng Viên 2 Cột Trên Laptop/PC & Chế Độ Double-Click Floating PIN Spotlight

**Ngày:** 2026-11-08  
**Quy mô:** Thay đổi nhỏ (Small change)

## 1. Mục đích & Lý do (Intent & Why)
1. **Dọn sạch giao diện và mã nguồn trình quét Camera QR không còn dùng:** Hệ thống đã chuyển 100% sang Điểm danh 1-Chạm GPS và Mã PIN 10 giây; việc giữ lại thư viện `html5-qrcode.min.js` (~350KB), hộp camera `#camera-modal-box` và cụm cài đặt URL bên Sinh viên gây nặng trang và dễ làm sinh viên bấm nhầm sửa hỏng link máy chủ.
2. **Nâng cấp UX Giảng viên trên Laptop/PC (`>= 960px`):** Thay thế khung đơn cột `540px` bằng bố cục **2 Cột (Split-View `1140px`)** giúp giảng viên vừa điều khiển phiên/xem đồng hồ ở cột trái, vừa quan sát 15–18 sinh viên cùng lúc ở cột phải mà không cần cuộn trang.
3. **Chế độ Double-Click Floating PIN Spotlight (Phương án A):** Cho phép giảng viên nhấp đúp chuột (`dblclick`) vào khung Mã PIN 10 giây để phóng đại thành màn hình chiếu chuyên dụng trên nền tối bảo mật (che kín danh sách sinh viên phía sau), giúp sinh viên ngồi cuối giảng đường 15m đọc rõ 4 số PIN và theo dõi thời gian / sĩ số trực tiếp.

## 2. Mục tiêu & Phi mục tiêu (Goals, Non-Goals, Anti-Goals)
- **Mục tiêu:**
  - **Xóa sạch Giao diện & Code Camera QR:** Xóa `html5-qrcode.min.js`, `<symbol id="ic-qr">`, `#camera-modal-box`, `#qr-reader`, cụm `#box-advanced-api` bên Sinh viên, nút `Quét mã QR Ghép nối` bên Giảng viên, và các hàm `html5QrScanner`, `activeScanPurpose`, `startCameraScanner()`, `stopCameraScanner()`, `handleScannedQrText()`, `toggleAdvancedApiBox()`.
  - **Giữ lại Cấu hình URL cho Giảng viên & Deep Link ngầm:** Giữ nguyên link `Cấu hình đường dẫn kết nối` (`#box-tea-api-advanced`) bên Giảng viên và hàm `handleUrlDeepLinks()` (`?onboard=` / `?pair=`).
  - **Bố cục 2 cột trên Laptop/PC (`>= 960px`) & Phím `Enter` đăng nhập:** Cột trái `420px` (Panel 1 + Panel 3), cột phải `1fr` (Panel 2 cao `calc(100dvh - 235px)`), nhấn `Enter` tại `#inp-tea-token` để đăng nhập ngay.
  - **Double-Click Floating PIN Spotlight (Phương án A):** Nhấp đúp vào `#tea-p2-pin-projector-box` bật nền tối `rgba(15, 23, 42, 0.96)`, tự bật Fullscreen, hiện thanh `#tea-pin-spotlight-meta` (`⏱ MM:SS • 👥 X / Y Có mặt`), 4 ô số PIN `clamp(3.2rem, 7vw, 5.6rem)`, thoát bằng Double-click, phím `Esc`, hoặc tự thoát khi đóng phiên P2 / chuyển sang 1-Chạm.
- **Phi mục tiêu:** Không thay đổi giao diện trên màn hình điện thoại (`< 960px`).
- **Anti-goals:** Không thêm nút bấm thừa trên thanh công cụ và không để sót bất kỳ lệnh gọi `stopCameraScanner` / `#inp-onboard-api` nào gây lỗi `ReferenceError` / `TypeError`.
