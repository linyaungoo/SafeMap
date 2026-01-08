import { BrowserRouter, Routes, Route } from "react-router-dom";
import AdminMap from "./AdminMap";
import PublicMap from "./PublicMap";
import ClientMap from "./ClientMap";

export default function App(){
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<AdminMap/>}/>
        <Route path="/public" element={<PublicMap/>}/>
        <Route path="/client" element={<ClientMap></ClientMap>}/>
      </Routes>
    </BrowserRouter>
  );
}
