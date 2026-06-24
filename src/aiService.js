const { GoogleGenAI } = require('@google/genai');
const apiKeyManager = require('./apiKeyManager');

class AiService {
    constructor() {
        this.ai = null;
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

    async generateResponse(systemPrompt, userMessage, maxRetries = 2) {
        return this.generateChatResponse(systemPrompt, [
            { role: 'user', parts: [{ text: userMessage }] }
        ], maxRetries);
    }

    async generateChatResponse(systemPrompt, contents, maxRetries = 2) {
        if (!this.ai) this.initClient();
        if (!this.ai) return "Xin lỗi, hiện tại hệ thống AI đang không có API Key để hoạt động.";

        const tools = [{
            functionDeclarations: [
                {
                    name: "checkAvailability",
                    description: "Kiểm tra lịch rảnh của Sếp trong một khoảng thời gian cụ thể trên Google Calendar.",
                    parameters: {
                        type: "OBJECT",
                        properties: {
                            timeMin: { type: "STRING", description: "Thời gian bắt đầu (chuẩn ISO 8601, ví dụ: 2026-06-25T08:00:00Z)" },
                            timeMax: { type: "STRING", description: "Thời gian kết thúc (chuẩn ISO 8601, ví dụ: 2026-06-25T17:00:00Z)" }
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
                            summary: { type: "STRING", description: "Tiêu đề cuộc hẹn, bao gồm tên khách hàng (VD: Hẹn khách hàng Nguyễn Văn A)" },
                            startTime: { type: "STRING", description: "Thời gian bắt đầu (chuẩn ISO 8601)" },
                            endTime: { type: "STRING", description: "Thời gian kết thúc (chuẩn ISO 8601)" }
                        },
                        required: ["summary", "startTime", "endTime"]
                    }
                }
            ]
        }];

        let attempt = 0;
        let currentModel = 'gemini-3.5-flash';
        
        while (attempt <= maxRetries) {
            try {
                const response = await this.ai.models.generateContent({
                    model: currentModel,
                    contents: contents,
                    config: {
                        systemInstruction: systemPrompt,
                        temperature: 0.7,
                        tools: tools
                    }
                });
                
                // Xử lý Function Calling cho Google Calendar
                if (response.functionCalls && response.functionCalls.length > 0) {
                    const call = response.functionCalls[0];
                    console.log(`[AI Tool] Gọi hàm ${call.name}...`);
                    
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
                        model: currentModel,
                        contents: newContents,
                        config: {
                            systemInstruction: systemPrompt,
                            temperature: 0.7,
                            tools: tools
                        }
                    });
                    return finalResponse.text;
                }
                
                return response.text;
                
            } catch (error) {
                attempt++;
                console.error(`AI Error (Attempt ${attempt}):`, error.message);
                
                // Nếu bị 503 (Server bận), tự động lùi về bản 1.5 ổn định hơn
                if (error.status === 503 || error.message.includes('503')) {
                    console.warn(`[AI] Server ${currentModel} quá tải (503). Đang hạ cấp xuống gemini-1.5-flash...`);
                    currentModel = 'gemini-1.5-flash';
                    continue;
                }
                
                // Quay vòng Key nếu hết Quota (429)
                if (error.status === 429 || error.message.includes('429') || error.message.includes('quota')) {
                    console.warn("API hết Quota. Đang đổi API Key khác...");
                    const rotated = apiKeyManager.rotateKey();
                    
                    if (rotated) {
                        this.initClient();
                        console.log("Đã đổi Key. Đang thử lại...");
                        continue; 
                    } else {
                        return "Hệ thống AI hiện đang hết tài nguyên. Xin vui lòng thử lại sau.";
                    }
                }
                
                if (attempt > maxRetries) {
                    return "Xin lỗi, đã có lỗi xảy ra khi kết nối tới AI. Vui lòng báo cáo sếp.";
                }
            }
        }
        
        return "Xin lỗi, hệ thống AI không thể trả lời lúc này.";
    }
}

module.exports = new AiService();
