# 📦 ClassCheck-GPS — Release Notes & Changelog (EN / VI)

## 🇬🇧 ENGLISH VERSION

### ✨ Version `v3.4.2` — *Lecturer UI Decluttering, 1-Tap Device Unlock & Projector Auto-Rehide*
* **Single-Column Lecturer Session Control & Removed Decorative Radar Box**: Removed the secondary `.gps-station-box` column (`.radar-circle` and `#poster-class-title`) from Panel 1 of the Lecturer Dashboard and integrated `#tea-gps-anchor-hint`, `#btn-toggle-adv-gps`, and `#box-adv-gps-mode` directly inside `#teacher-session-control-box` for a cleaner, faster single-column layout.
* **Removed Redundant `"Che MSSV"` Button & Unused QR Generator Library**: Removed `#btn-toggle-privacy` (`Che MSSV`) from the Panel 2 Roster header so only the 2 core actions (`Gọi ngẫu nhiên 1 SV` and `Ẩn/Hiện danh sách`) remain. Removed the unused `qrcode.min.js` library and legacy classroom QR poster nodes while preserving `html5-qrcode.min.js` for scanning Course Onboarding and Lecturer Pairing QR codes from the Google Sheet (`Setup_&_Dashboard`).
* **Projector Auto-Rehide on Search Action & 1-Tap Device Unlock**:
  * When the class roster is hidden on the projector (`showRosterNames === false`) and the Lecturer types into `#inp-roster-search` to find a student, clicking **`P`**, **`L`**, **`E`**, **`-`**, or **`Mở khóa`** now automatically clears `#inp-roster-search` and hides the roster again on the projector immediately.
  * Streamlined `teacherResetStudentDevice(studentId)` (`Mở khóa`) to execute in a single tap without a blocking confirmation modal (displaying feedback in `#tea-session-inline-status`), while keeping `P` and `L` buttons independent so late students (`L`) who cleared browser cache can be unlocked and marked accurately.

### 🔧 Version `v3.4.1` — *Lecturer-Proximity Priority (`TEACHER_GPS`) & Advanced 3-Student Centroid Mode (`STUDENT_AVG_3`)*
* **Default Lecturer-Proximity Evaluation (`TEACHER_GPS`)**: Whenever the Lecturer's device returns valid GPS coordinates (with Advanced Mode off), the session room center is strictly locked to the Lecturer's live position (`TEACHER_GPS`). Every student is evaluated strictly by their distance to the Lecturer (`<= 100m`), immediately rejecting any student sitting in another building (`ERR_LOCATION_OUT_OF_RANGE`).
* **Advanced Mode Toggle & No-GPS Fallback (`STUDENT_AVG_3` — Average of First 3 Students)**:
  * Added a dedicated `"Chế độ GPS nâng cao"` button (`#btn-toggle-adv-gps`) and toggle (`#chk-use-student-avg3`: *"Sử dụng GPS Sinh viên — Lấy trung bình 3 bạn đầu tiên làm tâm phòng"*) on the Lecturer dashboard.
  * **Only** when the Lecturer's device has no GPS at all, **or** when the Lecturer explicitly enables this Advanced Mode toggle, the session activates **`STUDENT_AVG_3`** (`COLLECTING_AVG_3`): it collects the coordinates of the **first 3 verified, non-spoofed students** inside the campus (`<= 850m`) and within `100m` of the running classroom average, locking the final classroom center to their exact centroid $\left(\frac{\text{Lat}_1+\text{Lat}_2+\text{Lat}_3}{3}, \frac{\text{Lng}_1+\text{Lng}_2+\text{Lng}_3}{3}\right)$.

### 🚀 Version `v3.4.0` — *Zero-Scroll Student UI, Contextual Inline Alerts & Dynamic Multi-Room Session Anchor*
* **Zero-Scroll (`100dvh`) Student Viewport & Contextual Inline Alerts**:
  * Locked the mobile Student check-in view (`body.student-locked-scroll`) to a compact, single-screen `100dvh` layout (`overflow: hidden`, `overscroll-behavior: none`), eliminating accidental vertical dragging while tapping check-in controls. Automatically unlocks scroll when opening the camera modal or advanced settings.
  * Replaced the detached bottom status banner with contextual inline notifications (`#gps-inline-status` inside `#gps-panel`, `#checkin-inline-status` directly below `"ĐIỂM DANH NGAY"`, `#onboard-inline-status` inside `#box-add-course`, plus `#tea-login-inline-status`, `#tea-session-inline-status`, and `#tea-admin-inline-status` for Lecturers) so errors and confirmations appear at the exact point of interaction.
