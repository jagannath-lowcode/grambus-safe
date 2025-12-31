
var express = require('express');
var router = express.Router();
const db = require("../db.js");
// const mysql = require("mysql2/promise");


/* GET users listing. */
router.get('/hubs', async function (req, res, next) {
  try {
    const [rows] = await db.query("SELECT stop_id,name FROM stoppages WHERE type='hub'");
    res.json(rows); // send all hubs as array
  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});



router.get('/stops', async (req, res) => {
  const search = req.query.q || '';
  const sql = search
    ? 'SELECT stop_id, name FROM stoppages WHERE LOWER(name) LIKE LOWER(?) LIMIT 20'
    : 'SELECT stop_id, name FROM stoppages LIMIT 20';

  const params = search ? [`%${search}%`] : [];

  try {
    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});



const haversineDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371000; // meters
  const toRad = deg => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // distance in meters
};
// CONFIG
const TIME_TOLERANCE_MIN = 30;  // minutes before/after schedule
const MAX_START_STOP_RADIUS_M = 800; // meters (tune this)


function timeToMinutes(t) {
  // t like "05:00:00"
  if (!t) return null;
  const [hh, mm, ss] = t.split(":").map(Number);
  return hh * 60 + mm;
}
// ----------------------------------------------------------------------------------------------

router.post("/driver/start-trip", async (req, res) => {
  try {
    const { busId, latitude, longitude } = req.body;
    // console.log(busId, latitude, longitude);


    if (!busId || !latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: "busId, latitude, longitude are required",
      });
    }

    const busLat = parseFloat(latitude);
    const busLon = parseFloat(longitude);

    if (isNaN(busLat) || isNaN(busLon)) {
      return res.status(400).json({
        success: false,
        message: "Invalid latitude/longitude",
      });
    }

    /** 1) UPSERT bus location **/
    await db.query(
      `INSERT INTO bus_locations (bus_id, latitude, longitude, last_updated)
       VALUES (?, ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         latitude = VALUES(latitude),
         longitude = VALUES(longitude),
         last_updated = NOW()`,
      [busId, busLat, busLon]
    );

    /** 2) Fetch trips **/
    const [trips] = await db.query(
      `SELECT id, trip_id, bus_id, start_stop_id, end_stop_id,
              direction, start_time, end_time
       FROM trips
       WHERE bus_id = ?`,
      [busId]
    );
    // console.log(trips)

    if (trips.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No trips configured for this bus",
      });
    }

    /** 3) Filter schedules **/
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    const candidates = trips.filter(trip => {
      const start = timeToMinutes(trip.start_time);
      const end = timeToMinutes(trip.end_time);
      return (
        nowMinutes >= start - TIME_TOLERANCE_MIN &&
        nowMinutes <= end + TIME_TOLERANCE_MIN
      );
    });
    // console.log('candidatesssss',candidates);

    if (candidates.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No active trip window right now for this bus",
      });
    }

    /** 4)Load starting stops for candidate trips **/
    const startStopIds = [...new Set(candidates.map(c => c.start_stop_id))];

    // console.log(startStopIds);

    const [stops] = await db.query(
      `SELECT id, name, latitude, longitude , stop_id
       FROM stoppages
       WHERE stop_id IN (?)`,
      [startStopIds]
    );

    // console.log("stops",stops);

    if (stops.length === 0) {
      return res.status(500).json({
        success: false,
        message: "No stoppages found for candidate trips",
      });
    }

    const stopById = Object.fromEntries(stops.map(s => [s.stop_id, s]));
    // console.log('stopbyid' , stopById);


    /** 5) Find nearest start stop **/
    let bestTrip = null;
    let bestDistance = Infinity;

    for (const trip of candidates) {
      const stop = stopById[trip.start_stop_id];
      // console.log('helllo',stop);

      if (!stop) continue;

      const dist = haversineDistance(
        busLat, busLon,
        parseFloat(stop.lat),
        parseFloat(stop.lng)
      );
      // console.log('dist', dist);

      if (dist < bestDistance) {
        bestDistance = dist;
        bestTrip = trip;
      }
    }

    if (!bestTrip) {
      return res.status(500).json({
        success: false,
        message: "Unable to choose active trip based on location",
      });
    }

    if (bestDistance > MAX_START_STOP_RADIUS_M) {
      return res.status(400).json({
        success: false,
        message: "Too far from starting stop to start the trip",
        distance: Math.round(bestDistance),
        limit: MAX_START_STOP_RADIUS_M,
      });
    }

    /** 6) Save active trip **/
    await db.query(
      `INSERT INTO active_bus_trip (bus_id, trip_id, started_at)
       VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         trip_id = VALUES(trip_id),
         started_at = NOW()`,
      [bestTrip.bus_id, bestTrip.trip_id]
    );

    /** 7) Respond **/
    return res.json({
      success: true,
      message: "Active trip detected",
      activeTrip: bestTrip,
      detection: {
        method: "time + nearest start stop",
        distanceFromStartStop: Math.round(bestDistance),
        toleranceMinutes: TIME_TOLERANCE_MIN,
      },
    });

  } catch (err) {
    console.error("Start-trip error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
});


