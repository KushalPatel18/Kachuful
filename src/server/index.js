/**
 * Entry point to launch the Kachuful Online server.
 * Uses port 3005 by default (avoiding IDE Live Preview on 3000-3001) with automatic port fallback.
 */

import os from 'node:os';
import { createServerApp } from './server.js';

function getLocalIp() {
  try {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const net of interfaces[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          return net.address;
        }
      }
    }
  } catch (_) {}
  return 'localhost';
}

function startServer(targetPort = Number(process.env.PORT) || 3005) {
  let port = targetPort;
  const maxAttempts = 10;
  let attempts = 0;

  function attemptListen(p) {
    const { server } = createServerApp();

    server.once('error', (err) => {
      server.close();
      if (err.code === 'EADDRINUSE' && attempts < maxAttempts) {
        attempts++;
        console.warn(`⚠️  Port ${p} is in use. Trying port ${p + 1}...`);
        attemptListen(p + 1);
      } else {
        console.error('❌ Failed to start Kachuful server:', err);
      }
    });

    server.listen(p, '0.0.0.0', () => {
      const localIp = getLocalIp();
      console.log('╔════════════════════════════════════════════════════════════════╗');
      console.log('║       ♠️ ♥️ Kachuful / Judgement Online Server Active! ♣️ ♦️       ║');
      console.log('╠════════════════════════════════════════════════════════════════╣');
      console.log(`║ 💻 Local (Host PC):   http://localhost:${p}                    ║`);
      if (localIp !== 'localhost') {
        const lanLine = `║ 📱 Mobile / Wi-Fi:    http://${localIp}:${p}`;
        console.log(lanLine.padEnd(65) + '║');
        console.log('║    ↳ Share the Mobile / Wi-Fi link with friends to play!      ║');
      }
      console.log('╚════════════════════════════════════════════════════════════════╝');
    });
  }

  attemptListen(port);
}

startServer();
