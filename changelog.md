# 📦 ClassCheck-GPS — Release Notes & Changelog (EN / VI)

## 🇬🇧 ENGLISH VERSION

### 🔧 Version `v3.3.1` — *Universal Content-Aware Drive Roster Sync & Zero-Lag Mid-Semester Student Import*
* **Universal Content-Aware File & Tab Resolution (`Class_ID` + `MSSV` / `Full_Name`)**: Upgraded `resolveClassTargetFile_` and `findBestMatchingSheet_` to universally disambiguate multiple files sharing the same `Class_ID` (such as a Class Diary / Course Syllabus sheet vs. an Attendance Roster workbook) by verifying the presence of valid `MSSV` (`Student_ID`) and `Full_Name` student rows rather than relying on personal filename suffixes. Added native resolution for Google Drive Shortcuts (`application/vnd.google-apps.shortcut`).
* **Zero-Lag Modified-Time Delta Detection (`ROSTER_SYNC_META_PROP_KEY`)**: Tracks each class's Drive file `lastUpdated` timestamp and synced student count so unchanged `.XLSX` files are skipped in `0ms`, while any `.XLSX` / Sheet file edited mid-semester to add new students is automatically re-scanned, badged (`🔄 +N new`), and pre-selected in the Sync dialog. Removed the legacy restriction that ignored ticked synced classes when the secondary re-scan toggle was unchecked.
* **1-Click Web App & Student Lookup Rescue Sync**: Connected the Lecturer Web App's `"Đồng bộ vào Google Sheet"` button (`TEACHER_REBUILD_REPORT`) and Student ID onboarding (`STUDENT_LOOKUP_RESCUE`) to `syncSingleClassRosterFromDrive_` (`onlyIfModified: true`), automatically importing newly added students from modified Drive `.XLSX` files and clearing roster caches immediately.
* **Batch Attendance Export Optimization**: Replaced per-row `setValue` / `setBackground` loops in `updateTargetAttendanceFile_` with single-range batch array writes (`setValues` / `setBackgrounds`), accelerating attendance sync to Google Sheets and `.XLSX` files by 5x–8x.

### ✨ Version `v3.3.0` — *Modular Architecture, Utilitarian UI & Smart Schedule Engine*
* **Modular Frontend Architecture**: Refactored the single-file frontend into a clean, maintainable 5-module structure (`index.html`, `css/styles.css`, `js/schedule-config.js`, `js/student.js`, `js/teacher.js`) while preserving 100% of existing student and lecturer `localStorage` data (`cc_student_profiles`, `cc_active_inst`, `cc_device_cred`).
* **`taste` Utilitarian Academic UI & Technical Monoline SVGs**: Rebuilt the visual system with high-contrast Slate & Academic Navy tokens, tabular monospace telemetry readouts, and an embedded 12-icon technical monoline SVG sprite (`stroke-width="1.75"`, zero emoji clutter).
* **Pre-Check & Activate GPS Panel (`#gps-panel`)**: Added a dedicated pre-session GPS verification bar (`#gps-dot`, `#gps-readout`, `#btn-check-gps`) allowing students to test location permissions and accuracy before class. Enforces `window.cachedGPS = null` so `executeStudentCheckIn` always acquires a fresh live GPS reading (`maximumAge: 0`) at check-in time, paired with an immediate `isSubmitting` anti-spam lock (`"Đang gửi dữ liệu..."`).
* **Real-Time Schedule Auto-Selection (Google Calendar + Multi-Day Period Slots)**: Added multi-tier class auto-selection across Student and Lecturer modes using live Google Calendar events, automatic multi-day & period schedule extraction from `Class_Name` / attendance sheets (e.g., `(10-12 T2&6)`, `(13-15 T2&T6)`, `(10-12 T3&T5)`), and university period slots (`123`: 06:30–09:00, `456`: 09:00–11:30, `789`: 12:30–15:00, `10-12`: 15:00–17:30, `13-15`: 17:30–20:00). Features smart transition-boundary priority (`17:15–17:30`) when classes run back-to-back on the same day (keeping the ongoing `10-12` class active until `17:20` before switching to `13-15` at `17:21`), a 15-minute early buffer, and safe off-hours fallback (`"Chưa chọn lớp - Ngoài khung giờ"`). Removed obsolete sample class `ENG101_G1`.
* **Default Master Sheet Endpoint & Auto-Migration (`INST_KfweyxZcv4`)**: Updated the default Master Sheet API endpoint (`INST_KfweyxZcv4`) and added automatic silent `localStorage` migration from legacy/tester Web App URLs so existing student and lecturer devices seamlessly connect to the production deployment.
* **Isolated Session Control & 2-Step Inline Confirmation**: Isolated lecturer session controls inside `#teacher-session-control-box` and replaced 1-tap session start with a 2-step inline confirmation bar (`#tea-open-confirm-bar`) featuring separate `"Hủy"` and `"Xác nhận mở lớp [Mã Lớp]"` buttons, alongside live roster filter tabs (`Tất cả / Có mặt / Vắng / Nghi vấn`) and Projector ID Privacy masking.

