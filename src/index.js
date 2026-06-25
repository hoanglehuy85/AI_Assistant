require('dotenv').config();
const express = require('express');
const aiService = require('./aiService');
const metaService = require('./metaService');
const knowledgeManager = require('./knowledgeManager');
const googleService = require('./googleService');
const escalationManager = require('./escalationManager');
const MessageDebouncer = require('./messageDebouncer');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

let bossPrivatePsid = null;
const customerDebouncer = new MessageDebouncer(3000);  // Gộp tin khách (3 giây)
const bossDebouncer = new MessageDebouncer(3000);      // Gộp tin Sếp (3 giây)

// ===== CÂU TRẢ LỜI CỐ ĐỊNH (TEMPLATE) - KHÔNG AI VIẾT =====
const TEMPLATES = {
    GREETING: 'Chào anh/chị! Em là trợ lý ảo của Tâm Thái Cha Mẹ. Anh/chị cần em hỗ trợ gì ạ? 😊',
    ESCALATE_NOTIFY_CUSTOMER: 'Dạ, để em hỏi lại bên em và trả lời anh/chị sớm nhất ạ!',
    ESCALATE_SKIP_CUSTOMER: 'Xin lỗi anh/chị, câu hỏi này em chưa có thông tin. Anh/chị vui lòng liên hệ trực tiếp qua Fanpage ạ.',
    AI_ERROR: 'Xin lỗi anh/chị, hệ thống em đang có chút trục trặc. Em xử lý xong sẽ quay lại ngay ạ!',
    BOSS_WELCOME: 'Đã ghi nhận Sếp! Em sẽ báo cáo các câu hỏi khó qua đây ạ.',
    BOSS_IDLE_HELP: 'Sếp cần gì ạ?\n• Gõ "lịch hôm nay" → Xem lịch hôm nay\n• Gõ "lịch ngày mai" → Xem lịch ngày mai\n• Các câu hỏi từ khách sẽ tự động xuất hiện ở đây.',
};

// ===== WEBHOOK VERIFICATION =====
app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED');
            res.status(200).send(challenge);
        } else {
            res.sendStatus(403);
        }
    } else {
        res.status(400).send('Missing mode or token');
    }
});

// ===== WEBHOOK HANDLER =====
app.post('/webhook', async (req, res) => {
    const body = req.body;

    if (body.object === 'page') {
        res.status(200).send('EVENT_RECEIVED');

        for (const entry of body.entry) {
            const pageId = entry.id;

            if (entry.messaging) {
                for (const webhookEvent of entry.messaging) {
                    if (!webhookEvent.message || !webhookEvent.message.text) continue;

                    const senderPsid = webhookEvent.sender.id;
                    const text = webhookEvent.message.text;

                    try {
                        if (pageId === metaService.mainPageId) {
                            await handleCustomerMessage(senderPsid, text);
                        } else if (pageId === metaService.privatePageId) {
                            await handleBossMessage(senderPsid, text);
                        }
                    } catch (error) {
                        console.error('[CRITICAL] Lỗi xử lý tin nhắn:', error);
                    }
                }
            }
        }
    } else {
        res.sendStatus(404);
    }
});

// ===== XỬ LÝ TIN NHẮN KHÁCH HÀNG (TRANG CHÍNH) =====
async function handleCustomerMessage(senderPsid, text) {
    console.log(`[Khách → Main]: "${text}"`);

    // Debounce: gộp tin nhắn liên tiếp
    const combined = await customerDebouncer.add(senderPsid, text);
    if (combined === null) return; // Tin nhắn đã được gộp, chờ timer

    // Lấy FAQ list từ Google Sheets
    const faqList = await knowledgeManager.getFAQList();

    // AI phân loại ý định (CHỈ trả về mã, KHÔNG viết văn)
    const classification = await aiService.classifyIntent(combined, faqList);

    switch (classification.intent) {
        case 'GREETING':
            await metaService.sendMessage(metaService.mainPageId, senderPsid, TEMPLATES.GREETING);
            break;

        case 'FAQ_MATCH':
            // Lấy câu trả lời CỦA SẾP từ Google Sheets (nguyên xi, không qua AI)
            const answer = knowledgeManager.getAnswerByIndex(classification.faq_index, faqList);
            if (answer) {
                await metaService.sendMessage(metaService.mainPageId, senderPsid, answer);
            } else {
                // Index sai → xử lý như NO_MATCH
                await escalateTooBoss(senderPsid, combined);
            }
            break;

        case 'NO_MATCH':
            await escalateTooBoss(senderPsid, combined);
            break;

        case 'ERROR':
        default:
            await metaService.sendMessage(metaService.mainPageId, senderPsid, TEMPLATES.AI_ERROR);
            break;
    }
}

// ===== CHUYỂN CÂU HỎI CHO SẾP =====
async function escalateTooBoss(customerPsid, question) {
    // Báo khách đang xử lý
    await metaService.sendMessage(metaService.mainPageId, customerPsid, TEMPLATES.ESCALATE_NOTIFY_CUSTOMER);

    // Đưa vào hàng đợi
    const result = escalationManager.addToQueue(customerPsid, question);

    if (result.shouldNotifyBoss && bossPrivatePsid) {
        // Sếp đang rảnh → gửi ngay
        const notification = escalationManager.getNextNotification();
        await metaService.sendMessage(metaService.privatePageId, bossPrivatePsid, notification);
    } else if (result.shouldNotifyBoss && !bossPrivatePsid) {
        console.log('[Cảnh báo] Sếp chưa từng nhắn tin Trang Kín. Không gửi được.');
    } else {
        console.log(`[Queue] Câu hỏi xếp hàng vị trí #${result.position}. Sếp đang trả lời câu khác.`);
    }
}

