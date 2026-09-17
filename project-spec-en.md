# Course/Section Matching Web App — Project Spec

## 1. Project Overview

A web application for university students (restricted to `@msu.ac.th` email addresses) to find classmates in the same course/section, and to find group members for coursework in General Education (GE) courses — courses that mix students from all 4 academic years together, where approaching strangers (especially juniors approaching seniors) is socially difficult.

**Problem this solves:** Students currently post "looking for classmates" messages in university Facebook/Instagram groups, but these posts get buried instantly by newer posts, making them impossible to find later. There's no persistent, searchable, course-specific way to find classmates.

**This is a university mini-project with a 2–3 week timeline.** Prioritize a fully working core feature set over polish or extra features. Do not add features beyond what is specified below without asking first.

**Tech stack requirement (must use exactly this):**
- **Frontend framework: Next.js (React)** — this is a strict requirement, not optional. Use the Next.js App Router.
- Styling: Tailwind CSS
- Backend/Database: Firebase (Firebase Authentication + Cloud Firestore)
- Hosting target: Vercel or Firebase Hosting

---

## 2. Explicitly Out of Scope (do NOT implement, even if it seems like a natural addition)

- No profile picture upload — users select from a pre-made set of cartoon avatars instead. **Do not use Firebase Storage at all.**
- No gender field
- No social media link fields (no Facebook/Instagram links)
- No study-group / tutoring-matching feature (planned for a future version, not this one)
- No "cancel request" button
- No timeout/expiration for pending requests
- No admin panel for editing the course list

---

## 3. Design Theme

