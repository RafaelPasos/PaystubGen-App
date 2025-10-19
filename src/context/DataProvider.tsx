'use client';

import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, DocumentData } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import type { Employee, ProductionItem, ProductionEntry } from '@/lib/types';
import { useToast } from "@/hooks/use-toast"

interface DataContextType {
  employees: Employee[];
  items: ProductionItem[];
  production: ProductionEntry[];
  loading: boolean;
  addEmployee: (employee: Omit<Employee, 'id'>) => Promise<void>;
  updateEmployee: (id: string, employee: Partial<Employee>) => Promise<void>;
  deleteEmployee: (id: string) => Promise<void>;
  addItem: (item: Omit<ProductionItem, 'id'>) => Promise<void>;
  updateItem: (id: string, item: Partial<ProductionItem>) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  addProductionEntry: (entry: Omit<ProductionEntry, 'id'>) => Promise<void>;
  deleteProductionEntry: (id: string) => Promise<void>;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export const DataProvider = ({ children }: { children: ReactNode }) => {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [items, setItems] = useState<ProductionItem[]>([]);
  const [production, setProduction] = useState<ProductionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    setLoading(true);
    const unsubEmployees = onSnapshot(collection(db, 'employees'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee));
      setEmployees(data);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching employees:", error);
      toast({ title: "Error", description: "Could not fetch employees. Make sure your Firebase setup is correct.", variant: "destructive" });
      setLoading(false);
    });

    const unsubItems = onSnapshot(collection(db, 'items'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductionItem));
      setItems(data);
    }, (error) => {
      console.error("Error fetching items:", error);
      toast({ title: "Error", description: "Could not fetch items.", variant: "destructive" });
    });

    const unsubProduction = onSnapshot(collection(db, 'production'), (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductionEntry));
      setProduction(data);
    }, (error) => {
      console.error("Error fetching production data:", error);
       toast({ title: "Error", description: "Could not fetch production data.", variant: "destructive" });
    });

    return () => {
      unsubEmployees();
      unsubItems();
      unsubProduction();
    };
  }, [toast]);

  const handleFirestoreError = (error: any, message: string) => {
    console.error(message, error);
    toast({ title: "Error", description: "An error occurred. Please try again.", variant: "destructive" });
  };
  
  const addEmployee = async (employee: Omit<Employee, 'id'>) => {
    try {
      await addDoc(collection(db, 'employees'), employee as DocumentData);
    } catch (error) { handleFirestoreError(error, "Error adding employee:"); }
  };

  const updateEmployee = async (id: string, employee: Partial<Employee>) => {
    try {
      await updateDoc(doc(db, 'employees', id), employee as DocumentData);
    } catch (error) { handleFirestoreError(error, "Error updating employee:"); }
  };

  const deleteEmployee = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'employees', id));
    } catch (error) { handleFirestoreError(error, "Error deleting employee:"); }
  };

  const addItem = async (item: Omit<ProductionItem, 'id'>) => {
    try {
      await addDoc(collection(db, 'items'), item as DocumentData);
    } catch (error) { handleFirestoreError(error, "Error adding item:"); }
  };

  const updateItem = async (id: string, item: Partial<ProductionItem>) => {
    try {
      await updateDoc(doc(db, 'items', id), item as DocumentData);
    } catch (error) { handleFirestoreError(error, "Error updating item:"); }
  };

  const deleteItem = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'items', id));
    } catch (error) { handleFirestoreError(error, "Error deleting item:"); }
  };

  const addProductionEntry = async (entry: Omit<ProductionEntry, 'id'>) => {
    try {
      await addDoc(collection(db, 'production'), entry as DocumentData);
    } catch (error) { handleFirestoreError(error, "Error adding production entry:"); }
  };

  const deleteProductionEntry = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'production', id));
    } catch (error) { handleFirestoreError(error, "Error deleting production entry:"); }
  };

  const value = {
    employees,
    items,
    production,
    loading,
    addEmployee,
    updateEmployee,
    deleteEmployee,
    addItem,
    updateItem,
    deleteItem,
    addProductionEntry,
    deleteProductionEntry,
  };

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
};

export const useData = () => {
  const context = useContext(DataContext);
  if (context === undefined) {
    throw new Error('useData must be used within a DataProvider');
  }
  return context;
};