// ===== XỬ LÝ TIN NHẮN SẾP (TRANG KÍN) =====
async function handleBossMessage(senderPsid, text) {
    console.log(`[Sếp → Private]: "${text}"`);

    // Lưu PSID của Sếp lần đầu
    if (bossPrivatePsid !== senderPsid) {
        bossPrivatePsid = senderPsid;
        await googleService.writeConfig('BOSS_PSID', senderPsid);
        await metaService.sendMessage(metaService.privatePageId, bossPrivatePsid, TEMPLATES.BOSS_WELCOME);
        return;
    }

    // Debounce: gộp tin nhắn Sếp
    const combined = await bossDebouncer.add(senderPsid, text);
    if (combined === null) return;

    // ===== SẾP ĐANG TRẢ LỜI KHÁCH (ANSWERING) =====
    if (escalationManager.isBossAnswering()) {
        const lowerText = combined.trim().toLowerCase();

        if (lowerText === 'bỏ qua' || lowerText === 'bo qua' || lowerText === 'skip') {
            // Sếp skip câu hỏi này
            const skipped = escalationManager.skipCurrent();
            if (skipped) {
                await metaService.sendMessage(metaService.mainPageId, skipped.psid, TEMPLATES.ESCALATE_SKIP_CUSTOMER);
                await metaService.sendMessage(metaService.privatePageId, bossPrivatePsid, '✓ Đã bỏ qua.');
            }
        } else {
            // Sếp trả lời → Gửi NGAY cho khách + Ghi vào FAQ
            const answered = escalationManager.bossAnswered(combined);
            if (answered) {
                // 1. Gửi NGUYÊN CÂU của Sếp cho khách (không qua AI format)
                await metaService.sendMessage(metaService.mainPageId, answered.psid, answered.answer);

                // 2. Ghi vào FAQ để Bot tự học
                await knowledgeManager.learn(answered.question, answered.answer);

                // 3. Xác nhận cho Sếp
                await metaService.sendMessage(metaService.privatePageId, bossPrivatePsid,
                    `✅ Đã gửi cho khách & ghi nhớ!\n"${answered.answer.substring(0, 100)}${answered.answer.length > 100 ? '...' : ''}"`
                );
            }
        }

        // Kiểm tra hàng đợi: còn câu nào nữa không?
        const nextNotification = escalationManager.getNextNotification();
        if (nextNotification) {
            await metaService.sendMessage(metaService.privatePageId, bossPrivatePsid, nextNotification);
        }

        return;
    }

    // ===== SẾP ĐANG RẢNH (IDLE) → XỬ LÝ LỆNH =====
    const lowerText = combined.trim().toLowerCase();

    // Lệnh xem lịch
    if (lowerText.includes('lịch hôm nay') || lowerText.includes('lich hom nay')) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const result = await googleService.checkAvailability(today.toISOString(), tomorrow.toISOString());
        await metaService.sendMessage(metaService.privatePageId, bossPrivatePsid, `📅 Lịch hôm nay:\n${result}`);
        return;
    }

    if (lowerText.includes('lịch ngày mai') || lowerText.includes('lich ngay mai')) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        const dayAfter = new Date(tomorrow);
        dayAfter.setDate(dayAfter.getDate() + 1);
        const result = await googleService.checkAvailability(tomorrow.toISOString(), dayAfter.toISOString());
        await metaService.sendMessage(metaService.privatePageId, bossPrivatePsid, `📅 Lịch ngày mai:\n${result}`);
        return;
    }

    if (lowerText.includes('lịch tuần này') || lowerText.includes('lich tuan nay')) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const endOfWeek = new Date(today);
        endOfWeek.setDate(endOfWeek.getDate() + (7 - today.getDay()));
        const result = await googleService.checkAvailability(today.toISOString(), endOfWeek.toISOString());
        await metaService.sendMessage(metaService.privatePageId, bossPrivatePsid, `📅 Lịch tuần này:\n${result}`);
        return;
    }

    // Lệnh xem hàng đợi
    if (lowerText.includes('hàng đợi') || lowerText.includes('hang doi') || lowerText.includes('queue')) {
        const qLen = escalationManager.getQueueLength();
        await metaService.sendMessage(metaService.privatePageId, bossPrivatePsid,
            qLen > 0 ? `Đang có ${qLen} câu hỏi chờ Sếp trả lời.` : 'Không có câu hỏi nào đang chờ ạ.'
        );
        return;
    }

    // Không nhận ra lệnh → Hiển thị menu
    await metaService.sendMessage(metaService.privatePageId, bossPrivatePsid, TEMPLATES.BOSS_IDLE_HELP);
}

// ===== KHỞI ĐỘNG =====
app.listen(PORT, async () => {
    console.log(`Server is running on port ${PORT}`);
    await metaService.init();
    await googleService.init();

    // Tải Boss PSID từ Google Sheets
    bossPrivatePsid = await googleService.readConfig('BOSS_PSID');
    if (bossPrivatePsid) {
        console.log(`[Khôi phục] Đã tải ID của Sếp: ${bossPrivatePsid}`);
    }

    console.log('[v2.0] Hệ thống Zero-Hallucination đã sẵn sàng.');
});
