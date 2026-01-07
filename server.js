const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const db = new sqlite3.Database('database.db');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const GASES = [
  "Oxygen","M Oxygen","Argon","Callgas","Acetylene","Zerogas",
  "Carbon Dioxide","Ethylene","Helium","Hydraulic Mixture",
  "Other Gas 1","Other Gas 2","Other Gas 3","Other Gas 4","Other Gas 5"
];

db.run(`CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT,
  phone TEXT,
  aadhar TEXT,
  gas TEXT,
  cylinder_no TEXT,
  action TEXT,
  datetime TEXT
)`);

function formatCylinderCode(gas, num) {
  return gas.replace(/\W+/g,'').toUpperCase() + String(num).padStart(4,'0');
}

function expandNumbers(input) {
  if (!input) return [];
  const out = new Set();
  input.split(',').forEach(p => {
    p = p.trim();
    if (p.includes('-')) {
      let [a,b] = p.split('-').map(Number);
      for (let i=Math.min(a,b); i<=Math.max(a,b); i++) out.add(i);
    } else if (!isNaN(p)) out.add(Number(p));
  });
  return [...out];
}

app.get('/', (req,res)=>res.redirect('/dashboard'));


// DASHBOARD
app.get('/dashboard',(req,res)=>{
  db.all(`
    SELECT gas,cylinder_no FROM history h1
    WHERE action='SELL'
    AND NOT EXISTS (
      SELECT 1 FROM history h2
      WHERE h2.gas=h1.gas
        AND h2.cylinder_no=h1.cylinder_no
        AND h2.action='RETURN'
        AND h2.datetime>h1.datetime
    )
    ORDER BY gas,cylinder_no
  `,[],(err,rows)=>{
    const active={};
    rows.forEach(r=>(active[r.gas]=active[r.gas]||[]).push(r.cylinder_no));
    res.render('dashboard', {
      gases: GASES,
      active,
      msg: req.query.msg || null
    });

  });
});


// API ACTIVE
app.get('/api/active',(req,res)=>{
  const gas=req.query.gas;
  if(!gas) return res.json({error:'gas required'});
  db.all(`
    SELECT h1.cylinder_no
    FROM history h1
    WHERE h1.gas = ?
      AND h1.action = 'SELL'
      AND NOT EXISTS (
        SELECT 1 FROM history h2
        WHERE h2.gas = h1.gas
          AND h2.cylinder_no = h1.cylinder_no
          AND h2.action = 'RETURN'
          AND h2.datetime > h1.datetime
      )
    ORDER BY h1.cylinder_no
  `, [gas], (err, rows) => {

    res.json({ list:(rows||[]).map(r=>r.cylinder_no) });
  });
});


// SELL (BLOCK DUPLICATE ACTIVE)
app.post('/sell', (req, res) => {
  const { type: gas, numbers, customer_name, aadhar, phone } = req.body;
  if (!gas || !numbers || !customer_name) {
    return res.redirect('/dashboard?msg=' + encodeURIComponent('Missing required fields'));
  }

  const nums = expandNumbers(numbers);
  const dt = new Date().toISOString();

  const insertStmt = db.prepare(`
    INSERT INTO history
    (customer_name, phone, aadhar, gas, cylinder_no, action, datetime)
    VALUES (?, ?, ?, ?, ?, 'SELL', ?)
  `);

  const checkSql = `
    SELECT 1 FROM history h1
    WHERE h1.gas = ?
      AND h1.cylinder_no = ?
      AND h1.action = 'SELL'
      AND NOT EXISTS (
        SELECT 1 FROM history h2
        WHERE h2.gas = h1.gas
          AND h2.cylinder_no = h1.cylinder_no
          AND h2.action = 'RETURN'
          AND h2.datetime > h1.datetime
      )
  `;

  const sellNext = (i = 0) => {
    if (i >= nums.length) {
      insertStmt.finalize(() =>
        res.redirect('/dashboard?msg=' + encodeURIComponent('Cylinder sold successfully'))
      );
      return;
    }

    const code = formatCylinderCode(gas, nums[i]);

    db.get(checkSql, [gas, code], (err, row) => {
      if (row) {
        insertStmt.finalize(() =>
          res.redirect('/dashboard?msg=' + encodeURIComponent(`Cylinder ${code} already sold`))
        );
        return;
      }

      insertStmt.run(customer_name, phone, aadhar, gas, code, dt, () => {
        sellNext(i + 1);
      });
    });
  };

  sellNext();
});


// RETURN (COPY CUSTOMER)
app.post('/return', (req, res) => {
  const { gas, cylinder_no } = req.body;
  if (!gas || !cylinder_no) {
    return res.redirect('/dashboard?msg=' + encodeURIComponent('Invalid return'));
  }

  const dt = new Date().toISOString();

  db.get(`
    SELECT customer_name, phone, aadhar
    FROM history h1
    WHERE gas = ? AND cylinder_no = ? AND action = 'SELL'
      AND NOT EXISTS (
        SELECT 1 FROM history h2
        WHERE h2.gas = h1.gas
          AND h2.cylinder_no = h1.cylinder_no
          AND h2.action = 'RETURN'
          AND h2.datetime > h1.datetime
      )
    ORDER BY datetime DESC
    LIMIT 1
  `, [gas, cylinder_no], (err, row) => {
    if (!row) {
      return res.redirect('/dashboard?msg=' + encodeURIComponent('Invalid return'));
    }

    db.run(`
      INSERT INTO history
      (customer_name, phone, aadhar, gas, cylinder_no, action, datetime)
      VALUES (?, ?, ?, ?, ?, 'RETURN', ?)
    `, [row.customer_name, row.phone, row.aadhar, gas, cylinder_no, dt],
      () => res.redirect('/dashboard?msg=' + encodeURIComponent('Cylinder returned successfully'))
    );
  });
});