* **Dynamic Session Anchor for Multi-Room Schedules (`TEACHER_GPS` vs. `CAMPUS_CLUSTER`)**:
  * Removed both confusing Lecturer GPS controls (`"Đặt vị trí thiết bị này làm Tâm"` button and `"Cập nhật Tâm phòng học theo GPS thiết bị này khi Mở phiên"` checkbox).
  * Automatically probes the Lecturer's device GPS when opening a session (`probeLecturerDeviceGpsFast`): if opened on a mobile phone/tablet with accurate hardware GPS (`accuracy <= 85m`), locks the session center to `TEACHER_GPS`. If opened on a classroom desktop PC without GPS (`accuracy > 85m` or unavailable), activates **`CAMPUS_CLUSTER`** (`PENDING_CLUSTER`), where the first verified, non-spoofed student checking in inside the university campus boundary (`<= 850m` from the baseline campus coordinates) dynamically anchors the exact classroom coordinates `(Room_Lat, Room_Lng)` for that session (`100m` radius), while off-campus students (`> 850m`) are immediately rejected.Supports lecturers teaching across 9+ different rooms/buildings per week without manual reconfiguration.
* **Hidden-Roster Instant Search & 1-Key (`Enter`) Attendance Mark**:
  * Upgraded `renderTeacherRoster()` so typing a student name or the last 3–4 digits of a Student ID (`#inp-roster-search`) immediately filters and reveals only the matching student(s) even while the full class roster remains hidden on the classroom projector (`showRosterNames === false`).
  * Added `handleRosterSearchKeydown(event)` so pressing `Enter` when a single student matches marks them `P` (`Present`) immediately and clears the search box.
* **Pre-Export Auto-Sync for Mid-Semester Roster Additions**: Updated `autoSyncTodayAttendanceAfterClass()` in `sync.txt` to invoke `syncSingleClassRosterFromDrive_` (`onlyIfModified: true`) prior to exporting attendance to `.XLSX` / Google Sheets, ensuring any newly added student in the Drive workbook is automatically imported before end-of-class grading.

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

### ✨ Version `v3.4.2` — *Tinh Gọn Giao Diện Giảng Viên, Mở Khóa Thiết Bị 1 Chạm & Tự Động Ẩn Lại Danh Sách Trên Máy Chiếu*
* **Gộp Cột Điều khiển Phiên 1 Cột & Loại bỏ Khung Radar Trang trí**: Gỡ bỏ cột phụ `.gps-station-box` (biểu tượng `.radar-circle` và tiêu đề lặp `#poster-class-title`) ở Mục 1 của Giảng viên; tích hợp gọn dòng trạng thái `#tea-gps-anchor-hint` và nút `#btn-toggle-adv-gps` (`"Chế độ GPS nâng cao"`) ngay bên trong khung `#teacher-session-control-box`.
* **Loại bỏ Nút `"Che MSSV"` Dư thừa & Thư viện Tạo QR Cũ (`qrcode.min.js`)**: Gỡ bỏ nút `#btn-toggle-privacy` (`Che MSSV`) trên thanh tiêu đề Mục 2 để chỉ giữ lại 2 nút cốt lõi (`Gọi ngẫu nhiên 1 SV` và `Ẩn/Hiện danh sách`). Loại bỏ thư viện `qrcode.min.js` không còn sử dụng nhưng giữ nguyên `html5-qrcode.min.js` để sinh viên và giảng viên quét mã QR Khóa học / QR Ghép nối có sẵn trong Google Sheet (`Setup_&_Dashboard`).
* **Tự động Xóa Ô Tìm kiếm để Ẩn lại Danh sách trên Máy chiếu & Mở khóa Thiết bị 1 Chạm**:
  * Khi Giảng viên đang bật chế độ Ẩn danh sách trên máy chiếu (`showRosterNames === false`) và gõ tìm kiếm sinh viên tại `#inp-roster-search`, ngay sau khi bấm **`P`**, **`L`**, **`E`**, **`-`** hoặc **`Mở khóa`**, hệ thống tự động xóa trắng ô tìm kiếm để màn hình máy chiếu quay về trạng thái ẩn danh sách ngay lập tức.
  * Tối ưu nút **`Mở khóa`** (`teacherResetStudentDevice`) thực thi ngay trong 1 cú chạm (báo kết quả tại `#tea-session-inline-status`, không bật hộp thoại hỏi lại), đồng thời giữ tách biệt với các nút `P` / `L` để Giảng viên linh hoạt bấm `L` nếu sinh viên đổi máy/xóa cache đi học trễ.

