import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, orderBy, limit } from 'firebase/firestore';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell
} from 'recharts';
import { TrendingUp, Package, ShoppingCart, Users, CheckSquare } from 'lucide-react';
import { db } from './firebase';
import { Sale, Product, Client, Task, Transaction, Purchase, SaleReturn } from './types';
import { formatCurrency, cn } from './lib/utils';
import { motion } from 'motion/react';
import { Wallet } from 'lucide-react';

const COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f59e0b'];

export const Dashboard: React.FC = () => {
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [returns, setReturns] = useState<SaleReturn[]>([]);

  useEffect(() => {
    const unsubSales = onSnapshot(query(collection(db, 'sales'), orderBy('date', 'desc')), (snap) => {
      setSales(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Sale)));
    });
    const unsubProducts = onSnapshot(collection(db, 'inventory'), (snap) => {
      setProducts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product)));
    });
    const unsubClients = onSnapshot(collection(db, 'clients'), (snap) => {
      setClients(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client)));
    });
    const unsubTasks = onSnapshot(collection(db, 'tasks'), (snap) => {
      setTasks(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Task)));
    });
    const unsubTrans = onSnapshot(collection(db, 'transactions'), (snap) => {
      setTransactions(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction)));
    });
    const unsubPurchases = onSnapshot(collection(db, 'purchases'), (snap) => {
      setPurchases(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Purchase)));
    });
    const unsubReturns = onSnapshot(collection(db, 'sales_returns'), (snap) => {
      setReturns(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as SaleReturn)));
    });

    return () => {
      unsubSales();
      unsubProducts();
      unsubClients();
      unsubTasks();
      unsubTrans();
      unsubPurchases();
      unsubReturns();
    };
  }, []);

  const totalSales = sales.reduce((acc, sale) => acc + sale.total, 0);
  const lowStock = products.filter(p => p.quantity < 10).length;
  const pendingTasks = tasks.filter(t => t.status !== 'done').length;

  // Calculate Cash Balance
  const manualIncome = transactions.filter(t => t.type === 'income' && !t.relatedId).reduce((acc, t) => acc + t.amount, 0);
  const manualExpense = transactions.filter(t => t.type === 'expense' && !t.relatedId).reduce((acc, t) => acc + t.amount, 0);
  const cashSales = sales.filter(s => s.paymentMethod === 'cash').reduce((acc, s) => acc + s.total, 0);
  const cashPurchases = purchases.filter(p => p.paymentMethod === 'cash').reduce((acc, p) => acc + p.total, 0);
  const cashReturns = returns.filter(r => r.refundMethod === 'cash').reduce((acc, r) => acc + r.total, 0);
  
  const cashBalance = (manualIncome + cashSales) - (manualExpense + cashPurchases + cashReturns);

  const chartData = sales.slice(0, 7).reverse().map(s => ({
    name: s.date?.toDate ? new Date(s.date.toDate()).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '',
    total: s.total
  }));

  const categoryData = products.reduce((acc: any[], p) => {
    const existing = acc.find(a => a.name === p.category);
    if (existing) {
      existing.value += 1;
    } else {
      acc.push({ name: p.category || 'Outros', value: 1 });
    }
    return acc;
  }, []);

  return (
    <div className="space-y-8">
      <header>
        <h2 className="text-3xl font-bold text-gray-900">Dashboard</h2>
        <p className="text-gray-500">Bem-vindo ao seu painel de controle empresarial.</p>
      </header>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Vendas Totais', value: formatCurrency(totalSales), icon: TrendingUp, color: 'bg-indigo-500' },
          { label: 'Saldo em Caixa', value: formatCurrency(cashBalance), icon: Wallet, color: 'bg-emerald-500' },
          { label: 'Clientes Ativos', value: clients.length, icon: Users, color: 'bg-blue-500' },
          { label: 'Tarefas Pendentes', value: pendingTasks, icon: CheckSquare, color: 'bg-amber-500' },
        ].map((stat, i) => (
          <motion.div 
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex items-center"
          >
            <div className={cn("p-3 rounded-xl text-white mr-4", stat.color)}>
              <stat.icon size={24} />
            </div>
            <div>
              <p className="text-sm text-gray-500 font-medium">{stat.label}</p>
              <p className="text-2xl font-bold text-gray-900">{stat.value}</p>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Sales Chart */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100"
        >
          <h3 className="text-lg font-bold text-gray-900 mb-6">Vendas Recentes</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <Tooltip 
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}
                  cursor={{ fill: '#f9fafb' }}
                />
                <Bar dataKey="total" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </motion.div>

        {/* Category Distribution */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100"
        >
          <h3 className="text-lg font-bold text-gray-900 mb-6">Distribuição por Categoria</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categoryData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {categoryData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: '12px', border: 'none' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="flex flex-wrap justify-center gap-4 mt-4">
            {categoryData.map((entry, index) => (
              <div key={entry.name} className="flex items-center">
                <div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
                <span className="text-xs text-gray-600">{entry.name}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      {/* Low Stock Alert */}
      {lowStock > 0 && (
        <div className="bg-amber-50 border border-amber-200 p-4 rounded-xl flex items-center text-amber-800">
          <Package className="mr-3" size={20} />
          <p className="font-medium">Atenção: Você tem {lowStock} produtos com estoque baixo (menos de 10 unidades).</p>
        </div>
      )}
    </div>
  );
};