// -----------------------------------------------------------------------------------------------------------------

const busRuntimeState = {};


router.get("/next-buses", async (req, res) => {
  try {
    const { fromStopId, toStopId, limit = 5 } = req.query;

    if (!fromStopId || !toStopId) {
      return res.status(400).json({ error: "fromStopId and toStopId are required" });
    }

    const [rows] = await db.query(
      `
      SELECT DISTINCT
          t.trip_id,
          t.bus_id,
          b.bus_name,

          ts_from.stop_order    AS from_order,
          ts_to.stop_order      AS to_order,
          ts_current.stop_order AS current_order,

          bl.current_stop_id,
          bl.upcoming_stop_id,
          bl.latitude  AS bus_lat,
          bl.longitude AS bus_lng,
          bl.last_updated

        FROM trips t
        JOIN buses b 
          ON b.bus_id = t.bus_id
        JOIN trip_stoppages ts_from 
          ON ts_from.trip_id = t.trip_id AND ts_from.stop_id = ?
        JOIN trip_stoppages ts_to   
          ON ts_to.trip_id   = t.trip_id AND ts_to.stop_id   = ?
        JOIN bus_locations bl       
          ON bl.bus_id       = t.bus_id
        JOIN trip_stoppages ts_current 
          ON ts_current.trip_id = t.trip_id 
        AND ts_current.stop_id = bl.current_stop_id
        WHERE 
          ts_from.stop_order < ts_to.stop_order
          AND ts_current.stop_order <= ts_from.stop_order
          ORDER BY (ts_from.stop_order - ts_current.stop_order) ASC -- Closest bus first
        LIMIT ?
      `,
      [fromStopId, toStopId, Number(limit)]
    );

    const results = [];


    for (const r of rows) {
      const [stops] = await db.query(`
            SELECT 
              ts.stop_order,
              s.stop_id,
              s.latitude,
              s.longitude
            FROM trip_stoppages ts
            JOIN stoppages s ON s.stop_id = ts.stop_id
            WHERE 
              ts.trip_id = ?
              -- Start from the bus's current stop
              AND ts.stop_order >= (
                SELECT stop_order 
                FROM trip_stoppages 
                WHERE trip_id = ? AND stop_id = ? 
              )
              -- End at the user's destination stop
              AND ts.stop_order <= (
                SELECT stop_order 
                FROM trip_stoppages 
                WHERE trip_id = ? AND stop_id = ? -- Replace with User's Stop ID
              )
            ORDER BY ts.stop_order ASC
            `, [r.trip_id, r.trip_id, r.upcoming_stop_id, r.trip_id, fromStopId]
      );


      const validStops = stops.filter(
        s => s.latitude !== null && s.longitude !== null
      );

      function haversineMeters(lat1, lon1, lat2, lon2) {
        const R = 6371000; // meters
        const toRad = d => (d * Math.PI) / 180;

        const dLat = toRad(lat2 - lat1);
        const dLon = toRad(lon2 - lon1);

        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(toRad(lat1)) *
          Math.cos(toRad(lat2)) *
          Math.sin(dLon / 2) ** 2;

        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
      }

      let totalMeters = 0;

      // distance from bus current GPS to first stop
      const firstStop = validStops[0];

      if (firstStop) {
        totalMeters += haversineMeters(
          r.bus_lat,
          r.bus_lng,
          firstStop.latitude,
          firstStop.longitude
        );
      }

      for (let i = 0; i < validStops.length - 1; i++) {
        const a = validStops[i];
        const b = validStops[i + 1];

        totalMeters += haversineMeters(
          a.latitude,
          a.longitude,
          b.latitude,
          b.longitude
        );
      }

      if (!isFinite(totalMeters) || totalMeters <= 0) {
        totalMeters = null; // force ETA fallback later
      }
      console.log({ busId: r.bus_id, totalMeters, stopCount: validStops.length });

      // -------------eta speed-----------

      const avgSpeed =
        busRuntimeState[r.bus_id]?.avgSpeed || r.avg_speed_mps || null;

      const FALLBACK_SPEED = 6;

      const speedToUse = avgSpeed || FALLBACK_SPEED;

      const etaMinutes = totalMeters
        ? Math.max(Math.round(totalMeters / speedToUse / 60), 1)
        : null;

      console.log(etaMinutes);

      function getLiveState(lastUpdated) {
        const diffMin = (Date.now() - new Date(lastUpdated)) / 60000;

        if (diffMin <= 2) return "live";
        if (diffMin <= 5) return "stale";
        return "offline";
      }
      function getStatus(stopsRemaining, liveState) {
        if (liveState === "offline") return "not_tracking";
        if (stopsRemaining <= 0) return "arriving";
        if (stopsRemaining <= 2) return "approaching";
        return "on_the_way";
      }

      const stopsRemaining = r.from_order - r.current_order;

      const liveState = getLiveState(r.last_updated);

      const status = getStatus(stopsRemaining, liveState);

      results.push({
        tripId: r.trip_id,
        busId: r.bus_id,
        etaMinutes,
        stopsRemaining,
        status,
        liveState,
        bus_name: r.bus_name,
      });
    }
    console.log(results);
    

    res.json({
      count: results.length,
      trips: results
    });
  } catch (error) {
    console.error("Error fetching next buses:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// -----------------------------------------------------------------------------------------------

router.post("/driver/location", async (req, res) => {
  try {
    const { bus_id, latitude, longitude, timestamp } = req.body;

    if (!bus_id || !latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: "bus_id, latitude, longitude are required",
      });
    }

    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);

    // console.log(lat, lon);
    // console.log('bus_id', bus_id);

    if (isNaN(lat) || isNaN(lon)) {
      return res.status(400).json({
        success: false,
        message: "Invalid latitude/longitude",
      });
    }

    // ----------------------------------------------------------
    // 1) Get active trip for this bus
    // ----------------------------------------------------------
    const [activeTrip] = await db.query(
      "SELECT trip_id FROM active_bus_trip WHERE bus_id = ? LIMIT 1",
      [bus_id]
    );
    // console.log(activeTrip);


    if (activeTrip.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No active trip. Driver must press START TRIP.",
      });
    }

    const tripId = activeTrip[0].trip_id;

    // ----------------------------------------------------------
    // 2) Load stops of this trip
    // ----------------------------------------------------------
    const [stops] = await db.query(
      `SELECT ts.stop_id, s.latitude, s.longitude, ts.stop_order
       FROM trip_stoppages ts
       JOIN stoppages s ON s.stop_id = ts.stop_id
       WHERE ts.trip_id = ?
       ORDER BY ts.stop_order ASC`,
      [tripId]
    );

    if (stops.length === 0) {
      return res.status(400).json({
        success: false,
        message: "This trip has no stoppages configured.",
      });
    }
    // console.log(stops);

    // ----------------------------------------------------------
    // 3) Find nearest stop
    // ----------------------------------------------------------
    const ARRIVE_RADIUS = 80; // meters

    let nearestStopId = null;
    let nearestStopOrder = null;
    let nearestDistance = Infinity;

    for (const stop of stops) {
      const dist = haversineDistance(lat, lon, stop.latitude, stop.longitude);

      if (dist < nearestDistance) {
        nearestDistance = dist;
        nearestStopId = stop.stop_id;
        nearestStopOrder = stop.stop_order;
      }
    }

    // ----------------------------------------------------------
    // 4) Fetch last known stop
    // ----------------------------------------------------------
    const [oldLocation] = await db.query(
      "SELECT current_stop_id FROM bus_locations WHERE bus_id = ? LIMIT 1",
      [bus_id]
    );

    const lastStopId =
      oldLocation.length > 0 ? oldLocation[0].current_stop_id : null;

    // Prevent backwards jump
    if (lastStopId) {
      const lastStopOrder = stops.find(s => s.stop_id === lastStopId)?.stop_order;

      if (nearestStopOrder < lastStopOrder) {
        nearestStopId = lastStopId;
        nearestStopOrder = lastStopOrder;
        nearestDistance = Infinity;
      }
    }

    let isAtStop = nearestDistance <= ARRIVE_RADIUS ? 1 : 0;
    let currentStopIdToSave = isAtStop ? nearestStopId : lastStopId;

    // ----------------------------------------------------------
    // 5) Determine upcoming stop + rotation
    // ----------------------------------------------------------
    const upcomingStop = stops.find(s => s.stop_order > nearestStopOrder) || null;

    let upcomingStopId = null;
    let rotation = null;

    if (upcomingStop) {
      upcomingStopId = upcomingStop.stop_id;
    }

    // ----------------------------------------------------------
    // 5.5) Speed calculation (NEW)
    // ----------------------------------------------------------

    const prevState = busRuntimeState[bus_id] || null;

    const currLoc = {
      lat,
      lng: lon,
      time: timestamp ? new Date(timestamp) : new Date()
    };

    let avgSpeed = prevState?.avgSpeed || null;

    if (prevState?.curr) {
      const dist = haversineDistance(
        prevState.curr.lat,
        prevState.curr.lng,
        currLoc.lat,
        currLoc.lng
      );

      const timeSec =
        (currLoc.time - new Date(prevState.curr.time)) / 1000;

      if (timeSec > 0) {
        const instantSpeed = dist / timeSec;

        // sanity filter
        if (instantSpeed >= 0.5 && instantSpeed <= 35) {
          avgSpeed = avgSpeed
            ? avgSpeed * 0.7 + instantSpeed * 0.3
            : instantSpeed;
        }
      }
    }

    // update runtime state
    busRuntimeState[bus_id] = {
      curr: currLoc,
      avgSpeed
    };
    // ----------------------------------------------------------
    // 6) Save location (UPSERT)
    // ----------------------------------------------------------
    await db.query(
      `
      INSERT INTO bus_locations 
        (bus_id, latitude, longitude, current_stop_id, upcoming_stop_id, is_at_stop,avg_speed_mps, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        latitude = VALUES(latitude),
        longitude = VALUES(longitude),
        current_stop_id = VALUES(current_stop_id),
        upcoming_stop_id = VALUES(upcoming_stop_id),
        is_at_stop = VALUES(is_at_stop),
        avg_speed_mps = VALUES(avg_speed_mps)
        last_updated = NOW()
      `,
      [bus_id, lat, lon, currentStopIdToSave, upcomingStopId, isAtStop, avgSpeed]
    );

    // ----------------------------------------------------------
    // 7) Send Response
    // ----------------------------------------------------------
    return res.json({
      success: true,
      nearestStopId,
      nearestDistance: Math.round(nearestDistance),
      isAtStop,
      currentStopId: currentStopIdToSave,
      nearestStopOrder,
      upcomingStopId,
    });

  } catch (err) {
    console.error("Error in /driver/location:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: err.message,
    });
  }
});



