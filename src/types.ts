export interface UserProfile {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
  role: 'admin' | 'user';
}

export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  quantity: number;
  category: string;
  updatedAt: any;
}

export interface Batch {
  id: string;
  purchaseId: string;
  quantity: number;
  initialQuantity: number;
  costPrice: number;
  createdAt: any;
}

export interface PurchaseItem {
  productId: string;
  name: string;
  quantity: number;
  costPrice: number;
}

export interface Purchase {
  id: string;
  date: any;
  supplierId?: string;
  supplier: string;
  items: PurchaseItem[];
  total: number;
  paymentMethod: 'cash' | 'credit';
}

export interface SaleItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
  costPrice: number;
}

export interface Sale {
  id: string;
  date: any;
  items: SaleItem[];
  total: number;
  totalCost: number;
  clientId?: string;
  clientName?: string;
  paymentMethod: 'cash' | 'credit';
}

export interface SaleReturnItem {
  productId: string;
  name: string;
  quantity: number;
  price: number; // Price at which it was sold
  costPrice: number; // Cost price at which it was sold (to revert profit)
}

export interface SaleReturn {
  id: string;
  saleId: string;
  date: any;
  items: SaleReturnItem[];
  total: number;
  totalCost: number;
  clientId?: string;
  clientName: string;
  reason: string;
  refundMethod: 'cash' | 'credit';
}

export interface Client {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  balance: number; // Positive for credit, negative for debt
}

export interface Supplier {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  balance: number; // Positive for credit, negative for debt (to supplier)
}

export interface Transaction {
  id: string;
  date: any;
  type: 'income' | 'expense';
  category: string;
  description: string;
  amount: number;
  relatedId?: string; // saleId, purchaseId, returnId, clientId, supplierId
  relatedType?: 'sale' | 'purchase' | 'return' | 'manual' | 'client' | 'supplier';
  clientId?: string;
  supplierId?: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'todo' | 'in-progress' | 'done';
  dueDate: any;
  assignedTo: string;
}
