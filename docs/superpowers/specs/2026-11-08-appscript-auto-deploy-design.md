# Thiết Kế Skill Tự Động Cập Nhật & Phát Hành Google Apps Script (`appscript-deploy`)

**Ngày:** 2026-11-08  
**Quy mô:** Thay đổi nhỏ (Small change)

## 1. Mục đích & Lý do (Intent & Why)
Tự động hóa hoàn toàn việc đẩy mã nguồn backend (`code<X.Y.Z>.text` và `sync.txt`) lên dự án Google Apps Script và phát hành phiên bản mới (`New version`) trực tiếp vào mã Deployment hiện tại thông qua `@google/clasp`, giúp giữ nguyên 100% đường dẫn Web App `/exec` mà không cần copy–paste hay vào `Manage deployments` thủ công trên trình duyệt.

## 2. Mục tiêu & Phi mục tiêu (Goals, Non-Goals, Anti-Goals)
- **Mục tiêu:**
  - Cài đặt và cấu hình `@google/clasp` kết nối với dự án Apps Script của hệ thống CCS.
  - Tạo thư mục đệm `.clasp/` tách biệt (nằm trong `.gitignore`) chứa `.clasp.json` và `appsscript.json` để tránh đẩy nhầm code giao diện web (`index.html`, `js/*.js`, `css/*.css`) lên Apps Script.
  - Xây dựng Workspace Skill `.agent/skills/appscript-deploy/SKILL.md` kèm script tự động `.agent/skills/appscript-deploy/scripts/deploy-appscript.js`:
    1. Tự động đọc `SYSTEM_VERSION` và lấy file `code<X.Y.Z>.text` mới nhất chuyển thành `.clasp/Code.gs`, đồng thời chuyển `sync.txt` thành `.clasp/Sync.gs`.
    2. Chạy `clasp push -f` để cập nhật `Code.gs` và `Sync.gs` trên Google Apps Script.
    3. Chạy `clasp deploy -i AKfycbyzXVAiaDpcvV4e8upgie6-yM_p7GOgjF5RhP3wmii6Hnx4s5xQZaPweZiPtbBYpO8q -d "v<X.Y.Z>"` (hoặc tạo version mới và gắn vào Deployment ID cố định) giống hệt thao tác `Manage deployments -> Edit -> New version`.
  - Cập nhật quy tắc `.agent/rules/changelog-and-versioning.md` để mỗi khi sửa code backend (`code<X.Y.Z>.text` hoặc `sync.txt`), Agent tự động kích hoạt Skill này.
- **Phi mục tiêu:** Không thay đổi logic nghiệp vụ điểm danh trong `code3.7.0.text` hay `sync.txt`.
- **Anti-goals:** Tuyệt đối không chạy `clasp deploy` không có cờ `-i <Deployment_ID>` (tránh sinh ra link `/exec` mới) và không ghi đè mất cấu hình quyền `webapp` trong `appsscript.json`.

## 3. Ràng buộc (Constraints)
- Giữ nguyên quy ước đặt tên `code<X.Y.Z>.text` và `sync.txt` ở thư mục gốc dự án để tương thích với quy trình backup lên Google Drive (`14mEoxJJ1_USzlYorIvnZBHJwzzK1KDOj` và `1TA3scTqHwz8btQYJbzDSPiP6K3QCsxyA`).
- Yêu cầu tài khoản Google đã bật `Google Apps Script API` tại `https://script.google.com/home/usersettings` và đăng nhập `clasp login` một lần duy nhất.

## 4. Các phương án đã cân nhắc (Approaches)
- **Phương án 1 (Đã chọn):** Dùng thư mục đệm `.clasp/` tách biệt + Script Node.js tự động đồng bộ `code<X.Y.Z>.text` $\rightarrow$ `Code.gs`, `sync.txt` $\rightarrow$ `Sync.gs`, chạy `clasp push -f` và `clasp deploy -i <Deployment_ID> -d "v<X.Y.Z>"`.
- **Phương án 2:** Đặt `.clasp.json` và `.claspignore` ngay tại thư mục gốc dự án. (Loại vì dễ đẩy nhầm các file `js/*.js` và `index.html` của GitHub Pages lên Apps Script).
- **Phương án 3:** Tự viết trình gọi REST API `script.googleapis.com` không qua `clasp`. (Loại vì phải tự cấu hình Google Cloud OAuth Client phức tạp).

## 5. Chi tiết triển khai (How It Gets Built)
- **Cấu hình Git (`.gitignore`):** Thêm `.clasp/` vào `.gitignore` để không đẩy thư mục đệm lên GitHub Pages.
- **Skill & Script (`.agent/skills/appscript-deploy/`):**
  - `SKILL.md`: Hướng dẫn quy trình kiểm tra đăng nhập `clasp`, đồng bộ file `.gs`, đẩy code, cập nhật version trên đúng Deployment ID và kiểm tra phản hồi từ link `/exec`.
  - `scripts/deploy-appscript.js`: Script tự động kiểm tra `scriptId` và `deploymentId`, kéo `appsscript.json` gốc nếu chưa có, copy `code<X.Y.Z>.text` $\rightarrow$ `.clasp/Code.gs` và `sync.txt` $\rightarrow$ `.clasp/Sync.gs`, thực thi `clasp push -f` và `clasp deploy -i <Deployment_ID> -d "v<X.Y.Z>"`.
- **Quy tắc tự động (`.agent/rules/changelog-and-versioning.md`):** Bổ sung bước kích hoạt Skill `appscript-deploy` mỗi khi cập nhật `code<X.Y.Z>.text` hoặc `sync.txt`.
