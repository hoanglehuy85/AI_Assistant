require('dotenv').config();
const aiService = require('./src/aiService');

async function test() {
    const text = "Giá 500k em nhé";
    const systemRole = "Bạn là trợ lý chăm sóc khách hàng. Nhiệm vụ của bạn là lấy câu trả lời thô của Sếp, viết lại cho thật lịch sự, chuyên nghiệp và CỰC KỲ NGẮN GỌN (dưới 1000 ký tự) để gửi cho khách. Chỉ trả về nội dung tin nhắn, không được giải thích lằng nhằng.";
    
    console.log("Calling AI...");
    let politeReply = await aiService.generateResponse(systemRole, `Câu trả lời của Sếp: "${text}"`);
    console.log("AI Reply:", politeReply);
}
test();
