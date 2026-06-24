const { GoogleGenAI } = require('@google/genai');
const axios = require('axios');
const apiKeyManager = require('./apiKeyManager');
const googleService = require('./googleService');

class AiService {
    constructor() {
        this.ai = null;
        this.groqApiKey = process.env.GROQ_API_KEY;
        this.initClient();
    }

    initClient() {
        const key = apiKeyManager.getCurrentKey();
        if (key) {
            this.ai = new GoogleGenAI({ apiKey: key });
            console.log("AI Client initialized with current key.");
        } else {
            console.error("Failed to initialize AI Client: No API Key available.");
        }
    }

    // ======= GROQ (Backup AI) =======
    async callGroq(systemPrompt, messages) {
        if (!this.groqApiKey) return null;
        
        try {
            const groqMessages = [{ role: 'system', content: systemPrompt }];
            for (const msg of messages) {
                const role = msg.role === 'model' ? 'assistant' : 'user';
                const text = msg.parts?.[0]?.text || '';
                if (text) groqMessages.push({ role, content: text });
            }
            
            const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                model: 'llama-3.3-70b-versatile',
                messages: groqMessages,
                temperature: 0.7,
                max_tokens: 1024
            }, {
                headers: {
                    'Authorization': `Bearer ${this.groqApiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: 15000
            });
            
            return response.data.choices[0].message.content;
        } catch (error) {
            console.error("[Groq] Lỗi:", error.response?.data?.error?.message || error.message);
            return null;
        }
    }

    // ======= GEMINI (Primary AI) =======
    async callGemini(systemPrompt, contents) {
        if (!this.ai) this.initClient();
        if (!this.ai) return null;

        const tools = [{
            functionDeclarations: [
                {
                    name: "checkAvailability",
                    description: "Kiểm tra lịch rảnh của Sếp trong một khoảng thời gian cụ thể trên Google Calendar.",
                    parameters: {
                        type: "OBJECT",
                        properties: {
                            timeMin: { type: "STRING", description: "Thời gian bắt đầu (chuẩn ISO 8601, ví dụ: 2026-06-25T08:00:00+07:00)" },
                            timeMax: { type: "STRING", description: "Thời gian kết thúc (chuẩn ISO 8601, ví dụ: 2026-06-25T17:00:00+07:00)" }
                        },
                        required: ["timeMin", "timeMax"]
                    }
                },
                {
                    name: "bookAppointment",
                    description: "Đặt lịch hẹn mới trên Google Calendar cho khách hàng hoặc Sếp.",
                    parameters: {
                        type: "OBJECT",
                        properties: {
                            summary: { type: "STRING", description: "Tiêu đề cuộc hẹn (VD: Hẹn khách hàng Nguyễn Văn A)" },
                            startTime: { type: "STRING", description: "Thời gian bắt đầu (chuẩn ISO 8601)" },
                            endTime: { type: "STRING", description: "Thời gian kết thúc (chuẩn ISO 8601)" }
                        },
                        required: ["summary", "startTime", "endTime"]
                    }
                }
            ]
        }];

        const models = ['gemini-2.5-flash', 'gemini-2.0-flash'];
        
        for (const model of models) {
            // Thử tất cả 5 keys cho mỗi model
            for (let keyAttempt = 0; keyAttempt < apiKeyManager.keys.length; keyAttempt++) {
                try {
                    console.log(`[Gemini] Đang gọi ${model} (key #${apiKeyManager.currentIndex + 1})...`);
                    
                    const response = await this.ai.models.generateContent({
                        model: model,
                        contents: contents,
                        config: { systemInstruction: systemPrompt, temperature: 0.7, tools: tools }
                    });
                    
                    // Xử lý Function Calling (Google Calendar)
                    if (response.functionCalls && response.functionCalls.length > 0) {
                        const call = response.functionCalls[0];
                        console.log(`[AI Tool] Gọi hàm ${call.name}(${JSON.stringify(call.args)})`);
                        
                        let funcResult = "";
                        if (call.name === "checkAvailability") {
                            funcResult = await googleService.checkAvailability(call.args.timeMin, call.args.timeMax);
                        } else if (call.name === "bookAppointment") {
                            funcResult = await googleService.bookAppointment(call.args.summary, call.args.startTime, call.args.endTime);
                        }
                        
                        const newContents = [
                            ...contents,
                            { role: 'model', parts: [{ functionCall: call }] },
                            { role: 'user', parts: [{ functionResponse: { name: call.name, response: { result: funcResult } } }] }
                        ];
                        
                        const finalResponse = await this.ai.models.generateContent({
                            model: model,
                            contents: newContents,
                            config: { systemInstruction: systemPrompt, temperature: 0.7, tools: tools }
                        });
                        console.log(`[Gemini] Trả lời thành công bằng ${model}.`);
                        return finalResponse.text;
                    }
                    
                    console.log(`[Gemini] Trả lời thành công bằng ${model}.`);
                    return response.text;
                    
                } catch (error) {
                    const code = error.status || '';
                    console.error(`[Gemini] Lỗi ${model} key#${apiKeyManager.currentIndex + 1}: ${code} ${error.message.substring(0, 80)}`);
                    
                    if (code === 429 || code === 503) {
                        apiKeyManager.rotateKey();
                        this.initClient();
                        continue;
                    }
                    break; // Lỗi khác (400, 404) -> bỏ qua model này
                }
            }
        }
        return null; // Gemini hoàn toàn thất bại
    }

    // ======= MAIN ENTRY POINT =======
    async generateResponse(systemPrompt, userMessage) {
        return this.generateChatResponse(systemPrompt, [
            { role: 'user', parts: [{ text: userMessage }] }
        ]);
    }

    async generateChatResponse(systemPrompt, contents) {
        // Bước 1: Thử Gemini trước (có Function Calling cho Calendar)
        const geminiResult = await this.callGemini(systemPrompt, contents);
        if (geminiResult) return geminiResult;
        
        // Bước 2: Gemini chết -> Chuyển sang Groq (Llama 3.3 70B)
        console.log("[AI] Gemini không khả dụng. Chuyển sang Groq/Llama...");
        const groqResult = await this.callGroq(systemPrompt, contents);
        if (groqResult) {
            console.log("[Groq] Trả lời thành công bằng Llama 3.3.");
            return groqResult;
        }
        
        // Bước 3: Cả 2 đều chết
        console.error("[AI] CẢ GEMINI VÀ GROQ ĐỀU KHÔNG KHẢ DỤNG!");
        return "Xin lỗi, hệ thống AI tạm thời đang bảo trì. Sếp sẽ liên hệ lại với bạn sớm nhất ạ.";
    }
}

module.exports = new AiService();
