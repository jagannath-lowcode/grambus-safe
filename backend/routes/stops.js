
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



// router.get('/stops', async (req, res) => {
//   const search = req.query.q || '';
//   const sql = search
//     ? 'SELECT * FROM stoppages WHERE name LIKE ? LIMIT 20'
//     : 'SELECT * FROM stoppages LIMIT 20';

//   const params = search ? [`%${search}%`] : [];

//   try {
//     const [rows] = await db.query(sql, params);
//     res.json(rows);
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });

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



// router.post("/driver/location", (req, res) => {
//   const { bus_id, latitude, longitude } = req.body;
//   console.log(bus_id, latitude, longitude );

//   const sql = `
//   INSERT INTO bus_locations (bus_id, latitude, longitude, last_updated)
//   VALUES (?, ?, ?, NOW())
//   ON DUPLICATE KEY UPDATE
//     latitude = VALUES(latitude),
//     longitude = VALUES(longitude),
//     last_updated = NOW();
// `;

// db.query(sql, [bus_id, latitude, longitude], (err, result) => {
//   if (err) {
//     console.error(err);
//     return res.status(500).json({ message: "Error inserting/updating" });
//   }
//   res.json({ success: true });
// });
// });

// function query(sql, params) {
//   return new Promise((resolve, reject) => {
//     db.query(sql, params, (err, results) => {
//       if (err) return reject(err);
//       resolve(results); // always return rows/results directly
//     });
//   });
// }


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

// router.post("/driver/start-trip", async (req, res) => {
//   try {
//     const { busId, latitude, longitude } = req.body;
//     console.log(busId, latitude, longitude);

//     if (!busId || !latitude || !longitude) {
//       return res.status(400).json({
//         success: false,
//         message: "busId, latitude, longitude are required",
//       });
//     }

//     const busLat = parseFloat(latitude);
//     const busLon = parseFloat(longitude);

//     if (isNaN(busLat) || isNaN(busLon)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid latitude/longitude",
//       });
//     }

//     // 1) Save location (non-blocking)
//     await query(
//       `INSERT INTO bus_locations (bus_id, latitude, longitude, last_updated)
//    VALUES (?, ?, ?, NOW())
//    ON DUPLICATE KEY UPDATE
//      latitude = VALUES(latitude),
//      longitude = VALUES(longitude),
//      last_updated = NOW()`,
//       [busId, busLat, busLon]
//     ).catch(err => console.error("Location upsert failed:", err));



//     // 2) Fetch trips for this bus
//     const trips = await query(
//       `SELECT id, trip_id, bus_id, start_stop_id, end_stop_id,
//               direction, start_time, end_time
//        FROM trips
//        WHERE bus_id = ?`,
//       [busId]
//     );
//     console.log("trips");
//     console.log("helloo", trips);


//     if (trips.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: "No trips configured for this bus",
//       });
//     }

//     // 3) Filter by schedule window
//     const now = new Date();
//     const nowMinutes = now.getHours() * 60 + now.getMinutes();

//     const candidates = trips.filter(trip => {
//       const start = timeToMinutes(trip.start_time);
//       const end = timeToMinutes(trip.end_time);
//       if (start == null || end == null) return false;

//       return (
//         nowMinutes >= start - TIME_TOLERANCE_MIN &&
//         nowMinutes <= end + TIME_TOLERANCE_MIN
//       );
//     });

//     if (candidates.length === 0) {
//       return res.status(404).json({
//         success: false,
//         message: "No active trip window right now for this bus",
//       });
//     }

//     // 4) Load starting stops for candidate trips
//     const startStopIds = [...new Set(candidates.map(c => c.start_stop_id))];

//     if (startStopIds.length === 0) {
//       return res.status(500).json({
//         success: false,
//         message: "Trips have no start_stop_id",
//       });
//     }

//     const stops = await query(
//       `SELECT id, name, latitude, longitude
//        FROM stoppages
//        WHERE id IN (?)`,
//       [startStopIds]
//     );

//     if (stops.length === 0) {
//       return res.status(500).json({
//         success: false,
//         message: "No stoppages found for candidate trips",
//       });
//     }

//     const stopById = Object.fromEntries(stops.map(s => [s.id, s]));

//     // 5) Pick best trip based on nearest start stop
//     let bestTrip = null;
//     let bestDistance = Infinity;

//     for (const trip of candidates) {
//       const stop = stopById[trip.start_stop_id];
//       if (!stop) continue;

//       const dist = haversineDistance(
//         busLat,
//         busLon,
//         parseFloat(stop.latitude),
//         parseFloat(stop.longitude)
//       );

//       if (dist < bestDistance) {
//         bestDistance = dist;
//         bestTrip = trip;
//       }
//     }

