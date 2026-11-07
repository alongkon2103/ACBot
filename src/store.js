import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, initializeData } from './data-paths.js';
initializeData();
let data;
try { data = JSON.parse(readFileSync(join(DATA_DIR, 'bot.json'), 'utf8')); }
catch (e) { if (e.code !== 'ENOENT') throw e; data = { guilds: {} }; }
export function save() {
  writeFileSync(join(DATA_DIR, 'bot.json.tmp'), JSON.stringify(data, null, 2));
  renameSync(join(DATA_DIR, 'bot.json.tmp'), join(DATA_DIR, 'bot.json'));
}
export function settings(id) {
  const config = data.guilds[id] ??= {
    welcome: { title: 'ยินดีต้อนรับสู่ {server} ✨', body: 'สวัสดี {user} 🎉\nยินดีต้อนรับเข้าสู่ครอบครัว AC Entertainment\nตอนนี้เรามีสมาชิก {count} คนแล้ว!', color: '#5865F2', enabled: false },
    goodbye: { title: 'แล้วพบกันใหม่ 👋', body: '{username} ออกจาก {server} แล้ว\nขอบคุณที่เคยเป็นส่วนหนึ่งของเรา 💙', color: '#95A5A6', enabled: false },
    ticket: { title: '🎫 ติดต่อทีมงาน AC', body: 'เลือกหัวข้อด้านล่างเพื่อเปิดห้องส่วนตัวกับทีมงาน\n\n🌟 สมัครเข้าสังกัด — พูดคุยเรื่องการร่วมงาน\n🛠️ แจ้งปัญหา — ขอความช่วยเหลือ\n🤝 ติดต่องาน — เสนอความร่วมมือ', color: '#5865F2', enabled: false, supportRoles: [], tickets: {} },
    announce: { title: '📢 ประกาศจาก AC Entertainment', body: 'เขียนรายละเอียดประกาศของคุณที่นี่', color: '#F1C40F' },
  };
  config.ticket.questions ??= {
    join: ['ชื่อ / ชื่อเล่น', 'อายุ', 'ช่อง TikTok / ลิงก์โปรไฟล์'],
    help: ['ปัญหาที่ต้องการให้ช่วย', '?รายละเอียดเพิ่มเติม'],
    work: ['ชื่อ / องค์กร', 'รายละเอียดงานที่ต้องการติดต่อ', 'ช่องทางติดต่อกลับ'],
  };
  return config;
}
