const WebSocket = require('ws');
const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const { spawn } = require('child_process');

const app = express();
const PORT = 8080;

app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/client.html');
});

const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

const wss = new WebSocket.Server({ server, perMessageDeflate: false });

// Performance optimizations
const activeKeys = new Set();
let lastFrameSent = 0;
let frameInterval = 33; // ~30fps

// Ultra-fast screen capture (maim with lowest quality)
async function captureScreen() {
    return new Promise((resolve, reject) => {
        const filename = `/tmp/screenshot_${Date.now()}.jpg`;
        exec(`maim --quality 2 --delay 0.02 ${filename}`, (error) => {
            if (error) {
                exec(`scrot -o -q 10 ${filename}`, (error) => {
                    if (error) return reject(error);
                    fs.readFile(filename, (err, data) => {
                        fs.unlink(filename, () => {});
                        err ? reject(err) : resolve(data);
                    });
                });
                return;
            }
            fs.readFile(filename, (err, data) => {
                fs.unlink(filename, () => {});
                err ? reject(err) : resolve(data);
            });
        });
    });
}

// Input handlers
function moveMouse(x, y) { spawn('xdotool', ['mousemove', '--', x, y]); }
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

// Frame sending loop
async function sendFrames(ws) {
    try {
        const now = Date.now();
        if (now - lastFrameSent >= frameInterval) {
            const frame = await captureScreen();
            ws.send(frame, { binary: true }); // Send raw binary for lowest latency
            lastFrameSent = now;
        }
    } catch (error) {
        console.error('Frame error:', error);
    }
}

wss.on('connection', (ws) => {
    console.log('Client connected');
    ws.binaryType = 'arraybuffer';
    let frameIntervalId;

    // Dynamic frame rate adjustment
    const adjustFrameRate = () => {
        frameInterval = Math.max(16, Math.min(50, frameInterval)); // 20-60fps range
    };

    // Start sending frames immediately
    const sendFrameLoop = () => {
        sendFrames(ws);
        frameIntervalId = setTimeout(sendFrameLoop, frameInterval);
    };
    sendFrameLoop();

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            switch(data.type) {
                case 'mouseMove': moveMouse(data.x, data.y); break;
                case 'mouseClick': mouseClick(data.button); break;
                case 'keyDown': keyDown(data.key); break;
                case 'keyUp': keyUp(data.key); break;
                case 'latencyReport': 
                    adjustFrameRate();
                    break;
            }
        } catch (error) {
            console.error('Message error:', error);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        clearTimeout(frameIntervalId);
        activeKeys.forEach(key => keyUp(key));
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clearTimeout(frameIntervalId);
    });
});
