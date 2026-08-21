# Kế hoạch triển khai: E2E Regression — toàn bộ trang Fizzle

- Project: Fizzle (lớp 357)
- Member: Luke (mentor — không thuộc bảng phân công member)
- Nhánh git: `test/e2e/luke`  <!-- LỆCH quy ước pages/<trang>/<member>: xem "Ghi chú lệch quy ước" bên dưới -->
- Ngày tạo: 2026-08-20

## Tổng quan

Viết bộ E2E Playwright phủ **tất cả trang đang tồn tại** của Fizzle. Đây là việc của mentor
(kiểm thử chéo sản phẩm sau khi merge PR của 3 member), không phải việc implement một trang.

### Ghi chú lệch quy ước (mentor cần biết khi review)
1. **Nhánh** — skill quy định `pages/<ten-trang>/<ten-member>`. Việc này cắt ngang cả 3 trang
   của 3 member nên không map vào một trang nào; đề xuất `test/e2e/luke`.
2. **Ownership (Bước 3 mục a)** — luật "không đụng trang member khác" áp cho *member*. Ở đây
   chỉ **đọc** code của họ để viết test, **không sửa** file nào trong `features/`, `khang/`,
   `k-profile/`. Mọi file mới nằm gọn trong `e2e/` + config ở root FE.
3. **Angular Material** — tiêu chí UI/UX của skill nhắc Material, nhưng repo hiện **không cài**
   Material; UI đang dựng trên design tokens riêng (`src/styles/`). Test sẽ đánh giá theo
   design system thật của repo, không ép theo Material.

### Hiện trạng đã khảo sát (quyết định phạm vi test được tới đâu)

| Trang | Route | Chủ | Trạng thái thật | Test được gì |
| --- | --- | --- | --- | --- |
| Login / Register / Forgot-password | `/auth/*` | Khánh Hưng | **Nối backend NestJS + Supabase thật** | E2E đầy đủ, có data thật |
| Friends | `/friends` (mặc định) | Thiện Phúc | `FriendService` = signal **mảng hardcode** | UI + tương tác client |
| Chat | `/chat/:id`, `/channels/:s/:c` | Thiện Phúc | `ChatStore` in-memory, rỗng khi khởi tạo | UI + gửi tin in-memory |
| Dashboard | `/dashboard` | Thiện Phúc | HTML tĩnh 100% | UI + link điều hướng |
| Settings | `/settings` → `app/khang/` | Hoàng Khang | 1463 dòng HTML tĩnh | UI |
| Profile | `/profile` → `app/k-profile/` | Hoàng Khang | 252 dòng HTML tĩnh | UI |

**Backend chỉ có module `auth`** — không có friends/chat/servers/profile/settings. Vì vậy
"test toàn bộ chức năng" thực tế = **auth test được hành vi thật**, các trang còn lại chỉ test
được **UI/điều hướng/tương tác client-side**, không có tiêu chí Data để đánh giá.

**Ngoài scope lần này**: livestream (chưa có route), voice/video, socket real-time
(`core/services/socket.ts` trỏ `io('http://localhost:3000')` nhưng BE chưa có gateway).

---

## Phase 1: Hạ tầng Playwright + smoke test điều hướng
Status: APPROVED

Mục tiêu (gắn với 1+ trong 3 tiêu chí UI/UX - Feature - Data):
- **Feature**: cài Playwright, chạy được `npm run e2e`, tự khởi động dev server khi test.
- **Feature**: smoke test — mọi route đang khai báo đều load, không lỗi console, không trắng trang.
- **Data**: helper seed/xoá tài khoản test qua Supabase admin API (không đụng schema, không
  dùng tài khoản thật của mentor).

File/folder dự kiến:
- frontend: `playwright.config.ts`, `e2e/fixtures/auth.fixture.ts`, `e2e/helpers/test-user.ts`,
  `e2e/smoke.spec.ts`, sửa `package.json` (thêm devDependency + script `e2e`), `.gitignore`
  (bỏ qua `playwright-report/`, `test-results/`).
- backend: không đổi code. Helper đọc `fizzle-be/.env` để lấy Supabase key khi seed user.

Tiêu chí hoàn thành (Definition of Done):
- `npm run e2e` chạy được từ thư mục `fizzle-fe`.
- Smoke test phủ đủ 6 route: `/auth/login`, `/auth/register`, `/auth/forgot-password`,
  `/friends`, `/dashboard`, `/settings`, `/profile`.
- Tài khoản test được tạo trước và **xoá sạch sau khi chạy** — không để rác trên Supabase.
- Không sửa bất kỳ file nào thuộc `features/`, `khang/`, `k-profile/`.

Test case dự kiến:
- Unit test: không có (phase hạ tầng, BE không đổi).
- E2E Playwright: mỗi route → trả HTTP 200, render đúng heading đặc trưng, console không có
  lỗi đỏ; route được bảo vệ thì redirect đúng khi chưa đăng nhập.