### 🚀 Version `v3.2.0` — *High-Concurrency Engine & Anti-Cheat Hardening*
* **High-Concurrency RAM Caching (`CacheService`)**: Added row-aware in-memory caching for class configurations, rosters, and active sessions, cutting `LockService` hold time by ~90% to support 60+ simultaneous check-ins and multiple concurrent classes without bottlenecks.
* **Pre-Lock Rate Limiting & Idempotency**: Filtered duplicate taps and blocked automated API spam loops (`F12` / script flooding) in RAM prior to spreadsheet lock acquisition.
* **Multi-Browser & DevTools Spoofing Detection**:
  * Server-side correlation of hardware fingerprints (`deviceFp`), exact GPS coordinates, and check-in timestamps to automatically flag dual-browser proxy attempts (`Safari + Chrome` on a single device) on the Lecturer dashboard.
  * Client-side detection of `navigator.geolocation` console overrides (`F12_GEO_OVERRIDE`).
* **Spot-Check Revocation Lock**: Prevented students whose attendance was manually revoked (`-`) during a live random spot-check from re-submitting attendance in the same session.
* **Multi-Lecturer & Modular Sync Compatibility**: Auto-revealed lecturer selection when a student links courses across multiple lecturers, and ensured zero-delay compatibility with external `.XLSX` Sync modules.

### 🔧 Version `v3.1.1` — *Roster Full-Name Parsing & Sync Refinement*
* **Split-Column Full Name Merging**: Automatically detected and merged separate Last/Middle Name and First Name columns when importing `.XLSX` attendance workbooks.
* **Attendance Grid Mapping & Audit Logging**: Refined session-column mapping for two-way Drive synchronization and expanded `Audit_Log` traceability.

### ✨ Version `v3.1.0` — *Two-Way Google Drive `.XLSX` / Sheet Sync & Undo Backup*
* **Automated Two-Way Drive Sync & Backup**: Added one-click roster import from `.XLSX` / Google Sheets on Drive and automated attendance export/backup back to official attendance books.
* **Safe Class Deletion with Undo Cache (`_Undo_Backup_Cache`)**: Preserved full JSON snapshots of class configs, rosters, sessions, and logs prior to deletion for instant 1-click restoration.

### 🎯 Version `v3.0.0` — *1-Tap GPS Attendance Architecture*
* **1-Tap GPS Check-In**: Transitioned daily student check-in from mandatory camera QR scanning to a single-tap GPS verification flow, keeping QR scanning as an optional fallback.
* **Dynamic Sheet Session Auth**: Enabled lecturer sign-in via rotating 6-digit session codes from Google Sheets (with 5-attempt brute-force lockout) alongside Master Key pairing.
* **Zero-Cache Web App**: Removed Service Worker (`sw.js`) caching to ensure mobile browsers (especially iOS Safari) always load the latest release immediately.

### 🌱 Version `v2.1.0` — *Original Baseline (`ClassCheck QR`)*
* **Core QR & Device-Lock Foundation**: Static/Rotating (15s) QR attendance, accuracy-aware Haversine GPS radius check, `1 Phone = 1 Student ID` SHA-256 browser binding (`Device_Registry`), and automated `Setup_&_Dashboard` initialization.

## 🇻🇳 PHIÊN BẢN TIẾNG VIỆT

