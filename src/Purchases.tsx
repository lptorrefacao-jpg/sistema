import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, addDoc, serverTimestamp, query, orderBy, doc, updateDoc, increment, writeBatch, getDocs, where, deleteDoc } from 'firebase/firestore';
import { ShoppingBag, Plus, Search, X, Check, ArrowRight, Truck, Edit2, Trash2 } from 'lucide-react';
import { db } from './firebase';
import { Purchase, Product, PurchaseItem, Batch, Supplier } from './types';
import { formatCurrency, formatDate, cn } from './lib/utils';
import { motion, AnimatePresence } from 'motion/react';

export const Purchases: React.FC = () => {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [cart, setCart] = useState<PurchaseItem[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'credit'>('cash');
  const [editingPurchaseId, setEditingPurchaseId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // New states for item selection
  const [selectedProductId, setSelectedProductId] = useState('');
  const [inputQuantity, setInputQuantity] = useState(1);
  const [inputCostPrice, setInputCostPrice] = useState(0);

  useEffect(() => {
    const unsubPurchases = onSnapshot(query(collection(db, 'purchases'), orderBy('date', 'desc')), (snap) => {
      setPurchases(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Purchase)));
    });
    const unsubProducts = onSnapshot(collection(db, 'inventory'), (snap) => {
      setProducts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product)));
    });
    const unsubSuppliers = onSnapshot(collection(db, 'suppliers'), (snap) => {
      setSuppliers(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Supplier)));
    });

    return () => {
      unsubPurchases();
      unsubProducts();
      unsubSuppliers();
    };
  }, []);

  const addToCart = () => {
    if (!selectedProductId) return;
    const product = products.find(p => p.id === selectedProductId);
    if (!product) return;

    const existing = cart.find(item => item.productId === product.id);
    if (existing) {
      setCart(cart.map(item => 
        item.productId === product.id ? { ...item, quantity: item.quantity + inputQuantity, costPrice: inputCostPrice } : item
      ));
    } else {
      setCart([...cart, { productId: product.id, name: product.name, quantity: inputQuantity, costPrice: inputCostPrice }]);
    }

    // Reset selection
    setSelectedProductId('');
    setInputQuantity(1);
    setInputCostPrice(0);
  };

  const handleProductSelect = (productId: string) => {
    setSelectedProductId(productId);
    const product = products.find(p => p.id === productId);
    if (product) {
      const lastCost = getLastCost(productId) || (product.price * 0.7);
      setInputCostPrice(lastCost);
    }
  };

  const getLastCost = (productId: string) => {
    for (const p of purchases) {
      const item = p.items.find(i => i.productId === productId);
      if (item) return item.costPrice;
    }
    return null;
  };

  const updateCartItem = (productId: string, field: keyof PurchaseItem, value: any) => {
    setCart(cart.map(item => 
      item.productId === productId ? { ...item, [field]: value } : item
    ));
  };

  const removeFromCart = (productId: string) => {
    setCart(cart.filter(item => item.productId !== productId));
  };

  const total = cart.reduce((acc, item) => acc + (item.costPrice * item.quantity), 0);

  const handleCheckout = async () => {
    if (cart.length === 0 || isSaving) return;
    
    setIsSaving(true);
    try {
      const batch = writeBatch(db);
      const productQuantityChanges: Record<string, number> = {};
      
      // 1. If editing, we first need to "revert" the old purchase's impact on stock
      if (editingPurchaseId) {
        const oldPurchase = purchases.find(p => p.id === editingPurchaseId);
        if (oldPurchase) {
          for (const item of oldPurchase.items) {
            // Find the batch created by this purchase for this product
            const batchesSnap = await getDocs(query(
              collection(db, `inventory/${item.productId}/batches`),
              where('purchaseId', '==', editingPurchaseId)
            ));
            
            for (const bDoc of batchesSnap.docs) {
              const bData = bDoc.data() as Batch;
              // Track quantity to be removed
              productQuantityChanges[item.productId] = (productQuantityChanges[item.productId] || 0) - bData.quantity;
              // Delete the old batch
              batch.delete(bDoc.ref);
            }
          }
        }
      }

      const supplierObj = suppliers.find(s => s.id === selectedSupplierId);
      const purchaseData = {
        date: serverTimestamp(),
        items: cart,
        total,
        supplierId: selectedSupplierId || null,
        supplier: supplierObj?.name || 'Fornecedor Geral',
        paymentMethod
      };

      // 2. Create/Update Purchase record
      const purchaseRef = editingPurchaseId 
        ? doc(db, 'purchases', editingPurchaseId)
        : doc(collection(db, 'purchases'));
      
      batch.set(purchaseRef, purchaseData);

      // 3. Update Supplier balance if credit
      if (paymentMethod === 'credit' && selectedSupplierId) {
        const supplierRef = doc(db, 'suppliers', selectedSupplierId);
        batch.update(supplierRef, {
          balance: increment(-total) // Buying on credit decreases balance (more debt)
        });
      }

      // 4. Create transaction
      const transRef = doc(collection(db, 'transactions'));
      batch.set(transRef, {
        date: serverTimestamp(),
        type: 'expense',
        category: 'Compra',
        description: `Compra #${purchaseRef.id.slice(-6)} - ${supplierObj?.name || 'Fornecedor Geral'}`,
        amount: total,
        relatedId: purchaseRef.id,
        relatedType: 'purchase',
        supplierId: selectedSupplierId || null,
        paymentMethod
      });

      // 5. Update Products and create Batches
      for (const item of cart) {
        // Track quantity to be added
        productQuantityChanges[item.productId] = (productQuantityChanges[item.productId] || 0) + item.quantity;

        // Create new batch for FIFO
        const batchRef = doc(collection(db, `inventory/${item.productId}/batches`));
        batch.set(batchRef, {
          purchaseId: purchaseRef.id,
          quantity: item.quantity,
          initialQuantity: item.quantity,
          costPrice: item.costPrice,
          createdAt: serverTimestamp()
        });
      }

      // 4. Apply consolidated product quantity updates
      for (const [productId, change] of Object.entries(productQuantityChanges)) {
        if (change !== 0) {
          const productRef = doc(db, 'inventory', productId);
          batch.update(productRef, {
            quantity: increment(change),
            updatedAt: serverTimestamp()
          });
        }
      }

      await batch.commit();
      alert("Lançamento concluído com sucesso!");
      setCart([]);
      setSelectedSupplierId('');
      setEditingPurchaseId(null);
      setIsModalOpen(false);
    } catch (error) {
      console.error("Error saving purchase:", error);
      alert("Erro ao salvar a compra. Por favor, tente novamente.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = (purchase: Purchase) => {
    setEditingPurchaseId(purchase.id);
    setSelectedSupplierId(purchase.supplierId || '');
    setPaymentMethod(purchase.paymentMethod || 'cash');
    setCart(purchase.items);
    setIsModalOpen(true);
  };

  const handleDelete = async (purchase: Purchase) => {
    if (!window.confirm('Tem certeza que deseja excluir esta compra? O estoque será revertido.')) return;

    try {
      const batch = writeBatch(db);
      const productQuantityChanges: Record<string, number> = {};
      
      for (const item of purchase.items) {
        const batchesSnap = await getDocs(query(
          collection(db, `inventory/${item.productId}/batches`),
          where('purchaseId', '==', purchase.id)
        ));
        
        for (const bDoc of batchesSnap.docs) {
          const bData = bDoc.data() as Batch;
          // Track quantity to be removed
          productQuantityChanges[item.productId] = (productQuantityChanges[item.productId] || 0) - bData.quantity;
          // Delete the batch
          batch.delete(bDoc.ref);
        }
      }

      // Apply consolidated product quantity updates
      for (const [productId, change] of Object.entries(productQuantityChanges)) {
        if (change !== 0) {
          const productRef = doc(db, 'inventory', productId);
          batch.update(productRef, {
            quantity: increment(change),
            updatedAt: serverTimestamp()
          });
        }
      }

      // Revert supplier balance if credit
      if (purchase.paymentMethod === 'credit' && purchase.supplierId) {
        const supplierRef = doc(db, 'suppliers', purchase.supplierId);
        batch.update(supplierRef, {
          balance: increment(purchase.total) // Reverting a credit purchase increases balance (less debt)
        });
      }

      // Delete associated transaction
      const transSnap = await getDocs(query(
        collection(db, 'transactions'),
        where('relatedId', '==', purchase.id),
        where('relatedType', '==', 'purchase')
      ));
      transSnap.docs.forEach(tDoc => batch.delete(tDoc.ref));

      batch.delete(doc(db, 'purchases', purchase.id));
      await batch.commit();
    } catch (error) {
      console.error("Error deleting purchase:", error);
      alert("Erro ao excluir a compra.");
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Compras</h2>
          <p className="text-gray-500">Entrada de mercadorias e gestão de fornecedores.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors shadow-sm"
        >
          <Plus size={20} className="mr-2" />
          Nova Compra
        </button>
      </header>

      {/* Purchase History */}
      <div className="grid grid-cols-1 gap-4">
        {purchases.map((purchase) => (
          <motion.div 
            key={purchase.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4"
          >
            <div className="flex items-center">
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl mr-4">
                <Truck size={24} />
              </div>
              <div>
                <p className="font-bold text-gray-900">{purchase.supplier}</p>
                <div className="flex items-center gap-2">
                  <p className="text-sm text-gray-500">{formatDate(purchase.date)}</p>
                  <span className={cn(
                    "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider",
                    purchase.paymentMethod === 'credit' ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600"
                  )}>
                    {purchase.paymentMethod === 'credit' ? 'A Prazo' : 'À Vista'}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-8">
              <div className="text-right">
                <p className="text-xs text-gray-400 uppercase font-bold tracking-wider">Itens</p>
                <p className="font-medium text-gray-700">{purchase.items.length} produtos</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-400 uppercase font-bold tracking-wider">Total</p>
                <p className="text-xl font-bold text-indigo-600">{formatCurrency(purchase.total)}</p>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => handleEdit(purchase)}
                  className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                >
                  <Edit2 size={18} />
                </button>
                <button 
                  onClick={() => handleDelete(purchase)}
                  className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* New Purchase Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="bg-white w-full max-w-5xl h-[80vh] rounded-3xl shadow-2xl overflow-hidden flex flex-col"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-xl font-bold text-gray-900">
                  {editingPurchaseId ? 'Editar Compra' : 'Registrar Compra'}
                </h3>
                <button 
                  onClick={() => {
                    setIsModalOpen(false);
                    setEditingPurchaseId(null);
                    setCart([]);
                    setSelectedSupplierId('');
                  }} 
                  className="p-2 hover:bg-gray-100 rounded-full text-gray-400"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Entry Form */}
                <div className="p-6 border-b border-gray-100 bg-gray-50/50">
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                    <div className="md:col-span-1">
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Fornecedor</label>
                      <select 
                        className="w-full p-3 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/20"
                        value={selectedSupplierId}
                        onChange={(e) => setSelectedSupplierId(e.target.value)}
                      >
                        <option value="">Selecionar fornecedor...</option>
                        {suppliers.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="md:col-span-1">
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Forma de Pagamento</label>
                      <div className="flex bg-white border border-gray-200 rounded-xl p-1">
                        <button 
                          onClick={() => setPaymentMethod('cash')}
                          className={cn(
                            "flex-1 py-2 text-xs font-bold rounded-lg transition-all",
                            paymentMethod === 'cash' ? "bg-indigo-600 text-white shadow-sm" : "text-gray-400 hover:text-gray-600"
                          )}
                        >
                          À Vista
                        </button>
                        <button 
                          onClick={() => setPaymentMethod('credit')}
                          className={cn(
                            "flex-1 py-2 text-xs font-bold rounded-lg transition-all",
                            paymentMethod === 'credit' ? "bg-indigo-600 text-white shadow-sm" : "text-gray-400 hover:text-gray-600"
                          )}
                        >
                          A Prazo
                        </button>
                      </div>
                    </div>
                    <div className="md:col-span-1">
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Produto</label>
                      <select 
                        className="w-full p-3 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/20"
                        value={selectedProductId}
                        onChange={(e) => handleProductSelect(e.target.value)}
                      >
                        <option value="">Selecionar produto...</option>
                        {products.map(p => (
                          <option key={p.id} value={p.id}>{p.name} (Estoque: {p.quantity})</option>
                        ))}
                      </select>
                    </div>
                    <div className="grid grid-cols-2 gap-2 md:col-span-1">
                      <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Qtd</label>
                        <input 
                          type="number"
                          className="w-full p-3 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/20"
                          value={inputQuantity}
                          onChange={(e) => setInputQuantity(parseInt(e.target.value) || 0)}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Custo Un.</label>
                        <input 
                          type="number"
                          step="0.01"
                          className="w-full p-3 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/20 font-bold text-indigo-600"
                          value={inputCostPrice}
                          onChange={(e) => setInputCostPrice(parseFloat(e.target.value) || 0)}
                        />
                      </div>
                    </div>
                    <button 
                      onClick={addToCart}
                      disabled={!selectedProductId}
                      className="h-[52px] px-6 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center justify-center"
                    >
                      <Plus size={20} className="mr-2" />
                      Adicionar
                    </button>
                  </div>
                </div>

                <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
                  {/* Cart Items Table */}
                  <div className="flex-1 p-4 lg:p-6 overflow-auto min-h-0">
                    <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">Itens da Compra</h4>
                    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden overflow-x-auto">
                      <table className="w-full text-left border-collapse min-w-[600px]">
                        <thead className="bg-gray-50 border-b border-gray-100">
                          <tr>
                            <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Produto</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-center">Quantidade</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-right">Custo Un.</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-right">Subtotal</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-center">Ações</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {cart.map(item => (
                            <tr key={item.productId} className="hover:bg-gray-50/50 transition-colors">
                              <td className="px-6 py-4 font-bold text-gray-900">{item.name}</td>
                              <td className="px-6 py-4 text-center">
                                <div className="flex items-center justify-center gap-2">
                                  <input 
                                    type="number"
                                    className="w-20 p-1 border border-gray-100 rounded text-center"
                                    value={item.quantity}
                                    onChange={(e) => updateCartItem(item.productId, 'quantity', parseInt(e.target.value) || 0)}
                                  />
                                </div>
                              </td>
                              <td className="px-6 py-4 text-right">
                                <input 
                                  type="number"
                                  step="0.01"
                                  className="w-28 p-1 border border-gray-100 rounded text-right font-bold text-indigo-600"
                                  value={item.costPrice}
                                  onChange={(e) => updateCartItem(item.productId, 'costPrice', parseFloat(e.target.value) || 0)}
                                />
                              </td>
                              <td className="px-6 py-4 text-right font-bold text-gray-900">
                                {formatCurrency(item.quantity * item.costPrice)}
                              </td>
                              <td className="px-6 py-4 text-center">
                                <button onClick={() => removeFromCart(item.productId)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg">
                                  <Trash2 size={18} />
                                </button>
                              </td>
                            </tr>
                          ))}
                          {cart.length === 0 && (
                            <tr>
                              <td colSpan={5} className="px-6 py-12 text-center text-gray-400">
                                Nenhum item adicionado à compra
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Summary Sidebar */}
                  <div className="w-full lg:w-80 p-6 bg-gray-50 border-t lg:border-t-0 lg:border-l border-gray-100 flex flex-col shrink-0 overflow-auto">
                    <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-6">Resumo Financeiro</h4>
                    <div className="space-y-4">
                      <div className="flex justify-between text-gray-500">
                        <span>Subtotal</span>
                        <span>{formatCurrency(total)}</span>
                      </div>
                      <div className="flex justify-between text-gray-500">
                        <span>Itens Totais</span>
                        <span>{cart.reduce((acc, i) => acc + i.quantity, 0)}</span>
                      </div>
                      <div className="pt-4 border-t border-gray-200">
                        <div className="flex justify-between text-xl font-bold text-gray-900">
                          <span>Total</span>
                          <span className="text-indigo-600">{formatCurrency(total)}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Fixed Footer Actions */}
                <div className="p-6 border-t border-gray-100 bg-white flex flex-col sm:flex-row gap-3 items-center justify-end">
                  {editingPurchaseId && (
                    <button 
                      onClick={() => {
                        setIsModalOpen(false);
                        setEditingPurchaseId(null);
                        setCart([]);
                        setSelectedSupplierId('');
                      }}
                      className="w-full sm:w-auto px-6 py-4 text-gray-500 hover:text-gray-700 font-medium transition-colors"
                    >
                      Cancelar Edição
                    </button>
                  )}
                  <button 
                    onClick={handleCheckout}
                    disabled={cart.length === 0 || isSaving}
                    className="w-full sm:w-auto px-12 py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center shadow-lg shadow-indigo-200"
                  >
                    {isSaving ? (
                      <span className="flex items-center">
                        <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Salvando...
                      </span>
                    ) : (
                      <>
                        {editingPurchaseId ? 'Salvar Alterações' : 'Finalizar Compra'}
                        <ArrowRight size={20} className="ml-2" />
                      </>
                    )}
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
