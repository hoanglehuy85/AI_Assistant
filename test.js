require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

async function test() {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY_1 });
        const response = await ai.models.generateContent({
            model: 'gemini-3.5-flash',
            contents: 'hello'
        });
        console.log("SUCCESS:", response.text);
    } catch (error) {
        console.log("ERROR:", error.message);
    }
}
test();
