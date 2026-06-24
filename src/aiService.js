const { GoogleGenAI } = require('@google/genai');
const axios = require('axios');
const apiKeyManager = require('./apiKeyManager');
const googleService = require('./googleService');

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
        this.ai = null;
        this.groqKeys = new GroqKeyManager();
        this.initClient();
    }

    initClient() {
        const key = apiKeyManager.getCurrentKey();
        if (key) {
            this.ai = new GoogleGenAI({ apiKey: key });
            console.log("AI Client initialized with current key.");
        }
    }

    // ======= GROQ / LLAMA 3.3 (BỘ NÃO CHÍNH) =======
    async callGroq(systemPrompt, messages, withTools = false) {
        const groqKey = this.groqKeys.getCurrentKey();
        if (!groqKey) return null;

        // Chuyển đổi format messages từ Gemini sang OpenAI
        const groqMessages = [{ role: 'system', content: systemPrompt }];
        for (const msg of messages) {
            const role = msg.role === 'model' ? 'assistant' : 'user';
            const text = msg.parts?.[0]?.text || '';
            if (text) groqMessages.push({ role, content: text });
        }

        // Định nghĩa tools cho Calendar (Groq cũng hỗ trợ Function Calling)
        const tools = withTools ? [{
            type: "function",
            function: {
                name: "checkAvailability",
                description: "Kiểm tra lịch rảnh của Sếp trong một khoảng thời gian trên Google Calendar.",
                parameters: {
                    type: "object",
                    properties: {
                        timeMin: { type: "string", description: "Thời gian bắt đầu (ISO 8601, VD: 2026-06-25T08:00:00+07:00)" },
                        timeMax: { type: "string", description: "Thời gian kết thúc (ISO 8601, VD: 2026-06-25T17:00:00+07:00)" }
                    },
                    required: ["timeMin", "timeMax"]
                }
            }
        }, {
            type: "function",
            function: {
                name: "bookAppointment",
                description: "Đặt lịch hẹn mới trên Google Calendar.",
                parameters: {
                    type: "object",
                    properties: {
                        summary: { type: "string", description: "Tiêu đề cuộc hẹn (VD: Hẹn tư vấn khách hàng Nguyễn Văn A)" },
                        startTime: { type: "string", description: "Thời gian bắt đầu (ISO 8601)" },
                        endTime: { type: "string", description: "Thời gian kết thúc (ISO 8601)" }
                    },
                    required: ["summary", "startTime", "endTime"]
                }
            }
        }] : undefined;

        // Thử tất cả Groq keys
        for (let attempt = 0; attempt < this.groqKeys.keys.length; attempt++) {
            try {
                const currentKey = this.groqKeys.getCurrentKey();
                console.log(`[Groq] Đang gọi Llama 3.3 (key #${this.groqKeys.currentIndex + 1})...`);

                const requestBody = {
                    model: 'llama-3.3-70b-versatile',
                    messages: groqMessages,
                    temperature: 0.7,
                    max_tokens: 1024
                };
                if (tools) requestBody.tools = tools;

                const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', requestBody, {
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
                    const funcArgs = JSON.parse(toolCall.function.arguments);
                    console.log(`[Groq Tool] Gọi hàm ${funcName}(${JSON.stringify(funcArgs)})`);

                    let funcResult = "";
                    if (funcName === "checkAvailability") {
                        funcResult = await googleService.checkAvailability(funcArgs.timeMin, funcArgs.timeMax);
                    } else if (funcName === "bookAppointment") {
                        funcResult = await googleService.bookAppointment(funcArgs.summary, funcArgs.startTime, funcArgs.endTime);
                    }

                    // Gửi kết quả function trở lại cho AI
                    groqMessages.push(choice.message);
                    groqMessages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: funcResult
                    });

                    const finalResponse = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
                        model: 'llama-3.3-70b-versatile',
                        messages: groqMessages,
                        temperature: 0.7,
                        max_tokens: 1024
                    }, {
                        headers: {
                            'Authorization': `Bearer ${currentKey}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 15000
                    });

                    console.log("[Groq] Trả lời thành công (có Calendar).");
                    return finalResponse.data.choices[0].message.content;
                }

                console.log("[Groq] Trả lời thành công.");
                return choice.message.content;

            } catch (error) {
                const status = error.response?.status || '';
                console.error(`[Groq] Lỗi key#${this.groqKeys.currentIndex + 1}: ${status} ${error.response?.data?.error?.message || error.message}`);

                if (status === 429 || status === 503) {
                    this.groqKeys.rotateKey();
                    continue;
                }
                break;
            }
        }
        return null;
    }

    // ======= GEMINI (BỘ NÃO DỰ PHÒNG) =======
    async callGemini(systemPrompt, contents) {
        if (!this.ai) this.initClient();
        if (!this.ai) return null;

        const tools = [{
            functionDeclarations: [
                {
                    name: "checkAvailability",
                    description: "Kiểm tra lịch rảnh của Sếp trên Google Calendar.",
                    parameters: {
                        type: "OBJECT",
                        properties: {
                            timeMin: { type: "STRING", description: "Thời gian bắt đầu (ISO 8601)" },
                            timeMax: { type: "STRING", description: "Thời gian kết thúc (ISO 8601)" }
                        },
                        required: ["timeMin", "timeMax"]
                    }
                },
                {
                    name: "bookAppointment",
                    description: "Đặt lịch hẹn mới trên Google Calendar.",
                    parameters: {
                        type: "OBJECT",
                        properties: {
                            summary: { type: "STRING", description: "Tiêu đề cuộc hẹn" },
                            startTime: { type: "STRING", description: "Thời gian bắt đầu (ISO 8601)" },
                            endTime: { type: "STRING", description: "Thời gian kết thúc (ISO 8601)" }
                        },
                        required: ["summary", "startTime", "endTime"]
                    }
                }
            ]
        }];

        for (let attempt = 0; attempt < apiKeyManager.keys.length; attempt++) {
            try {
                console.log(`[Gemini] Đang gọi gemini-2.5-flash (key #${apiKeyManager.currentIndex + 1})...`);
                const response = await this.ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: contents,
                    config: { systemInstruction: systemPrompt, temperature: 0.7, tools: tools }
                });

                if (response.functionCalls && response.functionCalls.length > 0) {
                    const call = response.functionCalls[0];
                    console.log(`[Gemini Tool] Gọi hàm ${call.name}(${JSON.stringify(call.args)})`);

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
                        model: 'gemini-2.5-flash',
                        contents: newContents,
                        config: { systemInstruction: systemPrompt, temperature: 0.7, tools: tools }
                    });
                    console.log("[Gemini] Trả lời thành công.");
                    return finalResponse.text;
                }

                console.log("[Gemini] Trả lời thành công.");
                return response.text;

            } catch (error) {
                console.error(`[Gemini] Lỗi key#${apiKeyManager.currentIndex + 1}:`, error.status || '', error.message.substring(0, 80));
                apiKeyManager.rotateKey();
                this.initClient();
            }
        }
        return null;
    }

    // ======= ĐIỂM VÀO CHÍNH =======
    async generateResponse(systemPrompt, userMessage) {
        return this.generateChatResponse(systemPrompt, [
            { role: 'user', parts: [{ text: userMessage }] }
        ]);
    }

    async generateChatResponse(systemPrompt, contents) {
        // Bước 1: Groq/Llama 3.3 (BỘ NÃO CHÍNH - quota khổng lồ, có Calendar)
        const groqResult = await this.callGroq(systemPrompt, contents, true);
        if (groqResult) return groqResult;

        // Bước 2: Gemini (DỰ PHÒNG - khi Groq chết)
        console.log("[AI] Groq không khả dụng. Chuyển sang Gemini...");
        const geminiResult = await this.callGemini(systemPrompt, contents);
        if (geminiResult) return geminiResult;

        // Bước 3: Cả 2 đều chết
        console.error("[AI] TẤT CẢ AI ĐỀU KHÔNG KHẢ DỤNG!");
        return "Xin lỗi, hệ thống AI tạm thời đang bảo trì. Sếp sẽ liên hệ lại với bạn sớm nhất ạ.";
    }
}

module.exports = new AiService();
