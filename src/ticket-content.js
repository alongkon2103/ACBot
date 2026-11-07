import { ActionRowBuilder, ButtonBuilder, ButtonStyle, LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
export const topics = {
  join: ['ติดต่อเข้าสังกัด', 'สวัสดีครับ ขอบคุณที่สนใจเข้าร่วม AC Entertainment นะครับ\n\nช่วยบอกชื่อเล่น อายุ และชื่อช่อง TikTok หรือ @บัญชีให้หน่อยครับ\nเคยไลฟ์เกมมาก่อนบ้างไหมครับ?'],
  bug: ['แจ้งบัค / ปัญหาการใช้งาน', 'เจอปัญหากับเกมหรือโปรแกรมอะไรครับ?\nช่วยเล่าอาการที่เจอและบอกหน่อยว่าเกิดขึ้นตอนไหน ถ้ามีรูปหน้าจอหรือคลิป ส่งมาในห้องนี้ได้เลยครับ'],
  income: ['สอบถามโบนัส / รายได้', 'อยากสอบถามเรื่องโบนัสหรือรายได้ส่วนไหนครับ?\nฝากชื่อช่อง TikTok กับรายละเอียดที่อยากทราบไว้ได้เลยครับ'],
  install: ['ขอความช่วยเหลือติดตั้ง', 'กำลังติดตั้งเกมหรือโปรแกรมอะไรอยู่ครับ แล้วติดปัญหาตรงไหน?\nถ้าอยากให้แอดมินช่วยดูผ่านหน้าจอ บอกเวลาที่สะดวกไว้ได้เลยครับ'],
  admin: ['ติดต่อแอดมิน', 'ฝากชื่อช่อง TikTok กับเรื่องที่อยากติดต่อไว้ได้เลยครับ เดี๋ยวทีมงานเข้ามาตอบเมื่อพร้อมให้บริการครับ'],
  info: ['สอบถามข้อมูลสังกัด', ''],
};
const button = (id, label, style = ButtonStyle.Secondary) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
const row = items => new ActionRowBuilder().addComponents(items);
export const ticketPanelButtons = () => [row([button('ticket:open:join', 'สมัครเข้าสังกัด')])];
export function ticketMenu(owner) {
  const buttons = Object.entries(topics).map(([key, [title]]) => button(`ticket:topic:${key}`, title));
  return [row(buttons.slice(0, 3)), row(buttons.slice(3)), row([button(`ticket:close:${owner}`, 'ปิดตั๋ว', ButtonStyle.Danger)])];
}
export function responseEditor(i, c) {
  return new ModalBuilder().setCustomId(`cfg:ticket:saveresponses:${i.user.id}`).setTitle('ข้อความตอบกลับใน Ticket').addLabelComponents(
    ...Object.entries(topics).filter(([key]) => key !== 'info').map(([key, [title, body]]) => new LabelBuilder().setLabel(title)
      .setTextInputComponent(new TextInputBuilder().setCustomId(key).setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2000).setValue(c.responses?.[key] ?? body))));
}
export function websiteEditor(i, c) {
  const input = new TextInputBuilder().setCustomId('website').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(500).setPlaceholder('https://example.com');
  if (c.website) input.setValue(c.website);
  return new ModalBuilder().setCustomId(`cfg:ticket:savewebsite:${i.user.id}`).setTitle('เว็บไซต์สังกัด').addLabelComponents(new LabelBuilder().setLabel('ลิงก์เว็บไซต์ (เว้นว่างเพื่อล้างค่า)').setTextInputComponent(input));
}
export function topicPayload(c, topic, userId) {
  if (!topics[topic]) throw Error('ไม่พบหัวข้อนี้');
  const [, fallback] = topics[topic];
  const body = topic === 'info' ? c.website ? `ดูข้อมูลสังกัดได้ที่นี่เลยครับ\n${c.website}` : 'ลิงก์เว็บไซต์สังกัดยังไม่ได้ตั้งค่าไว้ครับ ระหว่างนี้สอบถามทีมงานในห้องนี้ได้เลย' : c.responses?.[topic] ?? fallback;
  return { content: `<@${userId}> ${body}`, allowedMentions: { parse: [], users: [userId] }, flags: 4 };
}
