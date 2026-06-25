/**
 * MessageDebouncer - Gộp tin nhắn liên tiếp từ cùng 1 người
 * Khi nhận tin nhắn, đợi 3 giây. Nếu có thêm tin → gộp lại → xử lý 1 lần.
 */
class MessageDebouncer {
    constructor(delayMs = 3000) {
        this.delayMs = delayMs;
        this.pending = new Map(); // senderId -> { messages: [], timer, resolve }
    }

    /**
     * Thêm tin nhắn vào hàng đợi. Trả về Promise resolve khi hết thời gian chờ.
     * @param {string} senderId - ID người gửi
     * @param {string} text - Nội dung tin nhắn
     * @returns {Promise<string|null>} - Chuỗi gộp hoặc null nếu đã có pending
     */
    add(senderId, text) {
        return new Promise((resolve) => {
            if (this.pending.has(senderId)) {
                // Đã có tin nhắn đang chờ → gộp thêm, reset timer
                const entry = this.pending.get(senderId);
                entry.messages.push(text);
                clearTimeout(entry.timer);
                entry.timer = setTimeout(() => this._flush(senderId), this.delayMs);
                // Resolve ngay với null (tin nhắn này đã được gộp vào pending)
                resolve(null);
            } else {
                // Tin nhắn đầu tiên → tạo entry mới
                const entry = {
                    messages: [text],
                    timer: null,
                    resolve: null
                };
                entry.resolve = resolve;
                entry.timer = setTimeout(() => this._flush(senderId), this.delayMs);
                this.pending.set(senderId, entry);
            }
        });
    }

    _flush(senderId) {
        const entry = this.pending.get(senderId);
        if (!entry) return;

        const combined = entry.messages.join('\n');
        this.pending.delete(senderId);
        
        console.log(`[Debounce] Gộp ${entry.messages.length} tin nhắn từ ${senderId}: "${combined.substring(0, 80)}..."`);
        entry.resolve(combined);
    }
}

module.exports = MessageDebouncer;
