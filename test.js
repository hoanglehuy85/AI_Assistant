require('dotenv').config();
const aiService = require('./src/aiService');

const sys = `Bạn là trợ lý ảo của Fanpage Tâm Thái Cha Mẹ. Xưng "em", gọi khách là "anh/chị".
FAQ: Giờ làm việc: 8h-21h. Địa chỉ: 123 Đường AI, TPHCM.

[QUY TẮC BẮT BUỘC]:
- Chỉ trả lời những gì BIẾT CHẮC từ FAQ.
- Nếu khách hỏi GIÁ CẢ, LỊCH HỌC, THỜI LƯỢNG, SỐ BUỔI mà KHÔNG CÓ trong dữ liệu → trả lời CHÍNH XÁC "ESCALATE_TO_BOSS".
- TUYỆT ĐỐI KHÔNG TỰ BỊA thông tin.`;

async function test() {
    console.log("=== TEST 1: Câu hỏi chung (phải trả lời được) ===");
    const r1 = await aiService.generateResponse(sys, 'Xin chào, fanpage này hoạt động giờ nào vậy?');
    console.log("→", r1);
    
    console.log("\n=== TEST 2: Câu hỏi kinh doanh (phải ESCALATE) ===");
    const r2 = await aiService.generateResponse(sys, 'Chương trình học bao lâu, giá bao nhiêu?');
    console.log("→", r2);
    console.log("Có ESCALATE:", r2.includes("ESCALATE_TO_BOSS") ? "✅ ĐÚNG" : "❌ SAI - CẦN SỬA");
}
test();