### Kết quả Phase 1
- Ngày hoàn thành: 2026-08-20
- Commit: CHƯA commit (mentor chọn ④ — giữ local, chờ quyết hướng git; working tree
  còn lẫn fix auth register-redirect + artifact npx skills, sẽ loại khi commit).
- Kết quả test: unit `0/0` (phase hạ tầng, không có unit) · E2E Playwright `7/7 pass`
  (smoke 7 route) + kiểm chứng helper `1/1 pass` (spec tạm, đã xoá).
- Đánh giá theo 3 tiêu chí:
  - [x] **UI/UX** — N/A cho phase hạ tầng (không đụng UI). Smoke chỉ khẳng định
    không trang nào vỡ trắng / crash khi mở.
  - [x] **Feature** — Playwright 1.62.1 + Chromium đã cài; `npm run e2e` chạy được;
    7 route smoke pass; guard: `/friends`,`/dashboard` đẩy về login đúng; helper
    tạo/xoá tài khoản test round-trip OK.
  - [x] **Data** — helper tạo tài khoản qua Supabase Admin API, KHÔNG đổi schema
    (chỉ INSERT/DELETE bảng `profiles` sẵn có); xoá sạch (login trả 401 sau xoá).
- Migration DB: chưa cần (không đổi schema).
- Vấn đề phát sinh / ghi chú (findings để xử lý ở phase sau):
  1. `/settings`, `/profile` CHƯA có authGuard — người chưa đăng nhập vẫn vào được
     (smoke đang khẳng định đúng hiện trạng này; đổi test khi mentor thêm guard).
  2. Card server ở dashboard trỏ `/server/se-hub`, `/server/mc-lounge` — route không
     tồn tại (kiểm chính thức ở Phase 3).
  3. Bug register dead-end (confirm-email tắt) đã vá tay phiên này — cần test chặn
     tái diễn ở Phase 2.
- PR: chưa tạo.

---

## Phase 2: E2E luồng Auth (phần có backend thật)
Status: APPROVED

Mục tiêu:
- **Feature**: phủ đủ luồng đăng nhập, đăng ký + OTP, quên mật khẩu, đăng xuất.
- **Feature**: guard hai chiều — chưa đăng nhập vào `/friends` bị đẩy về login kèm `redirectTo`;
  đã đăng nhập vào `/auth/login` bị đẩy vào trong.
- **Feature**: session restore — F5 sau khi đăng nhập vẫn giữ phiên (đã sửa ở phiên trước).
- **Data**: sai mật khẩu trả 401 `INVALID_CREDENTIALS`, không lộ email tồn tại hay không;
  response login không chứa refresh token (chỉ nằm trong cookie HTTP-only).

File/folder dự kiến:
- frontend: `e2e/auth/login.spec.ts`, `e2e/auth/register.spec.ts`,
  `e2e/auth/forgot-password.spec.ts`, `e2e/auth/session.spec.ts`.
- backend: không đổi code (chỉ gọi API qua HTTP để lấy OTP bằng admin API).

Tiêu chí hoàn thành:
- Đăng nhập đúng → vào được trang trong; sai → hiện đúng thông báo lỗi tiếng Việt.
- Đăng ký → nhận OTP qua Supabase admin `generate_link` (không cần hộp thư thật) → xác thực xong vào app.
- Quên mật khẩu → đổi mật khẩu → đăng nhập lại bằng mật khẩu mới thành công, mật khẩu cũ bị từ chối.
- Validate phía client: email sai định dạng, mật khẩu yếu, ngày sinh dưới 13 tuổi đều chặn đúng.

Test case dự kiến:
- Unit test: không thêm mới (BE không đổi trong phase này).
- E2E Playwright: ~14 case trải 4 file spec nêu trên.

### Kết quả Phase 2
- Ngày hoàn thành:
- Commit: frontend `<sha>` · backend `<sha>`
- Kết quả test: unit `<x/y>` · E2E Playwright `<x/y>`
- Đánh giá theo 3 tiêu chí:
  - [ ] **UI/UX** —
  - [ ] **Feature** —
  - [ ] **Data** —
- Migration DB: chưa cần.
- Vấn đề phát sinh / ghi chú:
- PR:

---

## Phase 3: E2E Dashboard / Friends / Chat (trang Thiện Phúc — mức UI)
Status: PENDING

Mục tiêu:
- **UI/UX**: main-layout render đủ sidebar + rail; đổi route thì phần active đổi theo.
- **Feature**: friends — lọc theo tab, mở chat 1-1 từ danh sách bạn; chat — gõ và gửi tin nhắn
  hiện ra trong khung (in-memory), xoá tin nhắn hoạt động; dashboard — click card server điều
  hướng đúng.
- **Data**: KHÔNG đánh giá — các trang này chưa có backend, dữ liệu là mảng hardcode trong
  `core/services/friend.ts` / `server.ts`. Ghi rõ giới hạn này trong kết quả.