### 🔧 Version `v3.4.1` — *Mặc Định Đánh Giá Theo Vị Trí Giảng Viên (`TEACHER_GPS`) & Nút Chế Độ Nâng Cao Lấy Trung Bình 3 Sinh Viên Đầu Tiên (`STUDENT_AVG_3`)*
* **Mặc định Đánh giá theo Khoảng cách Gần Giảng viên (`TEACHER_GPS`)**: Khi Giảng viên mở phiên (chế độ mặc định), chỉ cần thiết bị của Giảng viên có tín hiệu GPS hợp lệ, hệ thống luôn khóa cứng tâm phòng học theo **vị trí thực tế của Giảng viên (`TEACHER_GPS`)**. Mọi sinh viên đều được chấm khoảng cách trực tiếp so với Giảng viên (`<= 100m`); sinh viên ngồi ở tòa nhà khác (`320m`) sẽ bị từ chối ngay lập tức (`[NGOÀI PHẠM VI]`).
* **Nút Chế độ GPS Nâng cao & Dự phòng khi Máy bàn Không có GPS (`STUDENT_AVG_3` — Trung bình 3 Sinh viên đầu tiên)**:
  * Bổ sung nút **`"Chế độ GPS nâng cao"`** (`#btn-toggle-adv-gps`) kèm tùy chọn **`"Sử dụng GPS Sinh viên (Lấy trung bình 3 bạn đầu tiên làm tâm phòng)"`** (`#chk-use-student-avg3`) trên giao diện Giảng viên.
  * **CHỈ KHI** thiết bị của Giảng viên hoàn toàn không có GPS, **HOẶC** khi Giảng viên chủ động bật nút Chế độ nâng cao này, hệ thống mới kích hoạt chế độ **`STUDENT_AVG_3`** (`COLLECTING_AVG_3`): lấy tọa độ trung bình cộng của **3 sinh viên hợp lệ đầu tiên** trong phòng học $\left(\frac{\text{Lat}_1+\text{Lat}_2+\text{Lat}_3}{3}, \frac{\text{Lng}_1+\text{Lng}_2+\text{Lng}_3}{3}\right)$ (bắt buộc cả 3 bạn phải ở trong trường `<= 850m` và ngồi gần nhau `<= 100m`) để khóa làm tâm phòng học.

### 🚀 Version `v3.4.0` — *Giao Diện Sinh Viên Không Cuộn Trang (`Zero-Scroll`), Thông Báo Nội Tuyến Đúng Vị Trí & Khóa Tâm Phòng Học Động Theo Ca*
* **Giao diện Sinh viên Không cuộn trang (`100dvh Zero-Scroll`) & Thông báo Nội tuyến Đúng vị trí**:
  * Khóa khung nhìn điểm danh của Sinh viên trên điện thoại (`body.student-locked-scroll`) vừa khít 1 màn hình `100dvh` (`overflow: hidden`, `overscroll-behavior: none`), loại bỏ hoàn toàn tình trạng trượt tay kéo trang khi bấm điểm danh. Tự động mở cuộn linh hoạt khi bật khung quét QR hoặc cài đặt nâng cao.
  * Thay thế thanh thông báo dưới đáy màn hình bằng các khung phản hồi nội tuyến ngay tại vị trí thao tác (`#gps-inline-status` nằm trong khung `#gps-panel`, `#checkin-inline-status` ngay dưới nút `"ĐIỂM DANH NGAY"`, `#onboard-inline-status` ngay trong khung `#box-add-course`, cùng `#tea-login-inline-status`, `#tea-session-inline-status`, `#tea-admin-inline-status` bên Giảng viên): lỗi hoặc thành công ở đâu thì xuất hiện thông báo ngay tại đó.
* **Khóa Tâm Phòng Học Động Theo Từng Ca Dạy (`TEACHER_GPS` vs. `CAMPUS_CLUSTER` cho 9+ Phòng Học Khác Nhau)**:
  * Gỡ bỏ hoàn toàn 2 nút/ô tích GPS gây rối trên giao diện Giảng viên (`"Đặt vị trí thiết bị này làm Tâm"` và `"Cập nhật Tâm phòng học theo GPS thiết bị này khi Mở phiên"`).
  * Tự động dò nhanh tín hiệu GPS của thiết bị Giảng viên khi bấm Mở phiên (`probeLecturerDeviceGpsFast`): nếu Giảng viên mở phiên bằng điện thoại/máy tính bảng có GPS chính xác (`accuracy <= 85m`), hệ thống khóa tâm phòng học theo `TEACHER_GPS`. Nếu Giảng viên mở phiên bằng máy tính bàn (PC) tại phòng học không có chip GPS (`accuracy > 85m`), hệ thống tự động kích hoạt chế độ **`CAMPUS_CLUSTER`** (`PENDING_CLUSTER`): sinh viên hợp lệ đầu tiên điểm danh bên trong khuôn viên trường (`<= 850m` so với tọa độ cơ sở và không bị gắn cờ can thiệp GPS) sẽ tự động ghim chính xác tọa độ phòng học mới `(Room_Lat, Room_Lng)` cho ca học đó (bán kính `100m`), trong khi sinh viên ở nhà/ngoài trường (`> 850m`) bị chặn ngay lập tức. Giải quyết triệt để bài toán Giảng viên dạy nhiều lớp đổi qua 9+ phòng/tòa nhà khác nhau mỗi tuần.