### 🔧 Version `v3.3.1` — *Đồng Bộ Danh Sách Thông Minh Theo Cấu Trúc (`Mã Lớp` + `MSSV` / `Họ Tên`) & Bổ Sung Sinh Viên Giữa Kỳ Không Độ Trễ*
* **Nhận diện File & Tab Điểm danh theo Cấu trúc Chung (`Class_ID` + `MSSV` / `Họ tên`)**: Nâng cấp `resolveClassTargetFile_` và `findBestMatchingSheet_` để phân biệt chính xác file Bảng điểm danh (`.XLSX` / Google Sheet) với file Nhật ký giảng dạy / Đề cương (`CLASS FOLDER`) có cùng Mã lớp dựa trên cấu trúc dữ liệu sinh viên thực tế (`MSSV` + `Họ và tên`), hoàn toàn không phụ thuộc vào hậu tố tên riêng của từng giảng viên. Hỗ trợ giải mã trực tiếp cả lối tắt Google Drive (`Shortcut`).
* **Phát hiện Sinh viên mới Bổ sung Giữa kỳ Không gây Lag (`ROSTER_SYNC_META_PROP_KEY`)**: Đối chiếu thời gian chỉnh sửa `lastUpdated` của file trên Drive và sĩ số đã đồng bộ; tự động bỏ qua trong `0ms` nếu file `.XLSX` không đổi, và tự động quét lại kèm nhãn **`🔄 +N new`** (tích chọn sẵn) ngay khi giảng viên vừa thêm sinh viên mới vào file `.XLSX` trên Drive. Loại bỏ hoàn toàn lỗi khóa hộp kiểm của các lớp đã đồng bộ trước đó.
* **Đồng bộ Sinh viên mới Ngay trên Web Giảng viên & Tự động Cứu hộ Tra cứu MSSV**: Kết nối nút `"Đồng bộ vào Google Sheet"` trên Web Giảng viên (`TEACHER_REBUILD_REPORT`) và luồng tra cứu MSSV (`STUDENT_LOOKUP_RESCUE`) với `syncSingleClassRosterFromDrive_` (`onlyIfModified: true`), giúp tự động nạp sinh viên mới từ file `.XLSX` vừa sửa trên Drive vào Master Sheet mà không cần mở máy tính.
* **Tối ưu Tốc độ Ghi Điểm danh Hàng loạt (`Batch Write`)**: Gom toàn bộ thao tác ghi điểm danh và tô màu nền trong `updateTargetAttendanceFile_` thành 1 lệnh mảng (`setValues` / `setBackgrounds`), tăng tốc độ đồng bộ điểm danh sang file `.XLSX` / Sheet gấp 5–8 lần.

### ✨ Version `v3.3.0` — *Kiến Trúc Đa Module, Giao Diện Học Thuật Tinh Gọn & Nhận Diện Lịch Tự Động*
* **Kiến trúc Frontend Đa Module (`Modular Architecture`)**: Tách biệt mã nguồn thành 5 module chuẩn hóa (`index.html`, `css/styles.css`, `js/schedule-config.js`, `js/student.js`, `js/teacher.js`) giúp dễ bảo trì, đồng thời bảo toàn 100% dữ liệu `localStorage` hiện có của sinh viên và giảng viên (`cc_student_profiles`, `cc_active_inst`, `cc_device_cred`).
* **Giao diện Học thuật Tinh gọn (`taste` Utilitarian UI) & Icon Kỹ thuật Monoline SVG**: Chuẩn hóa bảng màu Slate & Academic Navy độ tương phản cao, hiển thị số liệu tọa độ/bộ đếm bằng font `tabular-nums`, thay thế toàn bộ emoji trang trí bằng bộ 12 icon vector nét đơn (`stroke-width="1.75"`).
* **Khung Kiểm tra & Kích hoạt GPS trước giờ học (`#gps-panel`)**: Bổ sung thanh kiểm tra phần cứng định vị (`#gps-dot`, `#gps-readout`, `#btn-check-gps`) giúp sinh viên thử quyền truy cập GPS bất cứ lúc nào. Luôn đặt `window.cachedGPS = null` để hàm `executeStudentCheckIn` bắt buộc lấy lại tọa độ GPS thực tế mới nhất (`maximumAge: 0`) ngay tại thời điểm bấm điểm danh, kết hợp khóa chống bấm lặp tức thì `isSubmitting` (`"Đang gửi dữ liệu..."`).
* **Tự động nhận diện Lớp học theo Thời gian thực (Google Calendar + Đa thứ/tiết học)**: Tự động chọn đúng lớp học phần cho cả Sinh viên và Giảng viên dựa trên sự kiện Google Calendar, tự động bóc tách lịch học đa ngày và khung tiết từ `Class_Name` / bảng điểm danh Sheet (ví dụ: `(10-12 T2&6)`, `(13-15 T2&T6)`, `(10-12 T3&T5)`) cùng các khung tiết tiêu chuẩn (`123`: 06:30–09:00, `456`: 09:00–11:30, `789`: 12:30–15:00, `10-12`: 15:00–17:30, `13-15`: 17:30–20:00). Tích hợp thuật toán ưu tiên vùng giao thoa (`17:15–17:30`) khi có 2 ca học liên tiếp trong cùng ngày (giữ nguyên ca `10-12` đến hết `17:20` trước khi chuyển sang ca `13-15` từ `17:21`), đệm nhận diện sớm 15 phút và trạng thái an toàn ngoài khung giờ (`"Chưa chọn lớp - Ngoài khung giờ"`). Loại bỏ hoàn toàn lớp mẫu thử nghiệm `ENG101_G1`.
* **Cập nhật Endpoint Master Sheet Mặc định & Tự động Di trú (`INST_KfweyxZcv4`)**: Cập nhật đường dẫn API Master Sheet chính thức (`INST_KfweyxZcv4`) và tự động chuyển đổi ngầm (`auto-migration`) từ các URL thử nghiệm cũ trên `localStorage`, giúp thiết bị của sinh viên và giảng viên kết nối thẳng vào hệ thống mới mà không cần cấu hình lại.
* **Cụm Điều khiển Phiên biệt lập & Xác nhận Mở lớp 2 bước**: Tách riêng khung điều khiển phiên (`#teacher-session-control-box`) và thay thế nút mở phiên 1 chạm bằng thanh xác nhận nội tuyến 2 bước (`#tea-open-confirm-bar`) gồm 2 nút độc lập `"Hủy"` và `"Xác nhận mở lớp [Mã Lớp]"`, bổ sung bộ lọc sĩ số nhanh (`Tất cả / Có mặt / Vắng / Nghi vấn`) và chế độ Che MSSV trên máy chiếu.

