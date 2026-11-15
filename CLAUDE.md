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

## Workflow nhiều model
Opus lập kế hoạch và duyệt kết quả. Sonnet, Haiku và Codex thực thi theo plan.

1. Kế hoạch nằm ở `plan.md` (gốc repo, git bỏ qua nên nhớ sao lưu). Mỗi bước ghi: file liên quan, hành vi mong muốn, tiêu chí xong, và người làm (Sonnet / Haiku / Codex).
2. Chọn người làm:
   - Sonnet: bước cần hiểu ngữ cảnh, sửa nhiều file liên quan, logic nghiệp vụ.
   - Haiku: bước cơ học, phạm vi nhỏ (chuỗi UI, đổi tên, format, changelog).
   - Codex (miễn phí nhưng hạn mức thấp, chỉ dùng khi cần): review độc lập logic rủi ro trước khi deploy. Trên Windows agent `codex:codex-rescue` không chạy được, gọi trực tiếp `codex-companion.mjs` (cách chạy ở memory `codex-usage-on-windows`).
3. Các bước độc lập thì chạy song song. Bước phụ thuộc nhau thì chạy tuần tự.
4. Opus đọc lại diff và chạy test trước khi nhận kết quả. Không ai tự commit.

### Quy tắc giao Codex
- Chạy test cục bộ trước. Chỉ giao review phần file đã đổi, không audit cả repo.
- Gộp các sửa nhỏ liên quan vào một lần giao. Không review lại code chưa đổi.
- Codex không được `clasp push/deploy`, `git push` hay commit.
- Chỉ dùng cho logic rủi ro (công thức điểm, đường ghi của Sync, xác thực). Không dùng cho giao diện, tài liệu, nâng version.
- Phạm vi hẹp: `--base` là bản phát hành ngay trước, hoặc liệt kê rõ file/hàm. Không bao giờ quét nhiều bản một lần (một lần quét 3 bản đã tốn khoảng 30% hạn mức tháng).
- Ưu tiên `task` (không `--write`) với `--effort low`, giới hạn số phát hiện, dặn không chạy test.
- Codex báo hết hạn mức thì giao bước đó cho Sonnet hoặc Haiku, không thử lại liên tục.

## Tài liệu tham chiếu (đọc khi cần, không nạp sẵn)
- `RULES.md`: luật nghiệp vụ (trạng thái P/L/E/-, tính điểm, GPS, chống gian lận, lịch học). Lưu ý: header ghi v3.9.2, nhưng mục 1.1, 3, 6, 7 chưa đối chiếu lại hoàn toàn với `sync.txt` / `js/schedule-config.js`.
- `HANDOFF-CCS.md`: bàn giao từ Antigravity (bản đồ nơi lưu, việc dở). Chứa ID và email, không commit.
- `changelog.md`: lịch sử phiên bản.

## Cấu trúc
- `index.html`, `css/styles.css`, `js/schedule-config.js`, `js/student.js`, `js/teacher.js`: frontend.
- `code<X.Y.Z>.text` -> `.clasp/Code.gs`; `sync.txt` -> `.clasp/Sync.gs`: backend. Không chép `.html/.js/.css` vào `.clasp/`.
- Test: `node ".agent/skills/appscript-deploy/scripts/run-all-tests.js"` (chạy 7 bộ test, gồm `test-core.js`, `test-sim-class.js` (mô phỏng lớp 10 sinh viên), `test-attendance-rules.js` và `test-sync-marks.js` chạy backend thật trong vm). Script deploy tự chạy bộ test này trước (`--skip-tests` để bỏ qua).
- Xem trang: `.claude/launch.json` (git bỏ qua) khai báo server `ccs-web` cổng 8765; bật bằng Preview hoặc `preview_start`.
