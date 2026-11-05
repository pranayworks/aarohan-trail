const express = require('express');

const router = express.Router();

// Development reset endpoint
router.post('/reset', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Reset endpoint disabled in production' });
  }
  res.json({ message: 'State reset successfully' });
});

// Development simulate location endpoint (STRICTLY BLOCKED in production)
router.post('/dev/simulate-location', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({
      error: 'Location simulation is strictly disabled in production mode.',
      code: 'DEV_SIMULATION_FORBIDDEN'
    });
  }

  const { landmark = 'Gateway Mall' } = req.body || {};
  const mockCoords = {
    'Gateway Mall': { lat: -13.9722, lng: 33.7667, name: 'Gateway Mall, Kaunda Road, Area 47' },
    'City Centre': { lat: -13.9620, lng: 33.7880, name: 'City Centre (Capital Hill), Area 20' },
    'Old Town': { lat: -13.9840, lng: 33.7720, name: 'Old Town Mall & Market, Area 2' },
    'BNS': { lat: -13.9482, lng: 33.7431, name: 'Bingu National Stadium (BNS), Area 49' },
    'Lilongwe Airport': { lat: -13.7894, lng: 33.7811, name: 'Kamuzu International Airport (LLW)' }
  };

  const point = mockCoords[landmark] || mockCoords['Gateway Mall'];
  res.json({
    success: true,
    simulated: true,
    location: point
  });
});

module.exports = router;