// HISTORY + SEARCH + ACTIVE BY PERSON
app.get('/history',(req,res)=>{
  const q=req.query.q;
  let sql="SELECT * FROM history ORDER BY datetime DESC LIMIT 200";
  let params=[];
  if (q) {
    sql = `
      SELECT * FROM history
      WHERE customer_name LIKE ?
        OR aadhar LIKE ?
        OR gas LIKE ?
      ORDER BY datetime DESC
      LIMIT 200
    `;
    params = [`%${q}%`, `%${q}%`, `%${q}%`];
  }


  db.all(sql,params,(err,rows)=>{
    db.all(`
      SELECT gas,COUNT(*) total FROM history h1
      WHERE action='SELL'
      AND NOT EXISTS (
        SELECT 1 FROM history h2
        WHERE h2.gas=h1.gas
          AND h2.cylinder_no=h1.cylinder_no
          AND h2.action='RETURN'
          AND h2.datetime>h1.datetime
      )
      GROUP BY gas
    `,[],(err2,counts)=>{
      const countsMap={};
      (counts||[]).forEach(c=>countsMap[c.gas]=c.total);

      if(!q){
        return res.render('history',{ rows,counts:countsMap,activeByPerson:[] });
      }

      db.all(`
        SELECT gas,cylinder_no FROM history h1
        WHERE (customer_name LIKE ? OR aadhar LIKE ?)
        AND action='SELL'
        AND NOT EXISTS (
          SELECT 1 FROM history h2
          WHERE h2.gas=h1.gas
            AND h2.cylinder_no=h1.cylinder_no
            AND h2.action='RETURN'
            AND h2.datetime>h1.datetime
        )
      `,[`%${q}%`,`%${q}%`],(err3,activeByPerson)=>{
        res.render('history',{
          rows,
          counts:countsMap,
          activeByPerson:activeByPerson||[]
        });
      });
    });
  });
});


// COUNTS
app.get('/counts',(req,res)=>{
  db.all(`
    SELECT gas,COUNT(*) total FROM history h1
    WHERE action='SELL'
    AND NOT EXISTS (
      SELECT 1 FROM history h2
      WHERE h2.gas=h1.gas
        AND h2.cylinder_no=h1.cylinder_no
        AND h2.action='RETURN'
        AND h2.datetime>h1.datetime
    )
    GROUP BY gas
  `,[],(err,rows)=>{
    const map={};
    rows.forEach(r=>map[r.gas]=r.total);
    res.render('counts',{ gases:GASES,map });
  });
});

// View active customers by gas (NO history, only active)
app.get('/active-customers', (req, res) => {
  const gas = req.query.gas;
  if (!gas) return res.redirect('/counts');

  db.all(`
    SELECT h1.customer_name, h1.aadhar, h1.phone, h1.cylinder_no
    FROM history h1
    WHERE h1.gas = ?
      AND h1.action = 'SELL'
      AND NOT EXISTS (
        SELECT 1 FROM history h2
        WHERE h2.gas = h1.gas
          AND h2.cylinder_no = h1.cylinder_no
          AND h2.action = 'RETURN'
          AND h2.datetime > h1.datetime
      )
    ORDER BY h1.customer_name
  `, [gas], (err, rows) => {
    res.render('active-customers', { gas, rows });
  });
});

const fs = require('fs');

// DOWNLOAD HISTORY AS CSV
app.get('/download/history', (req, res) => {
  const { month, year } = req.query;

  let where = '';
  let params = [];
  let filename = 'shri-oxygen-history-all.csv';

  if (month) {
    where = "WHERE substr(datetime,1,7) = ?";
    params = [month];
    filename = `shri-oxygen-history-${month}.csv`;
  } else if (year) {
    where = "WHERE substr(datetime,1,4) = ?";
    params = [year];
    filename = `shri-oxygen-history-${year}.csv`;
  }

  db.all(
    `SELECT datetime, action, gas, cylinder_no, customer_name, aadhar, phone
     FROM history ${where}
     ORDER BY datetime`,
    params,
    (err, rows) => {
      if (err) return res.status(500).send('Error generating file');

      let csv = 'Date,Action,Gas,Cylinder,Customer,Aadhar,Phone\n';

      rows.forEach(r => {
        csv += `"${r.datetime}","${r.action}","${r.gas}","${r.cylinder_no}","${r.customer_name || ''}","${r.aadhar || ''}","${r.phone || ''}"\n`;
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
      res.send(csv);
    }
  );
});
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log('Server running on port ' + PORT);
});

