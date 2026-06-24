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
        
        while (attempt <= maxRetries) {
            try {
                // Nâng cấp lên model gemini-3.5-flash mới nhất và thông minh nhất
                const response = await this.ai.models.generateContent({
                    model: 'gemini-3.5-flash',
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
                        model: 'gemini-3.5-flash',
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
                
                // Quay vòng Key nếu hết Quota (429) hoặc Server Quá tải (503)
                if (error.status === 429 || error.status === 503 || error.message.includes('429') || error.message.includes('503') || error.message.includes('quota')) {
                    console.warn("API Quá tải hoặc hết Quota. Đang đổi API Key khác...");
                    const rotated = apiKeyManager.rotateKey();
                    
                    if (rotated) {
                        this.initClient();
                        console.log("Đã đổi Key. Đang thử lại...");
                        continue; 
                    } else {
                        return "Hệ thống AI hiện đang quá tải và không còn key dự phòng. Xin vui lòng thử lại sau.";
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