- **Primary colors:** White `#FFFFFF` and Yellow `#FFCD22`
- **Button style:** Rounded, bubble-like, soft shadows — buttons should feel soft and tactile, not sharp/flat
- **Overall tone:** Clean, minimal, uncluttered, few buttons per screen
- **Main layout — modeled after Google Classroom:**
  - **Left sidebar:** list of "previously searched courses" (the user's saved filters). Clicking one re-runs that exact search query.
  - **Main content area:** rectangular rounded "bubble cards," each showing one other student's info, with a "Send Request" button inside the card.
  - **Tab switcher** (top or bottom of main area): toggles between "Find Classmate" and "Find Group" views.
- **Avatars:** a pre-made set of ~10–15 cartoon avatar images matching the yellow/white theme, selectable at signup. Store only an `avatarId` reference — never an uploaded image.

---

## 4. Authentication

- Use Firebase Authentication with the Google Sign-In provider.
- **Login must be restricted to `@msu.ac.th` email addresses only.**
- Implementation: after a successful Google sign-in, check `user.email.endsWith('@msu.ac.th')` on the client. If it does not match, immediately call `signOut()` and show an error: "Please sign in with your university email."
- Optional enhancement: if `msu.ac.th` is confirmed to be a Google Workspace domain, add the `hd: 'msu.ac.th'` parameter to `GoogleAuthProvider` to pre-filter at the Google login screen — but the `endsWith` check above must always remain as a mandatory fallback regardless.

---

## 5. Data Model (Cloud Firestore)

> **Important design note — denormalization:** Firestore has no JOINs. Profile fields (nickname, year, faculty, major, avatar) must be **denormalized (copied)** into `listings` and `groupPosts` documents at the moment of submission, as a snapshot. If a user edits their profile later, previously submitted listings/posts will **not** update to reflect the change. This is an accepted, intentional limitation for this project — do not attempt to build a sync mechanism for it.

### 5.1 Collection: `users/{uid}`
```
studentId: string        // derived from the email prefix before @
email: string
nickname: string
year: number              // 1–4
faculty: string
major: string
skills: string            // "ความถนัด" — what the student is good at
personality: string       // "ลักษณะนิสัย" — personality traits
avatarId: string
savedFilters: array       // [{ courseCode, courseName, section }, ...]
createdAt: timestamp
```

### 5.2 Collection: `listings/{listingId}` — "Find Classmate" feature
- **`listingId` must be a deterministic ID:** `${uid}_${courseCode}_${section}`. This overwrites any prior listing from the same user for the same course+section, preventing duplicates if the user submits the form more than once.
```
uid: string
courseCode: string
courseName: string         // denormalized from the course list (see section 6)
section: string
nickname: string           // snapshot from users
year: number               // snapshot
faculty: string            // snapshot
major: string               // snapshot
skills: string               // snapshot
personality: string          // snapshot
avatarId: string              // snapshot
createdAt: timestamp
```

### 5.3 Collection: `groupPosts/{postId}` — "Find Group" feature
- `postId` must also be a deterministic ID: `${uid}_${courseCode}_${section}_group`
```
uid: string
courseCode: string
courseName: string
section: string
mode: "need_members" | "need_group"   // "looking for people to join my group" vs "looking for a group to join"
description: string        // skills offered / role needed, free text
spotsNeeded: number | null  // only used when mode == "need_members"
nickname: string            // snapshot
year: number                 // snapshot
faculty: string               // snapshot
major: string                 // snapshot
avatarId: string                // snapshot
createdAt: timestamp
```

### 5.4 Collection: `requests/{requestId}` — shared by both "Find Classmate" and "Find Group"
- **`requestId` must be a deterministic ID:** `${fromUid}_${toUid}_${sourceId}`
```
fromUid: string
toUid: string
sourceType: "listing" | "groupPost"
sourceId: string            // the listingId or postId this request was sent from
status: "pending" | "accepted" | "rejected"
chatId: string | null       // populated once status becomes "accepted"
createdAt: timestamp
```

**Spam-prevention logic (mandatory — implement exactly this):**
- Before creating a new request, always read the document at the deterministic ID first.
- If it already exists with `status == "pending"` → **block sending again.** Disable the send button and show "Request already pending."
- If it already exists with `status == "rejected"` → **allow re-sending.** Overwrite the same document and reset `status` back to `"pending"`.
- The recipient must see two separate, distinct actions: **"Accept"** and **"Reject."** Clicking "Reject" immediately removes the request from the recipient's inbox view (the document still exists in the database with `status: "rejected"`, it's just filtered out of the UI).
- There is intentionally **no cancel button** for the sender and **no timeout** — a pending request with no response stays pending indefinitely. This is an accepted product decision, not a bug.

### 5.5 Collection: `chats/{chatId}` + subcollection `messages`
```
chats/{chatId}
  participants: [uidA, uidB]
  createdAt: timestamp

chats/{chatId}/messages/{messageId}
  senderId: string
  text: string
  createdAt: timestamp
  expireAt: timestamp        // = createdAt + 24 hours, computed client-side when the message is sent
```

---

## 6. Course List (static — hardcode as a constant file, do NOT create a Firestore collection for this)

Create a file `courses.js` (or `.ts`) containing this exact array. This is used for **client-side validation only** — never query Firestore for course lookups.

