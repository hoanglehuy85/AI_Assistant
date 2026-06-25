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
     * Gọi Groq API (chỉ dùng Groq, không cần Gemini vì chỉ classify)
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
                    temperature: 0.1,  // Rất thấp → ít sáng tạo, ít bịa
                    max_tokens: 50     // Chỉ cần 1 dòng JSON ngắn
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
}

module.exports = new AiService();
