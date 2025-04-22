const fs = require('fs');
const https = require('https');
const WebSocket = require('ws');
const express = require('express');
const { exec } = require('child_process');
const { spawn } = require('child_process');

const app = express();
const PORT = 443; // Standard HTTPS port

// SSL Certificate (generate self-signed if needed)
const privateKey = fs.readFileSync('/etc/letsencrypt/live/yourdomain.com/privkey.pem', 'utf8');
const certificate = fs.readFileSync('/etc/letsencrypt/live/yourdomain.com/cert.pem', 'utf8');
const ca = fs.readFileSync('/etc/letsencrypt/live/yourdomain.com/chain.pem', 'utf8');

const credentials = {
    key: privateKey,
    cert: certificate,
    ca: ca
};

app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/client.html');
});

const httpsServer = https.createServer(credentials, app);
httpsServer.listen(PORT, () => {
    console.log(`Secure server running on https://localhost:${PORT}`);
});

const wss = new WebSocket.Server({ 
    server: httpsServer,
    perMessageDeflate: false 
});

// Track active keys
const activeKeys = new Set();

// Optimized screen capture
async function captureScreen() {
    return new Promise((resolve, reject) => {
        const filename = `/tmp/screenshot_${Date.now()}.jpg`;
        exec(`maim --quality 3 ${filename}`, (error) => {
            if (error) return reject(error);
            fs.readFile(filename, (err, data) => {
                fs.unlink(filename, () => {});
                err ? reject(err) : resolve(data);
            });
        });
    });
}

// Input handlers
function moveMouse(x, y) { spawn('xdotool', ['mousemove', x, y]); }
function mouseClick(button) { spawn('xdotool', ['click', button]); }
function keyDown(key) { 
    if (!activeKeys.has(key)) {
        activeKeys.add(key);
        spawn('xdotool', ['keydown', key]); 
    }
}
function keyUp(key) { 
    if (activeKeys.has(key)) {
        activeKeys.delete(key);
        spawn('xdotool', ['keyup', key]); 
    }
}

wss.on('connection', (ws) => {
    console.log('Secure client connected');
    ws.binaryType = 'arraybuffer';
    
    // 20fps frame rate (50ms interval)
    const frameInterval = setInterval(async () => {
        try {
            const frame = await captureScreen();
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(frame);
            }
        } catch (error) {
            console.error('Capture error:', error);
        }
    }, 50);

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            switch(data.type) {
                case 'mouseMove': moveMouse(data.x, data.y); break;
                case 'mouseClick': mouseClick(data.button); break;
                case 'keyDown': keyDown(data.key); break;
                case 'keyUp': keyUp(data.key); break;
            }
        } catch (error) {
            console.error('Message error:', error);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        clearInterval(frameInterval);
        activeKeys.forEach(key => keyUp(key));
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clearInterval(frameInterval);
    });
});
