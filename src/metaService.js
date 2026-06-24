const axios = require('axios');

class MetaService {
    constructor() {
        this.mainPageToken = process.env.PAGE_ACCESS_TOKEN_MAIN;
        this.privatePageToken = process.env.PAGE_ACCESS_TOKEN_PRIVATE;
        this.mainPageId = null;
        this.privatePageId = null;
    }

    async init() {
        this.mainPageId = process.env.PAGE_ID_MAIN;
        this.privatePageId = process.env.PAGE_ID_PRIVATE;

        if (!this.mainPageId || !this.privatePageId) {
            console.error("[CẢNH BÁO] Chưa cấu hình PAGE_ID_MAIN hoặc PAGE_ID_PRIVATE trong file .env!");
        } else {
            console.log(`[Meta] Đã tải Page IDs: Main(${this.mainPageId}), Private(${this.privatePageId})`);
        }
    }

    async sendMessage(pageId, recipientId, text) {
        let token = null;
        if (pageId === this.mainPageId) {
            token = this.mainPageToken;
        } else if (pageId === this.privatePageId) {
            token = this.privatePageToken;
        } else {
            console.error(`[Meta] Unknown pageId: ${pageId}`);
            return false;
        }

        try {
            await axios.post(
                `https://graph.facebook.com/v19.0/${pageId}/messages?access_token=${token}`,
                {
                    recipient: { id: recipientId },
                    message: { text: text }
                }
            );
            console.log(`[Meta] Đã gửi tin nhắn tới ${recipientId} qua Page ${pageId}`);
            return true;
        } catch (error) {
            console.error("[Meta] Lỗi gửi tin nhắn:", error.response ? error.response.data : error.message);
            return false;
        }
    }
}

module.exports = new MetaService();