//     if (!bestTrip) {
//       return res.status(500).json({
//         success: false,
//         message: "Unable to choose active trip based on location",
//       });
//     }

//     if (bestDistance > MAX_START_STOP_RADIUS_M) {
//       return res.status(400).json({
//         success: false,
//         message: "Too far from starting stop to start the trip",
//         distance: Math.round(bestDistance),
//         limit: MAX_START_STOP_RADIUS_M,
//       });
//     }

//     // 6) UPSERT active trip
//     await query(
//       `INSERT INTO active_bus_trip (bus_id, trip_id, started_at)
//        VALUES (?, ?, NOW())
//        ON DUPLICATE KEY UPDATE
//          trip_id = VALUES(trip_id),
//          started_at = NOW()`,
//       [bestTrip.bus_id, bestTrip.trip_id]
//     );

//     // 7) Response
//     return res.json({
//       success: true,
//       message: "Active trip detected",
//       activeTrip: {
//         id: bestTrip.id,
//         trip_id: bestTrip.trip_id,
//         bus_id: bestTrip.bus_id,
//         direction: bestTrip.direction,
//         start_stop_id: bestTrip.start_stop_id,
//         end_stop_id: bestTrip.end_stop_id,
//         start_time: bestTrip.start_time,
//         end_time: bestTrip.end_time,
//       },
//       detection: {
//         method: "time + nearest start stop",
//         distanceFromStartStop: Math.round(bestDistance),
//         toleranceMinutes: TIME_TOLERANCE_MIN,
//       },
//     });

//   } catch (err) {
//     console.error("Start-trip error:", err);
//     return res.status(500).json({
//       success: false,
//       message: "Server error",
//       error: err.message,
//     });
//   }
// });
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

// small helper (top of file or utils)
function getBearing(lat1, lon1, lat2, lon2) {
  const toRad = d => (d * Math.PI) / 180;

  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) -
    Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);

  let θ = (Math.atan2(y, x) * 180) / Math.PI;
  if (θ < 0) θ += 360;
  return θ;            // 0–360°
}


// router.post("/driver/location", async (req, res) => {
//   try {
//     const { bus_id, latitude, longitude } = req.body;
//     console.log(bus_id, latitude, longitude);


//     if (!bus_id || !latitude || !longitude) {
//       return res.status(400).json({
//         success: false,
//         message: "bus_id, latitude, longitude are required",
//       });
//     }

//     const lat = parseFloat(latitude);
//     const lon = parseFloat(longitude);

//     if (isNaN(lat) || isNaN(lon)) {
//       return res.status(400).json({
//         success: false,
//         message: "Invalid latitude/longitude",
//       });
//     }

//     // ----------------------------------------------------------
//     // 1) Get active trip for this bus
//     // ----------------------------------------------------------
//     const activeTrip = await query(
//       "SELECT trip_id FROM active_bus_trip WHERE bus_id = ? LIMIT 1",
//       [bus_id]
//     );

//     if (activeTrip.length === 0) {
//       return res.status(400).json({
//         success: false,
//         message: "No active trip. Driver must press START TRIP.",
//       });
//     }

//     const tripId = activeTrip[0].trip_id;

//     // ----------------------------------------------------------
//     // 2) Load stops of this trip
//     // ----------------------------------------------------------
//     const stops = await query(
//       `SELECT ts.stop_id, s.latitude, s.longitude, ts.stop_order
//        FROM trip_stoppages ts
//        JOIN stoppages s ON s.id = ts.stop_id
//        WHERE ts.trip_id = ?
//        ORDER BY ts.stop_order ASC`,
//       [tripId]
//     );

//     if (stops.length === 0) {
//       return res.status(400).json({
//         success: false,
//         message: "This trip has no stoppages configured.",
//       });
//     }

//     // ----------------------------------------------------------
//     // 3) Find nearest stop
//     // ----------------------------------------------------------
//     const ARRIVE_RADIUS = 80; // meters

//     let nearestStopId = null;
//     let nearestStopOrder = null;
//     let nearestDistance = Infinity;

//     for (const stop of stops) {
//       const dist = haversineDistance(lat, lon, stop.latitude, stop.longitude);

//       if (dist < nearestDistance) {
//         nearestDistance = dist;
//         nearestStopId = stop.stop_id;
//         nearestStopOrder = stop.stop_order;
//       }
//     }

//     // ----------------------------------------------------------
//     // 4) Fetch last known stop (to keep consistency in-between stops)
//     // ----------------------------------------------------------
//     const oldLocation = await query(
//       "SELECT current_stop_id FROM bus_locations WHERE bus_id = ? LIMIT 1",
//       [bus_id]
//     );

