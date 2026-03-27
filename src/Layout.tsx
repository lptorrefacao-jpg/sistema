import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Package, 
  ShoppingCart, 
  ShoppingBag,
  RotateCcw,
  TrendingUp,
  Users, 
  CheckSquare, 
  LogOut,
  Menu,
  X,
  History,
  DollarSign,
  Truck
} from 'lucide-react';
import { useAuth } from './AuthContext';
import { logout } from './firebase';
import { cn } from './lib/utils';

const navItems = [
  { name: 'Dashboard', path: '/', icon: LayoutDashboard },
  { name: 'Estoque', path: '/estoque', icon: Package },
  { name: 'Histórico Estoque', path: '/estoque/historico', icon: History },
  { name: 'Vendas', path: '/vendas', icon: ShoppingCart },
  { name: 'Devoluções', path: '/vendas/devolucoes', icon: RotateCcw },
  { name: 'Compras', path: '/compras', icon: ShoppingBag },
  { name: 'Lucro Bruto', path: '/lucro', icon: TrendingUp },
  { name: 'Financeiro', path: '/financeiro', icon: DollarSign },
  { name: 'Clientes', path: '/clientes', icon: Users },
  { name: 'Fornecedores', path: '/fornecedores', icon: Truck },
  { name: 'Tarefas', path: '/tarefas', icon: CheckSquare },
];

export const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [isSidebarOpen, setIsSidebarOpen] = React.useState(true);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="flex h-screen bg-gray-50 font-sans print:bg-white print:h-auto print:overflow-visible">
      {/* Sidebar */}
      <aside 
        className={cn(
          "bg-white border-r border-gray-200 transition-all duration-300 flex flex-col print:hidden",
          isSidebarOpen ? "w-64" : "w-20"
        )}
      >
        <div className="p-6 flex items-center justify-between">
          {isSidebarOpen && <h1 className="text-xl font-bold text-indigo-600">Gestão Pro</h1>}
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-1 rounded-lg hover:bg-gray-100 text-gray-500"
          >
            {isSidebarOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        <nav className="flex-1 px-4 space-y-2">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex items-center p-3 rounded-xl transition-colors",
                location.pathname === item.path 
                  ? "bg-indigo-50 text-indigo-600" 
                  : "text-gray-600 hover:bg-gray-100"
              )}
            >
              <item.icon size={20} />
              {isSidebarOpen && <span className="ml-3 font-medium">{item.name}</span>}
            </Link>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-100">
          <div className="flex items-center p-2">
            <img 
              src={profile?.photoURL || 'https://picsum.photos/seed/user/40/40'} 
              alt="User" 
              className="w-10 h-10 rounded-full border border-gray-200"
              referrerPolicy="no-referrer"
            />
            {isSidebarOpen && (
              <div className="ml-3 overflow-hidden">
                <p className="text-sm font-semibold text-gray-900 truncate">{profile?.displayName}</p>
                <p className="text-xs text-gray-500 truncate">{profile?.email}</p>
              </div>
            )}
          </div>
          <button 
            onClick={handleLogout}
            className={cn(
              "mt-4 flex items-center w-full p-3 text-red-600 hover:bg-red-50 rounded-xl transition-colors",
              !isSidebarOpen && "justify-center"
            )}
          >
            <LogOut size={20} />
            {isSidebarOpen && <span className="ml-3 font-medium">Sair</span>}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto p-8 print:p-0 print:overflow-visible">
        {children}
      </main>
    </div>
  );
};
