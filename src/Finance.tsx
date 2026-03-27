import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, onSnapshot, addDoc, serverTimestamp, query, orderBy, writeBatch, doc, increment } from 'firebase/firestore';
import { Wallet, Plus, Search, X, Check, ArrowUpRight, ArrowDownLeft, Calendar, User, DollarSign, TrendingUp, TrendingDown, ArrowRight, Truck } from 'lucide-react';
import { db } from './firebase';
import { Transaction, Sale, Purchase, SaleReturn, Client, Supplier } from './types';
import { formatCurrency, formatDate, cn } from './lib/utils';
import { motion, AnimatePresence } from 'motion/react';

export const Finance: React.FC = () => {
  const navigate = useNavigate();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [returns, setReturns] = useState<SaleReturn[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    type: 'income' as 'income' | 'expense',
    category: '',
    description: '',
    amount: 0,
    clientId: '',
    supplierId: ''
  });

  useEffect(() => {
    const unsubTrans = onSnapshot(query(collection(db, 'transactions'), orderBy('date', 'desc')), (snap) => {
      setTransactions(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction)));
    });
    const unsubSales = onSnapshot(collection(db, 'sales'), (snap) => {
      setSales(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Sale)));
    });
    const unsubPurchases = onSnapshot(collection(db, 'purchases'), (snap) => {
      setPurchases(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Purchase)));
    });
    const unsubReturns = onSnapshot(collection(db, 'sales_returns'), (snap) => {
      setReturns(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as SaleReturn)));
    });
    const unsubClients = onSnapshot(collection(db, 'clients'), (snap) => {
      setClients(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client)));
    });
    const unsubSuppliers = onSnapshot(collection(db, 'suppliers'), (snap) => {
      setSuppliers(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Supplier)));
    });

    return () => {
      unsubTrans();
      unsubSales();
      unsubPurchases();
      unsubReturns();
      unsubClients();
      unsubSuppliers();
    };
  }, []);

  // Combine all movements for the cash flow list
  const cashFlow = [
    ...transactions.filter(t => !t.relatedId).map(t => ({
      id: t.id,
      date: t.date,
      type: t.type,
      category: t.category,
      description: t.description,
      amount: t.amount,
      source: 'Manual',
      paymentMethod: 'cash'
    })),
    ...sales.map(s => ({
      id: s.id,
      date: s.date,
      type: 'income' as const,
      category: 'Venda',
      description: `Venda #${s.id.slice(-6)} - ${s.clientName}`,
      amount: s.total,
      source: 'Venda',
      paymentMethod: s.paymentMethod || 'cash'
    })),
    ...purchases.map(p => ({
      id: p.id,
      date: p.date,
      type: 'expense' as const,
      category: 'Compra',
      description: `Compra #${p.id.slice(-6)} - ${p.supplier}`,
      amount: p.total,
      source: 'Compra',
      paymentMethod: p.paymentMethod || 'cash'
    })),
    ...returns.map(r => ({
      id: r.id,
      date: r.date,
      type: 'expense' as const,
      category: 'Devolução',
      description: `Devolução #${r.id.slice(-6)} - ${r.clientName}`,
      amount: r.total,
      source: 'Devolução',
      paymentMethod: r.refundMethod || 'cash'
    }))
  ].sort((a, b) => {
    const dateA = a.date?.seconds || (a.date instanceof Date ? a.date.getTime() / 1000 : 9999999999);
    const dateB = b.date?.seconds || (b.date instanceof Date ? b.date.getTime() / 1000 : 9999999999);
    return dateB - dateA;
  });

  // Balance only considers cash movements
  const totalIncome = cashFlow
    .filter(f => f.type === 'income' && f.paymentMethod === 'cash')
    .reduce((acc, f) => acc + f.amount, 0);
  const totalExpense = cashFlow
    .filter(f => f.type === 'expense' && f.paymentMethod === 'cash')
    .reduce((acc, f) => acc + f.amount, 0);
  const balance = totalIncome - totalExpense;

  // Receivables (Client debts)
  const totalReceivable = clients.reduce((acc, c) => acc + (c.balance < 0 ? Math.abs(c.balance) : 0), 0);
  const totalCredit = clients.reduce((acc, c) => acc + (c.balance > 0 ? c.balance : 0), 0);

  const handleSave = async () => {
    if (!formData.category || !formData.amount || isSaving) return;

    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      
      // 1. Create transaction
      const transRef = doc(collection(db, 'transactions'));
      batch.set(transRef, {
        date: serverTimestamp(),
        type: formData.type,
        category: formData.category,
        description: formData.description,
        amount: formData.amount,
        relatedType: formData.clientId ? 'client' : (formData.supplierId ? 'supplier' : 'manual'),
        clientId: formData.clientId || null,
        supplierId: formData.supplierId || null
      });

      // 2. If it's a client payment (Income + Client selected), update client balance
      if (formData.type === 'income' && formData.clientId) {
        const clientRef = doc(db, 'clients', formData.clientId);
        batch.update(clientRef, {
          balance: increment(formData.amount) // Paying debt increases balance (moves it towards zero or positive)
        });
      }

      // 3. If it's a supplier payment (Expense + Supplier selected), update supplier balance
      if (formData.type === 'expense' && formData.supplierId) {
        const supplierRef = doc(db, 'suppliers', formData.supplierId);
        batch.update(supplierRef, {
          balance: increment(formData.amount) // Paying supplier increases balance (moves it towards zero or positive)
        });
      }

      await batch.commit();
      alert("Lançamento concluído com sucesso!");
      setIsModalOpen(false);
      setFormData({ type: 'income', category: '', description: '', amount: 0, clientId: '', supplierId: '' });
    } catch (error) {
      console.error("Error saving transaction:", error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Financeiro</h2>
          <p className="text-gray-500">Controle de fluxo de caixa, receitas e despesas.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors shadow-sm"
        >
          <Plus size={20} className="mr-2" />
          Novo Lançamento
        </button>
      </header>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl">
              <TrendingUp size={24} />
            </div>
            <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full uppercase tracking-wider">Receitas</span>
          </div>
          <p className="text-sm text-gray-500 mb-1">Total Recebido</p>
          <h3 className="text-2xl font-black text-gray-900">{formatCurrency(totalIncome)}</h3>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-red-50 text-red-600 rounded-2xl">
              <TrendingDown size={24} />
            </div>
            <span className="text-[10px] font-bold text-red-600 bg-red-50 px-2 py-1 rounded-full uppercase tracking-wider">Despesas</span>
          </div>
          <p className="text-sm text-gray-500 mb-1">Total Pago</p>
          <h3 className="text-2xl font-black text-gray-900">{formatCurrency(totalExpense)}</h3>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-indigo-600 p-6 rounded-3xl shadow-lg shadow-indigo-200 text-white"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-white/20 text-white rounded-2xl">
              <Wallet size={24} />
            </div>
            <span className="text-[10px] font-bold text-white bg-white/20 px-2 py-1 rounded-full uppercase tracking-wider">Saldo Atual</span>
          </div>
          <p className="text-white/70 text-sm mb-1">Disponível em Caixa</p>
          <h3 className="text-2xl font-black">{formatCurrency(balance)}</h3>
        </motion.div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          onClick={() => navigate('/clientes?filter=debts')}
          className="bg-amber-50 p-6 rounded-3xl shadow-sm border border-amber-100 cursor-pointer hover:border-amber-300 transition-all group"
        >
          <div className="flex items-center justify-between mb-4">
            <div className="p-3 bg-amber-100 text-amber-600 rounded-2xl">
              <User size={24} />
            </div>
            <div className="flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-100 px-2 py-1 rounded-full uppercase tracking-wider">
              A Receber
              <ArrowRight size={10} className="group-hover:translate-x-0.5 transition-transform" />
            </div>
          </div>
          <p className="text-gray-500 text-sm mb-1">Dívidas de Clientes</p>
          <h3 className="text-2xl font-black text-amber-700">{formatCurrency(totalReceivable)}</h3>
        </motion.div>
      </div>

      {/* Cash Flow Table */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900">Fluxo de Caixa</h3>
          <div className="flex gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
              <input 
                type="text"
                placeholder="Filtrar lançamentos..."
                className="pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
              />
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Data</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Categoria</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Descrição</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Pagamento</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Origem</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-right">Valor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {cashFlow.map((item) => (
                <tr key={item.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-6 py-4 text-sm text-gray-500">{formatDate(item.date)}</td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider",
                      item.type === 'income' ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
                    )}>
                      {item.category}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm font-medium text-gray-900">{item.description}</p>
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider",
                      item.paymentMethod === 'credit' ? "bg-amber-50 text-amber-600 border border-amber-100" : "bg-emerald-50 text-emerald-600 border border-emerald-100"
                    )}>
                      {item.paymentMethod === 'credit' ? 'A Prazo' : 'À Vista'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="text-xs text-gray-400 font-medium">{item.source}</span>
                  </td>
                  <td className={cn(
                    "px-6 py-4 text-right font-bold",
                    item.type === 'income' ? "text-emerald-600" : "text-red-600"
                  )}>
                    {item.type === 'income' ? '+' : '-'} {formatCurrency(item.amount)}
                  </td>
                </tr>
              ))}
              {cashFlow.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-400">
                    Nenhum lançamento financeiro registrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Transaction Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-xl font-bold text-gray-900">Novo Lançamento</h3>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full text-gray-400">
                  <X size={20} />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="flex bg-gray-100 p-1 rounded-xl">
                  <button 
                    onClick={() => setFormData({ ...formData, type: 'income' })}
                    className={cn(
                      "flex-1 py-2 text-sm font-bold rounded-lg transition-all",
                      formData.type === 'income' ? "bg-white text-emerald-600 shadow-sm" : "text-gray-400"
                    )}
                  >
                    Receita
                  </button>
                  <button 
                    onClick={() => setFormData({ ...formData, type: 'expense' })}
                    className={cn(
                      "flex-1 py-2 text-sm font-bold rounded-lg transition-all",
                      formData.type === 'expense' ? "bg-white text-red-600 shadow-sm" : "text-gray-400"
                    )}
                  >
                    Despesa
                  </button>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Categoria</label>
                  <input 
                    type="text"
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/20"
                    placeholder="Ex: Aluguel, Salário, Pagamento Cliente..."
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  />
                </div>

                {formData.type === 'income' && (
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Vincular Cliente (Opcional)</label>
                    <select 
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/20"
                      value={formData.clientId}
                      onChange={(e) => setFormData({ ...formData, clientId: e.target.value, supplierId: '' })}
                    >
                      <option value="">Nenhum</option>
                      {clients.map(c => (
                        <option key={c.id} value={c.id}>{c.name} (Saldo: {formatCurrency(c.balance)})</option>
                      ))}
                    </select>
                    <p className="mt-1 text-[10px] text-gray-400 italic">Se selecionado, o valor abaterá a dívida do cliente.</p>
                  </div>
                )}

                {formData.type === 'expense' && (
                  <div>
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Vincular Fornecedor (Opcional)</label>
                    <select 
                      className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/20"
                      value={formData.supplierId}
                      onChange={(e) => setFormData({ ...formData, supplierId: e.target.value, clientId: '' })}
                    >
                      <option value="">Nenhum</option>
                      {suppliers.map(s => (
                        <option key={s.id} value={s.id}>{s.name} (Saldo: {formatCurrency(s.balance)})</option>
                      ))}
                    </select>
                    <p className="mt-1 text-[10px] text-gray-400 italic">Se selecionado, o valor abaterá a dívida com o fornecedor.</p>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Descrição</label>
                  <textarea 
                    className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/20 resize-none"
                    rows={2}
                    placeholder="Detalhes adicionais..."
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Valor</label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
                    <input 
                      type="number"
                      step="0.01"
                      className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/20 font-bold text-lg"
                      placeholder="0,00"
                      value={formData.amount || ''}
                      onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                </div>

                <button 
                  onClick={handleSave}
                  disabled={isSaving || !formData.category || !formData.amount}
                  className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-100 disabled:opacity-50"
                >
                  {isSaving ? 'Salvando...' : 'Confirmar Lançamento'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
