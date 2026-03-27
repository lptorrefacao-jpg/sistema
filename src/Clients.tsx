import React, { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, writeBatch, serverTimestamp, increment } from 'firebase/firestore';
import { Plus, Search, Edit2, Trash2, X, Save, Phone, Mail, MapPin, Wallet, Filter } from 'lucide-react';
import { db } from './firebase';
import { Client } from './types';
import { formatCurrency, cn } from './lib/utils';
import { motion, AnimatePresence } from 'motion/react';

export const Clients: React.FC = () => {
  const location = useLocation();
  const [clients, setClients] = useState<Client[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showOnlyDebtors, setShowOnlyDebtors] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [selectedClientForPayment, setSelectedClientForPayment] = useState<Client | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    balance: 0
  });

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('filter') === 'debts') {
      setShowOnlyDebtors(true);
    }
  }, [location.search]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'clients'), (snap) => {
      setClients(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client)));
    });
    return () => unsub();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingClient) {
        await updateDoc(doc(db, 'clients', editingClient.id), formData);
      } else {
        await addDoc(collection(db, 'clients'), { ...formData, balance: 0 });
      }
      setIsModalOpen(false);
      setEditingClient(null);
      setFormData({ name: '', email: '', phone: '', address: '', balance: 0 });
    } catch (error) {
      console.error("Error saving client:", error);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Excluir este cliente?')) {
      await deleteDoc(doc(db, 'clients', id));
    }
  };

  const handleReceivePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedClientForPayment || paymentAmount <= 0 || isSaving) return;

    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      
      // 1. Create transaction
      const transRef = doc(collection(db, 'transactions'));
      batch.set(transRef, {
        date: serverTimestamp(),
        type: 'income',
        category: 'Recebimento de Dívida',
        description: `Recebimento de ${selectedClientForPayment.name}`,
        amount: paymentAmount,
        relatedType: 'manual',
        clientId: selectedClientForPayment.id,
        paymentMethod: 'cash'
      });

      // 2. Update client balance
      const clientRef = doc(db, 'clients', selectedClientForPayment.id);
      batch.update(clientRef, {
        balance: increment(paymentAmount)
      });

      await batch.commit();
      alert("Recebimento concluído com sucesso!");
      setIsPaymentModalOpen(false);
      setSelectedClientForPayment(null);
      setPaymentAmount(0);
    } catch (error) {
      console.error("Error receiving payment:", error);
      alert("Erro ao processar recebimento.");
    } finally {
      setIsSaving(false);
    }
  };

  const filteredClients = clients.filter(c => {
    const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         c.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesDebt = showOnlyDebtors ? (c.balance || 0) < 0 : true;
    return matchesSearch && matchesDebt;
  });

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Clientes</h2>
          <p className="text-gray-500">Gerencie sua base de contatos.</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => setShowOnlyDebtors(!showOnlyDebtors)}
            className={cn(
              "flex items-center px-4 py-2 rounded-xl transition-all shadow-sm border",
              showOnlyDebtors 
                ? "bg-amber-50 text-amber-600 border-amber-200" 
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            )}
          >
            <Filter size={20} className="mr-2" />
            {showOnlyDebtors ? "Mostrando Dívidas" : "Todas as Contas"}
          </button>
          <button 
            onClick={() => {
              setEditingClient(null);
              setFormData({ name: '', email: '', phone: '', address: '', balance: 0 });
              setIsModalOpen(true);
            }}
            className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors shadow-sm"
          >
            <Plus size={20} className="mr-2" />
            Novo Cliente
          </button>
        </div>
      </header>

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
        <input 
          type="text" 
          placeholder="Buscar clientes..." 
          className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredClients.map((client) => (
          <motion.div 
            key={client.id}
            layout
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 group hover:border-indigo-500 transition-all"
          >
            <div className="flex justify-between items-start mb-4">
              <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center font-bold text-xl">
                {client.name.charAt(0)}
              </div>
              <div className="flex space-x-1">
                {(client.balance || 0) < 0 && (
                  <button 
                    onClick={() => {
                      setSelectedClientForPayment(client);
                      setPaymentAmount(Math.abs(client.balance || 0));
                      setIsPaymentModalOpen(true);
                    }}
                    className="flex items-center px-3 py-1.5 bg-amber-50 text-amber-600 hover:bg-amber-100 rounded-xl transition-colors font-bold text-xs"
                    title="Receber Pagamento"
                  >
                    <Wallet size={14} className="mr-1.5" />
                    Receber
                  </button>
                )}
                <div className="flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => {
                      setEditingClient(client);
                      setFormData({ name: client.name, email: client.email, phone: client.phone, address: client.address, balance: client.balance || 0 });
                      setIsModalOpen(true);
                    }}
                    className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button 
                    onClick={() => handleDelete(client.id)}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">{client.name}</h3>
            <div className="mb-4">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Saldo</p>
              <p className={cn(
                "text-lg font-bold",
                (client.balance || 0) < 0 ? "text-red-600" : (client.balance || 0) > 0 ? "text-emerald-600" : "text-gray-400"
              )}>
                {formatCurrency(client.balance || 0)}
                <span className="text-[10px] ml-2 font-normal">
                  {(client.balance || 0) < 0 ? "(Dívida)" : (client.balance || 0) > 0 ? "(Crédito)" : ""}
                </span>
              </p>
            </div>
            <div className="space-y-2 text-sm text-gray-500">
              <div className="flex items-center"><Mail size={14} className="mr-2" /> {client.email}</div>
              <div className="flex items-center"><Phone size={14} className="mr-2" /> {client.phone}</div>
              <div className="flex items-center"><MapPin size={14} className="mr-2" /> {client.address}</div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Modal */}
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
                <h3 className="text-xl font-bold text-gray-900">{editingClient ? 'Editar Cliente' : 'Novo Cliente'}</h3>
                <button onClick={() => setIsModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full text-gray-400">
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleSave} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
                  <input 
                    type="text" required 
                    className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={formData.name}
                    onChange={(e) => setFormData({...formData, name: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input 
                    type="email" 
                    className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={formData.email}
                    onChange={(e) => setFormData({...formData, email: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Telefone</label>
                  <input 
                    type="text" 
                    className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={formData.phone}
                    onChange={(e) => setFormData({...formData, phone: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Endereço</label>
                  <input 
                    type="text" 
                    className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
                    value={formData.address}
                    onChange={(e) => setFormData({...formData, address: e.target.value})}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Saldo Inicial / Ajuste</label>
                  <input 
                    type="number" step="0.01"
                    className="w-full p-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none font-bold"
                    value={formData.balance}
                    onChange={(e) => setFormData({...formData, balance: parseFloat(e.target.value) || 0})}
                  />
                  <p className="text-[10px] text-gray-400 mt-1">Negativo para dívida, positivo para crédito.</p>
                </div>
                <button 
                  type="submit" 
                  className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors flex items-center justify-center"
                >
                  <Save size={20} className="mr-2" />
                  Salvar Cliente
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Payment Modal */}
      <AnimatePresence>
        {isPaymentModalOpen && selectedClientForPayment && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-xl font-bold text-gray-900">Receber Pagamento</h3>
                <button onClick={() => setIsPaymentModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full text-gray-400">
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleReceivePayment} className="p-6 space-y-4">
                <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100">
                  <p className="text-sm text-amber-800 font-medium">Cliente: {selectedClientForPayment.name}</p>
                  <p className="text-xl font-black text-amber-900 mt-1">
                    Dívida Atual: {formatCurrency(Math.abs(selectedClientForPayment.balance || 0))}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Valor a Receber</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-bold">R$</span>
                    <input 
                      type="number" step="0.01" required 
                      className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-lg"
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <div className="flex gap-2 mt-2">
                    <button 
                      type="button"
                      onClick={() => setPaymentAmount(Math.abs(selectedClientForPayment.balance || 0))}
                      className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-md hover:bg-indigo-100"
                    >
                      Total
                    </button>
                    <button 
                      type="button"
                      onClick={() => setPaymentAmount(Math.abs(selectedClientForPayment.balance || 0) / 2)}
                      className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-md hover:bg-indigo-100"
                    >
                      Metade
                    </button>
                  </div>
                </div>

                <button 
                  type="submit" 
                  disabled={isSaving || paymentAmount <= 0}
                  className="w-full py-4 bg-emerald-600 text-white rounded-2xl font-bold hover:bg-emerald-700 transition-colors flex items-center justify-center shadow-lg shadow-emerald-100 disabled:opacity-50"
                >
                  <Save size={20} className="mr-2" />
                  {isSaving ? 'Processando...' : 'Confirmar Recebimento'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
