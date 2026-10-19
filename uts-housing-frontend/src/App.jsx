import { Routes, Route } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/student/Dashboard';
import HousingSearch from './pages/student/HousingSearch';
import RoommateSearch from './pages/student/RoommateSearch';
import Profile from './pages/student/Profile';
import Messages from './pages/student/Messages'; // 1. 引入新页面

import LandlordPortal from './pages/landlord/LandlordPortal';

function App() {
  return (
    <div className="bg-gray-100 min-h-screen font-sans text-gray-900">
      <Routes>
        <Route path="/" element={<Login />} />
        
        {/* 学生端 */}
        <Route path="/student" element={<Dashboard />} />
        <Route path="/student/housing" element={<HousingSearch />} />
        <Route path="/student/roommates" element={<RoommateSearch />} />
        <Route path="/student/profile" element={<Profile />} />
        <Route path="/student/messages" element={<Messages />} /> {/* 2. 添加路由 */}
        
        {/* 房东端 */}
        <Route path="/landlord/*" element={<LandlordPortal />} />
      </Routes>
    </div>
  );
}

export default App;