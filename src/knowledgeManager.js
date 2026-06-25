const googleService = require('./googleService');

class KnowledgeManager {
    /**
     * Lưu câu hỏi-trả lời mới vào Google Sheets (Bot tự học)
     */
    async learn(question, answer) {
        await googleService.addFAQ(question, answer);
        console.log(`[KB] Đã học: Q: "${question}" → A: "${answer}"`);
    }

    /**
     * Lấy danh sách FAQ có cấu trúc (cho AI classify)
     * @returns {Array<{index: number, question: string, answer: string}>}
     */
    async getFAQList() {
        const rows = await googleService.readFAQ();
        if (rows.length === 0) return [];

        const list = [];
        for (let i = 0; i < rows.length; i++) {
            if (rows[i] && rows[i].length >= 2 && rows[i][0] && rows[i][1]) {
                // Bỏ qua header nếu có
                if (i === 0 && rows[i][0].toLowerCase().includes('question')) continue;
                list.push({
                    index: list.length + 1,
                    question: rows[i][0],
                    answer: rows[i][1]
                });
            }
        }
        return list;
    }

    /**
     * Lấy câu trả lời theo index FAQ
     * @param {number} faqIndex - Số thứ tự FAQ (1-based)
     * @param {Array} faqList - Danh sách FAQ đã load
     * @returns {string|null}
     */
    getAnswerByIndex(faqIndex, faqList) {
        const item = faqList.find(f => f.index === faqIndex);
        return item ? item.answer : null;
    }
}

module.exports = new KnowledgeManager();
