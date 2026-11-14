# CCS - ClassCheck System

Hệ thống điểm danh sinh viên: web tĩnh (HTML/CSS/JS thuần, không build) + backend Google Apps Script + Google Sheets. Đang vận hành thật, phiên bản hiện tại xem `SYSTEM_VERSION` trong `code<X.Y.Z>.text` mới nhất. Dự án dùng chung giữa Claude Code và Antigravity, nên luật gốc nằm ở `.agent/` và file này chỉ import, không chép lại.

## Giao tiếp
- Trả lời bằng tiếng Việt, ngắn gọn, nêu rõ file và dòng đã sửa.
- Chuỗi giao diện và changelog theo quy tắc bên dưới (changelog song ngữ Anh-Việt).

## Luật dùng chung với Antigravity (nguồn gốc ở `.agent/rules/`)
@.agent/rules/ui-demo-preview.md
@.agent/rules/changelog-and-versioning.md
@.agent/rules/shareable-universal-design.md

Chỉ sửa luật ở `.agent/rules/` để hai công cụ luôn khớp nhau. Phần dưới đây chỉ là điều chỉnh riêng cho Claude Code, nếu mâu thuẫn thì phần dưới thắng.

## Điều chỉnh cho Claude Code
- **Kiểm thử giao diện:** `/tmp/ccs-demo` không có trên Windows. Với thay đổi UI/layout, mở `index.html` bằng browser pane tích hợp (hoặc dựng bản nháp trong thư mục scratchpad) rồi chụp ảnh. Với thay đổi logic, chạy test Node thật, không chụp ảnh.
- **Đồng bộ Google Drive:** các lệnh `gdrive ...` trong luật là của Antigravity. Ở đây dùng connector Google Drive nếu có, và chỉ làm sau khi tôi đồng ý.
- **Việc hướng ra ngoài cần hỏi trước:** `clasp push/deploy` (qua script deploy), `git push`, ghi đè hay đổi tên file trên Drive. Hệ thống đang chạy thật trên lớp, nên không tự deploy.
- **Việc cục bộ cứ làm:** `--stage-only`, chạy test, sửa code, cập nhật changelog và version theo luật.
- **Không commit tự động.** Chỉ commit khi tôi bảo.
- **Skill deploy:** đọc `.agent/skills/appscript-deploy/SKILL.md` trước khi deploy backend. Không bao giờ chạy `clasp deploy` trần hay `clasp push` ở thư mục gốc.

## Tài liệu tham chiếu (đọc khi cần, không nạp sẵn)
- `RULES.md`: luật nghiệp vụ (trạng thái P/L/E/-, tính điểm, GPS, chống gian lận, lịch học). Lưu ý: header còn ghi v3.6.6, cần cập nhật lên v3.7.x trước khi tin hoàn toàn.
- `HANDOFF-CCS.md`: bàn giao từ Antigravity (bản đồ nơi lưu, việc dở). Chứa ID và email, không commit.
- `changelog.md`: lịch sử phiên bản.

## Cấu trúc
- `index.html`, `css/styles.css`, `js/schedule-config.js`, `js/student.js`, `js/teacher.js`: frontend.
- `code<X.Y.Z>.text` -> `.clasp/Code.gs`; `sync.txt` -> `.clasp/Sync.gs`: backend. Không chép `.html/.js/.css` vào `.clasp/`.
- Test: `node ".agent/skills/appscript-deploy/scripts/test-v371-ux.js"`.
