const { google } = require('googleapis');
const path = require('path');

class GoogleService {
    constructor() {
        this.sheetId = process.env.GOOGLE_SHEET_ID;
        
        const scopes = [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/calendar'
        ];

        if (process.env.GOOGLE_CREDENTIALS) {
            const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
            this.auth = new google.auth.GoogleAuth({ credentials, scopes });
        } else {
            const keyFilePath = path.join(__dirname, '../credentials.json');
            this.auth = new google.auth.GoogleAuth({ keyFile: keyFilePath, scopes });
        }
        
        this.sheets = google.sheets({ version: 'v4', auth: this.auth });
        this.calendar = google.calendar({ version: 'v3', auth: this.auth });
    }

    async init() {
        try {
            await this.auth.getClient();
            console.log("[Google] Đã xác thực Service Account thành công.");
            // Ensure sheets exist
            await this.ensureSheetsExist();
        } catch (error) {
            console.error("[Google] Lỗi xác thực:", error.message);
        }
    }

    async ensureSheetsExist() {
        try {
            if (!this.sheetId) return; // Bỏ qua nếu không có sheet
            const res = await this.sheets.spreadsheets.get({ spreadsheetId: this.sheetId });
            const sheetTitles = res.data.sheets.map(s => s.properties.title);
            
            const requests = [];
            if (!sheetTitles.includes('FAQ')) {
                requests.push({ addSheet: { properties: { title: 'FAQ' } } });
            }
            if (!sheetTitles.includes('Config')) {
                requests.push({ addSheet: { properties: { title: 'Config' } } });
            }
            
            if (requests.length > 0) {
                await this.sheets.spreadsheets.batchUpdate({
                    spreadsheetId: this.sheetId,
                    resource: { requests }
                });
                console.log("[Google] Đã tạo các Sheet còn thiếu (FAQ, Config).");
            }
        } catch (error) {
            console.error("[Google] Lỗi kiểm tra Sheet:", error.message);
        }
    }

    async readFAQ() {
        try {
            if (!this.sheetId) return [];
            const res = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.sheetId,
                range: 'FAQ!A:B',
            });
            return res.data.values || [];
        } catch (error) {
            console.error("[Google] Lỗi đọc FAQ:", error.message);
            return [];
        }
    }

    async addFAQ(question, answer) {
        try {
            if (!this.sheetId) return;
            await this.sheets.spreadsheets.values.append({
                spreadsheetId: this.sheetId,
                range: 'FAQ!A:B',
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: [[question, answer]]
                }
            });
        } catch (error) {
            console.error("[Google] Lỗi ghi FAQ:", error.message);
        }
    }

    async readConfig(key) {
        try {
            if (!this.sheetId) return null;
            const res = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.sheetId,
                range: 'Config!A:B',
            });
            const rows = res.data.values || [];
            const row = rows.find(r => r[0] === key);
            return row ? row[1] : null;
        } catch (error) {
            console.error("[Google] Lỗi đọc Config:", error.message);
            return null;
        }
    }

    async writeConfig(key, value) {
        try {
            if (!this.sheetId) return;
            const res = await this.sheets.spreadsheets.values.get({
                spreadsheetId: this.sheetId,
                range: 'Config!A:B',
            });
            const rows = res.data.values || [];
            const rowIndex = rows.findIndex(r => r[0] === key);

            if (rowIndex >= 0) {
                // Update
                const range = `Config!B${rowIndex + 1}`;
                await this.sheets.spreadsheets.values.update({
                    spreadsheetId: this.sheetId,
                    range: range,
                    valueInputOption: 'USER_ENTERED',
                    resource: { values: [[value]] }
                });
            } else {
                // Append
                await this.sheets.spreadsheets.values.append({
                    spreadsheetId: this.sheetId,
                    range: 'Config!A:B',
                    valueInputOption: 'USER_ENTERED',
                    resource: { values: [[key, value]] }
                });
            }
        } catch (error) {
            console.error("[Google] Lỗi ghi Config:", error.message);
        }
    }

    async checkAvailability(timeMin, timeMax) {
        try {
            const res = await this.calendar.events.list({
                calendarId: 'huyhoangnlp@gmail.com',
                timeMin: timeMin,
                timeMax: timeMax,
                singleEvents: true,
                orderBy: 'startTime',
            });
            const events = res.data.items;
            if (events.length === 0) {
                return "Không có lịch trình nào. Khung giờ này Sếp rảnh rỗi.";
            } else {
                let report = "Sếp đang bận vào các lịch sau:\n";
                events.forEach(event => {
                    const start = event.start.dateTime || event.start.date;
                    const end = event.end.dateTime || event.end.date;
                    report += `- ${event.summary} (Từ ${start} đến ${end})\n`;
                });
                return report;
            }
        } catch (error) {
            console.error("[Google] Lỗi kiểm tra lịch:", error.message);
            return "Đã xảy ra lỗi khi truy cập lịch.";
        }
    }

    async bookAppointment(summary, startTime, endTime) {
        try {
            const event = {
                summary: summary,
                start: { dateTime: startTime },
                end: { dateTime: endTime },
            };
            const res = await this.calendar.events.insert({
                calendarId: 'huyhoangnlp@gmail.com',
                resource: event,
            });
            return `Đã đặt lịch thành công! Sự kiện: ${summary} (Link: ${res.data.htmlLink})`;
        } catch (error) {
            console.error("[Google] Lỗi tạo lịch hẹn:", error.message);
            return "Đã xảy ra lỗi khi tạo lịch hẹn.";
        }
    }
}

module.exports = new GoogleService();
