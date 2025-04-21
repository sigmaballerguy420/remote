const WebSocket = require('ws');
const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const { spawn } = require('child_process');

const app = express();
const PORT = 8080;

// Serve static files
app.use(express.static('public'));

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/client.html');
});

const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

const wss = new WebSocket.Server({ server });

// Frame queue management
let activeFrame = null;
let frameQueue = [];
let isCapturing = false;

// Optimized screen capture using maim (faster than scrot)
async function captureScreen() {
    const timestamp = Date.now();
    const filename = `/tmp/screenshot_${timestamp}.jpg`;
    
    return new Promise((resolve, reject) => {
        exec(`maim --quality 5 --delay 0.1 ${filename}`, (error) => {
            if (error) {
                // Fallback to scrot if maim fails
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

// Input control functions (same as before)
function moveMouse(x, y) { spawn('xdotool', ['mousemove', '--', x, y]); }
function mouseClick(button) { spawn('xdotool', ['click', '--sync', button]); }
function mouseDown(button) { spawn('xdotool', ['mousedown', button]); }
function mouseUp(button) { spawn('xdotool', ['mouseup', button]); }
function sendKeys(keys) { 
    spawn('xdotool', ['getactivewindow', 'windowfocus', '--sync']);
    spawn('xdotool', ['type', '--clearmodifiers', '--delay', '10', keys]); 
}

// Frame capture loop
async function captureLoop(ws) {
    if (isCapturing) return;
    isCapturing = true;
    
    try {
        const frame = await captureScreen();
        
        // Only keep the latest frame
        frameQueue = [frame];
        
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
                type: 'screen',
                data: frame.toString('base64'),
                timestamp: Date.now()
            }));
        }
    } catch (error) {
        console.error('Capture error:', error);
    } finally {
        isCapturing = false;
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
                case 'keyPress': sendKeys(data.keys); break;
            }
        } catch (error) {
            console.error('Message error:', error);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        clearInterval(captureInterval);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clearInterval(captureInterval);
    });
});
