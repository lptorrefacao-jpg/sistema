import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { db } from './firebase';
import { Sale, Purchase, SaleReturn } from './types';
import { formatCurrency, formatDate, cn } from './lib/utils';
import { motion } from 'motion/react';
import { History, ArrowUpRight, ArrowDownLeft, Search, Filter, Calendar, RotateCcw } from 'lucide-react';

interface Movement {
  id: string;
  date: any;
  type: 'entry' | 'exit' | 'return';
  productName: string;
  quantity: number;
  price: number;
  total: number;
  origin: string;
  referenceId: string;
}

export const InventoryHistory: React.FC = () => {
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'entry' | 'exit' | 'return'>('all');

  useEffect(() => {
    const unsubSales = onSnapshot(query(collection(db, 'sales'), orderBy('date', 'desc')), (snap) => {
      const salesMovements: Movement[] = snap.docs.flatMap(doc => {
        const sale = { id: doc.id, ...doc.data() } as Sale;
        return sale.items.map((item, index) => ({
          id: `${doc.id}-${index}`,
          date: sale.date,
          type: 'exit' as const,
          productName: item.name,
          quantity: item.quantity,
          price: item.price,
          total: item.quantity * item.price,
          origin: sale.clientName || 'Venda Avulsa',
          referenceId: doc.id
        }));
      });
      
      updateMovements(salesMovements, 'sales');
    });

    const unsubPurchases = onSnapshot(query(collection(db, 'purchases'), orderBy('date', 'desc')), (snap) => {
      const purchasesMovements: Movement[] = snap.docs.flatMap(doc => {
        const purchase = { id: doc.id, ...doc.data() } as Purchase;
        return purchase.items.map((item, index) => ({
          id: `${doc.id}-${index}`,
          date: purchase.date,
          type: 'entry' as const,
          productName: item.name,
          quantity: item.quantity,
          price: item.costPrice,
          total: item.quantity * item.costPrice,
          origin: purchase.supplier || 'Fornecedor Geral',
          referenceId: doc.id
        }));
      });

      updateMovements(purchasesMovements, 'purchases');
    });

    const unsubReturns = onSnapshot(query(collection(db, 'sales_returns'), orderBy('date', 'desc')), (snap) => {
      const returnsMovements: Movement[] = snap.docs.flatMap(doc => {
        const ret = { id: doc.id, ...doc.data() } as SaleReturn;
        return ret.items.map((item, index) => ({
          id: `${doc.id}-${index}`,
          date: ret.date,
          type: 'return' as const,
          productName: item.name,
          quantity: item.quantity,
          price: item.price,
          total: item.quantity * item.price,
          origin: `Devolução: ${ret.clientName}`,
          referenceId: doc.id
        }));
      });

      updateMovements(returnsMovements, 'returns');
    });

    const salesData: Movement[] = [];
    const purchasesData: Movement[] = [];
    const returnsData: Movement[] = [];

    const updateMovements = (newData: Movement[], source: 'sales' | 'purchases' | 'returns') => {
      if (source === 'sales') salesData.splice(0, salesData.length, ...newData);
      else if (source === 'purchases') purchasesData.splice(0, purchasesData.length, ...newData);
      else returnsData.splice(0, returnsData.length, ...newData);

      const allMovements = [...salesData, ...purchasesData, ...returnsData].sort((a, b) => {
        const dateA = a.date?.seconds || 0;
        const dateB = b.date?.seconds || 0;
        return dateB - dateA;
      });

      setMovements(allMovements);
      setLoading(false);
    };

    return () => {
      unsubSales();
      unsubPurchases();
      unsubReturns();
    };
  }, []);

  const filteredMovements = movements.filter(m => {
    const matchesSearch = m.productName.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         m.origin.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = typeFilter === 'all' || m.type === typeFilter;
    return matchesSearch && matchesType;
  });

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">Histórico de Estoque</h2>
          <p className="text-gray-500">Acompanhe todas as entradas, saídas e devoluções.</p>
        </div>
        <div className="p-3 bg-indigo-50 text-indigo-600 rounded-2xl">
          <History size={24} />
        </div>
      </header>

      {/* Filters */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input 
            type="text"
            placeholder="Buscar produto ou origem..."
            className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/20"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter size={18} className="text-gray-400" />
          <select 
            className="flex-1 p-2 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-500/20"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as any)}
          >
            <option value="all">Todos os Tipos</option>
            <option value="entry">Entradas (Compras)</option>
            <option value="exit">Saídas (Vendas)</option>
            <option value="return">Devoluções</option>
          </select>
        </div>
        <div className="flex items-center gap-2 text-gray-400 text-sm">
          <Calendar size={18} />
          <span>Ordenado por data (mais recente primeiro)</span>
        </div>
      </div>

      {/* History Table */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Data</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Tipo</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Produto</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-center">Qtd</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-right">Valor Un.</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider text-right">Total</th>
                <th className="px-6 py-4 text-xs font-bold text-gray-400 uppercase tracking-wider">Origem/Destino</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mx-auto"></div>
                  </td>
                </tr>
              ) : filteredMovements.map((m) => (
                <motion.tr 
                  key={m.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="hover:bg-gray-50/50 transition-colors"
                >
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                    {formatDate(m.date)}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={cn(
                      "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium",
                      m.type === 'entry' 
                        ? "bg-emerald-100 text-emerald-800" 
                        : m.type === 'exit'
                        ? "bg-orange-100 text-orange-800"
                        : "bg-blue-100 text-blue-800"
                    )}>
                      {m.type === 'entry' ? (
                        <><ArrowDownLeft size={12} className="mr-1" /> Entrada</>
                      ) : m.type === 'exit' ? (
                        <><ArrowUpRight size={12} className="mr-1" /> Saída</>
                      ) : (
                        <><RotateCcw size={12} className="mr-1" /> Devolução</>
                      )}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-bold text-gray-900">
                    {m.productName}
                  </td>
                  <td className="px-6 py-4 text-center font-medium">
                    {m.type === 'exit' ? '-' : '+'}{m.quantity}
                  </td>
                  <td className="px-6 py-4 text-right text-gray-600">
                    {formatCurrency(m.price)}
                  </td>
                  <td className="px-6 py-4 text-right font-bold text-gray-900">
                    {formatCurrency(m.total)}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500">
                    {m.origin}
                  </td>
                </motion.tr>
              ))}
              {!loading && filteredMovements.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-gray-400">
                    Nenhuma movimentação encontrada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
