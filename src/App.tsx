import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import { Layout } from './Layout';
import { Dashboard } from './Dashboard';
import { Inventory } from './Inventory';
import { InventoryHistory } from './InventoryHistory';
import { Sales } from './Sales';
import { SalesReturns } from './SalesReturns';
import { Purchases } from './Purchases';
import { ProfitReport } from './ProfitReport';
import { Clients } from './Clients';
import { Suppliers } from './Suppliers';
import { Finance } from './Finance';
import { Tasks } from './Tasks';
import { Login } from './Login';

const PrivateRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();
  
  if (loading) return (
    <div className="h-screen flex items-center justify-center bg-gray-50">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-600"></div>
    </div>
  );
  
  if (!user) return <Navigate to="/login" />;
  
  return <Layout>{children}</Layout>;
};

export default function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<PrivateRoute><Dashboard /></PrivateRoute>} />
          <Route path="/estoque" element={<PrivateRoute><Inventory /></PrivateRoute>} />
          <Route path="/estoque/historico" element={<PrivateRoute><InventoryHistory /></PrivateRoute>} />
          <Route path="/vendas" element={<PrivateRoute><Sales /></PrivateRoute>} />
          <Route path="/vendas/devolucoes" element={<PrivateRoute><SalesReturns /></PrivateRoute>} />
          <Route path="/compras" element={<PrivateRoute><Purchases /></PrivateRoute>} />
          <Route path="/lucro" element={<PrivateRoute><ProfitReport /></PrivateRoute>} />
          <Route path="/clientes" element={<PrivateRoute><Clients /></PrivateRoute>} />
          <Route path="/fornecedores" element={<PrivateRoute><Suppliers /></PrivateRoute>} />
          <Route path="/financeiro" element={<PrivateRoute><Finance /></PrivateRoute>} />
          <Route path="/tarefas" element={<PrivateRoute><Tasks /></PrivateRoute>} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}
