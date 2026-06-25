const axios = require('axios');
const apiKeyManager = require('./apiKeyManager');

class GroqKeyManager {
    constructor() {
        this.keys = [];
        for (let i = 1; i <= 10; i++) {
            const key = process.env[`GROQ_API_KEY_${i}`];
            if (key) this.keys.push(key);
        }
        this.currentIndex = 0;
        console.log(`Loaded ${this.keys.length} Groq API keys for rotation.`);
    }

    getCurrentKey() {
        if (this.keys.length === 0) return null;
        return this.keys[this.currentIndex];
    }

    rotateKey() {
        if (this.keys.length <= 1) return false;
        this.currentIndex = (this.currentIndex + 1) % this.keys.length;
        console.log(`[Groq Key] Chuyển sang Key #${this.currentIndex + 1}`);
        return true;
    }
}

class AiService {
    constructor() {
        this.groqKeys = new GroqKeyManager();
    }

    /**
     * Phân loại ý định khách hàng. AI CHỈ trả về JSON, KHÔNG tự viết văn.
     * @param {string} userMessage - Tin nhắn (đã gộp) của khách
     * @param {Array} faqList - Mảng [{index, question, answer}]
     * @returns {Object} - {intent: "FAQ_MATCH"|"GREETING"|"NO_MATCH", faq_index?: number}
     */
    async classifyIntent(userMessage, faqList) {
        // Xây dựng danh sách FAQ cho AI đọc
        let faqText = '';
        if (faqList.length > 0) {
            faqText = '\n\nDANH SÁCH FAQ:\n';
            for (const faq of faqList) {
                faqText += `[${faq.index}] Q: ${faq.question}\n`;
            }
        }

        const systemPrompt = `Bạn là bộ phân loại ý định (intent classifier). Nhiệm vụ DUY NHẤT của bạn là đọc tin nhắn khách hàng và phân loại nó.

BẠN PHẢI TRẢ VỀ ĐÚNG 1 DÒNG JSON. KHÔNG ĐƯỢC VIẾT GÌ THÊM. KHÔNG GIẢI THÍCH.

Các loại intent:
1. {"intent":"GREETING"} - Khách chào hỏi, xã giao (xin chào, hi, hello, chào bạn, ...)
2. {"intent":"FAQ_MATCH","faq_index":<số>} - Câu hỏi của khách GIỐNG hoặc TƯƠNG TỰ với một câu trong danh sách FAQ bên dưới. Chỉ match khi BẠN CHẮC CHẮN nội dung khách hỏi đúng là câu đó.
3. {"intent":"NO_MATCH"} - Không match với FAQ nào. LUÔN chọn NO_MATCH nếu không chắc chắn.

QUY TẮC TUYỆT ĐỐI:
- Chỉ trả về 1 dòng JSON duy nhất.
- KHÔNG BAO GIỜ tự viết câu trả lời.
- KHÔNG BAO GIỜ thêm giải thích, lời chào, hay bất kỳ text nào khác.
- Nếu không chắc chắn → {"intent":"NO_MATCH"}
${faqText}`;

        const result = await this._callGroq(systemPrompt, userMessage);
        if (!result) {
            // Fallback: nếu cả Groq lẫn tất cả đều chết
            return { intent: 'ERROR' };
        }

        // Parse JSON từ response
        try {
            // Tìm JSON trong response (đề phòng AI thêm text thừa)
            const jsonMatch = result.match(/\{[^}]+\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]);
                // Validate
                if (['GREETING', 'FAQ_MATCH', 'NO_MATCH'].includes(parsed.intent)) {
                    console.log(`[AI Classify] Intent: ${JSON.stringify(parsed)}`);
                    return parsed;
                }
            }
        } catch (e) {
            console.error('[AI Classify] Không parse được JSON:', result);
        }

        // Nếu AI trả rác → mặc định NO_MATCH (an toàn nhất)
        console.log('[AI Classify] Fallback → NO_MATCH');
        return { intent: 'NO_MATCH' };
    }

    /**
     * Gọi Groq API đơn giản (cho classify)
     */
    async _callGroq(systemPrompt, userMessage) {
        for (let attempt = 0; attempt < this.groqKeys.keys.length; attempt++) {
            try {
                const currentKey = this.groqKeys.getCurrentKey();
                console.log(`[Groq] Classify (key #${this.groqKeys.currentIndex + 1})...`);

                const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                    model: 'llama-3.3-70b-versatile',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: userMessage }
                    ],
                    temperature: 0.1,
                    max_tokens: 50
                }, {
                    headers: {
                        'Authorization': `Bearer ${currentKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000
                });

                return response.data.choices[0].message.content.trim();

            } catch (error) {
                const status = error.response?.status || '';
                console.error(`[Groq] Lỗi key#${this.groqKeys.currentIndex + 1}: ${status}`);

                if (status === 429 || status === 503) {
                    this.groqKeys.rotateKey();
                    continue;
                }
                break;
            }
        }
        return null;
    }

    /**
     * Trợ lý thông minh cho Sếp (Trang Kín) - có Function Calling cho Calendar
     * Khác với classify: AI được phép trả lời tự nhiên VỚI Sếp vì Sếp kiểm soát được.
     * Nhưng dữ liệu Calendar luôn lấy từ API thật, không bịa.
     */
    async generateBossResponse(userMessage, chatHistory, googleService, escalationManager) {
        const now = new Date();
        const vietnamTime = now.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
        const isoNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));

        // Thông tin hàng đợi
        let queueInfo = '';
        if (escalationManager.isBossAnswering()) {
            const current = escalationManager.getCurrentQuestion();
            queueInfo = `\n[HÀNG ĐỢI] Đang có câu hỏi từ khách chờ Sếp trả lời: "${current.question}" (Gõ câu trả lời hoặc "bỏ qua")`;
            queueInfo += `\nCòn ${escalationManager.getQueueLength()} câu chờ thêm.`;
        }

        const systemPrompt = `Bạn là trợ lý ảo cá nhân của Sếp. Xưng "em" và gọi "Sếp".
Thời gian hiện tại: ${vietnamTime}
Múi giờ: Asia/Ho_Chi_Minh (UTC+7)

NHIỆM VỤ CỦA EM:
1. Giúp Sếp kiểm tra lịch, đặt lịch, xóa lịch trên Google Calendar.
2. Khi Sếp hỏi về lịch → BẮT BUỘC phải gọi tool checkAvailability để lấy dữ liệu THẬT. KHÔNG ĐƯỢC TỰ BỊA LỊCH.
3. Khi Sếp muốn đặt lịch → BẮT BUỘC phải gọi tool bookAppointment. KHÔNG ĐƯỢC nói "đã đặt" mà chưa gọi tool.
4. Trò chuyện, hỗ trợ Sếp mọi thứ một cách thông minh và nhanh nhẹn.
5. Trả lời ngắn gọn, rõ ràng, dưới 500 ký tự.

QUY TẮC VỀ THỜI GIAN:
- Khi Sếp nói "hôm nay" → dùng ngày ${isoNow.getFullYear()}-${String(isoNow.getMonth()+1).padStart(2,'0')}-${String(isoNow.getDate()).padStart(2,'0')}
- Khi Sếp nói "ngày mai" → cộng thêm 1 ngày
- Luôn dùng múi giờ +07:00 cho ISO 8601
- Nếu Sếp không nói giờ kết thúc, mặc định sự kiện kéo dài 1 giờ.
${queueInfo}

QUY TẮC TUYỆT ĐỐI:
- KHÔNG ĐƯỢC bịa ra sự kiện lịch. Nếu chưa gọi tool thì KHÔNG ĐƯỢC nói "lịch trống" hay "có cuộc hẹn".
- Phải gọi tool trước, đọc kết quả, rồi mới trả lời Sếp.`;

        const tools = [{
            type: "function",
            function: {
                name: "checkAvailability",
                description: "Kiểm tra lịch trình trên Google Calendar trong một khoảng thời gian.",
                parameters: {
                    type: "object",
                    properties: {
                        timeMin: { type: "string", description: "Thời gian bắt đầu (ISO 8601 với timezone, VD: 2026-06-25T00:00:00+07:00)" },
                        timeMax: { type: "string", description: "Thời gian kết thúc (ISO 8601 với timezone, VD: 2026-06-25T23:59:59+07:00)" }
                    },
                    required: ["timeMin", "timeMax"]
                }
            }
        }, {
            type: "function",
            function: {
                name: "bookAppointment",
                description: "Tạo sự kiện mới trên Google Calendar.",
                parameters: {
                    type: "object",
                    properties: {
                        summary: { type: "string", description: "Tiêu đề sự kiện" },
                        startTime: { type: "string", description: "Thời gian bắt đầu (ISO 8601 với timezone)" },
                        endTime: { type: "string", description: "Thời gian kết thúc (ISO 8601 với timezone)" }
                    },
                    required: ["summary", "startTime", "endTime"]
                }
            }
        }];

        // Xây messages với chat history
        const messages = [{ role: 'system', content: systemPrompt }];
        for (const msg of chatHistory) {
            messages.push({ role: msg.role, content: msg.content });
        }
        messages.push({ role: 'user', content: userMessage });

        // Gọi Groq
        for (let attempt = 0; attempt < this.groqKeys.keys.length; attempt++) {
            try {
                const currentKey = this.groqKeys.getCurrentKey();
                console.log(`[Boss AI] Gọi Groq (key #${this.groqKeys.currentIndex + 1})...`);

                const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                    model: 'llama-3.3-70b-versatile',
                    messages: messages,
                    tools: tools,
                    temperature: 0.3,
                    max_tokens: 512
                }, {
                    headers: {
                        'Authorization': `Bearer ${currentKey}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 15000
                });

                const choice = response.data.choices[0];

                // Xử lý Function Calling (Calendar)
                if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
                    const toolCall = choice.message.tool_calls[0];
                    const funcName = toolCall.function.name;
                    let funcArgs;
                    try {
                        funcArgs = JSON.parse(toolCall.function.arguments);
                    } catch(e) {
                        return "Em không hiểu yêu cầu. Sếp thử nói rõ hơn ạ.";
                    }
                    console.log(`[Boss AI Tool] ${funcName}(${JSON.stringify(funcArgs)})`);

                    let funcResult = "";
                    if (funcName === "checkAvailability") {
                        funcResult = await googleService.checkAvailability(funcArgs.timeMin, funcArgs.timeMax);
                    } else if (funcName === "bookAppointment") {
                        funcResult = await googleService.bookAppointment(funcArgs.summary, funcArgs.startTime, funcArgs.endTime);
                    }

                    // Gửi kết quả function trở lại cho AI để nó diễn giải
                    messages.push(choice.message);
                    messages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: funcResult
                    });

                    const finalResponse = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                        model: 'llama-3.3-70b-versatile',
                        messages: messages,
                        temperature: 0.3,
                        max_tokens: 512
                    }, {
                        headers: {
                            'Authorization': `Bearer ${currentKey}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 15000
                    });

                    console.log("[Boss AI] Trả lời thành công (có Calendar).");
                    return finalResponse.data.choices[0].message.content;
                }

                console.log("[Boss AI] Trả lời thành công.");
                return choice.message.content;

            } catch (error) {
                const status = error.response?.status || '';
                console.error(`[Boss AI] Lỗi key#${this.groqKeys.currentIndex + 1}: ${status} ${error.response?.data?.error?.message || error.message}`);

                if (status === 429 || status === 503) {
                    this.groqKeys.rotateKey();
                    continue;
                }
                break;
            }
        }
        return "Em đang gặp sự cố kết nối. Sếp thử lại sau giây lát ạ.";
    }
}

module.exports = new AiService();

