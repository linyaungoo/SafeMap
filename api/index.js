import express from "express";
import cors from "cors";
import pkg from "pg";
import axios from "axios";
import "dotenv/config";

const pool = new pkg.Pool({ connectionString: process.env.DATABASE_URL });

const app = express();
app.use(cors());
app.use(express.json());

/* ================= HELPERS ================= */
function normalizeGeoJSON(gj){
  if(!gj) return null;
  if(gj.type === "Feature") return gj.geometry;
  if(gj.type === "FeatureCollection") return gj.features[0].geometry;
  return gj;
}

/* ================= HEALTH ================= */
app.get("/health", (req,res)=>res.send("SafeMap API OK"));

/* ================= ROUTE GENERATION ================= */
app.post("/generateRoutes", async (req,res)=>{
  const { points } = req.body;
  if (!points || points.length < 2) return res.json([]);

  const origin = `${points[0].lat},${points[0].lng}`;
  const destination = `${points.at(-1).lat},${points.at(-1).lng}`;

  let url =
    `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&alternatives=true&key=${process.env.GOOGLE_KEY}`;

  if (points.length > 2) {
    const wp = points.slice(1,-1).map(p=>`${p.lat},${p.lng}`).join("|");
    url =
      `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&waypoints=${wp}&alternatives=true&key=${process.env.GOOGLE_KEY}`;
  }

  const r = await axios.get(url);
  res.json(r.data.routes);
});

/* ================= SAVE CORRIDOR ================= */
app.post("/saveRoute", async(req,res)=>{
  try{
    const { geojson, color, note } = req.body;
    const geom = normalizeGeoJSON(geojson);

    await pool.query(`
      INSERT INTO corridors(geom,safety_band,note)
      VALUES(
        ST_SetSRID(ST_GeomFromGeoJSON($1),4326),
        $2,$3
      )
    `,[ JSON.stringify(geom), color, note || "" ]);

    res.send("Saved");
  }catch(e){
    console.error("SAVE ROUTE ERROR:", e.message);
    res.status(500).send("Save failed");
  }
});

/* ================= SAVE ZONE ================= */
app.post("/save-zone", async(req,res)=>{
  try{
    const { zone_name, description, risk_band, geojson } = req.body;
    const geom = normalizeGeoJSON(geojson);

    await pool.query(`
      INSERT INTO zones(zone_name, risk_band, note, geom)
      VALUES($1,$2,$3,ST_SetSRID(ST_GeomFromGeoJSON($4),4326))
    `,[
      zone_name,
      risk_band,
      description || "",
      JSON.stringify(geom)
    ]);

    res.send("Zone saved");
  }catch(e){
    console.error("ZONE SAVE ERROR:",e);
    res.status(500).send("Save failed");
  }
});





/* ================= LOAD ZONES ================= */
app.get("/zones", async(req,res)=>{
  const r = await pool.query(`
    SELECT 
      id,
      zone_name,
      note AS description,
      risk_band,
      ST_AsGeoJSON(geom) AS geojson
    FROM zones
  `);
  res.json(r.rows);
});


/* ================= LOAD CORRIDORS ================= */
app.get("/corridors", async(req,res)=>{
  const r = await pool.query(`
    SELECT id,safety_band,note,ST_AsGeoJSON(geom) geojson FROM corridors
  `);
  res.json(r.rows);
});

/* ================= UPDATE / DELETE ================= */
app.put("/corridor/:id", async(req,res)=>{
  const { safety_band, note } = req.body;
  await pool.query(`UPDATE corridors SET safety_band=$1,note=$2 WHERE id=$3`,
    [safety_band,note||"",req.params.id]);
  res.send("Updated");
});

app.delete("/corridor/:id", async(req,res)=>{
  await pool.query(`DELETE FROM corridors WHERE id=$1`,[req.params.id]);
  res.send("Deleted");
});

app.put("/zone/:id", async(req,res)=>{
  try{
    const { zone_name, description, risk_band, geojson } = req.body;

    if(geojson){
      const geom = normalizeGeoJSON(geojson);
      await pool.query(`
        UPDATE zones SET zone_name=$1, risk_band=$2, note=$3,
        geom=ST_SetSRID(ST_GeomFromGeoJSON($4),4326)
        WHERE id=$5
      `,[zone_name,risk_band,description||"",JSON.stringify(geom),req.params.id]);
    }else{
      await pool.query(`
        UPDATE zones SET zone_name=$1, risk_band=$2, note=$3
        WHERE id=$4
      `,[zone_name,risk_band,description||"",req.params.id]);
    }

    res.send("Zone updated");
  }catch(e){
    console.error("ZONE UPDATE ERROR:",e);
    res.status(500).send("Update failed");
  }
});




app.delete("/zone/:id", async(req,res)=>{
  await pool.query(`DELETE FROM zones WHERE id=$1`,[req.params.id]);
  res.send("Deleted");
});

/* ================= SAFETY ANALYSIS ENGINE ================= */
app.post("/analyze", async(req,res)=>{
  const { lat,lng } = req.body;

  const r = await pool.query(`
    SELECT zone_name, risk_band
    FROM zones
    WHERE ST_Contains(geom, ST_SetSRID(ST_Point($1,$2),4326))
    ORDER BY
      CASE risk_band
        WHEN 'forbidden' THEN 4
        WHEN 'high' THEN 3
        WHEN 'medium' THEN 2
        ELSE 1
      END DESC
    LIMIT 1
  `,[lng,lat]);

  if(r.rowCount){
    return res.json({
      status: "inside_zone",
      zone: r.rows[0]
    });
  }

  const nearest = await pool.query(`
    SELECT id, safety_band,
      ST_Distance(geom::geography, ST_SetSRID(ST_Point($1,$2),4326)::geography) dist
    FROM corridors
    ORDER BY dist
    LIMIT 1
  `,[lng,lat]);

  res.json({
    status:"safe",
    nearest_route: nearest.rows[0]
  });
});

/* ================= START ================= */
app.listen(4000,()=>console.log("SafeMap API running on :4000"));