### 🚀 Version `v3.2.0` — *Tối Ưu Chịu Tải Cao & Siết Chặt Chống Gian Lận*
* **Bộ nhớ đệm chịu tải cao (`CacheService` RAM Layer)**: Lưu đệm thông minh cấu hình lớp, danh sách sinh viên và phiên điểm danh theo số dòng thực tế, giảm ~90% thời gian giữ khóa `LockService`, giúp hơn 60 sinh viên bấm điểm danh cùng lúc hoặc nhiều lớp chạy song song không bị nghẽn mạng.
* **Chống Spam API & Chống bấm đúp trước khóa**: Chặn các vòng lặp spam request tự động và trả kết quả tức thì cho thao tác bấm đúp ngay trên RAM trước khi chạm tới Google Sheet.
* **Phát hiện mở nhiều trình duyệt (`Safari + Chrome`) & Can thiệp F12**:
  * Đối chiếu dấu vân tay phần cứng (`deviceFp`), tọa độ GPS và khoảng cách thời gian ở phía Server để tự động tô vàng cảnh báo (`⚠️ Trùng máy/giờ`) khi 1 điện thoại mở 2 trình duyệt điểm danh hộ.
  * Phát hiện hành vi ghi đè hàm định vị `navigator.geolocation` trong F12 Console (`F12_GEO_OVERRIDE`).
* **Khóa điểm danh lại sau khi bị hủy kiểm tra ngẫu nhiên (`Spot-Check Lock`)**: Ngăn sinh viên tự bấm điểm danh lại trong cùng buổi học sau khi đã bị giảng viên gọi kiểm tra ngẫu nhiên và đánh dấu vắng (`-`).
* **Tương thích Đa Giảng viên & Module Đồng bộ độc lập**: Tự động hiển thị ô chọn Giảng viên khi sinh viên học nhiều thầy cô cùng dùng hệ thống; đồng bộ tức thì với module quản lý sổ sách `.XLSX` riêng biệt.

### 🔧 Version `v3.1.1` — *Chuẩn Hóa Họ Tên & Tinh Chỉnh Đồng Bộ*
* **Tự động ghép đầy đủ Họ đệm + Tên từ file `.XLSX`**: Xử lý triệt để lỗi mất tên chính khi nhập danh sách từ các bảng điểm danh Excel tách riêng cột Họ đệm và cột Tên.
* **Chuẩn hóa ánh xạ cột & Nhật ký (`Audit_Log`)**: Tinh chỉnh quy tắc ghi nhận buổi học khi đồng bộ ngược sang sổ gốc và ghi vết chi tiết vào `Audit_Log`.

