import { useEffect, useRef, useState } from "react";
import axios from "axios";
import "./ClientMap.css";

export default function ClientMap(){

  const mapRef = useRef();
  const map = useRef();
  const dirService = useRef();
  const dirRenderer = useRef();
  const markers = useRef([]);
  const zoneOverlays = useRef([]);
  const routeOverlays = useRef([]);
  const searchBoxRef = useRef();

  const [points,setPoints] = useState([]);
  const [routeAlert,setRouteAlert] = useState(null);
  const [blocked,setBlocked] = useState(false);
  const [zones,setZones] = useState([]);
  const [search,setSearch] = useState("");
  const [open,setOpen] = useState(false);

  const bandColor=b=>b==="SAFE"?"#16a34a":b==="WARNING"?"#f59e0b":b==="DANGER"?"#dc2626":"#020617";

  /* MAP INIT */
  useEffect(()=>{
    const t=setInterval(()=>{
      if(window.google){
        clearInterval(t);
        map.current=new window.google.maps.Map(mapRef.current,{
          center:{lat:16.8661,lng:96.1951},
          zoom:7,
          mapTypeControl:false,
          streetViewControl:false
        });
        dirService.current=new window.google.maps.DirectionsService();
        dirRenderer.current=new window.google.maps.DirectionsRenderer({map:map.current});
        loadZones();
        loadRoutes();
        locateUser();
      }
    },100);
  },[]);

  function locateUser(){
    if(navigator.geolocation){
      navigator.geolocation.getCurrentPosition(pos=>{
        const p={lat:pos.coords.latitude,lng:pos.coords.longitude};
        map.current.setCenter(p);
        new window.google.maps.Marker({position:p,map:map.current,title:"Your Location"});
      });
    }
  }

  /* Click to set route */
  useEffect(()=>{
    if(!map.current) return;
    map.current.addListener("click",e=>{
      if(points.length>=2) return;
      const m=new window.google.maps.Marker({position:e.latLng,map:map.current});
      markers.current.push(m);
      setPoints(p=>[...p,e.latLng]);
    });
  },[points]);

  /* Generate route */
  useEffect(()=>{
    if(points.length<2) return;
    dirService.current.route({
      origin:points[0],
      destination:points[1],
      travelMode:"DRIVING"
    },(res,stat)=>{
      if(stat==="OK"){
        dirRenderer.current.setDirections(res);
        scanRoute(res.routes[0].overview_polyline);
      }
    });
  },[points]);

  async function scanRoute(poly){
    const pts=window.google.maps.geometry.encoding.decodePath(poly);
    let worst="SAFE";
    for(let p of pts){
      const r=await axios.post("http://localhost:4000/analyze",{lat:p.lat(),lng:p.lng()});
      if(r.data.status==="inside_zone"){
        const b=r.data.zone.risk_band.toUpperCase();
        if(b==="FORBIDDEN"){ setRouteAlert("FORBIDDEN"); setBlocked(true); return; }
        if(b==="DANGER") worst="DANGER";
        if(b==="WARNING" && worst!=="DANGER") worst="WARNING";
      }
    }
    setRouteAlert(worst);
    setBlocked(false);
  }

  function reset(){
    markers.current.forEach(m=>m.setMap(null));
    markers.current=[];
    setPoints([]);
    setRouteAlert(null);
    setBlocked(false);
    dirRenderer.current.setDirections({routes:[]});
  }

  async function loadZones(){
    const r=await axios.get("http://localhost:4000/zones");
    setZones(r.data);

    r.data.forEach(z=>{
      const g=JSON.parse(z.geojson);
      const poly=new window.google.maps.Polygon({
        paths:g.coordinates[0].map(c=>({lng:c[0],lat:c[1]})),
        fillColor:bandColor(z.risk_band),
        strokeColor:bandColor(z.risk_band),
        fillOpacity:.3,
        map:map.current
      });

      const info=new window.google.maps.InfoWindow({
        content:`<b>${z.zone_name||"Unnamed Zone"}</b><br>${z.description||"No description"}<br>
        <span style="color:${bandColor(z.risk_band)}">${z.risk_band}</span>`
      });

      poly.addListener("mouseover",e=>{info.setPosition(e.latLng);info.open(map.current);});
      poly.addListener("mouseout",()=>info.close());

      zoneOverlays.current.push(poly);
    });
  }

  async function loadRoutes(){
    const r=await axios.get("http://localhost:4000/corridors");
    r.data.forEach(c=>{
      const g=JSON.parse(c.geojson);
      const line=new window.google.maps.Polyline({
        path:g.coordinates.map(p=>({lng:p[0],lat:p[1]})),
        strokeColor:bandColor(c.safety_band),
        strokeWeight:4,
        map:map.current
      });
      routeOverlays.current.push(line);
    });
  }

  function zoomToZone(z){
    const g = JSON.parse(z.geojson);
    const bounds = new window.google.maps.LatLngBounds();
    g.coordinates[0].forEach(p=>bounds.extend({lat:p[1],lng:p[0]}));
    map.current.fitBounds(bounds);
    setOpen(false);
    setSearch(z.zone_name||"");
  }

  /* CLOSE DROPDOWN */
  useEffect(()=>{
    function close(e){
      if(searchBoxRef.current && !searchBoxRef.current.contains(e.target)){
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", close);
    return ()=>document.removeEventListener("mousedown", close);
  },[]);

  useEffect(()=>{
    function esc(e){ if(e.key==="Escape") setOpen(false); }
    document.addEventListener("keydown", esc);
    return ()=>document.removeEventListener("keydown", esc);
  },[]);

  return(
    <>
      <div className="zone-search" ref={searchBoxRef}>
        <input
          placeholder="Search zone..."
          value={search}
          onChange={e=>{
            setSearch(e.target.value);
            if(!e.target.value) setOpen(false);
          }}
          onFocus={()=>setOpen(true)}
        />
        {open && (
          <div className="zone-list">
            {zones.filter(z=>z.zone_name?.toLowerCase().includes(search.toLowerCase()))
              .map(z=>(
                <div key={z.id} className="zone-item" onClick={()=>zoomToZone(z)}>
                  <div className="zone-name">{z.zone_name||"Unnamed Zone"}</div>
                  <div className={`zone-band ${z.risk_band.toLowerCase()}`}>{z.risk_band}</div>
                </div>
              ))}
          </div>
        )}
      </div>

      <div className="client-ui">
        {routeAlert==="WARNING" && <div className="warn yellow">⚠ WARNING ZONE</div>}
        {routeAlert==="DANGER" && <div className="warn red">⛔ DANGER ZONE</div>}
        {routeAlert==="FORBIDDEN" && <div className="warn black">🚫 BLOCKED</div>}
        <button disabled={blocked} onClick={()=>window.alert("Navigation Started")}>Start Navigation</button>
        <button onClick={reset}>Reset</button>
      </div>

      <div ref={mapRef} style={{height:"100vh"}}/>
    </>
  );
}
