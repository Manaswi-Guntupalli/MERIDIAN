import { Router } from 'express';
import readers from './readers.routes.js';
import cards from './cards.routes.js';
import scan from './scan.routes.js';
import feed from './feed.routes.js';
import analytics from './analytics.routes.js';
import settings from './settings.routes.js';
import simulate from './simulate.routes.js';

const router = Router();

router.use('/readers', readers);
router.use('/cards', cards);
router.use('/analytics', analytics);
router.use('/settings', settings);
router.use('/simulate', simulate);
// scan.routes and feed.routes each define their own top-level paths
// (/scan, /unknown, /events, /history/:id) rather than a shared prefix.
router.use('/', scan);
router.use('/', feed);

export default router;
