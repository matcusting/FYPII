import { Routes, Route } from 'react-router-dom';
import { RequireAuth } from './components/ui';
import Login from './pages/Login';
import Register from './pages/Register';
import { ForgotPassword, ResetPassword, VerifyEmail } from './pages/AccountRecovery';
import { Help, NotFound, Privacy, Terms } from './pages/InfoPages';
import Dashboard from './pages/student/Dashboard';
import HousingSearch from './pages/student/HousingSearch';
import RoommateSearch from './pages/student/RoommateSearch';
import Profile from './pages/student/Profile';
import Messages from './pages/student/Messages';

import LandlordPortal from './pages/landlord/LandlordPortal';
import AdminPortal from './pages/admin/AdminPortal';
import ReviewerPortal from './pages/reviewer/ReviewerPortal';

const student = (el) => <RequireAuth roles={['STUDENT']}>{el}</RequireAuth>;

function App() {
  return (
    <div className="bg-gray-100 min-h-screen font-sans text-gray-900">
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/help" element={<Help />} />
        
        {/* 学生端 */}
        <Route path="/student" element={student(<Dashboard />)} />
        <Route path="/student/housing" element={student(<HousingSearch key="all" />)} />
        <Route path="/student/favorites" element={student(<HousingSearch key="saved" savedOnly />)} />
        <Route path="/student/roommates" element={student(<RoommateSearch />)} />
        <Route path="/student/profile" element={student(<Profile />)} />
        <Route path="/student/messages" element={student(<Messages />)} />
        
        {/* 房东端 */}
        <Route path="/landlord/*" element={<RequireAuth roles={['LANDLORD']}><LandlordPortal /></RequireAuth>} />

        {/* 管理员端 */}
        <Route path="/admin" element={<RequireAuth roles={['ADMIN']}><AdminPortal /></RequireAuth>} />
        <Route path="/admin/:tab" element={<RequireAuth roles={['ADMIN']}><AdminPortal /></RequireAuth>} />

        {/* 律师审核端 */}
        <Route path="/reviewer" element={<RequireAuth roles={['LEGAL_REVIEWER']}><ReviewerPortal /></RequireAuth>} />
        <Route path="/reviewer/:tab" element={<RequireAuth roles={['LEGAL_REVIEWER']}><ReviewerPortal /></RequireAuth>} />

        <Route path="*" element={<NotFound />} />
      </Routes>
    </div>
  );
}

export default App;
