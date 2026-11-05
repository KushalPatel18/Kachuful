/**
 * Entry point to launch the Kachuful Online server.
 */

import { createServerApp } from './server.js';

const PORT = process.env.PORT || 3000;
const { server } = createServerApp();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`♠️ ♥️ Kachuful Online server listening on http://0.0.0.0:${PORT} (http://localhost:${PORT}) ♣️ ♦️`);
});
