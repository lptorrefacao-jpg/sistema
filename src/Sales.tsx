import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, addDoc, serverTimestamp, query, orderBy, writeBatch, doc, getDocs, increment } from 'firebase/firestore';
import { ShoppingCart, Plus, Search, X, Check, ArrowRight, Trash2, Edit2, RotateCcw, Printer } from 'lucide-react';
import { db } from './firebase';
import { Sale, Product, Client, SaleItem, Batch, Transaction } from './types';
import { formatCurrency, formatDate, cn } from './lib/utils';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';

export const Sales: React.FC = () => {
  const navigate = useNavigate();
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [cart, setCart] = useState<SaleItem[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'credit'>('cash');
  const [editingSaleId, setEditingSaleId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [printingSale, setPrintingSale] = useState<Sale | null>(null);
  const [showSuccessModal, setShowSuccessModal] = useState<{ isOpen: boolean; sale: Sale | null }>({ isOpen: false, sale: null });

  const handlePrint = (sale: Sale) => {
    setPrintingSale(sale);
    setTimeout(() => {
      window.focus();
      window.print();
      // Keep it for a bit so the print dialog can capture it
      setTimeout(() => setPrintingSale(null), 500);
    }, 100);
  };

  // Filter states
  const [searchHistory, setSearchHistory] = useState('');
  const [minValue, setMinValue] = useState('');
  const [maxValue, setMaxValue] = useState('');
  const [minQty, setMinQty] = useState('');
  const [maxQty, setMaxQty] = useState('');

  // New states for item selection
  const [selectedProductId, setSelectedProductId] = useState('');
  const [inputQuantity, setInputQuantity] = useState(1);
  const [inputPrice, setInputPrice] = useState(0);

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

    return () => {
      unsubSales();
      unsubProducts();
      unsubClients();
    };
  }, []);

  const addToCart = () => {
    if (!selectedProductId) return;
    const product = products.find(p => p.id === selectedProductId);
    if (!product) return;

    const existing = cart.find(item => item.productId === product.id);
    if (existing) {
      setCart(cart.map(item => 
        item.productId === product.id ? { ...item, quantity: item.quantity + inputQuantity, price: inputPrice } : item
      ));
    } else {
      setCart([...cart, { productId: product.id, name: product.name, quantity: inputQuantity, price: inputPrice, costPrice: 0 }]);
    }

    // Reset selection
    setSelectedProductId('');
    setInputQuantity(1);
    setInputPrice(0);
  };

  const handleProductSelect = (productId: string) => {
    setSelectedProductId(productId);
    const product = products.find(p => p.id === productId);
    if (product) {
      setInputPrice(product.price);
    }
  };

  const updateCartItem = (productId: string, field: keyof SaleItem, value: any) => {
    setCart(cart.map(item => 
      item.productId === productId ? { ...item, [field]: value } : item
    ));
  };

  const removeFromCart = (productId: string) => {
    setCart(cart.filter(item => item.productId !== productId));
  };

  const total = cart.reduce((acc, item) => acc + (item.price * item.quantity), 0);

  const handleCheckout = async () => {
    if (cart.length === 0 || isSaving) return;

    if (paymentMethod === 'credit' && !selectedClient) {
      alert("Para vendas a prazo, é necessário selecionar um cliente.");
      return;
    }
    
    setIsSaving(true);
    try {
      const batch = writeBatch(db);

      const saleRef = editingSaleId 
        ? doc(db, 'sales', editingSaleId)
        : doc(collection(db, 'sales'));
      
      let totalSaleCost = 0;
      const finalItems: SaleItem[] = [];
      const productQuantityChanges: Record<string, number> = {};

      // 1. If editing, reverse the old sale impact first
      if (editingSaleId) {
        const oldSale = sales.find(s => s.id === editingSaleId);
        if (oldSale) {
          // Revert old balance impact ONLY if it was a credit sale
          if (oldSale.clientId && oldSale.paymentMethod === 'credit') {
            const clientRef = doc(db, 'clients', oldSale.clientId);
            batch.update(clientRef, {
              balance: increment(oldSale.total)
            });
          }

          for (const item of oldSale.items) {
            // Track quantity to be returned to inventory
            productQuantityChanges[item.productId] = (productQuantityChanges[item.productId] || 0) + item.quantity;

            // For PEPS, we'll create a "return" batch to put the stock back
            const batchRef = doc(collection(db, `inventory/${item.productId}/batches`));
            batch.set(batchRef, {
              purchaseId: `edit_return_${editingSaleId}`,
              quantity: item.quantity,
              initialQuantity: item.quantity,
              costPrice: item.costPrice,
              createdAt: serverTimestamp()
            });
          }
        }
      }

      // 2. PEPS (FIFO) Logic for the new/updated items
      for (const item of cart) {
        let remainingToSell = item.quantity;
        let itemTotalCost = 0;
        
        // Track quantity to be removed
        productQuantityChanges[item.productId] = (productQuantityChanges[item.productId] || 0) - item.quantity;

        // Fetch batches for this product ordered by creation date (oldest first)
        const batchesSnap = await getDocs(query(
          collection(db, `inventory/${item.productId}/batches`),
          orderBy('createdAt', 'asc')
        ));

        const productBatches = batchesSnap.docs
          .map(d => ({ id: d.id, ...d.data() } as Batch))
          .filter(b => b.quantity > 0);

        for (const pBatch of productBatches) {
          if (remainingToSell <= 0) break;

          const batchRef = doc(db, `inventory/${item.productId}/batches`, pBatch.id);
          const quantityToConsume = Math.min(pBatch.quantity, remainingToSell);
          
          itemTotalCost += quantityToConsume * pBatch.costPrice;
          remainingToSell -= quantityToConsume;
          
          batch.update(batchRef, { quantity: pBatch.quantity - quantityToConsume });
        }

        if (remainingToSell > 0) {
          // Fallback if stock is insufficient
          const fallbackCost = productBatches.length > 0 
            ? productBatches[productBatches.length - 1].costPrice 
            : (products.find(p => p.id === item.productId)?.price || 0) * 0.7;
          
          itemTotalCost += remainingToSell * fallbackCost;
          console.warn(`Estoque insuficiente para ${item.name}. Faltaram ${remainingToSell} unidades.`);
        }

        const avgCostPrice = itemTotalCost / item.quantity;
        totalSaleCost += itemTotalCost;
        
        finalItems.push({
          ...item,
          costPrice: avgCostPrice
        });
      }

      // 3. Apply consolidated product quantity updates
      for (const [productId, change] of Object.entries(productQuantityChanges)) {
        if (change !== 0) {
          const productRef = doc(db, 'inventory', productId);
          batch.update(productRef, {
            quantity: increment(change),
            updatedAt: serverTimestamp()
          });
        }
      }

      const saleData = {
        date: editingSaleId ? (sales.find(s => s.id === editingSaleId)?.date || serverTimestamp()) : serverTimestamp(),
        items: finalItems,
        total,
        totalCost: totalSaleCost,
        clientId: selectedClient?.id || null,
        clientName: selectedClient?.name || 'Venda Avulsa',
        paymentMethod
      };

      batch.set(saleRef, saleData);

      // 4. Update client balance if payment is 'credit'
      if (selectedClient && paymentMethod === 'credit') {
        const clientRef = doc(db, 'clients', selectedClient.id);
        batch.update(clientRef, {
          balance: increment(-total)
        });
      }

      await batch.commit();
      
      const newSale = {
        id: saleRef.id,
        ...saleData,
        date: new Date() // Temporary date for printing if needed immediately
      } as Sale;

      setCart([]);
      setSelectedClient(null);
      setEditingSaleId(null);
      setPaymentMethod('cash');
      setIsModalOpen(false);

      setShowSuccessModal({ isOpen: true, sale: newSale });
    } catch (error) {
      console.error("Error creating sale:", error);
      alert("Erro ao salvar a venda. Por favor, tente novamente.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleEdit = (sale: Sale) => {
    setEditingSaleId(sale.id);
    setSelectedClient(clients.find(c => c.id === sale.clientId) || null);
    setPaymentMethod(sale.paymentMethod || 'cash');
    setCart(sale.items);
    setIsModalOpen(true);
  };

  const handleDelete = async (sale: Sale) => {
    if (!window.confirm('Tem certeza que deseja excluir esta venda? O estoque será devolvido.')) return;

    try {
      const batch = writeBatch(db);
      
      for (const item of sale.items) {
        // Find batches that were consumed by this sale
        // This is tricky because we don't store which batches were consumed in the Sale record directly
        // We only stored the average cost.
        // To properly revert, we should ideally have stored the consumption breakdown.
        // Since we didn't, we'll have to "return" the stock to the most recent batch or create a new "return" batch.
        // For simplicity and to keep FIFO integrity, we'll add it back to the product quantity.
        // However, the PEPS logic relies on batches.
        
        // A better way: create a new batch with the costPrice that was recorded in the sale item.
        const batchRef = doc(collection(db, `inventory/${item.productId}/batches`));
        batch.set(batchRef, {
          purchaseId: `return_${sale.id}`,
          quantity: item.quantity,
          initialQuantity: item.quantity,
          costPrice: item.costPrice,
          createdAt: serverTimestamp() // This will make it the "newest" batch, which is okay for a return
        });

        // Update product total quantity
        const productRef = doc(db, 'inventory', item.productId);
        batch.update(productRef, {
          quantity: increment(item.quantity),
          updatedAt: serverTimestamp()
        });
      }

      // Update client balance if applicable
      if (sale.clientId && sale.paymentMethod === 'credit') {
        const clientRef = doc(db, 'clients', sale.clientId);
        batch.update(clientRef, {
          balance: increment(sale.total)
        });
      }

      batch.delete(doc(db, 'sales', sale.id));
      await batch.commit();
    } catch (error) {
      console.error("Error deleting sale:", error);
    }
  };

  const filteredSales = sales.filter(sale => {
    const matchesSearch = sale.clientName?.toLowerCase().includes(searchHistory.toLowerCase()) || 
                         sale.items.some(i => i.name.toLowerCase().includes(searchHistory.toLowerCase()));
    
    const totalQty = sale.items.reduce((acc, i) => acc + i.quantity, 0);
    
    const matchesValue = (!minValue || sale.total >= parseFloat(minValue)) && 
                        (!maxValue || sale.total <= parseFloat(maxValue));
    
    const matchesQty = (!minQty || totalQty >= parseInt(minQty)) && 
                      (!maxQty || totalQty <= parseInt(maxQty));
    
    return matchesSearch && matchesValue && matchesQty;
  });

  return (
    <>
      <div className="space-y-6 print:hidden no-print">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Vendas</h2>
          <p className="text-gray-500">Histórico de transações e novos pedidos.</p>
        </div>
        <button 
          onClick={() => {
            setEditingSaleId(null);
            setCart([]);
            setSelectedClient(null);
            setPaymentMethod('cash');
            setIsModalOpen(true);
          }}
          className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition-colors shadow-sm"
        >
          <Plus size={20} className="mr-2" />
          Nova Venda
        </button>
      </header>

      {/* Filters Bar */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="md:col-span-1">
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Buscar</label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input 
              type="text"
              placeholder="Cliente ou produto..."
              className="w-full pl-9 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
              value={searchHistory}
              onChange={(e) => setSearchHistory(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Valor Mínimo</label>
          <input 
            type="number"
            placeholder="R$ 0,00"
            className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
            value={minValue}
            onChange={(e) => setMinValue(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Valor Máximo</label>
          <input 
            type="number"
            placeholder="R$ 9.999"
            className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
            value={maxValue}
            onChange={(e) => setMaxValue(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Qtd Mínima</label>
          <input 
            type="number"
            placeholder="0"
            className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
            value={minQty}
            onChange={(e) => setMinQty(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Qtd Máxima</label>
          <input 
            type="number"
            placeholder="999"
            className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
            value={maxQty}
            onChange={(e) => setMaxQty(e.target.value)}
          />
        </div>
      </div>

      {/* Sales History */}
      <div className="grid grid-cols-1 gap-4">
        {filteredSales.map((sale) => (
          <motion.div 
            key={sale.id}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4"
          >
            <div className="flex items-center">
              <div className="p-3 bg-indigo-50 text-indigo-600 rounded-xl mr-4">
                <ShoppingCart size={24} />
              </div>
              <div>
                <p className="font-bold text-gray-900">{sale.clientName}</p>
                <div className="flex items-center gap-2">
                  <p className="text-sm text-gray-500">{formatDate(sale.date)}</p>
                  <span className={cn(
                    "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider",
                    sale.paymentMethod === 'credit' ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600"
                  )}>
                    {sale.paymentMethod === 'credit' ? 'A Prazo' : 'À Vista'}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-8">
              <div className="text-right">
                <p className="text-xs text-gray-400 uppercase font-bold tracking-wider">Itens</p>
                <p className="font-medium text-gray-700">{sale.items.length} produtos</p>
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-400 uppercase font-bold tracking-wider">Total</p>
                <p className="text-xl font-bold text-indigo-600">{formatCurrency(sale.total)}</p>
              </div>
              <div className="flex gap-2">
                <button 
                  onClick={() => handlePrint(sale)}
                  className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                  title="Imprimir Pedido"
                >
                  <Printer size={18} />
                </button>
                <button 
                  onClick={() => navigate('/vendas/devolucoes')}
                  className="p-2 text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-all"
                  title="Devolver Venda"
                >
                  <RotateCcw size={18} />
                </button>
                <button 
                  onClick={() => handleEdit(sale)}
                  className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all"
                >
                  <Edit2 size={18} />
                </button>
                <button 
                  onClick={() => handleDelete(sale)}
                  className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                >
                  <Trash2 size={18} />
                </button>
              </div>
            </div>
          </motion.div>
        ))}
        {filteredSales.length === 0 && (
          <div className="bg-white p-12 rounded-2xl shadow-sm border border-gray-100 text-center">
            <Search size={48} className="mx-auto text-gray-200 mb-4" />
            <p className="text-gray-500 font-medium">Nenhuma venda encontrada com os filtros selecionados.</p>
            <button 
              onClick={() => {
                setSearchHistory('');
                setMinValue('');
                setMaxValue('');
                setMinQty('');
                setMaxQty('');
              }}
              className="mt-4 text-indigo-600 font-bold hover:underline"
            >
              Limpar todos os filtros
            </button>
          </div>
        )}
      </div>

      {/* New Sale Modal */}
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
                  {editingSaleId ? 'Editar Venda' : 'Registrar Venda'}
                </h3>
                <button 
                  onClick={() => {
                    setIsModalOpen(false);
                    setEditingSaleId(null);
                    setCart([]);
                    setSelectedClient(null);
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
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Cliente</label>
                      <select 
                        className="w-full p-3 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/20"
                        onChange={(e) => {
                          const client = clients.find(c => c.id === e.target.value) || null;
                          setSelectedClient(client);
                          if (!client) setPaymentMethod('cash');
                        }}
                        value={selectedClient?.id || ''}
                      >
                        <option value="">Venda Avulsa</option>
                        {clients.map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
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
                          disabled={!selectedClient}
                          className={cn(
                            "flex-1 py-2 text-xs font-bold rounded-lg transition-all",
                            paymentMethod === 'credit' ? "bg-indigo-600 text-white shadow-sm" : "text-gray-400 hover:text-gray-600",
                            !selectedClient && "opacity-50 cursor-not-allowed"
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
                        <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Preço Un.</label>
                        <input 
                          type="number"
                          step="0.01"
                          className="w-full p-3 bg-white border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/20 font-bold text-indigo-600"
                          value={inputPrice}
                          onChange={(e) => setInputPrice(parseFloat(e.target.value) || 0)}
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
                    <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4">Itens da Venda</h4>
                    <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden overflow-x-auto">
                      <table className="w-full text-left border-collapse min-w-[600px]">
                        <thead className="bg-gray-50 border-b border-gray-100">
                          <tr>
                            <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Produto</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-center">Quantidade</th>
                            <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-right">Preço Un.</th>
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
                                  value={item.price}
                                  onChange={(e) => updateCartItem(item.productId, 'price', parseFloat(e.target.value) || 0)}
                                />
                              </td>
                              <td className="px-6 py-4 text-right font-bold text-gray-900">
                                {formatCurrency(item.quantity * item.price)}
                              </td>
                              <td className="px-6 py-4 text-center">
                                <button onClick={() => removeFromCart(item.productId)} className="p-2 text-red-500 hover:bg-red-50 rounded-lg">
                                  <X size={18} />
                                </button>
                              </td>
                            </tr>
                          ))}
                          {cart.length === 0 && (
                            <tr>
                              <td colSpan={5} className="px-6 py-12 text-center text-gray-400">
                                Nenhum item adicionado à venda
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Summary Sidebar */}
                  <div className="w-full lg:w-80 p-6 bg-gray-50 border-t lg:border-t-0 lg:border-l border-gray-100 flex flex-col shrink-0 overflow-auto">
                    <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-6">Resumo da Venda</h4>
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
                  {editingSaleId && (
                    <button 
                      onClick={() => {
                        setIsModalOpen(false);
                        setEditingSaleId(null);
                        setCart([]);
                        setSelectedClient(null);
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
                        {editingSaleId ? 'Salvar Alterações' : 'Finalizar Venda'}
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

      {/* Success Modal */}
      <AnimatePresence>
        {showSuccessModal.isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="bg-white w-full max-w-md p-8 rounded-[2.5rem] shadow-2xl text-center"
            >
              <div className="w-20 h-20 bg-emerald-100 text-emerald-600 rounded-3xl flex items-center justify-center mx-auto mb-6">
                <Check size={40} />
              </div>
              <h3 className="text-2xl font-black text-gray-900 mb-2">Venda Concluída!</h3>
              <p className="text-gray-500 mb-8">O lançamento foi registrado com sucesso no sistema.</p>
              
              <div className="grid grid-cols-1 gap-3">
                <button 
                  onClick={() => {
                    if (showSuccessModal.sale) {
                      handlePrint(showSuccessModal.sale);
                    }
                    setShowSuccessModal({ isOpen: false, sale: null });
                  }}
                  className="w-full py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 transition-all flex items-center justify-center shadow-lg shadow-indigo-200"
                >
                  <Printer size={20} className="mr-2" />
                  Imprimir Pedido
                </button>
                <button 
                  onClick={() => setShowSuccessModal({ isOpen: false, sale: null })}
                  className="w-full py-4 bg-gray-100 text-gray-600 rounded-2xl font-bold hover:bg-gray-200 transition-all"
                >
                  Fechar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      </div>
      {/* Print View (Hidden in UI) */}
      {printingSale && (
        <div className="hidden print:block print-only bg-white p-8 text-black min-h-screen w-full absolute top-0 left-0 z-[9999]">
          <div className="max-w-2xl mx-auto border p-8">
            <div className="text-center mb-8 border-b pb-4">
              <h1 className="text-2xl font-bold uppercase">Pedido de Venda</h1>
              <p className="text-sm text-gray-600 mt-1">#{printingSale.id.toUpperCase()}</p>
            </div>

            <div className="grid grid-cols-2 gap-8 mb-8">
              <div>
                <h4 className="font-bold text-xs uppercase text-gray-500 mb-1">Cliente</h4>
                <p className="font-bold">{printingSale.clientName}</p>
              </div>
              <div className="text-right">
                <h4 className="font-bold text-xs uppercase text-gray-500 mb-1">Data</h4>
                <p className="font-bold">{formatDate(printingSale.date)}</p>
              </div>
            </div>

            <div className="mb-8">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b-2 border-black">
                    <th className="py-2 text-sm font-bold uppercase">Produto</th>
                    <th className="py-2 text-sm font-bold uppercase text-center">Qtd</th>
                    <th className="py-2 text-sm font-bold uppercase text-right">Preço Un.</th>
                    <th className="py-2 text-sm font-bold uppercase text-right">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {printingSale.items.map((item, idx) => (
                    <tr key={idx}>
                      <td className="py-3 text-sm">{item.name}</td>
                      <td className="py-3 text-sm text-center">{item.quantity}</td>
                      <td className="py-3 text-sm text-right">{formatCurrency(item.price)}</td>
                      <td className="py-3 text-sm text-right font-bold">{formatCurrency(item.quantity * item.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end border-t-2 border-black pt-4">
              <div className="w-64 space-y-2">
                <div className="flex justify-between text-sm">
                  <span>Forma de Pagamento:</span>
                  <span className="font-bold uppercase">{printingSale.paymentMethod === 'credit' ? 'A Prazo' : 'À Vista'}</span>
                </div>
                <div className="flex justify-between text-xl font-bold pt-2 border-t">
                  <span>TOTAL:</span>
                  <span>{formatCurrency(printingSale.total)}</span>
                </div>
              </div>
            </div>

            <div className="mt-16 pt-8 border-t border-dashed border-gray-300 text-center text-xs text-gray-400">
              <p>Obrigado pela preferência!</p>
              <p className="mt-1">Documento emitido em {new Date().toLocaleString()}</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
