import { useEffect, useRef } from "react";
import axios from "axios";

const waitForGoogle = () => new Promise(r=>{
  const i=setInterval(()=>window.google&&(clearInterval(i),r()),100);
});

export default function PublicMap(){

  const mapRef = useRef();
  const map = useRef();
  const info = useRef();
  const userMarker = useRef(null);
  const destMarker = useRef(null);
  const routeLine = useRef(null);

  useEffect(()=>{
    waitForGoogle().then(init);
  },[]);

  async function init(){
    map.current = new window.google.maps.Map(mapRef.current,{
      center:{lat:16.8661,lng:96.1951},
      zoom:6
    });

    info.current = new window.google.maps.InfoWindow();

    loadZones();
    loadCorridors();
    locateUser();

    map.current.addListener("click",e=>{
      setDestination(e.latLng);
    });
  }

  const bandColor=b=>b==="SAFE"?"green":b==="WARNING"?"orange":"red";

  /* ================= LOAD ADVISORY LAYERS ================= */

  async function loadZones(){
    const r = await axios.get("http://localhost:4000/zones");
    r.data.forEach(z=>{
      const g = JSON.parse(z.geojson||"{}");
      if(!g.coordinates) return;

      const poly = new window.google.maps.Polygon({
        paths: g.coordinates[0].map(c=>({lng:c[0],lat:c[1]})),
        fillColor: bandColor(z.risk_band),
        strokeColor: bandColor(z.risk_band),
        fillOpacity:.4,
        map: map.current
      });

      poly.addListener("mouseover",e=>{
        info.current.setContent(`<b>${z.zone_name||"Zone"}</b><br>${z.note||""}`);
        info.current.setPosition(e.latLng);
        info.current.open(map.current);
      });
      poly.addListener("mouseout",()=>info.current.close());
    });
  }

  async function loadCorridors(){
    const r = await axios.get("http://localhost:4000/corridors");
    r.data.forEach(c=>{
      const g = JSON.parse(c.geojson||"{}");
      if(!g.coordinates) return;

      new window.google.maps.Polyline({
        path: g.coordinates.map(p=>({lng:p[0],lat:p[1]})),
        strokeColor: bandColor(c.safety_band),
        strokeWeight:5,
        map: map.current
      });
    });
  }

  /* ================= USER LOCATION ================= */

  function locateUser(){
    navigator.geolocation.getCurrentPosition(pos=>{
      const loc = {lat:pos.coords.latitude, lng:pos.coords.longitude};
      map.current.setCenter(loc);
      map.current.setZoom(14);

      userMarker.current = new window.google.maps.Marker({
        position: loc,
        map: map.current,
        icon:"http://maps.google.com/mapfiles/ms/icons/blue-dot.png"
      });
    });
  }

  /* ================= DESTINATION & ROUTING ================= */

  async function setDestination(pos){
    if(destMarker.current) destMarker.current.setMap(null);
    destMarker.current = new window.google.maps.Marker({position:pos,map:map.current});

    const userPos = userMarker.current?.getPosition();
    if(!userPos) return;

    const res = await axios.post("http://localhost:4000/generateRoutes",{
      points:[
        {lat:userPos.lat(),lng:userPos.lng()},
        {lat:pos.lat(),lng:pos.lng()}
      ]
    });

    if(!res.data.length) return alert("No safe route found");

    const poly = res.data[0].overview_polyline.points;
    const path = window.google.maps.geometry.encoding.decodePath(poly);

    if(routeLine.current) routeLine.current.setMap(null);
    routeLine.current = new window.google.maps.Polyline({
      path,
      map:map.current,
      strokeColor:"#0066ff",
      strokeWeight:6
    });
  }

  return <div ref={mapRef} style={{height:"100vh"}}/>;
}