### ✨ Version `v3.1.0` — *Đồng Bộ Hai Chiều Google Drive `.XLSX` / Sheet & Sao Lưu Hoàn Tác*
* **Cập nhật & Tự động sao lưu hai chiều lên Google Drive**: Hỗ trợ nhập danh sách lớp trực tiếp từ file `.XLSX` / Sheet trên Drive và tự động đẩy kết quả điểm danh sang file sổ điểm danh gốc.
* **Xóa lớp an toàn kèm bộ nhớ đệm Hoàn tác (`_Undo_Backup_Cache`)**: Tự động đóng gói toàn bộ dữ liệu lớp học vào sheet ẩn trước khi xóa, cho phép khôi phục nguyên trạng chỉ với 1 thao tác.

### 🎯 Version `v3.0.0` — *Kiến Trúc Điểm Danh 1 Chạm (1-Tap GPS)*
* **Điểm danh 1 chạm bằng GPS**: Chuyển từ thao tác mở camera quét QR bắt buộc hàng ngày sang nút bấm 1 chạm bằng tọa độ GPS phòng học (giữ quét QR làm phương án dự phòng).
* **Mật khẩu phiên 6 số tự động xoay vòng trên Sheet**: Hỗ trợ giảng viên đăng nhập bằng mã 6 số hiển thị trên Sheet (kèm khóa 10 phút nếu nhập sai 5 lần) hoặc Master Key.
* **Loại bỏ lỗi kẹt bộ nhớ đệm (`No-Cache Web App`)**: Gỡ bỏ `sw.js` giúp trình duyệt di động (đặc biệt trên iOS Safari) luôn nhận bản cập nhật mới nhất ngay lập tức.

### 🌱 Version `v2.1.0` — *Phiên Bản Nền Tảng Gốc (`ClassCheck QR`)*
* **Nền tảng Điểm danh QR & Khóa thiết bị**: Điểm danh bằng QR tĩnh/xoay vòng 15 giây kết hợp kiểm tra bán kính GPS, khóa cứng `1 Trình duyệt = 1 MSSV` bằng mã băm SHA-256 (`Device_Registry`) và bảng điều khiển tự động `Setup_&_Dashboard`.

## 📊 Quick Comparison / Bảng Đối Chiếu Nhanh (`v2.1.0` vs. `v3.3.1`)

| Feature / Tính năng | Baseline `v2.1.0` | Release `v3.3.1` |
| :--- | :--- | :--- |
| **Frontend Architecture / Kiến trúc** | Monolithic `index.html` / Gộp chung 1 file | **Modular 5-File (`index.html`, `css/styles.css`, `js/schedule-config.js`, `js/student.js`, `js/teacher.js`)** |
| **UI & Iconography / Giao diện** | Decorative emojis / Giao diện dùng emoji | **`taste` Utilitarian Academic UI & Technical Monoline SVGs (`tabular-nums`)** |
| **Daily Check-In / Điểm danh** | Camera QR Scan / Quét QR bắt buộc | **Pre-Check `#gps-panel` + 1-Tap Live GPS (`cachedGPS = null`) + `isSubmitting` Lock** |
| **Class Selection / Chọn lớp học** | Manual selection / Chọn lớp thủ công | **Real-Time Auto-Select (`Class_Name` Multi-Day `(10-12 T2&6)` + Smart `17:15–17:30` Priority)** |
| **API Endpoint / Kết nối Máy chủ** | Manual URL setup / Dán link thủ công | **Default `INST_KfweyxZcv4` Endpoint + Legacy URL Auto-Migration** |
| **Lecturer Control / Mở phiên GV** | Direct 1-tap open / Mở phiên 1 chạm | **Isolated `#teacher-session-control-box` + 2-Step Inline Confirm (`Hủy` / `Xác nhận mở lớp [Mã Lớp]`)** |
| **Concurrency / Chịu tải** | Direct Sheet reads / Đọc trực tiếp từng tab | **RAM `CacheService` (~10x faster / Nhanh gấp 10 lần)** |
| **Anti-Cheat / Chống gian lận** | Basic radius check / Kiểm tra bán kính cơ bản | **Multi-Browser (`Safari+Chrome`), F12, Fresh GPS Timestamp & Spot-Check Lock** |
| **Roster & Backup / Sổ sách** | Manual copy-paste / Nhập xuất thủ công | **Universal Content-Aware (`Class_ID` + `MSSV`/Name) 2-Way `.XLSX` Sync + Zero-Lag Delta Import** |
| **Client Cache / Bộ nhớ đệm Web** | PWA Service Worker (`sw.js`) | **Instant live reload / Luôn tải bản mới tức thì** |
