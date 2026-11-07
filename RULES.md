# QUY TẮC HỆ THỐNG CCS (CLASSCHECK SYSTEM RULES)

> **Phiên bản đối chiếu hiện tại:** `v3.6.6` (Frontend UI & Backend Apps Script)  
> **Các tệp nguồn đối chiếu:**
> - Backend Apps Script: [`code3.6.6.text`](file:///d:/CCS%20-%20ClassCheck%20System/code3.6.6.text)
> - Script Đồng bộ Sổ Điểm danh & Master Sheet: [`sync.txt`](file:///d:/CCS%20-%20ClassCheck%20System/sync.txt)
> - Frontend Sinh viên / Giảng viên / Lịch học: [`js/student.js`](file:///d:/CCS%20-%20ClassCheck%20System/js/student.js), [`js/teacher.js`](file:///d:/CCS%20-%20ClassCheck%20System/js/teacher.js), [`js/schedule-config.js`](file:///d:/CCS%20-%20ClassCheck%20System/js/schedule-config.js)
> - Quy tắc Quản lý Phiên bản & Demo Giao diện: [`.agent/rules/changelog-and-versioning.md`](file:///d:/CCS%20-%20ClassCheck%20System/.agent/rules/changelog-and-versioning.md), [`.agent/rules/ui-demo-preview.md`](file:///d:/CCS%20-%20ClassCheck%20System/.agent/rules/ui-demo-preview.md)

---

## 1. Quy tắc Thời gian & Trạng thái Điểm danh (`P` / `L` / `E` / `-`)

### 1.1. Trạng thái gốc trên Master Sheet & Cơ chế Tùy biến Ký hiệu xuất ra File Lớp (`sync.txt`)
Trên **Master Sheet**, hệ thống lưu trữ thống nhất bằng 4 mã trạng thái chuẩn (`P`, `L`, `E`, `-`). Khi đồng bộ sang File Điểm danh riêng của từng Giảng viên (Google Sheet hoặc `.XLSX`), hệ thống đọc cấu hình từ mục **`⚙️ 5. Attendance Mark Settings` (`openAttendanceStyleDialog`)** trong [`sync.txt`](file:///d:/CCS%20-%20ClassCheck%20System/sync.txt#L51-L59) để mỗi giảng viên có thể tự tùy chỉnh ký hiệu & màu nền theo quy ước riêng:

| Mã gốc trên Master Sheet | Ý nghĩa & Quy đổi chuyên cần | Preset `CENTER` (Mặc định của bạn) | Preset `PLA` (Chuẩn chữ) | Chế độ `CUSTOM` | Màu chấm tròn Web UI (`7px`) |
| :---: | :--- | :--- | :--- | :--- | :---: |
| **`P`** | Có mặt đúng giờ (*Present*) — `0đ`, `0x` | Chữ: *(trống)*, Nền: *(trống)* | Chữ: `P`, Nền: *(trống)* | Tự chọn chữ & mã màu Hex | Xanh lá (`#16a34a`) |
| **`L`** | Đi học trễ (*Late*) — Trừ **`0.5đ`**, `0x` | Chữ: *(trống)*, Nền: Vàng (`#ffff00`) | Chữ: `L`, Nền: Vàng (`#ffff00`) | Tự chọn chữ & mã màu Hex | Vàng (`#eab308`) |
| **`E`** | Vắng có phép (*Excused*) — Trừ **`0.5đ`**, tính **`0.5x`** | Chữ: *(trống)*, Nền: Cam (`#ff9900`) | Chữ: `E`, Nền: Cam (`#ff9900`) | Tự chọn chữ & mã màu Hex | Cam (`#f97316`) |
| **`-`** | Vắng không phép (*Absent*) — Trừ **`1.0đ`**, tính **`1.0x`** | Chữ: `x`, Nền: *(trống)* | Chữ: `A`, Nền: *(trống)* | Tự chọn chữ & mã màu Hex | Đỏ (`#dc2626`) |

### 1.2. Mức thiết lập cửa sổ thời gian (`Present_Mins` & `Late_Mins`)
Được cấu hình trực tiếp theo từng lớp trong tab **`Classes_Config`** của Master Sheet và áp dụng tại [`handleTeacherStartSession`](file:///d:/CCS%20-%20ClassCheck%20System/code3.6.6.text#L1393-L1480) & [`handleStudentCheckIn`](file:///d:/CCS%20-%20ClassCheck%20System/code3.6.6.text#L649-L661):

1. **Mốc Có mặt (`Present_Mins`)**:
   - Mặc định: **`3 phút`** đầu kể từ lúc Giảng viên bấm mở phiên (`presentUntilMs = startTime + Present_Mins * 60000`).
   - Sinh viên bấm điểm danh khi `nowMs <= presentUntilMs` $\rightarrow$ Ghi nhận trạng thái **`P`** (Có mặt).
2. **Mốc Đi trễ (`Late_Mins`)**:
   - Mặc định trong `Classes_Config`: **`15 phút`** (hoặc fallback hệ thống `DEFAULT_LATE_MINS = 60` phút) kể từ lúc mở phiên (`closesAtMs = startTime + Late_Mins * 60000`).
   - Sinh viên bấm điểm danh khi `presentUntilMs < nowMs <= closesAtMs` $\rightarrow$ Ghi nhận trạng thái **`L`** (Đi trễ).
3. **Sau khi hết giờ (`nowMs > closesAtMs`)**:
   - Khóa cổng điểm danh (`ERR_SESSION_CLOSED`).
   - Sau `10 giây` (`CLOSE_SWEEP_DELAY_MS = 10000`), hàm [`sweepAndCloseSession`](file:///d:/CCS%20-%20ClassCheck%20System/code3.6.6.text#L1840-L1940) tự động quét toàn bộ sinh viên thuộc lớp chưa có bản ghi trong phiên (trừ sinh viên có `Status = REVOKED`) và điền trạng thái **`-`** (`Location_Mode = 'AUTO_SWEEP'`).

### 1.3. Điều khiển phiên trực tiếp của Giảng viên ([`handleTeacherControlSession`](file:///d:/CCS%20-%20ClassCheck%20System/code3.6.6.text#L1510-L1563))
- **Gia hạn +2p (`EXTEND_2M`)**: Cộng thêm `2 phút` vào `closesAtMs` (cho phép điểm danh mức Đi trễ `L`).
- **Mở lại +5p (`REOPEN_5M`)**: Mở lại chính phiên hiện tại (`Status = OPEN`), cấp mới **`2 phút` đầu là Có mặt (`P`)** (`presentUntilMs = baseNow + 2p`) và **`5 phút` tổng thời gian mở (`closesAtMs = baseNow + 5p`)**.
- **Đóng ngay (`CLOSE_NOW`)**: Đưa `presentUntilMs` và `closesAtMs` về thời điểm hiện tại, khóa phiên ngay lập tức và chạy `sweepAndCloseSession`.

---

## 2. Quy tắc Xử lý Nhiều Phiên Trong Cùng 1 Ngày & Đồng bộ Sheet (`v3.6.0`)

1. **Lọc phiên rỗng (Ghost/Test Sessions)**: Ngày nào mà tất cả các phiên mở ra đã đóng và có **`0` sinh viên có mặt/đi trễ/có phép/chấm tay** (`P = 0, L = 0, E = 0, TEACHER_MANUAL = 0`) thì coi là phiên mở nhầm/test $\rightarrow$ **Không tính là 1 buổi học đã diễn ra** và không tính vắng cho sinh viên.
2. **Gộp phiên trùng ngày (`1 ngày = 1 buổi học = 1 cột trên Sheet`)**:
   - Trên cả Sổ Điểm danh Lớp ([`sync.txt`](file:///d:/CCS%20-%20ClassCheck%20System/sync.txt)) và Tab Lớp của Master Sheet ([`code3.6.6.text` — `buildGroupedClassDayRecords_`](file:///d:/CCS%20-%20ClassCheck%20System/code3.6.6.text#L2020-L2106)), các phiên mở cùng ngày của cùng 1 lớp được gộp thành **1 buổi duy nhất trong ngày**.
   - Giữa các phiên trong cùng ngày:
     - Bản ghi do **Giảng viên chỉnh tay (`TEACHER_MANUAL`)** luôn có quyền cao nhất (theo lần chỉnh cuối cùng của Giảng viên, hỗ trợ cả duyệt phép `E` cho buổi học trước).
     - Bản ghi tự động quét vắng (`AUTO_SWEEP` khi đóng phiên 2) **không bao giờ đè** lên trạng thái `P / E / L` mà sinh viên đã điểm danh hợp lệ ở phiên 1 trong cùng ngày.
   - **Lấy dữ liệu từ Sheet & Lịch sử điểm danh đã gộp theo ngày**: Thống kê hiển thị cho Sinh viên kết hợp dữ liệu từ Sheet và lịch sử thiết bị đã gộp theo `dayKey` (`yyyy-MM-dd`) để luôn khớp 100% với số liệu của Giảng viên.

---

## 3. Quy tắc Tính Điểm Chuyên Cần & Xét Cấm Thi (Chuẩn Chính Thức)

### 3.1. Điểm gốc & Cách trừ điểm
- **Điểm ban đầu**: **`10.0 điểm`** (Tổng thời lượng tiêu chuẩn: `30 buổi`, tối đa được phép vắng `6.0x`).
- **Dấu `'x'` / `'X'` (Vắng không phép — `-` trên Master Sheet)**:
  - Trừ **`1.0 điểm / buổi`**
  - Tính **`1.0 dấu x`**
- **Ô màu vàng (`#FFFF00`, `#FFF2CC`, `#FFE599`, `#FFD966`, `#F1C232`... — Đi học trễ — `L` trên Master Sheet)**:
  - Nhận diện thông minh **mọi sắc thái màu vàng** trong bảng màu mặc định của Google Sheets và Excel (theo dải màu Hue $47^\circ\text{–}68^\circ$ hoặc danh sách mã Hex chuẩn).
  - Trừ **`0.5 điểm / buổi`**
  - **Không** tính vào số dấu `x` vắng (`0x`)
- **Ô màu cam (`#FF9900`, `#F6B26B`, `#F9CB9C`, `#FCE5CD`, `#E69138`, `#FFA500`, `#FFC000`... — Vắng có phép — `E` trên Master Sheet)**:
  - Nhận diện thông minh **mọi sắc thái màu cam** (cam đậm, cam nhạt, cam pastel) trong bảng màu mặc định của Google Sheets và Excel (theo dải màu Hue $18^\circ\text{–}46^\circ$ hoặc danh sách mã Hex chuẩn).
  - Trừ **`0.5 điểm / buổi`**
  - Tính **`0.5 dấu x quy đổi`** *(2 buổi vắng có phép = 1 dấu `x`)*

### 3.2. Công thức tính
$$\text{Tổng\_x\_quy\_đổi} = \text{Số\_dấu\_x} + (\text{Số\_ô\_cam} \times 0.5)$$

$$\text{Điểm\_còn\_lại} = 10.0 - (\text{Số\_dấu\_x} \times 1.0) - (\text{Số\_ô\_vàng} \times 0.5) - (\text{Số\_ô\_cam} \times 0.5)$$

### 3.3. Tiêu chí phân loại & Xét Cấm Thi (Hiển thị trên Giao diện Sinh viên)

> [!IMPORTANT]
> **Lưu ý ranh giới xét duyệt:** Nếu $\text{Tổng\_x\_quy\_đổi} \le 6.0$ **VÀ** $\text{Điểm\_còn\_lại} \ge 0.0$ (kể cả `0.0đ` hay `0.5đ`) thì sinh viên **VẪN ĐƯỢC THI** (chỉ nằm ở diện Cảnh báo sát nút). Sinh viên chỉ bị cấm thi khi vượt quá `6.0x` (từ `6.5x` trở lên) hoặc điểm tụt xuống mức âm (`<= -0.5đ`), hoặc bị Giảng viên tô đỏ thủ công trên file.

| Mức phân loại | Điều kiện kích hoạt | Hiển thị trên Giao diện Sinh viên |
| :--- | :--- | :--- |
| **1. CẤM THI NGAY** | - $\text{Tổng\_x\_quy\_đổi} > 6.0$ *(từ `6.5x` hoặc `7.0x` trở lên)*<br>- **HOẶC** $\text{Điểm\_còn\_lại} < 0.0$ *(tức từ `-0.5đ` trở xuống)*<br>- **HOẶC** Thông tin sinh viên (`STT`, `MSSV`, `Họ tên`) trên Sheet có nền đỏ / chữ đỏ (`#FF0000`, `#E06666`...) | **Giao diện Đỏ đậm (`#dc2626`)** + Hiện chữ lớn **`CẤM THI`** |
| **2. CẢNH BÁO SÁT NÚT**<br>*(Nguy cơ cấm thi)* | *(Khi chưa bị Cấm thi)*:<br>- $\text{Tổng\_x\_quy\_đổi}$ từ **`5.5` đến `6.0`** *(vắng thêm `0.5x` hay `1.0x` sẽ bị cấm)*<br>- **HOẶC** $\text{Điểm\_còn\_lại}$ từ **`0.0` đến `1.0` điểm** *(trễ/vắng thêm 1–2 lần là chạm mức âm `-0.5đ`)* | **Giao diện Đỏ nhạt** (nền `#fef2f2`, viền `#fecaca`, chữ `#b91c1c`) + Hiện thông báo cảnh báo nguy cơ cấm thi |
| **3. BÌNH THƯỜNG** | - $\text{Tổng\_x\_quy\_đổi} \le 5.0$ **VÀ** $\text{Điểm\_còn\_lại} \ge 1.5$ | Thẻ thống kê trung tính (`#f8fafc`), hiển thị rõ Điểm chuyên cần còn lại, số buổi Có mặt / Đi trễ / Có phép / Vắng (`Tổng x quy đổi`) |

---

## 4. Quy tắc Định vị GPS & Tâm Phòng Học (`Location_Mode`)

Được quy định tại [`CONFIG` (dòng 32–42)](file:///d:/CCS%20-%20ClassCheck%20System/code3.5.1.text#L32-L42) và [`handleStudentCheckIn` (dòng 715–772)](file:///d:/CCS%20-%20ClassCheck%20System/code3.5.1.text#L715-L772):

1. **Bán kính phòng học chuẩn (`Radius_Meters`)**: Mặc định **`100m`** (cấu hình trong `Classes_Config`).
2. **Bù trừ sai số GPS trong nhà (`accuracyAllowance`)**:
   - Tối đa **`50m`**: `accuracyAllowance = Math.min(accuracy, 50)`.
   - Khoảng cách thực tế tính xét duyệt: `effectiveDist = Math.max(0, rawDist - accuracyAllowance)`.
   - Hợp lệ khi: `effectiveDist <= Radius_Meters`.
3. **Không lưu đệm tọa độ cũ (`Fresh GPS Only`)**:
   - Trên thiết bị Sinh viên ([`js/student.js`](file:///d:/CCS%20-%20ClassCheck%20System/js/student.js)): `window.cachedGPS = null`, luôn gọi `navigator.geolocation.getCurrentPosition` với `enableHighAccuracy: true, maximumAge: 0`.
4. **Chế độ lấy tâm phòng học (`Location_Mode`)**:
   - **Mặc định (`TEACHER_GPS`)**: Lấy tọa độ GPS trực tiếp từ điện thoại/máy tính của Giảng viên lúc mở phiên.
   - **Tùy chọn nâng cao (`STUDENT_AVG_3`)**: Khi Giảng viên mở phiên trên máy bàn không có GPS, hệ thống thu thập tọa độ của **3 sinh viên đầu tiên** điểm danh nằm trong bán kính toàn trường IUH (**`MAX_CAMPUS_RADIUS = 850m`** quanh mốc `10.822158, 106.686845`), sau đó tính trung bình cộng làm tâm phòng học.

---

## 5. Quy tắc Khóa Thiết Bị 1-1 & Chống Gian Lận (`Anti-Cheat`)

Được quy định tại [`handleBindDevice` (dòng 487–609)](file:///d:/CCS%20-%20ClassCheck%20System/code3.5.1.text#L487-L609) và [`handleStudentCheckIn` (dòng 662–800)](file:///d:/CCS%20-%20ClassCheck%20System/code3.5.1.text#L662-L800):

1. **Khóa Thiết bị 1-1 (`Devices` sheet)**:
   - Mỗi `Student_ID` chỉ được gắn với **1 `Device_ID` (`ACTIVE`)** và mỗi `Device_ID` chỉ được gắn với **1 `Student_ID`**.
   - Sau khi liên kết thành công, ô nhập MSSV trên điện thoại sinh viên bị khóa cố định (`readonly`).
   - Khi Giảng viên bấm **Mở khóa** (`handleTeacherResetDevice`), trạng thái chuyển thành `REVOKED`. Lần tới sinh viên đó bấm điểm danh trên máy mới (hoặc máy cũ), hệ thống tự động kích hoạt lại (`ACTIVE`) mà không báo lỗi.
2. **Gắn cờ nghi vấn mềm (`Soft-Flag` — Vẫn cho điểm danh nhưng báo cảnh báo cho Giảng viên)**:
   - `SUSPECT_MOCK_GPS_CLIENT`: Phát hiện dấu hiệu giả lập GPS (`accuracy <= 1m`, thiếu thông số cảm biến phần cứng).
   - `SUSPECT_F12_DEVTOOLS`: Phát hiện mở cửa sổ F12 Developer Tools can thiệp trình duyệt.
   - `SUSPECT_WITH_<MSSV>` (Trùng tọa độ tuyệt đối): 2 thiết bị có `Lat` và `Lng` trùng khớp tuyệt đối tới **6 chữ số thập phân** (`0.000000`) trong vòng **`45 giây`**.
   - `SUSPECT_WITH_<MSSV>` (Trùng vân tay phần cứng `deviceFp`): 2 trình duyệt trên cùng 1 điện thoại (ví dụ Safari + Chrome hoặc Ẩn danh) có cùng `Canvas + WebGL + Screen + Cores + Memory hash` điểm danh cách nhau **`<= 20 giây`** và khoảng cách **`<= 5m`**.

---

## 6. Quy tắc Nhận Diện Lịch Học Tự Động (`js/schedule-config.js`)

Được quy định tại [`js/schedule-config.js`](file:///d:/CCS%20-%20ClassCheck%20System/js/schedule-config.js):

1. **Khung giờ tiết học chuẩn IUH (`PERIOD_SLOTS`)**:
   - **Tiết 1–3**: `06:30 – 09:00`
   - **Tiết 4–6**: `09:00 – 11:30`
   - **Tiết 7–9**: `12:30 – 15:00`
   - **Tiết 10–12**: `15:00 – 17:30`
   - **Tiết 13–15**: `17:30 – 20:00`
   - **Tiết 16–18**: `20:00 – 22:30`
   - *Độ trễ nhận diện sớm (`EARLY_BUFFER_MINS`)*: **`15 phút`** trước giờ bắt đầu ca học.
2. **Thứ tự ưu tiên tự động chọn lớp**:
   - **Ưu tiên 1**: Lớp đang có phiên điểm danh mở (`OPEN`).
   - **Ưu tiên 2**: Sự kiện trùng giờ hiện tại trên **Google Calendar** của Giảng viên (khớp `Class_ID` trên tiêu đề lịch).
   - **Ưu tiên 3**: Khung Thứ + Tiết học được đồng bộ tự động từ dòng thông tin lớp (dòng 5–6 của Sổ Điểm danh Excel) hoặc hậu tố trên `Class_Name`.

---

## 7. Quy tắc Đồng Bộ File Điểm Danh & Tùy Biến Ký Hiệu (`sync.txt`)

Được quy định tại [`sync.txt` (Mục 7: `openAttendanceStyleDialog`, dòng 1322–1468 & `updateTargetAttendanceFile_`, dòng 2495–2606)](file:///d:/CCS%20-%20ClassCheck%20System/sync.txt#L1322-L1468):

1. **Tùy biến Ký hiệu & Màu nền Điểm danh (`⚙️ 5. Attendance Mark Settings`)**:
   - Đã có sẵn hộp thoại cấu hình cho phép mọi giảng viên chọn giữa:
     - **`CENTER` (Highlight Style - Mặc định)**: `P` = Để trống, `L` = Nền vàng `#ffff00`, `E` = Nền cam `#ff9900`, `-` = Chữ `'x'`.
     - **`PLA` (Standard P / L / E / A)**: `P` = `'P'`, `L` = `'L'` + nền vàng, `E` = `'E'` + nền cam, `-` = `'A'`.
     - **`CUSTOM`**: Tự nhập chữ (hoặc để trống) và mã màu nền Hex riêng cho từng trạng thái `P`, `L`, `E`, `-`.
   - Đã tích hợp đầy đủ dòng cấu hình **`Excused (E)`** (`excusedText`, `excusedBg`) vào bảng `openAttendanceStyleDialog` và nhánh `else if (status === 'E')` trong `updateTargetAttendanceFile_`.
2. **Đồng bộ từ Master Sheet sang File Điểm danh Lớp (Google Sheet / `.XLSX`)**:
   - Gom tất cả các phiên mở trong cùng 1 ngày (`dd/MM/yyyy`) và điền vào đúng cột ngày tương ứng trên File Lớp theo bộ ký hiệu/màu sắc mà giảng viên đã chọn trong `Attendance Mark Settings`.
   - Lưu bản chụp trạng thái ô cũ (`previousCells`) để hỗ trợ hoàn tác 1 chạm (`↩️ 3. Undo Last Action`).

---

## 8. Quy tắc Giao Diện (`Utilitarian UI`) & Quản Lý Phiên Bản

1. **Giao diện Học thuật Tinh gọn (`No AI Icons`)**:
   - **Tuyệt đối không sử dụng Emoji / AI Icons** (`🎲`, `🎉`, `⚠️`, `🚨`, `✅`, `❌`, v.v.) trên toàn bộ giao diện Web của Giảng viên và Sinh viên.
   - Sử dụng Typography rõ ràng (`Be Vietnam Pro` + `JetBrains Mono` cho số liệu/MSSV/đồng hồ) và chấm tròn màu `7px` cho trạng thái `P / L / E / A`.
2. **Quy tắc Đánh số Phiên bản & Đồng bộ (`changelog-and-versioning.md`)**:
   - Mỗi lần cập nhật tính năng hoặc sửa lỗi: tăng `SYSTEM_VERSION` (`X.Y.Z`), đổi tên file [`code<X.Y.Z>.text`](file:///d:/CCS%20-%20ClassCheck%20System/code3.6.6.text) ở cả thư mục máy và trên Google Drive (`14mEoxJJ1_USzlYorIvnZBHJwzzK1KDOj`) khi có thay đổi backend, cập nhật [`sync.txt`](file:///d:/CCS%20-%20ClassCheck%20System/sync.txt) (`1TA3scTqHwz8btQYJbzDSPiP6K3QCsxyA`), [`changelog.md`](file:///d:/CCS%20-%20ClassCheck%20System/changelog.md) (`18y2_402KSn4KfRZ0LExDlnCmB6UsqGPz`) song ngữ Anh–Việt, và query string `?v=<X.Y.Z>` ở các file frontend.
3. **Quy tắc Sửa Code Tối Thiểu & Kiểm Thử Thực Tế (`ui-demo-preview.md`)**:
   - **Chỉ sửa đúng chỗ cần sửa**: Can thiệp đúng dòng/hàm cần thay đổi, hạn chế viết lại toàn bộ hàm/file; tuyệt đối không tự ý thêm các dòng comment giới thiệu đầu file/hàm hoặc chèn thêm chữ lên giao diện ngoài yêu cầu.
   - **Phân tách Preview Giao diện & Test Chức năng**:
     - Chỉ khi thay đổi **Giao diện (UI/UX, bố cục, màu sắc)** mới dựng bản nháp `/tmp/ccs-demo` và chụp ảnh màn hình (`2x Retina` qua Headless Chromium).
     - Khi thay đổi **Code / Logic / Chức năng** (GPS, tính điểm, phiên điểm danh, đồng bộ Sheet...), không chụp ảnh giao diện mà phải **chạy test thực tế** (script kiểm thử luồng hàm và các tình huống biên) để xác nhận kết quả.
