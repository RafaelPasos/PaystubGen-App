'use client';

import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState } from 'react';
import { collection, onSnapshot, addDoc, updateDoc, deleteDoc, doc, DocumentData, query, writeBatch, getDocs, where } from 'firebase/firestore';
import { useFirestore } from '@/firebase';
import type { Employee, ProductionItem, ProductionEntry, Team } from '@/lib/types';
import { useToast } from "@/hooks/use-toast"
import { addDocumentNonBlocking, deleteDocumentNonBlocking, updateDocumentNonBlocking } from '@/firebase/non-blocking-updates';
import { startOfWeek, formatISO } from 'date-fns';

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

const defaultTeams = [
    { name: "Corazones" },
    { name: "Hojas" }
];

const defaultItems: Record<string, Omit<ProductionItem, 'id' | 'teamId'>[]> = {
  "Corazones": [
    { name: 'Chico', payRate: 10 },
    { name: 'Mediano', payRate: 12 },
    { name: 'Grande', payRate: 14 },
    { name: 'Mini', payRate: 10 },
  ],
  "Hojas": [
    { name: 'Blanca', payRate: 13 },
    { name: 'Capote', payRate: 8 },
    { name: 'Tira', payRate: 6 },
  ]
};

export const DataProvider = ({ children }: { children: ReactNode }) => {
  const firestore = useFirestore();
  const [teams, setTeams] = useState<Team[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [items, setItems] = useState<ProductionItem[]>([]);
  const [production, setProduction] = useState<ProductionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const createInitialProductionEntries = async (employeeId: string, teamId: string, teamItems: ProductionItem[]) => {
    if (!firestore) return;
    const batch = writeBatch(firestore);
    const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 }); // Monday

    for (const item of teamItems) {
        for (let i = 0; i < 6; i++) {
            const date = new Date(weekStart);
            date.setDate(date.getDate() + i);
            const dateString = formatISO(date, { representation: 'date' });
            
            const newEntry: Omit<ProductionEntry, 'id'> = {
                employeeId,
                productionItemId: item.id,
                date: dateString,
                quantity: 0
            };
            const docRef = doc(collection(firestore, `teams/${teamId}/employees/${employeeId}/dailyProduction`));
            batch.set(docRef, newEntry);
        }
    }
    await batch.commit();
  };


  useEffect(() => {
    if (!firestore) return;
    setLoading(true);

    const setupInitialData = async () => {
        const teamsRef = collection(firestore, 'teams');
        const teamsSnap = await getDocs(teamsRef);
        
        if (teamsSnap.empty) {
            const batch = writeBatch(firestore);
            for (const team of defaultTeams) {
                const teamRef = doc(teamsRef);
                batch.set(teamRef, team);

                const teamItems = defaultItems[team.name] || [];
                const itemsRef = collection(firestore, `teams/${teamRef.id}/productionItems`);
                teamItems.forEach(item => {
                    const newItemRef = doc(itemsRef);
                    batch.set(newItemRef, { ...item, teamId: teamRef.id });
                });
            }
            await batch.commit();
        }
    };


    const unsubTeams = onSnapshot(collection(firestore, 'teams'), async (snapshot) => {
      const teamsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Team));
      setTeams(teamsData);
      
      if (teamsData.length > 0) {
        const employeeUnsubs = teamsData.flatMap(team => {
            const employeesRef = collection(firestore, `teams/${team.id}/employees`);
            const itemsRef = collection(firestore, `teams/${team.id}/productionItems`);
            
            const unsubEmployees = onSnapshot(employeesRef, empSnap => {
                const teamEmployees = empSnap.docs.map(d => ({ id: d.id, ...d.data() } as Employee));
                setEmployees(prev => [...prev.filter(e => e.teamId !== team.id), ...teamEmployees]);
                
                const prodUnsubs = teamEmployees.map(emp => {
                    const prodRef = collection(firestore, `teams/${team.id}/employees/${emp.id}/dailyProduction`);
                    return onSnapshot(prodRef, prodSnap => {
                        const empProduction = prodSnap.docs.map(p => ({ id: p.id, ...p.data() } as ProductionEntry));
                        setProduction(prev => [...prev.filter(p => p.employeeId !== emp.id), ...empProduction]);
                    });
                });
                return () => prodUnsubs.forEach(unsub => unsub());
            });

            const unsubItems = onSnapshot(itemsRef, itemSnap => {
                const teamItems = itemSnap.docs.map(d => ({ id: d.id, ...d.data() } as ProductionItem));
                setItems(prev => [...prev.filter(i => i.teamId !== team.id), ...teamItems]);
            });

            return [unsubEmployees, unsubItems];
        });

        setLoading(false);
        return () => employeeUnsubs.forEach(unsub => unsub());
      } else {
         await setupInitialData();
         setLoading(false);
      }
    }, (error) => {
      console.error("Error fetching teams:", error);
      toast({ title: "Error", description: "Could not fetch teams.", variant: "destructive" });
      setLoading(false);
    });

    return () => {
        unsubTeams();
    };
  }, [firestore, toast]);
  

  const addEmployee = async (employee: Omit<Employee, 'id'>) => {
    if (!firestore) return;
    try {
      const newDocRef = await addDoc(collection(firestore, `teams/${employee.teamId}/employees`), employee);
      const teamItems = items.filter(item => item.teamId === employee.teamId);
      await createInitialProductionEntries(newDocRef.id, employee.teamId, teamItems);
    } catch(e) {
      console.error(e);
      toast({ title: "Error", description: "Could not add employee", variant: "destructive" });
    }
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
