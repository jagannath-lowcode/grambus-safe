
var express = require('express');
var router = express.Router();
const db = require("../db.js");
const mysql = require("mysql2/promise");


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

module.exports = router;

