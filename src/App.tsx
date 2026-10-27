import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { GamesPage } from '@/routes/GamesPage';
import { GameDetailPage } from '@/routes/GameDetailPage';
import { AchievementPage } from '@/routes/AchievementPage';
import { ProfilePage } from '@/routes/ProfilePage';
import { SettingsPage } from '@/routes/SettingsPage';
import { LoginPage } from '@/routes/LoginPage';

export default function App() {
  return (
    <Routes>
      {/* Public */}
      <Route path="/login" element={<LoginPage />} />

      {/* Dashboard */}
      <Route
        path="/"
        element={
          <DashboardLayout>
            <Outlet />
          </DashboardLayout>
        }
      >
        <Route index element={<Navigate to="/games" replace />} />
        <Route path="games" element={<GamesPage />} />
        <Route path="games/:slug" element={<GameDetailPage />} />
        <Route path="achievements/:id" element={<AchievementPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
