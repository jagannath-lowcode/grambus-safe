var express = require('express');
var router = express.Router();

/* GET users listing. */
router.get('/', function(req, res, next) {
  res.send('respond with a resource');
});




// // routes/tripStoppages.js


// /**
//  * Generate trip_stoppages for a given trip.
//  * Body params:
//  * - trip_id
//  * - pattern_id
//  * - start_stop_id
//  * - end_stop_id
//  */
router.post("/generate-trip-stoppages", async (req, res) => {
  const { trip_id, pattern_id, start_stop_id, end_stop_id } = req.body;

  if (!trip_id || !pattern_id || !start_stop_id || !end_stop_id) {
    return res.status(400).json({ error: "trip_id, pattern_id, start_stop_id, end_stop_id are required" });
  }

  try {
    // 1. Get stops of this pattern
    const [patternStops] = await db.query(
      `SELECT stop_id, stop_order, is_optional
       FROM stop_pattern_stops
       WHERE pattern_id = ?
       ORDER BY stop_order`,
      [pattern_id]
    );

    if (!patternStops.length) {
      return res.status(404).json({ error: "No stops found for given pattern_id" });
    }

    // 2. Find start and end index
    const startIndex = patternStops.findIndex(s => s.stop_id === start_stop_id);
    const endIndex = patternStops.findIndex(s => s.stop_id === end_stop_id);

    if (startIndex === -1 || endIndex === -1) {
      return res.status(400).json({ error: "start_stop_id or end_stop_id not found in this pattern" });
    }
    if (startIndex > endIndex) {
      return res.status(400).json({ error: "start_stop_id comes after end_stop_id in this pattern" });
    }

    // 3. Take only relevant stops
    const tripStops = patternStops.slice(startIndex, endIndex + 1);

    // 4. Get skip stops for this trip (if any)
    const [skipStops] = await db.query(
      `SELECT stop_id FROM trip_skip_stops WHERE trip_id = ?`,
      [trip_id]
    );
    const skipSet = new Set(skipStops.map(s => s.stop_id));

    // 5. Insert trip_stoppages
    const insertValues = [];
    tripStops.forEach((stop, i) => {
      if (!skipSet.has(stop.stop_id)) {
        insertValues.push([trip_id, stop.stop_id, i + 1]);
      }
    });

    if (!insertValues.length) {
      return res.status(400).json({ error: "No stops left after filtering (maybe all skipped)" });
    }

    await db.query(
      `INSERT INTO trip_stoppages (trip_id, stop_id, stop_order)
       VALUES ?`,
      [insertValues]
    );

    res.json({
      message: "Trip stoppages generated successfully",
      count: insertValues.length,
      stops: insertValues
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});
module.exports = router;

// export default router;
