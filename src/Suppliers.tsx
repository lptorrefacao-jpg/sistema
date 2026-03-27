import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, writeBatch, serverTimestamp, increment } from 'firebase/firestore';
import { Plus, Search, Edit2, Trash2, X, Save, Phone, Mail, MapPin, Wallet, Filter, Truck } from 'lucide-react';
import { db } from './firebase';
import { Supplier } from './types';
import { formatCurrency, cn } from './lib/utils';
import { motion, AnimatePresence } from 'motion/react';

export const Suppliers: React.FC = () => {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showOnlyCreditors, setShowOnlyCreditors] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [selectedSupplierForPayment, setSelectedSupplierForPayment] = useState<Supplier | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    balance: 0
  });

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'suppliers'), (snap) => {
      setSuppliers(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Supplier)));
    });
    return () => unsub();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingSupplier) {
        await updateDoc(doc(db, 'suppliers', editingSupplier.id), formData);
      } else {
        await addDoc(collection(db, 'suppliers'), { ...formData, balance: 0 });
      }
      setIsModalOpen(false);
      setEditingSupplier(null);
      setFormData({ name: '', email: '', phone: '', address: '', balance: 0 });
    } catch (error) {
      console.error("Error saving supplier:", error);
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Excluir este fornecedor?')) {
      await deleteDoc(doc(db, 'suppliers', id));
    }
  };

  const handlePaySupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSupplierForPayment || paymentAmount <= 0 || isSaving) return;

    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      
      // 1. Create transaction
      const transRef = doc(collection(db, 'transactions'));
      batch.set(transRef, {
        date: serverTimestamp(),
        type: 'expense',
        category: 'Pagamento de Fornecedor',
        description: `Pagamento para ${selectedSupplierForPayment.name}`,
        amount: paymentAmount,
        relatedType: 'manual',
        supplierId: selectedSupplierForPayment.id,
        paymentMethod: 'cash'
      });

      // 2. Update supplier balance
      const supplierRef = doc(db, 'suppliers', selectedSupplierForPayment.id);
      batch.update(supplierRef, {
        balance: increment(paymentAmount) // Paying supplier increases balance (moves it towards zero or positive)
      });

      await batch.commit();
      alert("Pagamento concluído com sucesso!");
      setIsPaymentModalOpen(false);
      setSelectedSupplierForPayment(null);
      setPaymentAmount(0);
    } catch (error) {
      console.error("Error paying supplier:", error);
      alert("Erro ao processar pagamento.");
    } finally {
      setIsSaving(false);
    }
  };

  const filteredSuppliers = suppliers.filter(s => {
    const matchesSearch = s.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                          s.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesDebt = showOnlyCreditors ? (s.balance || 0) < 0 : true;
    return matchesSearch && matchesDebt;
  });

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Fornecedores</h2>
          <p className="text-gray-500">Gerencie seus fornecedores e saldos.</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => setShowOnlyCreditors(!showOnlyCreditors)}
            className={cn(
              "flex items-center px-4 py-2 rounded-xl transition-all shadow-sm border",
              showOnlyCreditors 
                ? "bg-amber-50 text-amber-600 border-amber-200" 
                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
            )}
          >
            <Filter size={20} className="mr-2" />
            {showOnlyCreditors ? "Mostrando Dívidas" : "Todas as Contas"}
          </button>
          <button 
            onClick={() => {
              setEditingSupplier(null);
              setFormData({ name: '', email: '', phone: '', address: '', balance: 0 });
              setIsModalOpen(true);
            }}
            className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors shadow-sm"
          >
            <Plus size={20} className="mr-2" />
            Novo Fornecedor
          </button>
        </div>
      </header>

      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
        <input 
          type="text" 
          placeholder="Buscar fornecedores..." 
          className="w-full pl-12 pr-4 py-3 bg-white border border-gray-200 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-all"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredSuppliers.map((supplier) => (
          <motion.div 
            key={supplier.id}
            layout
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 group hover:border-indigo-500 transition-all"
          >
            <div className="flex justify-between items-start mb-4">
              <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center font-bold text-xl">
                {supplier.name.charAt(0)}
              </div>
              <div className="flex space-x-1">
                {(supplier.balance || 0) < 0 && (
                  <button 
                    onClick={() => {
                      setSelectedSupplierForPayment(supplier);
                      setPaymentAmount(Math.abs(supplier.balance || 0));
                      setIsPaymentModalOpen(true);
                    }}
                    className="flex items-center px-3 py-1.5 bg-amber-50 text-amber-600 hover:bg-amber-100 rounded-xl transition-colors font-bold text-xs"
                    title="Pagar Fornecedor"
                  >
                    <Wallet size={14} className="mr-1.5" />
                    Pagar
                  </button>
                )}
                <div className="flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => {
                      setEditingSupplier(supplier);
                      setFormData({ name: supplier.name, email: supplier.email, phone: supplier.phone, address: supplier.address, balance: supplier.balance || 0 });
                      setIsModalOpen(true);
                    }}
                    className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button 
                    onClick={() => handleDelete(supplier.id)}
                    className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </div>
            <h3 className="text-lg font-bold text-gray-900 mb-2">{supplier.name}</h3>
            <div className="mb-4">
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Saldo</p>
              <p className={cn(
                "text-lg font-bold",
                (supplier.balance || 0) < 0 ? "text-red-600" : (supplier.balance || 0) > 0 ? "text-emerald-600" : "text-gray-400"
              )}>
                {formatCurrency(supplier.balance || 0)}
                <span className="text-[10px] ml-2 font-normal">
                  {(supplier.balance || 0) < 0 ? "(Dívida)" : (supplier.balance || 0) > 0 ? "(Crédito)" : ""}
                </span>
              </p>
            </div>
            <div className="space-y-2 text-sm text-gray-500">
              <div className="flex items-center"><Mail size={14} className="mr-2" /> {supplier.email}</div>
              <div className="flex items-center"><Phone size={14} className="mr-2" /> {supplier.phone}</div>
              <div className="flex items-center"><MapPin size={14} className="mr-2" /> {supplier.address}</div>
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
                <h3 className="text-xl font-bold text-gray-900">{editingSupplier ? 'Editar Fornecedor' : 'Novo Fornecedor'}</h3>
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
                  Salvar Fornecedor
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      {/* Payment Modal */}
      <AnimatePresence>
        {isPaymentModalOpen && selectedSupplierForPayment && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-xl font-bold text-gray-900">Pagar Fornecedor</h3>
                <button onClick={() => setIsPaymentModalOpen(false)} className="p-2 hover:bg-gray-100 rounded-full text-gray-400">
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handlePaySupplier} className="p-6 space-y-4">
                <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100">
                  <p className="text-sm text-amber-800 font-medium">Fornecedor: {selectedSupplierForPayment.name}</p>
                  <p className="text-xl font-black text-amber-900 mt-1">
                    Dívida Atual: {formatCurrency(Math.abs(selectedSupplierForPayment.balance || 0))}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Valor a Pagar</label>
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
                      onClick={() => setPaymentAmount(Math.abs(selectedSupplierForPayment.balance || 0))}
                      className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-md hover:bg-indigo-100"
                    >
                      Total
                    </button>
                    <button 
                      type="button"
                      onClick={() => setPaymentAmount(Math.abs(selectedSupplierForPayment.balance || 0) / 2)}
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
                  {isSaving ? 'Processando...' : 'Confirmar Pagamento'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
