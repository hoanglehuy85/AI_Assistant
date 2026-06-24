require('dotenv').config();

class ApiKeyManager {
    constructor() {
        // Load all keys starting with GEMINI_API_KEY_ from environment
        this.keys = [];
        for (let i = 1; i <= 5; i++) {
            const key = process.env[`GEMINI_API_KEY_${i}`];
            if (key) {
                this.keys.push(key);
            }
        }
        
        if (this.keys.length === 0) {
            console.warn("WARNING: No Gemini API keys found in .env file.");
        }
        
        this.currentIndex = 0;
        console.log(`Loaded ${this.keys.length} Gemini API keys for rotation.`);
    }

    getCurrentKey() {
        if (this.keys.length === 0) return null;
        return this.keys[this.currentIndex];
    }

    // Call this method when a 429 Too Many Requests error occurs
    rotateKey() {
        if (this.keys.length <= 1) {
            console.warn("Only one or zero keys available. Cannot rotate.");
            return false;
        }
        
        const oldIndex = this.currentIndex;
        this.currentIndex = (this.currentIndex + 1) % this.keys.length;
        console.log(`[API Key Rotator] Switched from Key #${oldIndex + 1} to Key #${this.currentIndex + 1}`);
        return true;
    }
}

// Export a singleton instance
module.exports = new ApiKeyManager();
