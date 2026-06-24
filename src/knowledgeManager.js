const googleService = require('./googleService');

class KnowledgeManager {
    async learn(question, answer) {
        await googleService.addFAQ(question, answer);
        console.log(`[Hệ thống tự học] Đã đẩy lên Google Sheets: Q: "${question}" -> A: "${answer}"`);
    }

    async getKnowledgeContext() {
        const rows = await googleService.readFAQ();
        if (rows.length === 0) return "";
        
        let context = "\n\n=== DỮ LIỆU ĐÃ HỌC TỪ SẾP ===\nDưới đây là các câu trả lời trước đó của Sếp cho những câu hỏi khó. Nếu khách hỏi câu tương tự, hãy tự tin trả lời dựa theo thông tin này mà KHÔNG CẦN CHUYỂN CHO SẾP (không trả lời ESCALATE_TO_BOSS):\n";
        
        for (let i = 1; i < rows.length; i++) { // Bỏ qua header nếu có
            if (rows[i] && rows[i].length >= 2) {
                context += `Q: ${rows[i][0]}\nA: ${rows[i][1]}\n---\n`;
            }
        }
        
        // Handle case where row[0] is data directly
        if (rows.length > 0 && rows[0][0] && !rows[0][0].toLowerCase().includes("question")) {
             context += `Q: ${rows[0][0]}\nA: ${rows[0][1]}\n---\n`;
        }
        return context;
    }
}

module.exports = new KnowledgeManager();
