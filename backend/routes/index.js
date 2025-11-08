var express = require("express");
var router = express.Router();
const db = require("../db.js");
const mysql = require("mysql2/promise");
const dayjs = require("dayjs");


// 🚍 Test route
router.get('/', function (req, res, next) {
  res.send('express');
});

// ------------------------------------------


// next-buses.js


// const db = mysql.createPool({
//   host: 'localhost',
//   user: "root",
//   password: "jaggi@dev",
//   database: "graminbus",
//   waitForConnections: true,
//   connectionLimit: 10,
// });
// const AVG_MIN_PER_STOP = 4;


router.get("/next-buses", async (req, res) => {
  try {
    const { fromStopId, toStopId, limit = 5 } = req.query;

    if (!fromStopId || !toStopId) {
      return res.status(400).json({ error: "fromStopId and toStopId are required" });
    }

    const [rows] = await db.query(
      `
      SELECT 
        t.trip_id,
        t.bus_id,
        ts_from.stop_order AS from_order,
        ts_to.stop_order   AS to_order,
        ts_current.stop_order AS current_order,
        bl.current_stop_id,
        bl.last_updated
      FROM trips t
      JOIN trip_stoppages ts_from    ON ts_from.trip_id   = t.trip_id AND ts_from.stop_id = ?
      JOIN trip_stoppages ts_to      ON ts_to.trip_id     = t.trip_id AND ts_to.stop_id   = ?
      JOIN bus_locations bl          ON bl.bus_id         = t.bus_id
      JOIN trip_stoppages ts_current ON ts_current.trip_id = t.trip_id 
                                  AND ts_current.stop_id = bl.current_stop_id
      WHERE 
        ts_from.stop_order < ts_to.stop_order -- ✅ only forward direction
        AND ts_current.stop_order <= ts_from.stop_order -- ✅ bus hasn't passed fromStop
      ORDER BY ts_from.stop_order ASC
      LIMIT ?
      `,
      [fromStopId, toStopId, Number(limit)]
    );

    res.json({
      count: rows.length,
      trips: rows.map(r => ({
        tripId: r.trip_id,
        busId: r.bus_id,
        currentStopId: r.current_stop_id,
        currentOrder: r.current_order,
        fromOrder: r.from_order,
        toOrder: r.to_order,
        lastUpdated: r.last_updated,
      })),
    });
  } catch (error) {
    console.error("Error fetching next buses:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});





router.post("/update-location", async (req, res) => {
  const { busId, currentStopId } = req.body; // driver app can send the nearest stop id
  if (!busId || !currentStopId) return res.status(400).json({ error: "busId and currentStopId required" });

  await db.query(
    "INSERT INTO bus_locations (bus_id, current_stop_id, updated_at) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE current_stop_id=VALUES(current_stop_id), updated_at=NOW()",
    [busId, currentStopId]
  );
  res.json({ success: true });
});




router.post("/generate-trip-stoppages", async (req, res) => {
  const { trip_id, pattern_id, start_stop_id, end_stop_id } = req.body;

  if (!trip_id || !pattern_id || !start_stop_id || !end_stop_id) {
    return res.status(400).json({
      error: "trip_id, pattern_id, start_stop_id, end_stop_id are required",
    });
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

    // 3. Slice in correct direction (forward or reverse)
    let tripStops;
    if (startIndex <= endIndex) {
      // forward slice
      tripStops = patternStops.slice(startIndex, endIndex + 1);
    } else {
      // backward slice (reverse order)
      tripStops = patternStops.slice(endIndex, startIndex + 1).reverse();
    }

    // 4. Get skip stops for this trip (if any)
    const [skipStops] = await db.query(
      `SELECT stop_id FROM trip_skip_stops WHERE trip_id = ?`,
      [trip_id]
    );
    const skipSet = new Set(skipStops.map(s => s.stop_id));

    // 5. Insert trip_stoppages (normalize stop_order)
    const insertValues = [];
    tripStops.forEach((stop, i) => {
      if (!skipSet.has(stop.stop_id)) {
        insertValues.push([trip_id, stop.stop_id, i + 1]);
      }
    });

    if (!insertValues.length) {
      return res.status(400).json({
        error: "No stops left after filtering (maybe all skipped)",
      });
    }

    // remove existing stoppages for this trip before inserting new
    await db.query(`DELETE FROM trip_stoppages WHERE trip_id = ?`, [trip_id]);

    await db.query(
      `INSERT INTO trip_stoppages (trip_id, stop_id, stop_order)
       VALUES ?`,
      [insertValues]
    );

    res.json({
      message: "Trip stoppages generated successfully",
      count: insertValues.length,
      stops: insertValues,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/bus-location/:busId", async (req, res) => {
  const { busId } = req.params;
  const [rows] = await db.query(
    `SELECT latitude, longitude, last_updated 
     FROM bus_locations 
     WHERE bus_id = ?`, 
     [busId]
  );

  if (!rows.length) return res.status(404).json({ error: "Bus not found" });
  res.json(rows[0]);
});


router.get('/areas', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT name, lat, lng FROM stoppages');
    res.json(rows);
    // console.log(rows);
    
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching areas");
  }
});



module.exports = router;
