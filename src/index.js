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
Bạn là trợ lý ảo của Fanpage. Bạn là một AI vô cùng thông minh (được xây dựng trên nền tảng Gemini).
Nhiệm vụ của bạn:
1. Giao tiếp, chào hỏi và trả lời các câu hỏi kiến thức chung, tâm sự với khách hàng bằng sự thông minh và linh hoạt vốn có của bạn.
2. Trả lời các thông tin liên quan đến hoạt động kinh doanh của Fanpage dựa vào FAQ dưới đây:
   - Giờ làm việc: 8h sáng đến 9h tối.
   - Địa chỉ: 123 Đường AI, TP.HCM

[QUAN TRỌNG NHẤT]: Nếu khách hỏi một câu hỏi ĐẶC THÙ liên quan đến sản phẩm, dịch vụ, giá cả, hoặc quyết định kinh doanh của Fanpage mà bạn KHÔNG tìm thấy thông tin trong FAQ hoặc DỮ LIỆU ĐÃ HỌC TỪ SẾP, bạn tuyệt đối KHÔNG ĐƯỢC tự bịa ra thông tin. 
Trong trường hợp đó, hãy trả lời bằng MỘT CÂU DUY NHẤT chứa đúng mã này: "ESCALATE_TO_BOSS". Hệ thống sẽ tự hiểu và chuyển câu hỏi cho Sếp.
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
                            // Sếp tự nhắn
                            await metaService.sendMessage(metaService.privatePageId, bossPrivatePsid, "Dạ em nghe Sếp ạ! Hiện tại không có khách nào chờ trả lời.");
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

