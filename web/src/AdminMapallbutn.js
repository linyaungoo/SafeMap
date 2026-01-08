import { useEffect, useRef, useState } from "react";
import axios from "axios";

const MODES = {
  DEFAULT:"DEFAULT",
  DRAW_ROUTE:"DRAW_ROUTE",
  DRAW_ZONE:"DRAW_ZONE",
  EDIT_ROUTE:"EDIT_ROUTE",
  EDIT_ZONE:"EDIT_ZONE",
  DELETE_ROUTE:"DELETE_ROUTE",
  DELETE_ZONE:"DELETE_ZONE"
};

export default function AdminMap(){

  const mapRef = useRef();
  const map = useRef();
  const dirService = useRef();
  const dirRenderer = useRef();
  const drawingManager = useRef();

  const zoneOverlays = useRef([]);
  const routeOverlays = useRef([]);
  const draftMarkers = useRef([]);
  const draftZoneOverlay = useRef(null);
  const editZoneOverlay = useRef(null);

  const [mode,setMode] = useState(MODES.DEFAULT);
  const [band,setBand] = useState("SAFE");
  const [selected,setSelected] = useState(null);
  const [waypoints,setWaypoints] = useState([]);
  const [pendingZone,setPendingZone] = useState(null);
  const [zoneForm,setZoneForm] = useState({name:"",description:"",band:"SAFE"});

  const bandColor=b=>b==="SAFE"?"green":b==="WARNING"?"orange":"red";

  /* MAP INIT */
  useEffect(()=>{
    const t=setInterval(()=>{
      if(window.google){
        clearInterval(t);
        map.current=new window.google.maps.Map(mapRef.current,{
          center:{lat:16.8661,lng:96.1951},zoom:6
        });
        dirService.current=new window.google.maps.DirectionsService();
        dirRenderer.current=new window.google.maps.DirectionsRenderer({suppressMarkers:true});
        drawingManager.current=new window.google.maps.drawing.DrawingManager({drawingControl:false});
        refresh();
      }
    },100);
  },[]);

  /* FSM MODE ENGINE */
  useEffect(()=>{
    if(!map.current) return;

    window.google.maps.event.clearListeners(map.current,"click");
    drawingManager.current.setMap(null);
    dirRenderer.current.setMap(null);
    draftMarkers.current.forEach(m=>m.setMap(null));
    draftMarkers.current=[];
    setWaypoints([]);
    setPendingZone(null);
    setSelected(null);

    if(editZoneOverlay.current){
      editZoneOverlay.current.setMap(null);
      editZoneOverlay.current=null;
    }

    applyVisibility();

    if(mode===MODES.DRAW_ROUTE){
      dirRenderer.current.setMap(map.current);
      map.current.addListener("click",e=>{
        const m=new window.google.maps.Marker({position:e.latLng,map:map.current});
        draftMarkers.current.push(m);
        setWaypoints(w=>[...w,e.latLng]);
      });
    }

    if(mode===MODES.DRAW_ZONE){
      drawingManager.current.setDrawingMode("polygon");
      drawingManager.current.setMap(map.current);
      drawingManager.current.addListener("overlaycomplete",e=>{
        const p=e.overlay.getPath().getArray().map(x=>[x.lng(),x.lat()]);
        p.push(p[0]);
        setPendingZone({type:"Polygon",coordinates:[p]});
        setZoneForm({name:"",description:"",band:"SAFE"});
        e.overlay.setMap(null);
        drawingManager.current.setMap(null);
      });
    }

    refresh();
  },[mode]);

  /* DRAFT ZONE PREVIEW */
  useEffect(()=>{
    if(draftZoneOverlay.current){
      draftZoneOverlay.current.setMap(null);
      draftZoneOverlay.current=null;
    }

    if(pendingZone){
      draftZoneOverlay.current=new window.google.maps.Polygon({
        paths: pendingZone.coordinates[0].map(p=>({lng:p[0],lat:p[1]})),
        fillColor: bandColor(zoneForm.band),
        strokeColor: bandColor(zoneForm.band),
        fillOpacity:.35,
        map: map.current
      });
    }
  },[pendingZone,zoneForm.band]);

  /* LIVE EDIT COLOR PREVIEW */
  useEffect(()=>{
    if(editZoneOverlay.current){
      editZoneOverlay.current.setOptions({
        fillColor: bandColor(zoneForm.band),
        strokeColor: bandColor(zoneForm.band)
      });
    }
  },[zoneForm.band]);

  function applyVisibility(){
    zoneOverlays.current.forEach(z=>z.setMap(null));
    routeOverlays.current.forEach(r=>r.setMap(null));

    if(mode===MODES.DEFAULT){
      zoneOverlays.current.forEach(z=>z.setMap(map.current));
      routeOverlays.current.forEach(r=>r.setMap(map.current));
    }
    if([MODES.DRAW_ROUTE,MODES.EDIT_ROUTE,MODES.DELETE_ROUTE].includes(mode)){
      routeOverlays.current.forEach(r=>r.setMap(map.current));
    }
    if([MODES.DRAW_ZONE,MODES.EDIT_ZONE,MODES.DELETE_ZONE].includes(mode)){
      zoneOverlays.current.forEach(z=>z.setMap(map.current));
    }
  }

  async function refresh(){
    await loadZones();
    await loadRoutes();
    applyVisibility();
  }

  async function loadZones(){
    zoneOverlays.current.forEach(z=>z.setMap(null)); zoneOverlays.current=[];
    const r=await axios.get("http://localhost:4000/zones");
    r.data.forEach(z=>{
      const g=JSON.parse(z.geojson);
      const poly=new window.google.maps.Polygon({
        paths:g.coordinates[0].map(c=>({lng:c[0],lat:c[1]})),
        fillColor:bandColor(z.risk_band),
        strokeColor:bandColor(z.risk_band),
        fillOpacity:.3,map:map.current
      });
      poly.addListener("click",()=>{
        if(mode===MODES.EDIT_ZONE){
          setSelected(z);
          setZoneForm({name:z.zone_name||"",description:z.description||"",band:z.risk_band||"SAFE"});
          if(editZoneOverlay.current) editZoneOverlay.current.setMap(null);
          editZoneOverlay.current=new window.google.maps.Polygon({
            paths:g.coordinates[0].map(p=>({lng:p[0],lat:p[1]})),
            fillColor:bandColor(z.risk_band),
            strokeColor:bandColor(z.risk_band),
            fillOpacity:.35,
            editable:true,
            map:map.current
          });
        }
        if(mode===MODES.DELETE_ZONE) setSelected(z);
      });
      zoneOverlays.current.push(poly);
    });
  }

  async function loadRoutes(){
    routeOverlays.current.forEach(r=>r.setMap(null)); routeOverlays.current=[];
    const r=await axios.get("http://localhost:4000/corridors");
    r.data.forEach(c=>{
      const g=JSON.parse(c.geojson);
      const line=new window.google.maps.Polyline({
        path:g.coordinates.map(p=>({lng:p[0],lat:p[1]})),
        strokeColor:bandColor(c.safety_band),
        strokeWeight:4,map:map.current
      });
      line.addListener("click",()=>{ if(mode===MODES.EDIT_ROUTE||mode===MODES.DELETE_ROUTE) setSelected(c); });
      routeOverlays.current.push(line);
    });
  }

  /* AUTO ROUTING */
  useEffect(()=>{
    if(mode!==MODES.DRAW_ROUTE || waypoints.length<2) return;
    dirService.current.route({
      origin:waypoints[0],
      destination:waypoints[waypoints.length-1],
      waypoints:waypoints.slice(1,-1).map(p=>({location:p,stopover:true})),
      travelMode:"DRIVING"
    },(res,stat)=>{
      if(stat==="OK"){
        dirRenderer.current.setDirections(res);
        dirRenderer.current.setOptions({polylineOptions:{strokeColor:bandColor(band),strokeWeight:5}});
      }
    });
  },[waypoints,band,mode]);

  async function saveRoute(){
    const rt=dirRenderer.current.getDirections().routes[0];
    const path=window.google.maps.geometry.encoding.decodePath(rt.overview_polyline);
    const coords=path.map(p=>[p.lng(),p.lat()]);
    await axios.post("http://localhost:4000/saveRoute",{geojson:{type:"LineString",coordinates:coords},color:band});
    setMode(MODES.DEFAULT);
  }

  async function saveZone(){
    await axios.post("http://localhost:4000/save-zone",{
      zone_name: zoneForm.name,
      description: zoneForm.description,
      risk_band: zoneForm.band,
      geojson: pendingZone
    });
    setMode(MODES.DEFAULT);
  }

  async function saveEdit(){
    if(mode===MODES.EDIT_ROUTE)
      await axios.put(`http://localhost:4000/corridor/${selected.id}`,{safety_band:band});

    if(mode===MODES.EDIT_ZONE){
      const pts = editZoneOverlay.current.getPath().getArray().map(p=>[p.lng(),p.lat()]);
      pts.push(pts[0]);
      await axios.put(`http://localhost:4000/zone/${selected.id}`,{
        zone_name: zoneForm.name,
        description: zoneForm.description,
        risk_band: zoneForm.band,
        geojson:{type:"Polygon",coordinates:[pts]}
      });
    }
    setMode(MODES.DEFAULT);
  }

  async function confirmDelete(){
    if(mode===MODES.DELETE_ROUTE) await axios.delete(`http://localhost:4000/corridor/${selected.id}`);
    if(mode===MODES.DELETE_ZONE) await axios.delete(`http://localhost:4000/zone/${selected.id}`);
    setMode(MODES.DEFAULT);
  }

  return(
    <>
      <div className="control-panel">
        <button onClick={()=>setMode(MODES.DRAW_ROUTE)}>Draw Route</button>
        <button onClick={()=>setMode(MODES.DRAW_ZONE)}>Draw Zone</button>
        <button onClick={()=>setMode(MODES.EDIT_ROUTE)}>Edit Route</button>
        <button onClick={()=>setMode(MODES.EDIT_ZONE)}>Edit Zone</button>
        <button onClick={()=>setMode(MODES.DELETE_ROUTE)}>Delete Route</button>
        <button onClick={()=>setMode(MODES.DELETE_ZONE)}>Delete Zone</button>
        <button onClick={()=>setMode(MODES.DEFAULT)}>Cancel</button>
      </div>

      {(mode===MODES.DRAW_ZONE||mode===MODES.EDIT_ZONE) && (pendingZone||editZoneOverlay.current) &&
        <div className="zone-panel">
          <input placeholder="Zone Name" value={zoneForm.name} onChange={e=>setZoneForm({...zoneForm,name:e.target.value})}/>
          <textarea placeholder="Description" value={zoneForm.description} onChange={e=>setZoneForm({...zoneForm,description:e.target.value})}/>
          <select value={zoneForm.band} onChange={e=>setZoneForm({...zoneForm,band:e.target.value})}>
            <option value="SAFE">SAFE</option>
            <option value="WARNING">WARNING</option>
            <option value="DANGER">DANGER</option>
            <option value="FORBIDDEN">FORBIDDEN</option>
          </select>
          <div style={{height:20,background:bandColor(zoneForm.band)}}/>
          <button onClick={mode===MODES.DRAW_ZONE?saveZone:saveEdit}>Confirm Save</button>
          <button onClick={()=>setMode(MODES.DEFAULT)}>Cancel</button>
        </div>
      }

      {(mode===MODES.DELETE_ROUTE||mode===MODES.DELETE_ZONE) && selected &&
        <div className="control-panel">
          <button onClick={confirmDelete}>Confirm Delete</button>
        </div>
      }

      {(mode===MODES.DRAW_ROUTE || mode===MODES.EDIT_ROUTE) &&
        <div className="control-panel">
          <select value={band} onChange={e=>setBand(e.target.value)}>
            <option value="SAFE">SAFE</option>
            <option value="WARNING">WARNING</option>
            <option value="DANGER">DANGER</option>
          </select>
          {mode===MODES.DRAW_ROUTE && waypoints.length>1 && <button onClick={saveRoute}>Save Route</button>}
          {mode===MODES.EDIT_ROUTE && selected && <button onClick={saveEdit}>Save Change</button>}
        </div>
      }

      <div ref={mapRef} style={{height:"100vh"}}/>
    </>
  );
}
