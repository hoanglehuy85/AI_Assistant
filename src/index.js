require('dotenv').config();
const express = require('express');
const aiService = require('./aiService');
const metaService = require('./metaService');
const knowledgeManager = require('./knowledgeManager');
const googleService = require('./googleService');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;

// In-memory state
let escalatedRequest = null; // { psid, question }
const chatHistory = new Map(); // psid -> Array<{role, parts:[{text}]}>

let bossPrivatePsid = null;

const BASE_SYSTEM_PROMPT = `
Bạn là trợ lý ảo của Fanpage. Bạn là AI thông minh, lịch sự và chuyên nghiệp. Xưng "em", gọi khách là "anh/chị".

Nhiệm vụ của bạn:
1. Giao tiếp, chào hỏi, trò chuyện với khách hàng bằng sự thông minh vốn có.
2. Trả lời các thông tin về Fanpage dựa vào FAQ:
   - Giờ làm việc: 8h sáng đến 9h tối.
   - Địa chỉ: 123 Đường AI, TP.HCM
3. Nếu khách muốn đặt lịch hẹn hoặc kiểm tra lịch rảnh, hãy sử dụng công cụ checkAvailability hoặc bookAppointment.

[QUY TẮC BẮT BUỘC - KHÔNG ĐƯỢC VI PHẠM]:
- Chỉ trả lời những gì bạn BIẾT CHẮC CHẮN từ FAQ hoặc DỮ LIỆU ĐÃ HỌC TỪ SẾP ở phía dưới.
- Nếu khách hỏi về GIÁ CẢ, LỊCH HỌC CỤ THỂ, THỜI LƯỢNG KHÓA HỌC, SỐ BUỔI, CHƯƠNG TRÌNH CHI TIẾT, hoặc BẤT KỲ thông tin kinh doanh đặc thù nào mà bạn KHÔNG CÓ trong dữ liệu:
  → Bạn PHẢI trả lời CHÍNH XÁC cụm từ "ESCALATE_TO_BOSS" (không thêm bớt).
  → TUYỆT ĐỐI KHÔNG ĐƯỢC TỰ BỊA, TỰ SUY LUẬN, hay ước lượng bất kỳ con số, thời gian, giá tiền nào.
- Trả lời ngắn gọn, dưới 500 ký tự.
`;

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

                    // 1. Nếu tin nhắn gửi đến FANPAGE CHÍNH (Từ khách hàng)
                    if (pageId === metaService.mainPageId) {
                        console.log(`[Khách Hàng -> Main Page]: "${text}"`);
                        
                        // Cập nhật Chat History
                        if (!chatHistory.has(senderPsid)) {
                            chatHistory.set(senderPsid, []);
                        }
                        const history = chatHistory.get(senderPsid);
                        history.push({ role: 'user', parts: [{ text: text }] });
                        if (history.length > 10) history.shift();
                        
                        // Gom Knowledge Base từ Google Sheets
                        const kbContext = await knowledgeManager.getKnowledgeContext();
                        const fullSystemPrompt = BASE_SYSTEM_PROMPT + kbContext;
                        
                        // Hỏi AI kèm History
                        const aiReply = await aiService.generateChatResponse(fullSystemPrompt, history);
                        
                        if (aiReply.includes("ESCALATE_TO_BOSS")) {
                            // Chuyển cho sếp
                            await metaService.sendMessage(metaService.mainPageId, senderPsid, "Dạ vấn đề này hơi phức tạp, em đã báo Sếp xem qua và sẽ trả lời anh/chị ngay ạ.");
                            
                            if (bossPrivatePsid) {
                                escalatedRequest = { psid: senderPsid, question: text };
                                await metaService.sendMessage(metaService.privatePageId, bossPrivatePsid, `Sếp ơi, có khách hỏi câu này: "${text}"\nSếp nhắn lại câu trả lời để em gửi khách và ghi nhớ luôn nhé!`);
                            } else {
                                console.log("[Cảnh báo] Sếp chưa từng nhắn tin cho Fanpage Kín nên không biết gửi cho ai.");
                            }
                            
                            history.pop();
                        } else {
                            // Lưu câu trả lời của AI vào history
                            history.push({ role: 'model', parts: [{ text: aiReply }] });
                            
                            // Trả lời khách
                            await metaService.sendMessage(metaService.mainPageId, senderPsid, aiReply);
                        }
                    }
                    
                    // 2. Nếu tin nhắn gửi đến FANPAGE KÍN (Từ Sếp)
                    else if (pageId === metaService.privatePageId) {
                        console.log(`[Sếp -> Private Page]: "${text}"`);
                        
                        // Lưu lại ID của Sếp lên Google Sheets nếu thay đổi
                        if (bossPrivatePsid !== senderPsid) {
                            bossPrivatePsid = senderPsid;
                            await googleService.writeConfig('BOSS_PSID', senderPsid);
                            await metaService.sendMessage(metaService.privatePageId, bossPrivatePsid, "Đã ghi nhận Sếp! Em sẽ báo cáo các ca khó qua đây.");
                        }

                        // Nếu có câu hỏi đang đợi Sếp
                        if (escalatedRequest) {
                            // Sếp trả lời, học luôn vào Knowledge Base (Google Sheets)
                            await knowledgeManager.learn(escalatedRequest.question, text);
                            
                            // Format câu trả lời
                            const systemRole = "Bạn là trợ lý chăm sóc khách hàng. Nhiệm vụ của bạn là lấy câu trả lời thô của Sếp, viết lại cho thật lịch sự, chuyên nghiệp và CỰC KỲ NGẮN GỌN (dưới 1000 ký tự) để gửi cho khách. Chỉ trả về nội dung tin nhắn, không được giải thích lằng nhằng.";
                            let politeReply = await aiService.generateResponse(systemRole, `Câu trả lời của Sếp: "${text}"`);
                            
                            if (politeReply.length > 2000) politeReply = politeReply.substring(0, 1995) + "...";
                            
                            // Cập nhật history của khách
                            if (chatHistory.has(escalatedRequest.psid)) {
                                const custHistory = chatHistory.get(escalatedRequest.psid);
                                custHistory.push({ role: 'user', parts: [{ text: escalatedRequest.question }] });
                                custHistory.push({ role: 'model', parts: [{ text: politeReply }] });
                            }
                            
                            // Gửi cho khách
                            await metaService.sendMessage(metaService.mainPageId, escalatedRequest.psid, politeReply);
                            
                            // Báo Sếp
                            await metaService.sendMessage(metaService.privatePageId, bossPrivatePsid, `Đã ghi nhớ và gửi cho khách: "${politeReply}"`);
                            
                            escalatedRequest = null; // Reset
                        } else {
                            // Sếp tự nhắn (Chat trực tiếp với AI)
                            const bossPrompt = `Bạn là trợ lý ảo cá nhân của Sếp. Xưng 'em' và gọi 'Sếp'. Nhiệm vụ của bạn là vâng lời Sếp, giúp Sếp tra cứu lịch rảnh, đặt lịch làm việc, hoặc trò chuyện vui vẻ.`;
                            
                            // Cập nhật Chat History cho Sếp (dùng chung chatHistory map với key là 'BOSS')
                            if (!chatHistory.has('BOSS')) chatHistory.set('BOSS', []);
                            const history = chatHistory.get('BOSS');
                            history.push({ role: 'user', parts: [{ text: text }] });
                            if (history.length > 10) history.shift();
                            
                            const aiReply = await aiService.generateChatResponse(bossPrompt, history);
                            history.push({ role: 'model', parts: [{ text: aiReply }] });
                            
                            await metaService.sendMessage(metaService.privatePageId, bossPrivatePsid, aiReply);
                        }
                    }
                }
            }
        }
    } else {
        res.sendStatus(404);
    }
});

app.listen(PORT, async () => {
    console.log(`Server is running on port ${PORT}`);
    await metaService.init();
    await googleService.init();
    
    // Tải Boss PSID từ Google Sheets
    bossPrivatePsid = await googleService.readConfig('BOSS_PSID');
    if (bossPrivatePsid) {
        console.log(`[Khôi phục] Đã tải ID của Sếp từ Google Sheets: ${bossPrivatePsid}`);
    }
    
    console.log(`Bạn cần cấu hình Ngrok để publish port ${PORT} ra ngoài Internet.`);
});