```javascript
export const COURSES = [
  { code: "0041001", name: "ภาษาอังกฤษเพื่อเตรียมความพร้อม" },
  { code: "0041002", name: "ภาษาอังกฤษเพื่อการสื่อสาร" },
  { code: "0041003", name: "ภาษาอังกฤษเพื่อความมุ่งหมายเฉพาะด้านมนุษยศาสตร์และสังคมศาสตร์" },
  { code: "0041004", name: "ภาษาอังกฤษเพื่อความมุ่งหมายเฉพาะด้านวิทยาศาสตร์และเทคโนโลยี" },
  { code: "0041005", name: "ภาษาอังกฤษเพื่อความมุ่งหมายเฉพาะด้านวิทยาศาสตร์สุขภาพ" },
  { code: "0041006", name: "ภาษาอังกฤษเพื่อการเตรียมความพร้อมในการประกอบอาชีพ" },
  { code: "0041007", name: "ภาษาอังกฤษสำหรับสื่อและความเป็นสากล" },
  { code: "0041008", name: "ภาษาอังกฤษสำหรับผู้สร้างสรรค์เนื้อหาสื่อสังคม" },
  { code: "0041009", name: "ภาษาอังกฤษสำหรับผู้ประกอบการออนไลน์" },
  { code: "0041010", name: "ภาษาอังกฤษสำหรับนักเดินทางรอบโลก" },
  { code: "0041011", name: "ภาษาอังกฤษเพื่อการนำเสนอเชิงวิชาการ" },
  { code: "0041012", name: "ภาษาไทยบูรณาการเพื่อการเตรียมความพร้อมในการประกอบอาชีพ" },
  { code: "0041013", name: "ภาษาไทยประยุกต์เพื่อความสุขและความคิดสร้างสรรค์" },
  { code: "0041014", name: "ภาษาจีนเพื่อการสื่อสาร" },
  { code: "0041015", name: "ภาษาเกาหลีเพื่อการสื่อสาร" },
  { code: "0041016", name: "ภาษาญี่ปุ่นเพื่อการสื่อสาร" },
  { code: "0041017", name: "ภาษาเวียดนามเพื่อการสื่อสาร" },
  { code: "0041018", name: "ภาษาเขมรเพื่อการสื่อสาร" },
  { code: "0041019", name: "ภาษาพม่าเพื่อการสื่อสาร" },
  { code: "0041020", name: "ภาษาลาวเพื่อการสื่อสาร" },
  { code: "0041021", name: "ภาษาฝรั่งเศสเพื่อการสื่อสาร" },
  { code: "0041023", name: "พลเมืองดิจิทัล" },
  { code: "0041024", name: "โปรแกรมประยุกต์สำหรับสำนักงานดิจิทัล" },
  { code: "0041025", name: "การคิดแก้ปัญหาแบบตรรกศาสตร์เบื้องต้น" },
  { code: "0041026", name: "การวิเคราะห์และการนำเสนอข้อมูลเบื้องต้น" },
  { code: "0041027", name: "คอนเทนต์และสื่อดิจิทัล" },
  { code: "0041028", name: "วิทยาศาสตร์สมัยใหม่และนวัตกรรมเพื่อชีวิต" },
  { code: "0041029", name: "วิศวกรรมในชีวิตประจำวัน" },
  { code: "0042001", name: "ประชากรโลก ไร้โรค" },
  { code: "0042002", name: "ตระหนักรู้เรื่องสุขภาพ" },
  { code: "0042003", name: "การดูแลและการสร้างเสริมสุขภาพแบบองค์รวม" },
  { code: "0042004", name: "การดูแลสุขภาพแต่ละช่วงวัย" },
  { code: "0042005", name: "อาหารและการออกกำลังกายเพื่อสุขภาพและความงาม" },
  { code: "0042006", name: "ฉลาดบริโภคยาและผลิตภัณฑ์สุขภาพ" },
  { code: "0042007", name: "การเรียนร่วมสหวิชาชีพเพื่อสุขภาพชุมชน" },
  { code: "0042008", name: "ทักษะชีวิต" },
  { code: "0042009", name: "บุคลิกภาพเพื่อความสัมพันธ์ในสังคม" },
  { code: "0042010", name: "ฝ่าวิกฤตภัยพิบัติ" },
  { code: "0042011", name: "วิถีชีวิตที่เป็นมิตรกับสิ่งแวดล้อม" },
  { code: "0042012", name: "การจัดที่อยู่อาศัยเพื่อเสริมสร้างคุณภาพชีวิต" },
  { code: "0042013", name: "กัญชาวิทยา" },
  { code: "0042014", name: "สัตว์เลี้ยงกับชีวิต" },
  { code: "0043001", name: "การคิดเชิงออกแบบ" },
  { code: "0043002", name: "การจัดการความคิดสร้างสรรค์และนวัตกรรม" },
  { code: "0043003", name: "การลงทุนอย่างชาญฉลาด" },
  { code: "0043004", name: "ผู้ประกอบการรุ่นเยาว์" },
  { code: "0043005", name: "ผู้ประกอบการทางสังคม" },
  { code: "0043006", name: "ธุรกิจออนไลน์" },
  { code: "0043007", name: "แก่นการนำเสนออย่างตรงเป้า" },
  { code: "0043008", name: "การเงินส่วนบุคคล" },
  { code: "0043009", name: "การดำรงชีวิตอัจฉริยะ" },
  { code: "0043010", name: "นวัตกรรมเกษตรและอาหาร" },
  { code: "0044001", name: "พันธกิจมหาวิทยาลัยกับชุมชน" },
  { code: "0044002", name: "ผู้นำการเปลี่ยนแปลง" },
  { code: "0044003", name: "พลเมืองเพื่อความอยู่ดีมีสุข" },
  { code: "0044004", name: "กฎหมายและการใช้สิทธิในชีวิตประจำวัน" },
  { code: "0044005", name: "กฎหมายในการประกอบอาชีพ" },
  { code: "0044006", name: "ศาสตร์พระราชากับการพัฒนาที่ยั่งยืน" },
  { code: "0044007", name: "ศาสนาและการใช้เหตุผลเพื่อการดำรงชีวิต" },
  { code: "0044008", name: "ชีวิตและสันติสุข" },
  { code: "0044009", name: "สมาธิเพื่อพัฒนาชีวิต" },
  { code: "0044010", name: "จิตอาสาสิ่งแวดล้อม" },
  { code: "0045001", name: "ศิลปะกับชีวิต" },
  { code: "0045002", name: "ดนตรีและศิลปะการแสดงอีสาน" },
  { code: "0045003", name: "ภูมิปัญญาเพื่อคุณภาพชีวิต" },
  { code: "0045004", name: "รู้จักอาเซียน" },
  { code: "0045005", name: "มนุษย์กับความหลากหลายทางสังคมและวัฒนธรรม" },
  { code: "0045006", name: "พหุวัฒนธรรมลุ่มน้ำโขง" },
  { code: "0045007", name: "อีสานทันโลก" },
  { code: "0045008", name: "การบริหารจัดการวัฒนธรรมและการแปรรูปวัฒนธรรมเป็นสินค้า" },
  { code: "0045009", name: "การท่องเที่ยวเชิงวัฒนธรรม" },
  { code: "0045010", name: "อาหารและเครื่องดื่มจากภูมิปัญญาพื้นบ้าน" },
  { code: "0045011", name: "ภูมิปัญญาและนวัตกรรมผ้าทออีสาน" },
  { code: "0045012", name: "พระเครื่องสนาม การวิเคราะห์และอนุรักษ์" },
  { code: "0045013", name: "คติความเชื่อตะวันออกสำหรับการอยู่อาศัย" },
  { code: "0045014", name: "การบริหารจัดการภูมิทัศน์ท้องถิ่น" },
];
```

