# Thiết Kế Rút Gọn Giao Diện (SV & GV) & Đồng Bộ Nhanh Chống Văng Phiên

**Ngày:** 2026-11-03  
**Quy mô:** Thay đổi nhỏ (Small change)

## 1. Mục đích & Lý do (Intent & Why)
Giúp Giảng viên và Sinh viên thao tác nhanh, dễ nhìn trên điện thoại bằng cách lược bỏ các nút thừa, cắt gọn tối đa các câu mô tả dài dòng, đồng thời tăng tốc độ tự làm mới danh sách điểm danh và khắc phục triệt để lỗi bị văng về màn hình Sinh viên / mất đăng nhập khi bấm F5 hoặc Đóng phiên.

## 2. Mục tiêu & Phi mục tiêu (Goals, Non-Goals, Anti-Goals)
- **Mục tiêu:**
  - Xóa bỏ 2 nút `Toàn màn hình` và `Làm mới` cùng các dòng tiêu đề/mô tả lặp lại trên màn hình Giảng viên.
  - Ẩn hoàn toàn dòng mô tả GPS mặc định; chỉ hiển thị nút nhỏ `GPS nâng cao`, bấm vào mới hiện tùy chọn ngắn gọn `Lấy tâm phòng theo TB 3 SV đầu`.
  - Rút gọn câu chữ mô tả, nhãn nút và thông báo ở cả giao diện Sinh viên (đặc biệt là cụm kiểm tra GPS) và Giảng viên.
  - Giảm chu kỳ tự động làm mới của Giảng viên từ `4.5s` xuống `2.5s` (có khóa chống chồng chéo request và tự làm mới tức thì khi mở lại tab).
  - Giữ nguyên tab `Giảng viên`, lớp đang chọn và trạng thái bảng điều khiển khi F5 / tải lại trang; đồng bộ mã phiên 6 số mới khi đóng phiên để không bị tự đăng xuất.
- **Phi mục tiêu:** Không thay đổi thuật toán tính khoảng cách GPS hay cấu trúc bảng dữ liệu Google Sheet.
- **Anti-goals:** Không làm mất bất kỳ chức năng quản lý lớp, lọc danh sách, điểm danh thủ công hay kiểm tra ngẫu nhiên nào.

## 3. Ràng buộc (Constraints)
- Tương thích 100% với dữ liệu đã lưu trên trình duyệt của Sinh viên và Giảng viên.
- Tuân thủ quy tắc cập nhật `changelog.md` (song ngữ Anh - Việt) và nâng phiên bản hệ thống (`v3.3.8`).

## 4. Các phương án đã cân nhắc (Approaches)
- **Phương án 1 (Đã chọn):** Tối giản tối đa câu chữ & khung thừa + ẩn tùy chọn GPS vào nút `GPS nâng cao` + đồng bộ nhanh 2.5s & lưu trạng thái chống văng khi F5 / đóng phiên.
- **Phương án 2:** Giữ bố cục cũ, chỉ rút ngắn câu chữ và để lại nút Refresh icon. (Bị loại vì vẫn còn nhiều tầng chữ trên màn hình điện thoại).

## 5. Chi tiết triển khai (How It Gets Built)
- **Giao diện (`index.html`, `css/styles.css`):**
  - Bỏ nút `Toàn màn hình`, `Làm mới`, dòng lặp `Lớp đang chọn:`, dòng tiêu đề phụ `Điều khiển Mở / Đóng Phiên Điểm Danh` và dòng mô tả GPS mặc định.
  - Đặt nút nhỏ `GPS nâng cao` cạnh hàng nút điều khiển phiên; khi bấm mới mở hộp tích chọn `Lấy tâm phòng theo TB 3 SV đầu`.
  - Rút gọn khung GPS Sinh viên: trạng thái mặc định chỉ ghi `Chưa kiểm tra GPS`, nút bấm ghi `Kiểm tra GPS`.
- **Logic Đồng bộ & Giữ phiên (`js/schedule-config.js`, `js/student.js`, `js/teacher.js`, `code3.3.0.text`, `sync.txt`):**
  - Lưu `cc_active_mode` (`STUDENT` / `TEACHER`), `cc_teacher_selected_class` và bản đệm `cc_teacher_state_cache` để khi F5 trang web khôi phục ngay màn hình Giảng viên mà không nháy về Sinh viên.
  - Giảm `teacherPollTimer` xuống `2500ms`, thêm cờ `isRefreshingTeacher` tránh nghẽn mạng, và lắng nghe sự kiện `visibilitychange` để cập nhật ngay khi bật màn hình.
  - Khi `CLOSE_NOW` đổi mã 6 số trên Sheet, trả mã mới (`rotatedTempCode`) về cho phiên Giảng viên đang đăng nhập để tự động cập nhật token, không bị văng.