//     const lastStopId =
//       oldLocation.length > 0 ? oldLocation[0].current_stop_id : null;

//     // Prevent backwards jump due to GPS drift
//     if (lastStopId) {
//       const lastStopOrder = stops.find(s => s.stop_id === lastStopId)?.stop_order;

//       if (nearestStopOrder < lastStopOrder) {
//         nearestStopId = lastStopId;
//         nearestStopOrder = lastStopOrder;
//         nearestDistance = Infinity;
//       }
//     }
//     let isAtStop = 0;
//     let currentStopIdToSave = lastStopId;

//     if (nearestDistance <= ARRIVE_RADIUS) {
//       // Bus arrived at stop
//       isAtStop = 1;
//       currentStopIdToSave = nearestStopId;
//     } else {
//       // Bus between stops → keep last stop
//       isAtStop = 0;
//     }

//     // ----------------------------------------------------------
//     // 5) Find upcoming stop and bearing (for bus icon rotation)
//     // ----------------------------------------------------------

//     // find next stop in order
//     const upcomingStop = stops.find(s => s.stop_order > nearestStopOrder) || null;

//     let upcomingStopId = null;
//     let rotation = null;

//     if (upcomingStop) {
//       upcomingStopId = upcomingStop.stop_id;
//       rotation = getBearing(
//         lat,
//         lon,
//         upcomingStop.latitude,
//         upcomingStop.longitude
//       );
//     }


//     // ----------------------------------------------------------
//     // 6) Save/Update bus location (UPSERT)
//     // ----------------------------------------------------------
//     await query(`
//       INSERT INTO bus_locations 
//         (bus_id, latitude, longitude, current_stop_id, upcoming_stop_id, rotation, is_at_stop, last_updated)
//       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
//       ON DUPLICATE KEY UPDATE
//       latitude = VALUES(latitude),
//       longitude = VALUES(longitude),
//       current_stop_id = VALUES(current_stop_id),
//       upcoming_stop_id = VALUES(upcoming_stop_id),
//       rotation = VALUES(rotation),
//       is_at_stop = VALUES(is_at_stop),
//       last_updated = NOW()
//     `, [bus_id, lat, lon, currentStopIdToSave, upcomingStopId, rotation, isAtStop]);

//     // await query(
//     //   `
//     //   INSERT INTO bus_locations 
//     //     (bus_id, latitude, longitude, current_stop_id, is_at_stop, last_updated)
//     //   VALUES (?, ?, ?, ?, ?, NOW())
//     //   ON DUPLICATE KEY UPDATE
//     //     latitude = VALUES(latitude),
//     //     longitude = VALUES(longitude),
//     //     current_stop_id = VALUES(current_stop_id),
//     //     is_at_stop = VALUES(is_at_stop),
//     //     last_updated = NOW()
//     // `,
//     //   [bus_id, lat, lon, currentStopIdToSave, isAtStop]
//     // );

//     // ----------------------------------------------------------
//     // 7) Send Response
//     // ----------------------------------------------------------
//     return res.json({
//       success: true,
//       nearestStopId,
//       nearestDistance: Math.round(nearestDistance),
//       isAtStop,
//       currentStopId: currentStopIdToSave,
//       nearestStopOrder,
//     });
//   } catch (err) {
//     console.error("Error in /driver/location:", err);
//     return res.status(500).json({
//       success: false,
//       message: "Server error",
//       error: err.message,
//     });
//   }
// });

router.post("/driver/location", async (req, res) => {
  try {
    const { bus_id, latitude, longitude } = req.body;

    if (!bus_id || !latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: "bus_id, latitude, longitude are required",
      });
    }

    const lat = parseFloat(latitude);
    const lon = parseFloat(longitude);

    console.log(lat,lon);
    console.log('bus_id',bus_id);
    
    

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
      // rotation = getBearing(lat, lon, upcomingStop.latitude, upcomingStop.longitude);
    }

    // ----------------------------------------------------------
    // 6) Save location (UPSERT)
    // ----------------------------------------------------------
    await db.query(
      `
      INSERT INTO bus_locations 
        (bus_id, latitude, longitude, current_stop_id, upcoming_stop_id, is_at_stop, last_updated)
      VALUES (?, ?, ?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        latitude = VALUES(latitude),
        longitude = VALUES(longitude),
        current_stop_id = VALUES(current_stop_id),
        upcoming_stop_id = VALUES(upcoming_stop_id),
        is_at_stop = VALUES(is_at_stop),
        last_updated = NOW()
      `,
      [bus_id, lat, lon, currentStopIdToSave, upcomingStopId,  isAtStop]
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
      rotation,
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


module.exports = router;