// ---------------------------------------------------------------------------------------------------


router.post("/driver/end-trip", async (req, res) => {
  const { busId } = req.body;

  if (!busId) {
    return res.status(400).json({ success: false, message: "busId required" });
  }

  try {
    // find active trip first
    const [active] = await db.query(
      "SELECT trip_id FROM active_bus_trip WHERE bus_id = ? LIMIT 1",
      [busId]
    );

    if (!active.length) {
      return res.status(400).json({
        success: false,
        message: "No active trip found for this bus."
      });
    }

    const tripId = active[0].trip_id;

    // Optionally record completion timestamp (future analytics)
    await db.query(
      "UPDATE active_bus_trip SET ended_at = NOW(), is_active = 0 WHERE bus_id = ?",
      [busId]
    );

    // Now remove active trip so new one can start later
    await db.query(
      "DELETE FROM active_bus_trip WHERE bus_id = ?",
      [busId]
    );

    return res.json({
      success: true,
      message: "Trip ended successfully",
      tripId
    });

  } catch (err) {
    console.error("Error ending trip:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

// ----------------------------------------------------------------------

// router.get('/buses', async (req, res) => {
//   const q = (req.query.q || '').trim().toLowerCase();
//   const params = [];

//   let sql = 'SELECT id, bus_name FROM buses';

//   if (q.length > 0) {
//     // Append the conditional WHERE/ORDER BY/LIMIT clauses
//     sql += ' WHERE LOWER(bus_name)  LIKE ? ORDER BY bus_name LIMIT 20';
//     params.push(`%${q}%`, `%${q}%`);
//   } else {
//     // Append only ORDER BY/LIMIT
//     sql += ' ORDER BY bus_name LIMIT 20';
//   }

//   try {
//     const [rows] = await db.query(sql, params);
//     res.json(rows);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ error: 'Database error' });
//   }
// });

// --------------------------------------

// routes.routes.js
router.get("/routes", async (req, res) => {
  const search = req.query.q || "";
  console.log(search);


  try {
    const sql = `
      SELECT id, from_place, to_place, via_places, is_popular
      FROM routesINFO
      WHERE LOWER(from_place) LIKE LOWER(?)
         OR LOWER(to_place) LIKE LOWER(?)
         OR LOWER(via_places) LIKE LOWER(?)
      ORDER BY is_popular DESC, from_place ASC
    `;

    const like = `%${search}%`;
    const [rows] = await db.query(sql, [like, like, like]);
    // console.log(rows);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch routes" });
  }
});

router.get('/buslist/:routeId', async (req, res) => {
  const { routeId } = req.params;

  try {
    const [rows] = await db.query(`select * from buses where routeINFO_id = ?`, [routeId]);

    if (rows.length === 0) {
      return res.json({ success: false, message: 'no bus found of this route' })
    }

    return res.json(rows)

  } catch (err) {
    console.error(err, err.message);
    res.status(500).send("Error fetching buslist");
  }
})

router.get('/bus/:busId', async (req, res) => {
  const { busId } = req.params;
  const sql = `SELECT
                  t.id AS trip_id,
                  t.label AS trip_label,
                  ts.stop_order,
                  ts.departure_time,
                  s.stop_id AS stoppage_id,
                  s.name AS stoppage_name
                  FROM trips t
                  JOIN trip_stoppages ts ON ts.trip_id = t.trip_id
                  JOIN stoppages s ON s.stop_id = ts.stop_id
                  WHERE t.bus_id = ?
                  ORDER BY t.id, ts.stop_order;
                `

  try {
    const [rows] = await db.query(sql, [busId]);

    if (rows.length === 0) {
      return res.json({
        busId,
        trips: []
      });
    };

    const tripsMap = {};

    rows.forEach(row => {
      if (!tripsMap[row.trip_id]) {
        tripsMap[row.trip_id] = {
          trip_id: row.trip_id,
          label: row.trip_label,
          start_time: row.start_time,
          stops: []
        };
      }

      tripsMap[row.trip_id].stops.push({
        stop_id: row.stoppage_id,
        name: row.stoppage_name,
        departure_time: row.departure_time,
        stop_order: row.stop_order
      });
    });    

    res.json({
      busId,
      trips: Object.values(tripsMap)
    });

  } catch (error) {

    console.error("Error fetching trips:", error);
    res.status(500).json({
      message: "Internal server error"
    });
  }
})



router.get('/stoppages', async (req, res) => {
  try {
    const [rows] = await db.query("SELECT stop_id , name FROM stoppages order by name ASC");
    res.json(rows);
    // console.log(rows);

  } catch (err) {
    console.error('DB error:', err);
    res.status(500).json({ error: 'Database error' });
  }
})

module.exports = router;

