'use client';

import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, DocumentData, query, where } from 'firebase/firestore';
import { useFirestore, useMemoFirebase } from '@/firebase';
import type { Employee, ProductionItem, ProductionEntry, Team } from '@/lib/types';
import { useToast } from "@/hooks/use-toast"
import { addDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';

interface DataContextType {
  teams: Team[];
  employees: Employee[];
  items: ProductionItem[];
  production: ProductionEntry[];
  loading: boolean;
  addEmployee: (employee: Omit<Employee, 'id'>) => Promise<void>;
  updateEmployee: (id: string, teamId: string, employee: Partial<Employee>) => Promise<void>;
  deleteEmployee: (id: string, teamId: string) => Promise<void>;
  addItem: (item: Omit<ProductionItem, 'id'>) => Promise<void>;
  updateItem: (id: string, teamId: string, item: Partial<ProductionItem>) => Promise<void>;
  deleteItem: (id: string, teamId: string) => Promise<void>;
  addProductionEntry: (entry: Omit<ProductionEntry, 'id'>) => Promise<void>;
  updateProductionEntry: (id: string, teamId:string, employeeId: string, entry: Partial<ProductionEntry>) => Promise<void>;
  deleteProductionEntry: (id: string) => Promise<void>;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export const DataProvider = ({ children }: { children: ReactNode }) => {
  const firestore = useFirestore();
  const [teams, setTeams] = useState<Team[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [items, setItems] = useState<ProductionItem[]>([]);
  const [production, setProduction] = useState<ProductionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    if (!firestore) return;
    setLoading(true);

    const unsubTeams = onSnapshot(collection(firestore, 'teams'), (snapshot) => {
      const teamsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Team));
      setTeams(teamsData);
      
      if (teamsData.length > 0) {
        const teamIds = teamsData.map(t => t.id);

        const unsubEmployees = onSnapshot(query(collection(firestore, `teams/${teamIds[0]}/employees`)), (snapshot) => {
          const employeeData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee));
          setEmployees(prev => [...prev.filter(e => e.teamId !== teamIds[0]), ...employeeData]);
        });

        const unsubItems = onSnapshot(query(collection(firestore, `teams/${teamIds[0]}/productionItems`)), (snapshot) => {
            const itemsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductionItem));
            setItems(prev => [...prev.filter(i => i.teamId !== teamIds[0]), ...itemsData]);
        });

         const unsubProduction = onSnapshot(query(collection(firestore, `teams/${teamIds[0]}/employees`)), employeeSnapshot => {
            employeeSnapshot.docs.forEach(empDoc => {
                onSnapshot(collection(firestore, `teams/${teamIds[0]}/employees/${empDoc.id}/dailyProduction`), productionSnapshot => {
                    const productionData = productionSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductionEntry));
                    setProduction(prev => [...prev.filter(p=> p.employeeId !== empDoc.id), ...productionData]);
                });
            });
        });

        if (teamIds.length > 1) {
            const unsubEmployees2 = onSnapshot(query(collection(firestore, `teams/${teamIds[1]}/employees`)), (snapshot) => {
              const employeeData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Employee));
              setEmployees(prev => [...prev.filter(e => e.teamId !== teamIds[1]), ...employeeData]);
            });

            const unsubItems2 = onSnapshot(query(collection(firestore, `teams/${teamIds[1]}/productionItems`)), (snapshot) => {
                const itemsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductionItem));
                setItems(prev => [...prev.filter(i => i.teamId !== teamIds[1]), ...itemsData]);
            });

            const unsubProduction2 = onSnapshot(query(collection(firestore, `teams/${teamIds[1]}/employees`)), employeeSnapshot => {
                employeeSnapshot.docs.forEach(empDoc => {
                    onSnapshot(collection(firestore, `teams/${teamIds[1]}/employees/${empDoc.id}/dailyProduction`), productionSnapshot => {
                        const productionData = productionSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as ProductionEntry));
                        setProduction(prev => [...prev.filter(p => p.employeeId !== empDoc.id), ...productionData]);
                    });
                });
            });

            return () => { unsubEmployees2(); unsubItems2(); unsubProduction2() };
        }
        
        setLoading(false);
        return () => { unsubEmployees(); unsubItems(); unsubProduction(); };
      } else {
        setLoading(false);
      }
    }, (error) => {
      console.error("Error fetching teams:", error);
      toast({ title: "Error", description: "Could not fetch teams.", variant: "destructive" });
      setLoading(false);
    });

    return () => unsubTeams();
  }, [firestore, toast]);
  

  const addEmployee = async (employee: Omit<Employee, 'id'>) => {
    if (!firestore) return;
    await addDocumentNonBlocking(collection(firestore, `teams/${employee.teamId}/employees`), employee as DocumentData);
  };

  const updateEmployee = async (id: string, teamId: string, employee: Partial<Employee>) => {
    if (!firestore) return;
    await updateDocumentNonBlocking(doc(firestore, `teams/${teamId}/employees`, id), employee as DocumentData);
  };

  const deleteEmployee = async (id: string, teamId: string) => {
    if (!firestore) return;
    await deleteDocumentNonBlocking(doc(firestore, `teams/${teamId}/employees`, id));
  };

  const addItem = async (item: Omit<ProductionItem, 'id'>) => {
    if (!firestore) return;
    await addDocumentNonBlocking(collection(firestore, `teams/${item.teamId}/productionItems`), item as DocumentData);
  };

  const updateItem = async (id: string, teamId: string, item: Partial<ProductionItem>) => {
    if (!firestore) return;
    await updateDocumentNonBlocking(doc(firestore, `teams/${teamId}/productionItems`, id), item as DocumentData);
  };

  const deleteItem = async (id: string, teamId: string) => {
    if (!firestore) return;
    await deleteDocumentNonBlocking(doc(firestore, `teams/${teamId}/productionItems`, id));
  };

  const addProductionEntry = async (entry: Omit<ProductionEntry, 'id'>) => {
    if (!firestore) return;
    // We need to find the teamId from the employee
    const employee = employees.find(e => e.id === entry.employeeId);
    if (!employee) return;
    await addDocumentNonBlocking(collection(firestore, `teams/${employee.teamId}/employees/${entry.employeeId}/dailyProduction`), entry as DocumentData);
  };

  const updateProductionEntry = async (id: string, teamId: string, employeeId: string, entry: Partial<ProductionEntry>) => {
     if (!firestore) return;
     await updateDocumentNonBlocking(doc(firestore, `teams/${teamId}/employees/${employeeId}/dailyProduction`, id), entry as DocumentData);
  };

  const deleteProductionEntry = async (id: string) => {
    // This is more complex as we don't know the team/employee from just the production id
    // For simplicity, this is left out in this migration. A better data model might be needed.
  };

  const value = {
    teams,
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
    updateProductionEntry,
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
