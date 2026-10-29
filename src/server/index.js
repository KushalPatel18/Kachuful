/**
 * Entry point to launch the Kachuful Online server.
 */

import { createServerApp } from './server.js';

const PORT = process.env.PORT || 3000;
const { server } = createServerApp();

server.listen(PORT, () => {
  console.log(`♠️ ♥️ Kachuful Online server listening on http://localhost:${PORT} ♣️ ♦️`);
});
