import { main } from '../tui/index.js';

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
