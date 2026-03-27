import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { TrendingUp, DollarSign, Package, Calendar, ArrowUpRight, Search, Filter, List, LayoutGrid, Info } from 'lucide-react';
import { db } from './firebase';
import { Sale, SaleItem } from './types';
import { formatCurrency, formatDate, cn } from './lib/utils';
import { motion, AnimatePresence } from 'motion/react';

type ViewMode = 'product' | 'sale';

interface ProductGroup {
  productId: string;
  name: string;
  quantity: number;
  revenue: number;
  cost: number;
  profit: number;
}

interface DetailedSaleItem extends SaleItem {
  saleId: string;
  date: any;
  clientName: string;
}

export const ProfitReport: React.FC = () => {
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('product');
  
  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  useEffect(() => {
    const unsub = onSnapshot(query(collection(db, 'sales'), orderBy('date', 'desc')), (snap) => {
      setSales(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Sale)));
      setLoading(false);
    });
    return unsub;
  }, []);

  const normalize = (str: string) => 
    str.normalize('NFD').replace(/[\u0300-\u036f]/g, "").toLowerCase();

  // Filter Logic
  const filteredSales = sales.filter(sale => {
    const saleDate = sale.date?.toDate();
    if (!saleDate) return true;
    
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;
    
    if (start && saleDate < start) return false;
    if (end) {
      const endOfDay = new Date(end);
      endOfDay.setHours(23, 59, 59, 999);
      if (saleDate > endOfDay) return false;
    }
    
    return true;
  });

  // Grouped by Product Logic
  const productGroups = filteredSales.reduce((acc, sale) => {
    if (!sale.items || !Array.isArray(sale.items)) return acc;

    sale.items.forEach(item => {
      const itemName = item.name || 'Produto sem nome';
      const normalizedName = normalize(itemName);
      const normalizedSearch = normalize(searchTerm.trim());

      if (searchTerm.trim() && !normalizedName.includes(normalizedSearch)) {
        return;
      }

      const productId = item.productId || 'unknown';

      if (!acc[productId]) {
        acc[productId] = {
          productId,
          name: itemName,
          quantity: 0,
          revenue: 0,
          cost: 0,
          profit: 0
        };
      }
      
      const itemRevenue = (item.quantity || 0) * (item.price || 0);
      const itemCost = (item.quantity || 0) * (item.costPrice || 0);
      
      acc[productId].quantity += (item.quantity || 0);
      acc[productId].revenue += itemRevenue;
      acc[productId].cost += itemCost;
      acc[productId].profit += (itemRevenue - itemCost);
    });
    return acc;
  }, {} as Record<string, ProductGroup>);

  const groupedProducts = (Object.values(productGroups) as ProductGroup[]).sort((a, b) => b.profit - a.profit);

  // Detailed Items Logic
  const detailedItems: DetailedSaleItem[] = [];
  filteredSales.forEach(sale => {
    sale.items.forEach(item => {
      const itemName = item.name || 'Produto sem nome';
      const normalizedName = normalize(itemName);
      const normalizedSearch = normalize(searchTerm.trim());

      if (searchTerm.trim() && !normalizedName.includes(normalizedSearch)) {
        return;
      }

      detailedItems.push({
        ...item,
        saleId: sale.id,
        date: sale.date,
        clientName: sale.clientName || 'Venda Avulsa'
      });
    });
  });

  const stats = groupedProducts.reduce((acc, p) => ({
    totalRevenue: acc.totalRevenue + p.revenue,
    totalCost: acc.totalCost + p.cost,
    totalProfit: acc.totalProfit + p.profit,
    totalQuantity: acc.totalQuantity + p.quantity
  }), { totalRevenue: 0, totalCost: 0, totalProfit: 0, totalQuantity: 0 } as { totalRevenue: number, totalCost: number, totalProfit: number, totalQuantity: number });

  const profitMargin = stats.totalRevenue > 0 
    ? (stats.totalProfit / stats.totalRevenue) * 100 
    : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 tracking-tight">Relatório de Lucro Bruto</h2>
          <div className="flex items-center gap-2 mt-1">
            <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] font-bold uppercase rounded tracking-wider">Método PEPS (FIFO)</span>
            <p className="text-gray-500 text-sm">Análise de rentabilidade e custos efetivos de aquisição.</p>
          </div>
        </div>
        
        <div className="flex bg-gray-100 p-1 rounded-xl">
          <button 
            onClick={() => setViewMode('product')}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all",
              viewMode === 'product' ? "bg-white text-indigo-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
            )}
          >
            <LayoutGrid size={16} />
            Por Produto
          </button>
          <button 
            onClick={() => setViewMode('sale')}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold transition-all",
              viewMode === 'sale' ? "bg-white text-indigo-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
            )}
          >
            <List size={16} />
            Por Venda
          </button>
        </div>
      </header>

      {/* Filters Section */}
      <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
        <div className="flex flex-col lg:flex-row gap-4 items-end">
          <div className="flex-1 w-full">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Buscar Produto</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input 
                type="text"
                placeholder="Nome do produto..."
                className="w-full pl-10 pr-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
          <div className="w-full lg:w-48">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Data Inicial</label>
            <input 
              type="date"
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="w-full lg:w-48">
            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Data Final</label>
            <input 
              type="date"
              className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <button 
            onClick={() => {
              setSearchTerm('');
              setStartDate('');
              setEndDate('');
            }}
            className="px-6 py-2.5 text-gray-500 hover:text-red-600 font-bold text-sm transition-colors"
          >
            Limpar Filtros
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {[
          { label: 'Receita Total', value: stats.totalRevenue, icon: DollarSign, color: 'indigo' },
          { label: 'Custo Efetivo (PEPS)', value: stats.totalCost, icon: Package, color: 'red' },
          { label: 'Lucro Bruto', value: stats.totalProfit, icon: TrendingUp, color: 'emerald' },
          { label: 'Margem Bruta', value: `${profitMargin.toFixed(1)}%`, icon: ArrowUpRight, color: 'amber' }
        ].map((stat, i) => (
          <motion.div 
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100 flex flex-col justify-between h-32"
          >
            <div className="flex items-center justify-between">
              <div className={cn("p-2 rounded-xl", `bg-${stat.color}-50 text-${stat.color}-600`)}>
                <stat.icon size={20} />
              </div>
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{stat.label}</span>
            </div>
            <p className="text-2xl font-black text-gray-900">
              {typeof stat.value === 'number' ? formatCurrency(stat.value) : stat.value}
            </p>
          </motion.div>
        ))}
      </div>

      {/* Main Content Table */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-gray-50/30">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-bold text-gray-900">
              {viewMode === 'product' ? 'Desempenho por Produto' : 'Detalhamento por Item Vendido'}
            </h3>
            <div className="group relative">
              <Info size={14} className="text-gray-400 cursor-help" />
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 bg-gray-900 text-white text-[10px] rounded-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 leading-relaxed">
                O <strong>Custo Efetivo Unitário</strong> é calculado usando o método PEPS (Primeiro que Entra, Primeiro que Sai), refletindo o valor real pago na aquisição de cada unidade vendida.
              </div>
            </div>
          </div>
          <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
            {viewMode === 'product' ? `${groupedProducts.length} Produtos` : `${detailedItems.length} Itens`}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-gray-50/50 border-b border-gray-100">
              <tr>
                {viewMode === 'product' ? (
                  <>
                    <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Produto</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">Qtd</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Receita</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Custo Efet. Médio</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Custo Total</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Lucro</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Margem</th>
                  </>
                ) : (
                  <>
                    <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Data / Venda</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Produto / Cliente</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">Qtd</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Preço Venda</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Custo Efet. (PEPS)</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Lucro</th>
                    <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest text-right">Margem</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {viewMode === 'product' ? (
                groupedProducts.map((product) => {
                  const margin = product.revenue > 0 ? (product.profit / product.revenue) * 100 : 0;
                  const avgCost = product.quantity > 0 ? product.cost / product.quantity : 0;

                  return (
                    <tr key={product.productId} className="hover:bg-gray-50/50 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="font-bold text-gray-900 group-hover:text-indigo-600 transition-colors">{product.name}</div>
                        <div className="text-[9px] text-gray-400 font-mono mt-0.5 uppercase">ID: {product.productId.slice(0, 8)}</div>
                      </td>
                      <td className="px-6 py-4 text-center text-gray-600 font-mono text-sm">{product.quantity}</td>
                      <td className="px-6 py-4 text-right font-bold text-gray-900">{formatCurrency(product.revenue)}</td>
                      <td className="px-6 py-4 text-right">
                        <div className="text-sm font-bold text-gray-500">{formatCurrency(avgCost)}</div>
                        <div className="text-[9px] text-gray-400 uppercase font-bold">PEPS Médio</div>
                      </td>
                      <td className="px-6 py-4 text-right text-red-600 font-bold">{formatCurrency(product.cost)}</td>
                      <td className="px-6 py-4 text-right font-black text-emerald-600">{formatCurrency(product.profit)}</td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div 
                              className={cn("h-full transition-all duration-500", margin > 0 ? "bg-emerald-500" : "bg-red-500")}
                              style={{ width: `${Math.min(Math.max(margin, 0), 100)}%` }}
                            />
                          </div>
                          <span className={cn(
                            "text-xs font-black min-w-[40px]",
                            margin > 0 ? "text-emerald-600" : "text-red-600"
                          )}>
                            {margin.toFixed(1)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                detailedItems.map((item, idx) => {
                  const revenue = item.quantity * item.price;
                  const cost = item.quantity * item.costPrice;
                  const profit = revenue - cost;
                  const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

                  return (
                    <tr key={`${item.saleId}-${idx}`} className="hover:bg-gray-50/50 transition-colors group">
                      <td className="px-6 py-4">
                        <div className="text-xs font-bold text-gray-900">{formatDate(item.date)}</div>
                        <div className="text-[9px] text-gray-400 font-mono mt-0.5 uppercase">VENDA: {item.saleId.slice(0, 8)}</div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="font-bold text-gray-900 group-hover:text-indigo-600 transition-colors">{item.name}</div>
                        <div className="text-[10px] text-gray-500 italic">{item.clientName}</div>
                      </td>
                      <td className="px-6 py-4 text-center text-gray-600 font-mono text-sm">{item.quantity}</td>
                      <td className="px-6 py-4 text-right font-bold text-gray-900">{formatCurrency(item.price)}</td>
                      <td className="px-6 py-4 text-right">
                        <div className="text-sm font-bold text-red-600">{formatCurrency(item.costPrice)}</div>
                        <div className="text-[9px] text-gray-400 uppercase font-bold">Custo Efetivo</div>
                      </td>
                      <td className="px-6 py-4 text-right font-black text-emerald-600">{formatCurrency(profit)}</td>
                      <td className="px-6 py-4 text-right">
                        <span className={cn(
                          "px-2 py-1 rounded-lg text-[10px] font-black",
                          margin > 0 ? "bg-emerald-50 text-emerald-600 border border-emerald-100" : "bg-red-50 text-red-600 border border-red-100"
                        )}>
                          {margin.toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
              {(viewMode === 'product' ? groupedProducts : detailedItems).length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-24 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="p-4 bg-gray-50 rounded-full text-gray-300">
                        <Filter size={32} />
                      </div>
                      <p className="text-gray-400 font-bold uppercase text-[10px] tracking-widest">Nenhum dado encontrado para os filtros selecionados</p>
                    </div>
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
