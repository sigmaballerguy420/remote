const fs = require('fs');
const https = require('https');
const WebSocket = require('ws');
const express = require('express');
const { exec } = require('child_process');
const { spawn } = require('child_process');

const app = express();
const PORT = 8080;

// SSL Certificate
const serverOptions = {
  cert: fs.readFileSync('./cert.pem'),
  key: fs.readFileSync('./privkey.pem')
};

// Serve static files
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/client.html');
});

// Create HTTPS server
const server = https.createServer(serverOptions, app).listen(PORT, () => {
  console.log(`Server running on https://localhost:${PORT}`);
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// Track pressed keys on server
const pressedKeys = new Set();

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
  keys.forEach(key => {
    spawn('xdotool', ['keydown', key]);
  });
}

function releaseKeys(keys) {
  keys.forEach(key => {
    spawn('xdotool', ['keyup', key]);
  });
}

wss.on('connection', (ws) => {
  console.log('Client connected');
  
  // Release any stuck keys when new client connects
  if (pressedKeys.size > 0) {
    releaseKeys(Array.from(pressedKeys));
    pressedKeys.clear();
  }
  
  // Start capture loop at 10fps
  const captureInterval = setInterval(async () => {
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
  }, 100);
  
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      
      switch(data.type) {
        case 'mouseMove':
          moveMouse(data.x, data.y);
          break;
        case 'mouseClick':
          mouseClick(data.button);
          break;
        case 'mouseDown':
          mouseDown(data.button);
          break;
        case 'mouseUp':
          mouseUp(data.button);
          break;
        case 'keyDown':
          if (!pressedKeys.has(data.key)) {
            pressedKeys.add(data.key);
            spawn('xdotool', ['keydown', data.key]);
          }
          break;
        case 'keyUp':
          if (pressedKeys.has(data.key)) {
            pressedKeys.delete(data.key);
            spawn('xdotool', ['keyup', data.key]);
          }
          break;
        case 'keyState':
          // Sync key states between client and server
          const keysToRelease = Array.from(pressedKeys).filter(
              k => !data.keys.includes(k));
          const keysToPress = data.keys.filter(
              k => !pressedKeys.has(k));
          
          if (keysToRelease.length > 0) {
            releaseKeys(keysToRelease);
            keysToRelease.forEach(k => pressedKeys.delete(k));
          }
          if (keysToPress.length > 0) {
            sendKeys(keysToPress);
            keysToPress.forEach(k => pressedKeys.add(k));
          }
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
    if (pressedKeys.size > 0) {
      releaseKeys(Array.from(pressedKeys));
      pressedKeys.clear();
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clearInterval(captureInterval);
    // Release all keys on error
    if (pressedKeys.size > 0) {
      releaseKeys(Array.from(pressedKeys));
      pressedKeys.clear();
    }
  });
});