**"Section" (`section` field) is a free-text field the user types in themselves — do NOT validate it against any list.** Section numbers change every semester and are not fixed, unlike course codes.

**Validation flow:**
1. User types or selects a course code (recommend an autocomplete dropdown component, not a plain text input, to reduce typos)
2. Check the input against the `COURSES` array immediately, client-side (no server round-trip)
3. If found → auto-fill and display the course name for confirmation
4. If not found → show the error message **"ไม่พบวิชาตามรหัสที่ผู้ใช้กรอก"** ("No course found matching this code") and disable the submit button until corrected

---

## 7. Feature Flows

### 7.1 Sign-up / First-time Profile Setup
1. Sign in with Google → verify domain as described in section 4
2. If this is the user's first login (no existing `users/{uid}` document), show a profile setup form collecting: nickname, year, faculty, major, skills, personality
3. Let the user pick an avatar from the pre-made set
4. Save all of this to `users/{uid}`

### 7.2 Find Classmate
1. From the home screen, user selects the "Find Classmate" tab
2. User fills in: course code (autocomplete + validated against `COURSES`), section (free text), and optionally desired faculty/major filters
3. On submit → create or overwrite `listings/{uid}_{courseCode}_{section}` (per section 5.2) → also append this filter to the user's `savedFilters` array in `users/{uid}`
4. Navigate to the results view: query `listings` where `courseCode` and `section` match; apply faculty/major filtering client-side if the user specified them
5. Render results as rounded bubble cards, each with a "Send Request" button (respecting the spam-prevention logic in section 5.4)
6. The left sidebar always shows the user's `savedFilters` — clicking one re-runs that exact query

### 7.3 Find Group
- Identical flow to 7.2, except it writes to `groupPosts` instead of `listings`
- Before the course/section form, the user first picks a mode: **"Looking for members"** (also collects `spotsNeeded` and `description`) or **"Looking for a group"** (collects `description` only)

### 7.4 Request System (shared logic used by both 7.2 and 7.3)
1. Clicking "Send Request" on a card creates a `requests` document following the exact logic in section 5.4
2. The recipient sees the incoming request in their inbox, with "Accept" and "Reject" buttons
3. On **Accept** → create a new `chats` document (or reuse an existing one between these two users if it already exists) → set `chatId` on the request document → navigate the user to the chat screen
4. On **Reject** → set `status` to `"rejected"` → the request disappears from the recipient's inbox view

### 7.5 Chat
- Real-time messaging via a Firestore `onSnapshot` listener on `chats/{chatId}/messages`
- When sending a message, compute `expireAt = now + 24 hours` and store it alongside the message
- Expired messages are deleted automatically via a **Firestore TTL Policy** — this is configured in the Firebase Console only, and must NOT be implemented as a Cloud Function or scheduled job. Do not write any server-side deletion code for this.

---

## 8. Firestore Security Rules (required — write these, and flag them clearly for manual review before deployment)

- `users/{uid}`: readable by any authenticated user; writable only by the document owner (`request.auth.uid == uid`)
- `listings`, `groupPosts`: readable by any authenticated user; writable only by the owner (`request.auth.uid == resource.data.uid`)
- `requests`: readable and writable only by the user whose `uid` matches either `fromUid` or `toUid` on that document
- `chats/{chatId}/messages`: readable and writable only by users listed in that chat's `participants` array

**⚠️ Critical:** After generating these rules, explicitly flag to the user that they must test — before real deployment — that a user cannot read another user's chat messages or another user's private request data. Do not assume the rules are correct without this being called out.

---

## 9. Known, Accepted Limitations (do not attempt to fix these — they are intentional trade-offs for a 2–3 week mini-project scope)

- Editing a profile does not retroactively update previously submitted `listings` or `groupPosts` (denormalized snapshot data).
- A rejected request can be re-sent immediately with no cooldown period, which could theoretically be used to spam the same person repeatedly. This risk is accepted because all users are verified students of the same university (not anonymous internet users).
- There is no admin panel to edit the course list — updating it requires a code change and redeploy.
- No photo upload, no gender field, no social media links, no study-group matching feature — all explicitly out of scope per section 2.

---

## 10. Build Order (please follow this order and pause for review between steps — do not build everything in one pass)

1. Next.js project scaffold + Firebase SDK connection setup
2. Google Sign-In + domain restriction (section 4)
3. First-time profile setup form (section 7.1)
4. "Find Classmate" feature: form, listing creation, results view, sidebar of saved filters (section 7.2)
5. "Find Group" feature (section 7.3)
6. Request system: send/accept/reject logic (section 7.4 + spam-prevention logic in 5.4)
7. Chat feature with TTL-based expiry (section 7.5)
8. Firestore Security Rules (section 8) — flag for manual testing before deployment
