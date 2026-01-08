import { useEffect, useRef, useState } from "react";
import axios from "axios";

const waitForGoogle = () => new Promise(r=>{
  const i=setInterval(()=>window.google&&(clearInterval(i),r()),100);
});

export default function App(){

  const mapRef = useRef();
  const map = useRef();
  const toolRef = useRef(null);

  const zones = useRef([]);
  const corridors = useRef([]);
  const draft = useRef(null);

  const [tool,setTool] = useState(null);
  const [selected,setSelected] = useState(null);
  const [pendingZone,setPendingZone] = useState(null);

  useEffect(()=>{ toolRef.current=tool },[tool]);

  useEffect(()=>{
    waitForGoogle().then(()=>{
      map.current=new window.google.maps.Map(mapRef.current,{
        center:{lat:16.8661,lng:96.1951},zoom:6
      });

      map.current.addListener("click",e=>{
        if(toolRef.current==="ROUTE") addPoint(e.latLng);
      });

      refresh();
    });
  },[]);

  const bandColor=b=>b==="SAFE"?"green":b==="WARNING"?"orange":"red";
  const refresh=()=>{ loadZones(); loadCorridors(); };

  /* ================= ROUTE ENGINE ================= */

  function startRoute(){
    draft.current={points:[],markers:[],routes:[],tempLines:[],selected:0};
    setTool("ROUTE");
  }

  function addPoint(pos){
    const s=draft.current; if(!s) return;
    s.points.push(pos);
    const m=new window.google.maps.Marker({position:pos,map:map.current,label:String(s.points.length)});
    m.addListener("dblclick",()=>removePoint(m));
    s.markers.push(m);
    rebuildDraft();
  }

  function removePoint(marker){
    const s=draft.current;
    const i=s.markers.indexOf(marker);
    if(i<0) return;
    s.markers[i].setMap(null);
    s.markers.splice(i,1);
    s.points.splice(i,1);
    rebuildDraft();
  }

  /* ---------- SAFE POLYLINE EXTRACTOR ---------- */
  function extractPolyline(rt){
    if(rt.overview_polyline?.points) return rt.overview_polyline.points;

    let pts=[];
    rt.legs.forEach(l=>{
      l.steps.forEach(s=>{
        pts.push(...window.google.maps.geometry.encoding.decodePath(s.polyline.points));
      });
    });
    return window.google.maps.geometry.encoding.encodePath(pts);
  }

  async function rebuildDraft(){
    const s=draft.current;
    s.tempLines.forEach(l=>l.setMap(null));
    s.tempLines=[]; 
    s.routes=[];

    if(s.points.length<2) return;

    const pts=s.points.map(p=>({lat:p.lat(),lng:p.lng()}));
    const res=await axios.post("http://localhost:4000/generateRoutes",{points:pts});

    res.data.forEach((rt,i)=>{
      const poly = extractPolyline(rt);
      if(!poly) return;

      const path = window.google.maps.geometry.encoding.decodePath(poly);

      const line=new window.google.maps.Polyline({
        path,
        map:map.current,
        clickable:true,
        strokeWeight:6,
        strokeOpacity:1,
        strokeColor:"#999"
      });

      line.addListener("click",()=>selectDraftRoute(i));
      s.tempLines.push(line);
      s.routes.push({ polyline: poly, line });
    });

    if(s.routes.length) selectDraftRoute(0);
  }

  function selectDraftRoute(i){
    const s=draft.current;
    s.routes.forEach((r,idx)=>r.line.setOptions({strokeColor:idx===i?"#0066ff":"#999"}));
    s.selected=i;
  }

  async function saveDraft(band){
    const s=draft.current;
    const r=s.routes[s.selected];
    if(!r) return alert("Select route first");

    const coords = window.google.maps.geometry.encoding.decodePath(r.polyline)
        .map(p=>[p.lng(),p.lat()]);

    const geo = { type:"LineString", coordinates: coords };

    await axios.post("http://localhost:4000/saveRoute",{geojson:geo,color:band});
    clearDraft(); refresh();
  }

  function clearDraft(){
    const s=draft.current;
    if(!s) return;
    s.markers.forEach(m=>m.setMap(null));
    s.tempLines.forEach(l=>l.setMap(null));
    draft.current=null; setTool(null);
  }

  /* ================= ZONES ================= */

  async function loadZones(){
    zones.current.forEach(z=>z.setMap(null)); zones.current=[];
    const r=await axios.get("http://localhost:4000/zones");
    r.data.forEach(z=>{
      const g=JSON.parse(z.geojson||"{}"); if(!g.coordinates) return;
      const poly=new window.google.maps.Polygon({
        paths:g.coordinates[0].map(c=>({lng:c[0],lat:c[1]})),
        fillColor:bandColor(z.risk_band),
        strokeColor:bandColor(z.risk_band),
        fillOpacity:.3,map:map.current
      });
      poly.addListener("click",()=>setSelected({type:"zone",id:z.id}));
      zones.current.push(poly);
    });
  }

  async function loadCorridors(){
    corridors.current.forEach(l=>l.setMap(null)); corridors.current=[];
    const r=await axios.get("http://localhost:4000/corridors");
    r.data.forEach(c=>{
      const g=JSON.parse(c.geojson||"{}"); if(!g.coordinates) return;
      const line=new window.google.maps.Polyline({
        path:g.coordinates.map(p=>({lng:p[0],lat:p[1]})),
        strokeColor:bandColor(c.safety_band),strokeWeight:4,map:map.current
      });
      line.addListener("click",()=>setSelected({type:"corridor",id:c.id}));
      corridors.current.push(line);
    });
  }

  /* ================= ZONE DRAW ================= */

  function drawZone(){
    setTool("ZONE");
    const dm=new window.google.maps.drawing.DrawingManager({
      drawingMode:window.google.maps.drawing.OverlayType.POLYGON,
      drawingControl:false
    });
    dm.setMap(map.current);
    dm.addListener("overlaycomplete",e=>{
      const p=e.overlay.getPath().getArray().map(x=>[x.lng(),x.lat()]);
      p.push(p[0]);
      setPendingZone({type:"Polygon",coordinates:[p]});
      e.overlay.setMap(null); dm.setMap(null);
    });
  }

  const saveZone=async band=>{
    await axios.post("http://localhost:4000/save-zone",{zone_name:"Zone",risk_band:band,geojson:pendingZone});
    setPendingZone(null); refresh();
  };

  /* ================= CLASSIFY / DELETE ================= */

  const applyBand=async band=>{
    if(!selected) return;
    if(selected.type==="zone") await axios.put(`http://localhost:4000/zone/${selected.id}`,{risk_band:band});
    if(selected.type==="corridor") await axios.put(`http://localhost:4000/corridor/${selected.id}`,{safety_band:band});
    setSelected(null); refresh();
  };

  const remove=async()=>{
    if(!selected) return;
    if(selected.type==="zone") await axios.delete(`http://localhost:4000/zone/${selected.id}`);
    if(selected.type==="corridor") await axios.delete(`http://localhost:4000/corridor/${selected.id}`);
    setSelected(null); refresh();
  };

  return(
    <>
      <div className="toolbar">
        <button onClick={startRoute}>🛣 Draw Route</button>
        <button onClick={drawZone}>🗺 Draw Zone</button>
        <button onClick={()=>setTool("CLASSIFY")}>🟩 Classify</button>
        <button onClick={remove}>🗑 Delete</button>
        <button onClick={clearDraft}>❌ Cancel</button>
      </div>

      {draft.current &&
        <div className="toolbar">
          <button onClick={()=>saveDraft("SAFE")}>🟩 Save SAFE</button>
          <button onClick={()=>saveDraft("WARNING")}>🟨 Save WARNING</button>
          <button onClick={()=>saveDraft("DANGER")}>🟥 Save DANGER</button>
        </div>
      }

      {pendingZone &&
        <div className="toolbar">
          <button onClick={()=>saveZone("SAFE")}>🟩 Save SAFE</button>
          <button onClick={()=>saveZone("WARNING")}>🟨 Save WARNING</button>
          <button onClick={()=>saveZone("DANGER")}>🟥 Save DANGER</button>
        </div>
      }

      {selected &&
        <div className="toolbar">
          <button onClick={()=>applyBand("SAFE")}>🟩</button>
          <button onClick={()=>applyBand("WARNING")}>🟨</button>
          <button onClick={()=>applyBand("DANGER")}>🟥</button>
        </div>
      }

      <div ref={mapRef} style={{height:"85vh"}}/>
    </>
  );
}
