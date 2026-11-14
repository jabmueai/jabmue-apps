# จับมือ AI · แอปที่ทำในคลิป

แอปทุกตัวในนี้ AI เขียนให้ทั้งหมดจาก prompt เดียว ไม่ได้แก้โค้ดเอง กดลิงก์เล่นได้เลย หรือ copy prompt ไปลองทำเองก็ได้

📲 ทุกแอปติดตั้งลงมือถือได้เหมือนแอปจริง (มีไอคอน เปิดเต็มจอ ใช้ตอนไม่มีเน็ตได้หลังเปิดครั้งแรก)
- iPhone: เปิดลิงก์ใน Safari → ปุ่มแชร์ → เพิ่มไปยังหน้าจอโฮม
- Android: เปิดลิงก์ใน Chrome → เมนู ⋮ → ติดตั้งแอป (หรือ เพิ่มลงในหน้าจอหลัก)

ไอคอน, `manifest.webmanifest` และ `sw.js` ของแต่ละแอปเพิ่มทีหลังเพื่อให้ติดตั้งได้ ส่วนโค้ดแอปเหมือนที่ AI เขียนทุกอย่าง

| คลิป | ลองเล่น | โค้ด | prompt |
|---|---|---|---|
| จับมือทำแอป ตอน 1: นาฬิกาแปรงฟันให้ลูก 🪥 (Gemini Canvas) | [เล่นเลย](https://jabmueai.github.io/jabmue-apps/brush/) | [brush/index.html](brush/index.html) | [brush/prompt.txt](brush/prompt.txt) |
| จับมือทำแอป ตอน 2: กระปุกออมเงินให้ลูก 🐷 (Gemini Canvas) | [เล่นเลย](https://jabmueai.github.io/jabmue-apps/piggy/) | [piggy/index.html](piggy/index.html) | [piggy/prompt.txt](piggy/prompt.txt) |
| จับมือทำแอป ตอน 3: ตารางงานบ้านสะสมดาวให้ลูก ⭐ (Gemini Canvas) | [เล่นเลย](https://jabmueai.github.io/jabmue-apps/chores/) | [chores/index.html](chores/index.html) | [chores/prompt.txt](chores/prompt.txt) |
| จับมือทำแอป ตอน 4: ส่งสลิปให้ AI สรุปรายจ่ายเดือนนี้ 🧾 (Gemini Canvas · สลิปตัวอย่างใน [slips/samples](slips/samples)) | [เล่นเลย](https://jabmueai.github.io/jabmue-apps/slips/) | [slips/index.html](slips/index.html) | [slips/prompt.txt](slips/prompt.txt) |
| จับมือทำแอป ตอน 5: แอปเตือนพ่อแม่กินยา 💊 (Gemini Canvas) | [เล่นเลย](https://jabmueai.github.io/jabmue-apps/meds/) | [meds/index.html](meds/index.html) | [meds/prompt.txt](meds/prompt.txt) |
| จับมือทำแอป ตอน 6: แอปเก็บใบเสร็จลดหย่อนภาษี 🧾 (Gemini Canvas · ใบเสร็จในแอปเป็นตัวอย่าง) | [เล่นเลย](https://jabmueai.github.io/jabmue-apps/receipts/) | [receipts/index.html](receipts/index.html) | [receipts/prompt.txt](receipts/prompt.txt) |
| จับมือทำแอป ตอน 7: แอปหารค่าทริปกับเพื่อน 🧳 (Gemini Canvas · ชื่อเพื่อนในแอปเป็นตัวอย่าง) | [เล่นเลย](https://jabmueai.github.io/jabmue-apps/trip/) | [trip/index.html](trip/index.html) | [trip/prompt.txt](trip/prompt.txt) |
| จับมือทำแอป ตอน 8: แอปจดความดัน 🩺 (Gemini Canvas · ถ่ายรูปหน้าจอเครื่องวัดให้ AI อ่านค่า · รูปและตัวเลขเป็นตัวอย่าง ไม่ใช่การวินิจฉัย) | [เล่นเลย](https://jabmueai.github.io/jabmue-apps/bp/) | [bp/index.html](bp/index.html) | [bp/prompt.txt](bp/prompt.txt) · [รูปตัวอย่าง](bp/sample-photos) |
| จับมือทำ ตอน 3: เกมทายศัพท์ภาษาอังกฤษให้ลูก 🎮 | [เล่นเลย](https://jabmueai.github.io/jabmue-apps/word-game/) | [word-game/index.html](word-game/index.html) | [word-game/prompt.txt](word-game/prompt.txt) |
| จับมือทำ ตอน 4: แอปจดค่าไฟบ้าน ⚡ | [เล่นเลย](https://jabmueai.github.io/jabmue-apps/electric/) | [electric/index.html](electric/index.html) | [electric/prompt.txt](electric/prompt.txt) |

แอปเก็บข้อมูลไว้ในเครื่องของคนเล่นเท่านั้น (localStorage) ไม่ส่งไปที่ไหน

ทำได้จริง ทำตามได้ทุกคน 🤝 · YouTube [@jabmueai](https://www.youtube.com/@jabmueai) · TikTok [@jabmue.ai](https://www.tiktok.com/@jabmue.ai) · [Facebook](https://www.facebook.com/profile.php?id=61596056038143)