File/folder dự kiến:
- frontend: `e2e/dashboard/friends.spec.ts`, `e2e/dashboard/chat.spec.ts`,
  `e2e/dashboard/dashboard.spec.ts`.
- backend: không đổi.

Tiêu chí hoàn thành:
- Test bám vào dữ liệu hardcode hiện có, và **ghi chú rõ** test sẽ phải viết lại khi nối API thật.
- Phát hiện & báo cáo link hỏng nếu có (vd card dashboard trỏ `/server/se-hub` — route không tồn tại).

Test case dự kiến:
- Unit test: không có (BE chưa có module tương ứng).
- E2E Playwright: ~10 case.

### Kết quả Phase 3
- Ngày hoàn thành:
- Commit: frontend `<sha>` · backend `<sha>`
- Kết quả test: unit `<x/y>` · E2E Playwright `<x/y>`
- Đánh giá theo 3 tiêu chí:
  - [ ] **UI/UX** —
  - [ ] **Feature** —
  - [ ] **Data** — N/A, chưa có backend
- Migration DB: chưa cần.
- Vấn đề phát sinh / ghi chú:
- PR:

---

## Phase 4: E2E Settings / Profile (trang Hoàng Khang — mức UI)
Status: PENDING

Mục tiêu:
- **UI/UX**: `/settings` và `/profile` render đủ khối chính, chuyển tab/section hoạt động,
  responsive không vỡ ở 1280px và 375px.
- **Feature**: các control tĩnh (toggle, tab, nút) phản hồi đúng ở mức client.
- **Data**: KHÔNG đánh giá — chưa nối backend.

File/folder dự kiến:
- frontend: `e2e/khang/settings.spec.ts`, `e2e/khang/profile.spec.ts`.
- backend: không đổi.

Tiêu chí hoàn thành:
- Phủ các section chính của settings và profile.
- **Báo cáo rủi ro**: `/settings` và `/profile` hiện **không có `authGuard`** — người chưa đăng
  nhập vẫn vào được. Test sẽ ghi nhận hiện trạng này; sửa hay không là quyết định của mentor
  (thuộc trang Hoàng Khang, tôi không tự sửa).

Test case dự kiến:
- Unit test: không có.
- E2E Playwright: ~8 case.

### Kết quả Phase 4
- Ngày hoàn thành:
- Commit: frontend `<sha>` · backend `<sha>`
- Kết quả test: unit `<x/y>` · E2E Playwright `<x/y>`
- Đánh giá theo 3 tiêu chí:
  - [ ] **UI/UX** —
  - [ ] **Feature** —
  - [ ] **Data** — N/A
- Migration DB: chưa cần.
- Vấn đề phát sinh / ghi chú:
- PR:

---

## Phase 5: Hồi quy toàn bộ + báo cáo bàn giao
Status: PENDING

Mục tiêu:
- **Feature**: chạy lại toàn bộ spec của Phase 1-4 trong một lần, đảm bảo không phase nào phá phase nào.
- Xuất báo cáo HTML của Playwright + bảng tổng hợp lỗi phát hiện được, phân loại theo **trang
  của member nào** để mentor giao lại đúng người sửa.

File/folder dự kiến:
- frontend: `e2e/README.md` (hướng dẫn chạy cho member), cập nhật plan.
- backend: cập nhật bản plan tương ứng.

Tiêu chí hoàn thành:
- Toàn bộ suite chạy được bằng 1 lệnh, kết quả ổn định (không flaky) qua 2 lần chạy liên tiếp.
- Có danh sách bug kèm chủ sở hữu trang.

Test case dự kiến:
- Chạy lại tất cả spec đã viết.

### Kết quả Phase 5
- Ngày hoàn thành:
- Commit: frontend `<sha>` · backend `<sha>`
- Kết quả test: unit `<x/y>` · E2E Playwright `<x/y>`
- Đánh giá theo 3 tiêu chí:
  - [ ] **UI/UX** —
  - [ ] **Feature** —
  - [ ] **Data** —
- Migration DB: chưa cần.
- Vấn đề phát sinh / ghi chú:
- PR:

---

## Nhật ký duyệt & hoàn thành
| Phase | Duyệt lúc | Hoàn thành lúc | Test pass | Commit |
| --- | --- | --- | --- | --- |
| 1 | 2026-08-20 | 2026-08-20 | E2E 7/7 + helper 1/1 | chưa commit |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |

---

## Tổng kết trang (điền ở Bước 9)
- Ngày hoàn thành:
- Tổng số phase đã làm:
- Kết quả hồi quy toàn bộ: unit `<x/y>` · E2E Playwright `<x/y>`
- Đánh giá tổng thể theo 3 tiêu chí:
  - **UI/UX**:
  - **Feature**:
  - **Data**:
- Migration DB đã dùng: không có (bộ test không đổi schema).
- Phần còn thiếu / để lại cho sau:
- PR cuối cùng:
