/**
 * EscalationManager - Quản lý hàng đợi câu hỏi chờ Sếp trả lời
 * Hỗ trợ nhiều khách hàng escalate cùng lúc, xử lý tuần tự (FIFO).
 */
class EscalationManager {
    constructor() {
        this.queue = [];         // [{psid, question, timestamp}]
        this.current = null;     // Câu hỏi Sếp đang trả lời: {psid, question}
        this.state = 'IDLE';     // 'IDLE' | 'ANSWERING'
    }

    /**
     * Thêm câu hỏi vào hàng đợi
     * @returns {{shouldNotifyBoss: boolean, question: string, position: number}}
     */
    addToQueue(psid, question) {
        const item = { psid, question, timestamp: Date.now() };

        if (this.state === 'IDLE' && !this.current) {
            // Sếp đang rảnh → gửi ngay
            this.current = item;
            this.state = 'ANSWERING';
            return { shouldNotifyBoss: true, question, position: 0 };
        } else {
            // Sếp đang bận → xếp hàng
            this.queue.push(item);
            return { shouldNotifyBoss: false, question, position: this.queue.length };
        }
    }

    /**
     * Sếp đã trả lời câu hỏi hiện tại
     * @param {string} answer - Câu trả lời của Sếp
     * @returns {{psid, question, answer}} - Thông tin để gửi cho khách
     */
    bossAnswered(answer) {
        if (!this.current) return null;

        const result = {
            psid: this.current.psid,
            question: this.current.question,
            answer: answer
        };

        this.current = null;
        this._processNext();

        return result;
    }

    /**
     * Sếp bỏ qua câu hỏi hiện tại
     * @returns {{psid, question}} - Thông tin khách bị skip
     */
    skipCurrent() {
        if (!this.current) return null;

        const skipped = {
            psid: this.current.psid,
            question: this.current.question
        };

        this.current = null;
        this._processNext();

        return skipped;
    }

    /**
     * Lấy câu hỏi tiếp theo từ hàng đợi
     */
    _processNext() {
        if (this.queue.length > 0) {
            this.current = this.queue.shift();
            this.state = 'ANSWERING';
        } else {
            this.state = 'IDLE';
        }
    }

    /**
     * Kiểm tra Sếp đang bận trả lời hay rảnh
     */
    isBossAnswering() {
        return this.state === 'ANSWERING' && this.current !== null;
    }

    /**
     * Lấy câu hỏi đang chờ Sếp trả lời
     */
    getCurrentQuestion() {
        return this.current;
    }

    /**
     * Lấy số câu hỏi đang chờ trong hàng đợi
     */
    getQueueLength() {
        return this.queue.length;
    }

    /**
     * Lấy thông tin để thông báo cho Sếp về câu hỏi tiếp theo (nếu có)
     * @returns {string|null} - Tin nhắn gửi cho Sếp, hoặc null nếu hết hàng đợi
     */
    getNextNotification() {
        if (!this.current) return null;
        const queueInfo = this.queue.length > 0 ? `\n(Còn ${this.queue.length} câu hỏi đang chờ)` : '';
        return `📩 Có khách hỏi:\n"${this.current.question}"\n\n👉 Sếp gõ câu trả lời (gộp 1 tin nhắn). Gõ "bỏ qua" để skip.${queueInfo}`;
    }
}

module.exports = new EscalationManager();
