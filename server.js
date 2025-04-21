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

const wss = new WebSocket.Server({ server });

// Track active keys
const activeKeys = new Set();

// Optimized screen capture
async function captureScreen() {
    const timestamp = Date.now();
    const filename = `/tmp/screenshot_${timestamp}.jpg`;
    
    return new Promise((resolve, reject) => {
        exec(`maim --quality 5 --delay 0.1 ${filename}`, (error) => {
            if (error) {
                exec(`scrot -o -q 50 ${filename}`, (error) => {
                    if (error) return reject(error);
                    readAndSend(filename, resolve, reject);
                });
                return;
            }
            readAndSend(filename, resolve, reject);
        });
    });
}

function readAndSend(filename, resolve, reject) {
    fs.readFile(filename, (err, data) => {
        fs.unlink(filename, () => {});
        err ? reject(err) : resolve(data);
    });
}

// Input control functions
function moveMouse(x, y) { spawn('xdotool', ['mousemove', '--', x, y]); }
function mouseClick(button) { spawn('xdotool', ['click', '--sync', button]); }
function mouseDown(button) { spawn('xdotool', ['mousedown', button]); }
function mouseUp(button) { spawn('xdotool', ['mouseup', button]); }

function sendKeys(keys) {
    spawn('xdotool', ['getactivewindow', 'windowfocus', '--sync']);
    spawn('xdotool', ['type', '--clearmodifiers', '--delay', '10', keys]); 
}

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

// Frame capture loop
async function captureLoop(ws) {
    try {
        const frame = await captureScreen();
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'screen',
                data: frame.toString('base64'),
                timestamp: Date.now()
            }));
        }
    } catch (error) {
        console.error('Capture error:', error);
    }
}

wss.on('connection', (ws) => {
    console.log('Client connected');
    
    // Start capture loop at 10fps
    const captureInterval = setInterval(() => captureLoop(ws), 100);
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            switch(data.type) {
                case 'mouseMove': moveMouse(data.x, data.y); break;
                case 'mouseClick': mouseClick(data.button); break;
                case 'mouseDown': mouseDown(data.button); break;
                case 'mouseUp': mouseUp(data.button); break;
                case 'keyDown': keyDown(data.key); break;
                case 'keyUp': keyUp(data.key); break;
                case 'keyStates': 
                    // Sync key states
                    const currentKeys = new Set(data.keys);
                    // Release keys no longer pressed
                    activeKeys.forEach(key => {
                        if (!currentKeys.has(key)) {
                            keyUp(key);
                        }
                    });
                    // Press new keys
                    currentKeys.forEach(key => {
                        if (!activeKeys.has(key)) {
                            keyDown(key);
                        }
                    });
                    break;
            }
        } catch (error) {
            console.error('Message error:', error);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        clearInterval(captureInterval);
        // Release all keys when client disconnects
        activeKeys.forEach(key => keyUp(key));
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clearInterval(captureInterval);
        activeKeys.forEach(key => keyUp(key));
    });
});
