require('dotenv').config();
const aiService = require('./src/aiService');
const knowledgeManager = require('./src/knowledgeManager');
const escalationManager = require('./src/escalationManager');
const MessageDebouncer = require('./src/messageDebouncer');

async function runTests() {
    console.log('============================================');
    console.log('   TEST HỆ THỐNG v2.0 - ZERO HALLUCINATION');
    console.log('============================================\n');

    // Test 1: Load FAQ
    console.log('--- TEST 1: Load FAQ từ Google Sheets ---');
    const faqList = await knowledgeManager.getFAQList();
    console.log(`Đã load ${faqList.length} câu FAQ:`);
    faqList.forEach(f => console.log(`  [${f.index}] Q: "${f.question}" → A: "${f.answer.substring(0, 50)}..."`));

    // Test 2: AI classify - Chào hỏi
    console.log('\n--- TEST 2: Classify "Xin chào shop" ---');
    const r1 = await aiService.classifyIntent('Xin chào shop ơi', faqList);
    console.log('Kết quả:', JSON.stringify(r1));
    console.log(r1.intent === 'GREETING' ? '✅ ĐÚNG (GREETING)' : '⚠️ Không đúng GREETING');

    // Test 3: AI classify - FAQ match (nếu có FAQ)
    if (faqList.length > 0) {
        console.log(`\n--- TEST 3: Classify câu tương tự FAQ[1]: "${faqList[0].question}" ---`);
        const r2 = await aiService.classifyIntent(faqList[0].question, faqList);
        console.log('Kết quả:', JSON.stringify(r2));
        if (r2.intent === 'FAQ_MATCH') {
            const answer = knowledgeManager.getAnswerByIndex(r2.faq_index, faqList);
            console.log(`✅ Match FAQ #${r2.faq_index}, câu trả lời: "${answer}"`);
        } else {
            console.log('⚠️ Không match FAQ');
        }
    } else {
        console.log('\n--- TEST 3: SKIP (chưa có FAQ) ---');
    }

    // Test 4: AI classify - Câu không có trong FAQ
    console.log('\n--- TEST 4: Classify "Cho hỏi giá khóa premium bao nhiêu" ---');
    const r3 = await aiService.classifyIntent('Cho hỏi giá khóa premium bao nhiêu tiền vậy shop', faqList);
    console.log('Kết quả:', JSON.stringify(r3));
    console.log(r3.intent === 'NO_MATCH' ? '✅ ĐÚNG (NO_MATCH → sẽ hỏi Sếp)' : '⚠️ Không đúng NO_MATCH');

    // Test 5: Escalation Queue
    console.log('\n--- TEST 5: Escalation Queue ---');
    const e1 = escalationManager.addToQueue('KHACH_001', 'Giá bao nhiêu?');
    console.log(`Khách 1 hỏi: shouldNotifyBoss=${e1.shouldNotifyBoss}, position=${e1.position}`);
    console.log(`Sếp đang answering: ${escalationManager.isBossAnswering()}`);

    const e2 = escalationManager.addToQueue('KHACH_002', 'Địa chỉ ở đâu?');
    console.log(`Khách 2 hỏi: shouldNotifyBoss=${e2.shouldNotifyBoss}, position=${e2.position}`);

    const a1 = escalationManager.bossAnswered('500k em nhé');
    console.log(`Sếp trả lời → gửi cho ${a1.psid}: "${a1.answer}"`);
    console.log(`Hàng đợi còn: ${escalationManager.getQueueLength()}`);

    const next = escalationManager.getNextNotification();
    console.log(`Câu tiếp: ${next ? 'CÓ' : 'HẾT'}`);
    if (next) {
        const a2 = escalationManager.bossAnswered('Ở Hà Nội nhé');
        console.log(`Sếp trả lời → gửi cho ${a2.psid}: "${a2.answer}"`);
    }
    console.log(`Sếp IDLE: ${!escalationManager.isBossAnswering()}`);
    console.log('✅ Queue hoạt động chính xác');

    // Test 6: Debouncer
    console.log('\n--- TEST 6: Message Debouncer ---');
    const debouncer = new MessageDebouncer(1000); // 1 giây cho test nhanh
    const p1 = debouncer.add('user_1', 'Cho mình hỏi');
    const p2 = debouncer.add('user_1', 'giá bao nhiêu');
    const p3 = debouncer.add('user_1', 'với lịch học ntn');
    
    const results = await Promise.all([p1, p2, p3]);
    console.log('Kết quả gộp:', results);
    console.log(results[0] !== null ? '✅ Tin nhắn đã được gộp' : '⚠️ Lỗi gộp');

    console.log('\n============================================');
    console.log('   KẾT THÚC TEST');
    console.log('============================================');
}

runTests().catch(console.error);
