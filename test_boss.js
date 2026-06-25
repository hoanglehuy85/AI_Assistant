require('dotenv').config();
const aiService = require('./src/aiService');
const googleService = require('./src/googleService');
const escalationManager = require('./src/escalationManager');

async function testBossAI() {
    console.log('=== TEST BOSS AI (Trợ lý thông minh) ===\n');
    await googleService.init();

    const chatHistory = [];

    // Test 1: Chào hỏi
    console.log('--- Sếp: "Chào em" ---');
    const r1 = await aiService.generateBossResponse('Chào em', chatHistory, googleService, escalationManager);
    console.log('Bot:', r1);
    chatHistory.push({ role: 'user', content: 'Chào em' });
    chatHistory.push({ role: 'assistant', content: r1 });

    // Test 2: Xem lịch (sẽ gọi Calendar API thật)
    console.log('\n--- Sếp: "Lịch hôm nay của tôi thế nào?" ---');
    const r2 = await aiService.generateBossResponse('Lịch hôm nay của tôi thế nào?', chatHistory, googleService, escalationManager);
    console.log('Bot:', r2);
    chatHistory.push({ role: 'user', content: 'Lịch hôm nay của tôi thế nào?' });
    chatHistory.push({ role: 'assistant', content: r2 });

    // Test 3: Đặt lịch
    console.log('\n--- Sếp: "Thêm lịch ngày mai 10h sáng họp với team" ---');
    const r3 = await aiService.generateBossResponse('Thêm lịch ngày mai 10h sáng họp với team', chatHistory, googleService, escalationManager);
    console.log('Bot:', r3);

    console.log('\n=== KẾT THÚC TEST ===');
}

testBossAI().catch(console.error);
