# Universal & Shareable Design Rule (`CCS - ClassCheck System`)

This project (`CCS - ClassCheck System`) is built both for the author's own teaching workflow and to be **shared publicly with other lecturers/teachers across different faculties and schools**. Always follow these principles:

1. **Never Hardcode Personal Naming Conventions**:
   - Do **not** rely on lecturer-specific file suffixes/prefixes (such as `_Mr.`, `_Ms.`, or a specific teacher's name) to identify files, folders, or sheets.
   - Rely on **universal academic data structures** that every lecturer's files have:
     - **Class Code (`Mã lớp` / `Class_ID`)** in the file name, folder name, or sheet header.
     - **Student Roster Structure (`MSSV` / `Student_ID` + `Họ và tên` / `Full_Name`)** inside the spreadsheet/table to distinguish an actual Attendance/Roster file from a Syllabus/Class Diary file that shares the same Class Code.

2. **Performance & Zero-Lag UX**:
   - Avoid heavy background polling or unnecessary `.XLSX` conversions when nothing has changed.
   - Check lightweight metadata first (such as Drive file `lastUpdated` / `modifiedTime` or row count) before converting/scanning `.XLSX` files, and only run sync operations when triggered by the lecturer or when the target file's `lastUpdated` timestamp has actually changed.
