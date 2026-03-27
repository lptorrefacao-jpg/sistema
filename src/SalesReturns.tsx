import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, addDoc, serverTimestamp, query, orderBy, writeBatch, doc, increment } from 'firebase/firestore';
import { RotateCcw, Search, X, Check, ArrowRight, Trash2, Calendar, User, Package } from 'lucide-react';
import { db } from './firebase';
import { Sale, SaleReturn, SaleReturnItem, Product, Client } from './types';
import { formatCurrency, formatDate, cn } from './lib/utils';
import { motion, AnimatePresence } from 'motion/react';

export const SalesReturns: React.FC = () => {
  const [sales, setSales] = useState<Sale[]>([]);
  const [returns, setReturns] = useState<SaleReturn[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedSale, setSelectedSale] = useState<Sale | null>(null);
  const [returnItems, setReturnItems] = useState<SaleReturnItem[]>([]);
  const [reason, setReason] = useState('');
  const [refundMethod, setRefundMethod] = useState<'cash' | 'credit'>('credit');
  const [isSaving, setIsSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    const unsubSales = onSnapshot(query(collection(db, 'sales'), orderBy('date', 'desc')), (snap) => {
      setSales(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Sale)));
    });
    const unsubReturns = onSnapshot(query(collection(db, 'sales_returns'), orderBy('date', 'desc')), (snap) => {
      setReturns(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as SaleReturn)));
    });
    const unsubClients = onSnapshot(collection(db, 'clients'), (snap) => {
      setClients(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Client)));
    });

    return () => {
      unsubSales();
      unsubReturns();
      unsubClients();
    };
  }, []);

  const openReturnModal = (sale: Sale) => {
    setSelectedSale(sale);
    // Initialize return items with 0 quantity
    setReturnItems(sale.items.map(item => ({
      productId: item.productId,
      name: item.name,
      quantity: 0,
      price: item.price,
      costPrice: item.costPrice
    })));
    setReason('');
    setRefundMethod(sale.clientId ? 'credit' : 'cash');
    setIsModalOpen(true);
  };

  const updateReturnQuantity = (productId: string, qty: number, maxQty: number) => {
    const safeQty = Math.max(0, Math.min(qty, maxQty));
    setReturnItems(prev => prev.map(item => 
      item.productId === productId ? { ...item, quantity: safeQty } : item
    ));
  };

  const handleProcessReturn = async () => {
    const itemsToReturn = returnItems.filter(item => item.quantity > 0);
    if (itemsToReturn.length === 0 || !selectedSale || isSaving) return;

    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      const returnRef = doc(collection(db, 'sales_returns'));
      
      let totalReturnAmount = 0;
      let totalReturnCost = 0;

      for (const item of itemsToReturn) {
        totalReturnAmount += item.quantity * item.price;
        totalReturnCost += item.quantity * item.costPrice;

        // 1. Restore stock in batches (PEPS/FIFO)
        // We create a new batch with the original cost price
        const batchRef = doc(collection(db, `inventory/${item.productId}/batches`));
        batch.set(batchRef, {
          purchaseId: `return_${returnRef.id}`,
          quantity: item.quantity,
          initialQuantity: item.quantity,
          costPrice: item.costPrice,
          createdAt: serverTimestamp() // Put it at the end of the queue (newest)
        });

        // 2. Update product total quantity
        const productRef = doc(db, 'inventory', item.productId);
        batch.update(productRef, {
          quantity: increment(item.quantity),
          updatedAt: serverTimestamp()
        });
      }

      const returnData: any = {
        saleId: selectedSale.id,
        date: serverTimestamp(),
        items: itemsToReturn,
        total: totalReturnAmount,
        totalCost: totalReturnCost,
        clientId: selectedSale.clientId || null,
        clientName: selectedSale.clientName || 'Venda Avulsa',
        reason: reason || 'Não informada',
        refundMethod
      };

      batch.set(returnRef, returnData);

      // 3. Update client balance if refund is 'credit'
      if (selectedSale.clientId && refundMethod === 'credit') {
        const clientRef = doc(db, 'clients', selectedSale.clientId);
        batch.update(clientRef, {
          balance: increment(totalReturnAmount)
        });
      }

      await batch.commit();
      alert("Lançamento concluído com sucesso!");

      setIsModalOpen(false);
      setSelectedSale(null);
      setReturnItems([]);
      setReason('');
    } catch (error) {
      console.error("Error processing return:", error);
      alert("Erro ao processar devolução.");
    } finally {
      setIsSaving(false);
    }
  };

  const filteredSales = sales.filter(s => 
    s.clientName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Devoluções</h2>
          <p className="text-gray-500">Gerencie devoluções de vendas e estorno de estoque.</p>
        </div>
        <div className="p-3 bg-orange-50 text-orange-600 rounded-2xl">
          <RotateCcw size={24} />
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sales List to Select From */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex items-center gap-3">
            <Search className="text-gray-400" size={20} />
            <input 
              type="text"
              placeholder="Buscar venda por cliente ou ID..."
              className="flex-1 outline-none bg-transparent"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider px-2">Vendas Recentes</h3>
            {filteredSales.map(sale => (
              <motion.div 
                key={sale.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white p-5 rounded-2xl shadow-sm border border-gray-100 flex items-center justify-between group hover:border-orange-200 transition-all"
              >
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-gray-50 text-gray-400 group-hover:bg-orange-50 group-hover:text-orange-600 rounded-xl transition-colors">
                    <User size={20} />
                  </div>
                  <div>
                    <p className="font-bold text-gray-900">{sale.clientName}</p>
                    <p className="text-xs text-gray-400">{formatDate(sale.date)} • {sale.items.length} itens</p>
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-right">
                    <p className="text-lg font-bold text-gray-900">{formatCurrency(sale.total)}</p>
                    <p className="text-[10px] text-gray-400 uppercase font-bold">Total Venda</p>
                  </div>
                  <button 
                    onClick={() => openReturnModal(sale)}
                    className="px-4 py-2 bg-orange-600 text-white rounded-xl text-sm font-bold hover:bg-orange-700 transition-colors flex items-center gap-2"
                  >
                    <RotateCcw size={16} />
                    Devolver
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Recent Returns History */}
        <div className="space-y-4">
          <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider px-2">Histórico de Devoluções</h3>
          <div className="space-y-3">
            {returns.map(ret => (
              <motion.div 
                key={ret.id}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100"
              >
                <div className="flex justify-between items-start mb-2">
                  <span className="text-[10px] font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full uppercase">Devolução</span>
                  <span className="text-xs text-gray-400">{formatDate(ret.date)}</span>
                </div>
                <p className="font-bold text-gray-900 text-sm">{ret.clientName}</p>
                <p className="text-xs text-gray-500 mt-1 italic">"{ret.reason}"</p>
                <div className="mt-3 pt-3 border-t border-gray-50 flex justify-between items-center">
                  <span className="text-xs text-gray-400">{ret.items.reduce((acc, i) => acc + i.quantity, 0)} itens devolvidos</span>
                  <span className="font-bold text-gray-900">{formatCurrency(ret.total)}</span>
                </div>
              </motion.div>
            ))}
            {returns.length === 0 && (
              <div className="text-center py-12 bg-gray-50/50 rounded-2xl border border-dashed border-gray-200">
                <RotateCcw size={32} className="mx-auto text-gray-300 mb-2" />
                <p className="text-sm text-gray-400">Nenhuma devolução registrada.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Return Modal */}
      <AnimatePresence>
        {isModalOpen && selectedSale && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-3xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Processar Devolução</h3>
                  <div className="flex items-center gap-2 mt-1">
                    <p className="text-sm text-gray-500">Venda para {selectedSale.clientName} em {formatDate(selectedSale.date)}</p>
                    {selectedSale.clientId && (
                      <span className={cn(
                        "text-[10px] font-bold px-2 py-0.5 rounded-full",
                        (clients.find(c => c.id === selectedSale.clientId)?.balance || 0) < 0 
                          ? "bg-red-50 text-red-600" 
                          : "bg-emerald-50 text-emerald-600"
                      )}>
                        Saldo: {formatCurrency(clients.find(c => c.id === selectedSale.clientId)?.balance || 0)}
                      </span>
                    )}
                  </div>
                </div>
                <button 
                  onClick={() => setIsModalOpen(false)} 
                  className="p-2 hover:bg-gray-100 rounded-full text-gray-400"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-auto p-6 space-y-6">
                <div className="space-y-4">
                  <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Selecione os itens e quantidades</h4>
                  <div className="space-y-3">
                    {selectedSale.items.map((saleItem, idx) => {
                      const returnItem = returnItems.find(ri => ri.productId === saleItem.productId);
                      return (
                        <div key={idx} className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-white rounded-lg text-gray-400">
                              <Package size={18} />
                            </div>
                            <div>
                              <p className="font-bold text-gray-900 text-sm">{saleItem.name}</p>
                              <p className="text-xs text-gray-500">Vendido: {saleItem.quantity} un. • {formatCurrency(saleItem.price)}/un</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="flex items-center bg-white border border-gray-200 rounded-xl p-1">
                              <button 
                                onClick={() => updateReturnQuantity(saleItem.productId, (returnItem?.quantity || 0) - 1, saleItem.quantity)}
                                className="w-8 h-8 flex items-center justify-center hover:bg-gray-50 rounded-lg text-gray-500"
                              >
                                -
                              </button>
                              <input 
                                type="number"
                                className="w-12 text-center font-bold text-gray-900 outline-none bg-transparent"
                                value={returnItem?.quantity || 0}
                                onChange={(e) => updateReturnQuantity(saleItem.productId, parseInt(e.target.value) || 0, saleItem.quantity)}
                              />
                              <button 
                                onClick={() => updateReturnQuantity(saleItem.productId, (returnItem?.quantity || 0) + 1, saleItem.quantity)}
                                className="w-8 h-8 flex items-center justify-center hover:bg-gray-50 rounded-lg text-gray-500"
                              >
                                +
                              </button>
                            </div>
                            <div className="text-right w-24">
                              <p className="font-bold text-orange-600 text-sm">
                                {formatCurrency((returnItem?.quantity || 0) * saleItem.price)}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Motivo da Devolução</label>
                  <textarea 
                    className="w-full p-4 bg-gray-50 border border-gray-200 rounded-2xl outline-none focus:ring-2 focus:ring-orange-500/20 resize-none h-24"
                    placeholder="Ex: Produto com defeito, desistência do cliente..."
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Forma de Estorno</label>
                  <div className="flex bg-gray-100 p-1 rounded-xl w-full max-w-xs">
                    <button 
                      onClick={() => setRefundMethod('credit')}
                      disabled={!selectedSale.clientId}
                      className={cn(
                        "flex-1 py-2 text-xs font-bold rounded-lg transition-all",
                        refundMethod === 'credit' ? "bg-white text-orange-600 shadow-sm" : "text-gray-400",
                        !selectedSale.clientId && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      Crédito/Saldo
                    </button>
                    <button 
                      onClick={() => setRefundMethod('cash')}
                      className={cn(
                        "flex-1 py-2 text-xs font-bold rounded-lg transition-all",
                        refundMethod === 'cash' ? "bg-white text-orange-600 shadow-sm" : "text-gray-400"
                      )}
                    >
                      Dinheiro (Caixa)
                    </button>
                  </div>
                  {!selectedSale.clientId && (
                    <p className="mt-1 text-[10px] text-gray-400 italic">Vendas avulsas só permitem estorno em dinheiro.</p>
                  )}
                </div>
              </div>

              <div className="p-6 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
                <div className="text-right">
                  <p className="text-xs text-gray-400 uppercase font-bold">Total a Estornar</p>
                  <p className="text-2xl font-bold text-orange-600">
                    {formatCurrency(returnItems.reduce((acc, i) => acc + (i.quantity * i.price), 0))}
                  </p>
                </div>
                <div className="flex gap-3">
                  <button 
                    onClick={() => setIsModalOpen(false)}
                    className="px-6 py-3 text-gray-500 font-bold hover:bg-gray-100 rounded-2xl transition-colors"
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={handleProcessReturn}
                    disabled={returnItems.every(i => i.quantity === 0) || isSaving}
                    className="px-8 py-3 bg-orange-600 text-white rounded-2xl font-bold hover:bg-orange-700 transition-colors shadow-lg shadow-orange-200 disabled:opacity-50 flex items-center gap-2"
                  >
                    {isSaving ? 'Processando...' : 'Confirmar Devolução'}
                    {!isSaving && <Check size={20} />}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