* **Tìm kiếm Nhanh & Điểm danh 1 Phím (`Enter`) Ngay Cả Khi Đang Ẩn Danh Sách Trên Máy Chiếu**:
  * Nâng cấp `renderTeacherRoster()` cho phép Giảng viên gõ tên hoặc 3–4 số cuối MSSV vào ô `#inp-roster-search` để hiện ngay đúng sinh viên cần tìm mà vẫn giữ nguyên chế độ ẩn toàn bộ danh sách còn lại trên máy chiếu (`showRosterNames === false`).
  * Bổ sung `handleRosterSearchKeydown(event)`: khi kết quả lọc khớp duy nhất 1 sinh viên, Giảng viên chỉ cần nhấn phím `Enter` để đánh dấu `P` (`Có mặt`) ngay lập tức và tự xóa ô tìm kiếm.
* **Tự động Nạp Sinh viên mới Trước Khi Xuất Điểm danh Cuối Ca**: Cập nhật `autoSyncTodayAttendanceAfterClass()` trong `sync.txt` tự động gọi `syncSingleClassRosterFromDrive_` (`onlyIfModified: true`) trước khi xuất dữ liệu điểm danh sang file `.XLSX` / Google Sheet, đảm bảo sinh viên mới thêm vào danh sách lớp giữa kỳ được cập nhật đầy đủ vào sổ điểm danh cuối buổi.

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

## 📊 Quick Comparison / Bảng Đối Chiếu Nhanh (`v2.1.0` vs. `v3.4.2`)

| Feature / Tính năng | Baseline `v2.1.0` | Release `v3.4.2` |
| :--- | :--- | :--- |
| **Frontend Architecture / Kiến trúc** | Monolithic `index.html` / Gộp chung 1 file | **Modular 5-File (`index.html`, `css/styles.css`, `js/schedule-config.js`, `js/student.js`, `js/teacher.js`)** |
| **UI & Iconography / Giao diện** | Decorative emojis / Giao diện dùng emoji | **`taste` Utilitarian UI, Zero-Scroll (`100dvh`) Student View, Decluttered 1-Col Lecturer UI & Inline Alerts** |
| **Daily Check-In / Điểm danh** | Camera QR Scan / Quét QR bắt buộc | **Pre-Check `#gps-panel` + 1-Tap Live GPS (`cachedGPS = null`) + `isSubmitting` Lock** |
| **Room Center / Tâm phòng học** | Static coordinates / Tọa độ phòng cố định | **Default Lecturer GPS (`TEACHER_GPS`) + Advanced / No-GPS 3-Student Centroid (`STUDENT_AVG_3`)** |
| **Class Selection / Chọn lớp học** | Manual selection / Chọn lớp thủ công | **Real-Time Auto-Select (`Class_Name` Multi-Day `(10-12 T2&6)` + Smart `17:15–17:30` Priority)** |
| **API Endpoint / Kết nối Máy chủ** | Manual URL setup / Dán link thủ công | **Default `INST_KfweyxZcv4` Endpoint + Legacy URL Auto-Migration** |
| **Lecturer Control / Mở phiên GV** | Direct 1-tap open / Mở phiên 1 chạm | **2-Step Confirm + Hidden-Roster Search Auto-Rehide & 1-Tap Device Unlock** |
| **Concurrency / Chịu tải** | Direct Sheet reads / Đọc trực tiếp từng tab | **RAM `CacheService` (~10x faster / Nhanh gấp 10 lần)** |
| **Anti-Cheat / Chống gian lận** | Basic radius check / Kiểm tra bán kính cơ bản | **Multi-Browser (`Safari+Chrome`), F12, Fresh GPS Timestamp & Spot-Check Lock** |
| **Roster & Backup / Sổ sách** | Manual copy-paste / Nhập xuất thủ công | **Universal Content-Aware (`Class_ID` + `MSSV`/Name) 2-Way `.XLSX` Sync + Pre-Export Delta Import** |
| **Client Cache / Bộ nhớ đệm Web** | PWA Service Worker (`sw.js`) | **Instant live reload / Luôn tải bản mới tức thì** |
