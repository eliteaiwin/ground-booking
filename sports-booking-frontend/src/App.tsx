import { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import Dashboard from './pages/Dashboard';
import GameDetail from './pages/GameDetail';
import CreateGame from './pages/CreateGame';
import MyPayments from './pages/MyPayments';
import AdminSummary from './pages/AdminSummary';
import ManageUsers from './pages/ManageUsers';
import ProfilePage from './pages/ProfilePage';
import ModeratorPreferences from './pages/ModeratorPreferences';
import ModeratorScreens from './pages/ModeratorScreens';
import AdminScreens from './pages/AdminScreens';
import SearchGrounds from './pages/SearchGrounds';
import BackendSettlement from './pages/BackendSettlement';
import GameSearch from './pages/GameSearch';
import GroundManagement from './pages/GroundManagement';
import HallOfFame from './pages/HallOfFame';

type Page = 'dashboard' | 'game-detail' | 'create-game' | 'my-payments' | 'admin-summary' | 'manage-users' | 'profile' | 'moderator-preferences' | 'moderator-screens' | 'admin-screens' | 'search-grounds' | 'backend-settlement' | 'game-search' | 'ground-management' | 'hall-of-fame';

function AppContent() {
  const { user, loading, isAddingAccount, setIsAddingAccount } = useAuth();
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [currentPage, setCurrentPage] = useState<Page>('dashboard');
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null);

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center mx-auto mb-4 animate-pulse">
            <span className="text-white text-2xl">&#9917;</span>
          </div>
          <p className="text-gray-500">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    if (authMode === 'login') {
      return <LoginPage onSwitchToRegister={() => setAuthMode('register')} />;
    }
    return <RegisterPage onSwitchToLogin={() => setAuthMode('login')} />;
  }

  // "Add User" mode — show login form as overlay so user can log in as another account
  if (isAddingAccount) {
    return (
      <div className="relative">
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[90vh] overflow-y-auto relative">
            <button
              onClick={() => setIsAddingAccount(false)}
              className="absolute top-3 right-3 z-10 p-1 rounded-full hover:bg-gray-100 text-gray-500"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
            <div className="p-4 border-b bg-blue-50 rounded-t-2xl">
              <h3 className="text-lg font-bold text-blue-800">Add Another Account</h3>
              <p className="text-sm text-blue-600">Log in with a different account to switch between users</p>
            </div>
            <LoginPage onSwitchToRegister={() => {}} isAddUserMode />
          </div>
        </div>
      </div>
    );
  }

  const navigate = (page: string, gameId?: number) => {
    setCurrentPage(page as Page);
    if (gameId !== undefined) setSelectedGameId(gameId);
  };

  const goHome = () => {
    setCurrentPage('dashboard');
    setSelectedGameId(null);
  };

  switch (currentPage) {
    case 'game-detail':
      return selectedGameId ? (
        <GameDetail gameId={selectedGameId} onBack={goHome} />
      ) : (
        <Dashboard onNavigate={navigate} />
      );
    case 'create-game':
      return (
        <CreateGame
          onBack={goHome}
          onCreated={(gameId) => {
            setSelectedGameId(gameId);
            setCurrentPage('game-detail');
          }}
        />
      );
    case 'my-payments':
      return <MyPayments onBack={goHome} />;
    case 'admin-summary':
      return <AdminSummary onBack={goHome} />;
    case 'manage-users':
      return <ManageUsers onBack={goHome} />;
    case 'profile':
      return <ProfilePage onBack={goHome} />;
    case 'moderator-preferences':
      return <ModeratorPreferences onBack={goHome} />;
    case 'moderator-screens':
      return <ModeratorScreens onBack={goHome} />;
    case 'admin-screens':
      return <AdminScreens onBack={goHome} />;
    case 'search-grounds':
      return <SearchGrounds onBack={goHome} />;
    case 'backend-settlement':
      return <BackendSettlement onBack={goHome} />;
    case 'game-search':
      return <GameSearch onBack={goHome} onViewGame={(gameId) => { setSelectedGameId(gameId); setCurrentPage('game-detail'); }} />;
    case 'ground-management':
      return <GroundManagement onBack={goHome} />;
    case 'hall-of-fame':
      return <HallOfFame onBack={goHome} />;
    default:
      return <Dashboard onNavigate={navigate} />;
  }
}

function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}

export default App
