import { Router } from 'express';
import session from './session.routes.js';
import feed from './feed.routes.js';
import analytics from './analytics.routes.js';
import settings from './settings.routes.js';
import simulate from './simulate.routes.js';

const router = Router();

router.use('/session', session);
router.use('/analytics', analytics);
router.use('/settings', settings);
router.use('/simulate', simulate);
// feed.routes defines its own top-level paths (/events, /history/:id).
router.use('/', feed);

export default router;
