const express = require('express');

const router = express.Router();

// Development reset endpoint
router.post('/reset', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Reset endpoint disabled in production' });
  }
  res.json({ message: 'State reset successfully' });
});

module.exports = router;
